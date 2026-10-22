"""Build Google Sheets webhook payload and POST completed extractions."""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import httpx

from . import db
from .config import BACKEND_ROOT
from .field_options import match_currency
from .settings_store import get_app_settings

EXPORT_DIR = BACKEND_ROOT / "exports"


def _s(offer: dict[str, Any], *keys: str) -> str:
    for k in keys:
        v = offer.get(k)
        if v is None:
            continue
        t = str(v).strip()
        if t and t.upper() not in ("N/A", "UNKNOWN", "NONE", "-"):
            return t
    return ""


def _truthy(raw: str) -> bool:
    return raw.strip().lower() in ("1", "true", "yes", "y", "on")


def _email_date_iso(email: dict[str, Any]) -> str:
    """Date the email was received — YYYY-MM-DD for webhook reference.date."""
    iso = (email.get("date_iso") or "").strip()
    if iso:
        return iso[:10]
    date_str = (email.get("date_str") or "").strip()
    m = re.match(r"(\d{4}-\d{2}-\d{2})", date_str)
    if m:
        return m.group(1)
    return datetime.utcnow().strftime("%Y-%m-%d")


def _condition_for_sheet(raw: str) -> str:
    """Map controlled CONDITION to a short sheet-friendly code when possible."""
    s = (raw or "").strip()
    if not s:
        return ""
    # Already a short code
    if re.fullmatch(r"[A-Za-z]{2}", s):
        return s.upper()
    # "OH-Overhauled" → "OH"
    if "-" in s:
        head = s.split("-", 1)[0].strip()
        if head and head.upper() != "NONE":
            return head.upper() if len(head) <= 3 else head
    if s.lower() in ("any",):
        return "ANY"
    if "none" in s.lower():
        return "None Specified"
    return s


def _alt_parts(raw: str) -> str:
    """Sheet expects comma-separated alt part numbers."""
    if not raw:
        return ""
    parts = [p.strip() for p in re.split(r"[;|/]+", raw) if p.strip()]
    return ", ".join(parts)


def _certs(raw: str) -> str:
    if not raw:
        return ""
    parts = [p.strip() for p in re.split(r"[;|/]+", raw) if p.strip()]
    return ", ".join(parts)


def _is_package(offer: dict[str, Any]) -> bool:
    pkg = _s(offer, "PACKAGE", "PACKAGE TYPE", "PACKAGE QUANTITY")
    if not pkg:
        return False
    return pkg.lower() not in ("no", "false", "0", "n")


def _parse_money_number(raw: str) -> Optional[float]:
    """Parse a money/qty string to float; return None if not a clear number."""
    t = (raw or "").strip()
    if not t:
        return None
    # Keep digits, dots, commas, minus; drop currency symbols/letters
    cleaned = re.sub(r"[^\d,.\-]", "", t)
    if not cleaned or cleaned in ("-", ".", ",", "-.", "-,"):
        return None
    # European-style 1.234,56 → 1234.56; US 1,234.56 → 1234.56
    if "," in cleaned and "." in cleaned:
        if cleaned.rfind(",") > cleaned.rfind("."):
            cleaned = cleaned.replace(".", "").replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
    elif "," in cleaned:
        parts = cleaned.split(",")
        if len(parts) == 2 and len(parts[1]) <= 2:
            cleaned = cleaned.replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
    try:
        return float(cleaned)
    except ValueError:
        return None


def _format_money_number(n: float) -> str:
    if abs(n - round(n)) < 1e-9:
        return str(int(round(n)))
    text = f"{n:.4f}".rstrip("0").rstrip(".")
    return text


def _total_price_for_sheet(offer: dict[str, Any]) -> str:
    """Prefer extracted TOTAL PRICE; else qty × unit when both are clear numbers."""
    total = _s(offer, "TOTAL PRICE")
    if total:
        return total
    price_type = _s(offer, "PRICE TYPE").lower()
    if price_type == "no quote":
        return ""
    qty = _parse_money_number(_s(offer, "QUANTITY OFFERED"))
    unit = _parse_money_number(_s(offer, "PRICE UNIT"))
    if qty is None or unit is None:
        return ""
    return _format_money_number(qty * unit)


def offer_to_part(offer: dict[str, Any]) -> dict[str, Any]:
    part: dict[str, Any] = {
        "partNum": _s(offer, "PART NUMBER"),
        "altPartNum": _alt_parts(_s(offer, "ALTERNATE PART NUMBER")),
        "nsn": _s(offer, "NSN"),
        "description": _s(offer, "DESCRIPTION"),
        "condition": _condition_for_sheet(_s(offer, "CONDITION")),
        "qtyOffered": _s(offer, "QUANTITY OFFERED"),
        "uom": _s(offer, "UOM") or "EA",
        "isPackage": _is_package(offer),
        "currency": match_currency(_s(offer, "CURRENCY")) or "USD",
        "qtyRequired": _s(offer, "QUANTITY REQUIRED"),
        "priceUnit": _s(offer, "PRICE UNIT"),
        "totalPrice": _total_price_for_sheet(offer),
        "deliveryLead": _s(offer, "DELIVERY LEAD"),
        "priceType": _s(offer, "PRICE TYPE"),
        "trace": _s(offer, "TRACE"),
        "certs": _certs(_s(offer, "CERTIFICATION DOCUMENTS")),
    }
    # Drop empty optional strings (keep bools / useful empties sparingly)
    return {k: v for k, v in part.items() if v not in ("", None) or k in ("isPackage",)}


def _first_shared(offers: list[dict[str, Any]], *keys: str) -> str:
    """Pick first non-empty value for a quote-level field across all part lines."""
    for key in keys:
        for offer in offers:
            v = _s(offer, key)
            if v:
                return v
    return ""


def build_webhook_payload(
    email: dict[str, Any],
    offers: list[dict[str, Any]],
    token: str,
) -> dict[str, Any]:
    """One vendor/reference/terms block + many parts — matches the Google Sheet form."""
    intl_raw = _first_shared(offers, "INTERNATIONAL VENDOR")
    international = _truthy(intl_raw) if intl_raw else False

    moq_raw = _first_shared(offers, "MOQ")
    moq = bool(moq_raw)

    notes_bits = [_s(o, "NOTES") for o in offers if _s(o, "NOTES")]
    notes = "; ".join(dict.fromkeys(notes_bits))

    parts = [offer_to_part(o) for o in offers]
    parts = [
        p
        for p in parts
        if p.get("partNum") or p.get("description") or p.get("priceUnit") or p.get("totalPrice")
    ]

    return {
        "token": token,
        "action": "save",
        "quoteSource": "Quotation Form",
        "vendor": {
            "vendorCompany": _first_shared(offers, "VENDOR COMPANY"),
            "internationalVendor": international,
            "vendorContactName": _first_shared(offers, "VENDOR CONTACT NAME"),
            "vendorPhone": _first_shared(offers, "VENDOR PHONE"),
            "vendorFax": _first_shared(offers, "VENDOR FAX"),
            "vendorEmail": _first_shared(offers, "VENDOR EMAIL"),
            "vendorWebsite": _first_shared(offers, "VENDOR WEBSITE"),
            "vendorAddr1": _first_shared(offers, "VENDOR ADDRESS LINE 1"),
            "vendorAddr2": _first_shared(offers, "VENDOR ADDRESS LINE 2"),
            "vendorAddr3": _first_shared(offers, "VENDOR ADDRESS LINE 3"),
            "vendorCity": _first_shared(offers, "VENDOR ADDRESS CITY"),
            "vendorState": _first_shared(offers, "VENDOR ADDRESS STATE"),
            "vendorZip": _first_shared(offers, "VENDOR ADDRESS ZIP CODE"),
            "vendorCountry": _first_shared(offers, "VENDOR ADDRESS COUNTRY"),
        },
        "reference": {
            "date": _email_date_iso(email),
            "quoteRef": _first_shared(offers, "QUOTE REFERENCE"),
            "rfqRef": _first_shared(offers, "RFQ REFERENCE"),
            "quoteValidity": _first_shared(offers, "Quote Validity Days"),
        },
        "terms": {
            "moq": moq,
            "minLineAmount": _first_shared(offers, "Minimum Line Amount $"),
            "minPoAmount": _first_shared(offers, "Minimum PO Amount $"),
            "creditCard": _first_shared(offers, "CREDIT CARD"),
            "wirePayment": _first_shared(offers, "WIRE PAYMENT"),
            "notes": notes,
        },
        "parts": parts,
    }


def export_extraction(extraction_id: int) -> Path:
    ext = db.get_extraction(extraction_id)
    if not ext:
        raise RuntimeError("Extraction not found")
    if not ext.get("result"):
        raise RuntimeError("No result to export")

    email = db.get_email(ext["email_uid"]) or {}
    offers = (ext["result"] or {}).get("offers") or []
    if not isinstance(offers, list):
        offers = []
    settings = get_app_settings()
    token = getattr(settings, "forward_webhook_token", "") or ""
    payload = build_webhook_payload(email, offers, token)

    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    path = EXPORT_DIR / f"extraction_{extraction_id}_{stamp}.json"
    path.write_text(
        json.dumps(
            {
                "extraction_id": extraction_id,
                "email_uid": ext["email_uid"],
                "exported_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
                "webhook_payload": payload,
                "raw_result": ext["result"],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return path


def forward_extraction(extraction_id: int, webhook_url: Optional[str] = None) -> dict[str, Any]:
    settings = get_app_settings()
    url = (webhook_url or settings.forward_webhook_url or "").strip()
    token = (getattr(settings, "forward_webhook_token", None) or "").strip()

    ext = db.get_extraction(extraction_id)
    if not ext:
        raise RuntimeError("Extraction not found")
    if ext.get("status") != "completed" or not ext.get("result"):
        raise RuntimeError("Extraction is not completed — extract with OpenAI first")
    if not db.is_email_quote_checked(ext["email_uid"]):
        raise RuntimeError(
            "Quote must be checked first. Open Check Quote, review the data, then click Mark checked."
        )

    offers = (ext["result"] or {}).get("offers") or []
    if not isinstance(offers, list) or not offers:
        raise RuntimeError("No offers to send")

    email = db.get_email(ext["email_uid"]) or {"uid": ext["email_uid"]}
    payload = build_webhook_payload(email, offers, token)
    path = export_extraction(extraction_id)

    if not url:
        db.set_email_forward_status(ext["email_uid"], "error")
        raise RuntimeError("Webhook URL not set. Open Settings and save Forward webhook URL.")

    if not token:
        # Still allow send if their Apps Script does not require token — warn in message
        pass

    try:
        last_err: Exception | None = None
        resp = None
        for attempt in range(2):
            try:
                with httpx.Client(timeout=60.0, follow_redirects=True) as client:
                    resp = client.post(url, json=payload)
                break
            except httpx.ConnectError as exc:
                last_err = exc
                msg = str(exc)
                if attempt == 0 and (
                    "name resolution" in msg.lower()
                    or "temporary failure" in msg.lower()
                    or "nodename" in msg.lower()
                ):
                    continue
                raise RuntimeError(
                    "Cannot reach the webhook host (DNS/network). "
                    "Check internet on this PC, then confirm the Webhook URL in Settings "
                    "(should start with https://script.google.com/macros/s/…/exec)."
                ) from exc
            except httpx.TimeoutException as exc:
                raise RuntimeError(
                    "Webhook timed out. Google Script may be slow — try again."
                ) from exc
        if resp is None and last_err is not None:
            raise RuntimeError(
                "Cannot reach the webhook host (DNS/network). "
                "Check internet, then re-check Webhook URL in Settings."
            ) from last_err
        assert resp is not None
        if resp.status_code >= 400:
            raise RuntimeError(f"Webhook HTTP {resp.status_code}: {resp.text[:300]}")

        # Apps Script often returns JSON { ok, success, error }
        body_text = (resp.text or "").strip()
        if body_text.startswith("{") or body_text.startswith("["):
            try:
                body = resp.json()
                if isinstance(body, dict):
                    ok_flag = body.get("ok", body.get("success"))
                    if ok_flag is False:
                        raise RuntimeError(
                            f"Sheet webapp rejected the save: {body.get('error') or body}"
                        )
            except RuntimeError:
                raise
            except Exception:
                pass
    except RuntimeError:
        db.set_email_forward_status(ext["email_uid"], "error")
        db.update_extraction(extraction_id, status=ext["status"], forwarded=False)
        raise
    except Exception as exc:
        db.set_email_forward_status(ext["email_uid"], "error")
        db.update_extraction(extraction_id, status=ext["status"], forwarded=False)
        raise RuntimeError(f"Webhook failed: {exc}") from exc

    db.update_extraction(extraction_id, status=ext["status"], forwarded=True)
    db.set_email_forward_status(ext["email_uid"], "sent")
    return {
        "ok": True,
        "forwarded": True,
        "status_code": resp.status_code,
        "export_path": str(path),
        "email_uid": ext["email_uid"],
        "parts_sent": len(payload.get("parts") or []),
        "payload_preview": {
            "reference": payload.get("reference"),
            "vendorCompany": (payload.get("vendor") or {}).get("vendorCompany"),
            "partCount": len(payload.get("parts") or []),
        },
    }


def forward_emails(email_uids: list[str], webhook_url: Optional[str] = None) -> dict[str, Any]:
    """Send each selected email's latest completed extraction to the webhook."""
    results: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for uid in email_uids:
        ext = db.get_latest_extraction_for_email(uid)
        if not ext:
            errors.append({"email_uid": uid, "error": "No completed extraction"})
            db.set_email_forward_status(uid, "error")
            continue
        try:
            results.append(forward_extraction(ext["id"], webhook_url))
        except Exception as exc:
            errors.append({"email_uid": uid, "error": str(exc)})
    return {
        "ok": len(errors) == 0,
        "sent": len(results),
        "failed": len(errors),
        "results": results,
        "errors": errors,
    }
