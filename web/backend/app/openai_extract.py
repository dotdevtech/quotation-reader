"""OpenAI IMPEX 9 quotation extraction queue (cost-aware)."""

from __future__ import annotations

import json
import re
import threading
from typing import Any

from . import db
from .attachments import attachment_dir
from .doc_text import extract_file_text
from .imap_sync import ensure_message_body
from .prompt import (
    MAX_ATTACHMENT_CHARS,
    MAX_EMAIL_BODY_CHARS,
    MAX_TOTAL_CHARS,
    SYSTEM_PROMPT,
)
from .settings_store import get_app_settings

_queue_lock = threading.Lock()
_stop_event = threading.Event()


def start_extraction_job(email_uids: list[str], force: bool = False) -> int:
    if not email_uids:
        raise ValueError("No emails selected")
    settings = get_app_settings()
    if not settings.openai_api_key:
        raise RuntimeError("OpenAI API key not set. Open Settings and save it.")

    # Skip already-extracted unless force (saves API cost)
    uids: list[str] = []
    for uid in email_uids:
        status = db.get_email_extraction_status(uid)
        if status == "completed" and not force:
            continue
        uids.append(uid)
    if not uids:
        raise ValueError("Selected emails already have extracted data. Use force to re-run.")

    _stop_event.clear()
    job_id = db.create_job(uids)
    for uid in uids:
        db.set_email_extraction_status(uid, "pending")
    thread = threading.Thread(target=_run_job, args=(job_id,), daemon=True)
    thread.start()
    return job_id


def stop_extraction_jobs() -> dict[str, Any]:
    """Request stop: finish the current mail (if any), skip the rest of the queue."""
    _stop_event.set()
    stats = db.cancel_pending_scans()
    counts = db.count_active_scans()
    return {
        "ok": True,
        "message": (
            "Scanning stop requested. Queued mails were cancelled. "
            "If one mail is mid-scan, it will finish, then the queue stops."
        ),
        **stats,
        **counts,
    }


def get_extraction_queue_status() -> dict[str, Any]:
    counts = db.count_active_scans()
    scanning = counts["pending_or_running_emails"] > 0 or counts["active_jobs"] > 0 or (
        _queue_lock.locked() and not _stop_event.is_set()
    )
    return {
        "scanning": bool(scanning),
        "stop_requested": _stop_event.is_set(),
        **counts,
    }


def _run_job(job_id: int) -> None:
    with _queue_lock:
        if _stop_event.is_set():
            db.cancel_pending_scans()
            db.update_job(job_id, "cancelled", error="Stopped by user")
            return
        db.update_job(job_id, "running")
        job = db.get_job(job_id)
        if not job:
            return
        try:
            stopped = False
            for ext in job["extractions"]:
                if _stop_event.is_set():
                    stopped = True
                    break
                # Skip rows already cancelled by stop_extraction_jobs()
                if (ext.get("status") or "") == "cancelled":
                    continue
                # Re-read in case status changed while waiting
                fresh = db.get_extraction(ext["id"])
                if fresh and (fresh.get("status") or "") == "cancelled":
                    continue
                if (fresh or ext).get("status") in ("completed", "error", "cancelled"):
                    continue
                _process_one(ext["id"], ext["email_uid"])
                if _stop_event.is_set():
                    stopped = True
                    break

            if stopped or _stop_event.is_set():
                db.cancel_pending_scans()
                db.update_job(job_id, "cancelled", error="Stopped by user")
                return

            job = db.get_job(job_id)
            failed = [e for e in (job or {}).get("extractions", []) if e["status"] == "error"]
            done_like = [
                e
                for e in (job or {}).get("extractions", [])
                if e["status"] in ("completed", "error", "cancelled")
            ]
            if failed and len(failed) == len(job["extractions"]):
                db.update_job(job_id, "error", error="All extractions failed")
            elif failed:
                db.update_job(job_id, "completed_with_errors")
            elif len(done_like) == len(job["extractions"]):
                db.update_job(job_id, "completed")
            else:
                db.update_job(job_id, "completed")
        except Exception as exc:
            db.update_job(job_id, "error", error=str(exc))


def _process_one(extraction_id: int, email_uid: str) -> None:
    db.update_extraction(extraction_id, "running")
    db.set_email_extraction_status(email_uid, "running", extraction_id)
    try:
        email = ensure_message_body(email_uid)
        if not email:
            raise RuntimeError(f"Email {email_uid} not found")

        payload = build_extraction_payload(email)
        offers = call_openai_extract(payload)
        from .field_options import (
            fill_missing_platforms,
            fill_missing_price_types,
            normalize_offers,
        )

        offers = normalize_offers(offers if isinstance(offers, list) else [])
        # Vendor PDFs often label this "Quote Type"; text may glue "OutrightLead Time"
        offers = fill_missing_price_types(offers, payload)
        # ILS / PartBase / Net Components = PLATFORM (not vendor)
        offers = fill_missing_platforms(offers, payload)
        result = {"offers": offers, "offer_count": len(offers)}
        db.update_extraction(extraction_id, "completed", result=result)
        db.set_email_extraction_status(email_uid, "completed", extraction_id)
    except Exception as exc:
        db.update_extraction(extraction_id, "error", error=str(exc))
        db.set_email_extraction_status(email_uid, "error", extraction_id)


def build_extraction_payload(email: dict[str, Any]) -> str:
    text = (email.get("body_text") or "").strip()
    if not text and email.get("body_html"):
        text = re.sub(r"<[^>]+>", " ", email["body_html"] or "")
        text = re.sub(r"\s+", " ", text).strip()
    if len(text) > MAX_EMAIL_BODY_CHARS:
        text = text[:MAX_EMAIL_BODY_CHARS] + "\n…[email body truncated for cost]"

    parts = [
        "=== EMAIL HEADERS ===",
        f"From: {email.get('from_addr') or ''}",
        f"To: {email.get('to_addr') or ''}",
        f"Date: {email.get('date_str') or ''}",
        f"Subject: {email.get('subject') or ''}",
        "",
        "=== EMAIL BODY ===",
        text or "(empty body)",
    ]

    uid = str(email.get("uid") or "")
    atts = email.get("attachments") or []
    remaining = MAX_TOTAL_CHARS - sum(len(p) for p in parts)
    for att in atts:
        if remaining <= 500:
            parts.append("\n…[further attachments omitted for cost]")
            break
        filename = att.get("filename") or "file"
        path = attachment_dir(uid) / filename
        per_budget = min(MAX_ATTACHMENT_CHARS, remaining // 2)
        extracted = extract_file_text(path, max_chars=per_budget)
        if not extracted:
            continue
        block = f"\n=== ATTACHMENT: {filename} ===\n{extracted}\n"
        parts.append(block)
        remaining -= len(block)

    return "\n".join(parts)


def call_openai_extract(email_payload: str) -> list[dict[str, Any]]:
    from openai import OpenAI

    settings = get_app_settings()
    client = OpenAI(api_key=settings.openai_api_key)

    response = client.chat.completions.create(
        model=settings.openai_model or "gpt-4o-mini",
        temperature=0,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    "Extract vendor quotation offers from the following email + attachment text. "
                    "Return ONLY the JSON array.\n"
                    "Reminders:\n"
                    "- Column 'CD' / 'Cond' = CONDITION (map to controlled list).\n"
                    "- CURRENCY must be an alphabetic code only: "
                    "USD, EUR, CAD, GBP, YEN, PKR, AED, or OTHER — never $, €, £, ¥.\n"
                    "- 'Unit Price' / 'Each' / 'Unit Each' = PRICE UNIT; "
                    "'Total' / 'Extension' / 'Ext' = TOTAL PRICE (do not swap).\n"
                    "- If Unit Price cell says 'No Quote' / NQ / 'Not quoting' / 'No Bid': "
                    "set PRICE TYPE=No quote, omit PRICE UNIT/TOTAL PRICE, and add "
                    "'Unit price: No Quote' (or vendor's exact words) to NOTES.\n"
                    "- 'Quote Type: Outright' (even glued like 'OutrightLead Time') → PRICE TYPE Outright.\n"
                    "- Put restrictions / special instructions into NOTES.\n"
                    "- Min Line Amount = per product/line; Min PO Amount = whole order.\n"
                    "- Split vendor CITY / STATE / ZIP / COUNTRY. If country missing but "
                    "state is a US state (or US ZIP), set COUNTRY=USA and INTERNATIONAL VENDOR=No; "
                    "if state is not a US state, treat as international.\n"
                    "- ILS, PartBase, Net Components (and close spellings) = PLATFORM, not vendor.\n\n"
                    + email_payload
                ),
            },
        ],
    )
    content = (response.choices[0].message.content or "").strip()
    return parse_offers_json(content)


def parse_offers_json(content: str) -> list[dict[str, Any]]:
    raw = content.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    data = json.loads(raw)
    if isinstance(data, dict):
        # tolerate accidental wrapper
        for key in ("offers", "data", "results", "items"):
            if isinstance(data.get(key), list):
                data = data[key]
                break
        else:
            data = [data]
    if not isinstance(data, list):
        raise RuntimeError("OpenAI did not return a JSON array of offers")
    cleaned: list[dict[str, Any]] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        offer = {
            str(k): v
            for k, v in item.items()
            if v is not None and str(v).strip() not in ("", "N/A", "Unknown", "null")
        }
        if offer:
            cleaned.append(offer)
    return cleaned
