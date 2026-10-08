"""Controlled vocabularies for CONDITION, PRICE TYPE, and CERTIFICATION DOCUMENTS."""

from __future__ import annotations

import re
from typing import Any

CONDITION_OPTIONS = [
    "NE-NEW",
    "NS-New Surplus",
    "SN-Stock New",
    "OH-Overhauled",
    "RD-Repaired",
    "EX-Exchange",
    "AR-As Removed",
    "FN- Factory New",
    "ANY",
    "SV- Serviceable",
    "RB-Refurbish",
    "None Specified",
]

PRICE_TYPE_OPTIONS = [
    "Outright",
    "Exchange",
    "Make Offer",
    "Negotiable",
    "Need info",
    "No quote",
]

CERTIFICATION_OPTIONS = [
    "FAA 8130",
    "EASA Form 1",
    "COC",
    "NONE",
    "OEM CERT",
    "DUAL",
    "MATERIAL TEST CERT",
    "CALIBIRATION",
    "JAA F1",
]


def _norm(s: str) -> str:
    return " ".join(s.lower().replace("_", " ").replace("/", " ").split())


# Fuzzy aliases → canonical CONDITION
_CONDITION_ALIASES: dict[str, str] = {
    "ne": "NE-NEW",
    "ne new": "NE-NEW",
    "new": "NE-NEW",
    "new surplus": "NS-New Surplus",
    "ns": "NS-New Surplus",
    "ns new surplus": "NS-New Surplus",
    "stock new": "SN-Stock New",
    "sn": "SN-Stock New",
    "sn stock new": "SN-Stock New",
    "oh": "OH-Overhauled",
    "o h": "OH-Overhauled",
    "overhauled": "OH-Overhauled",
    "oh overhauled": "OH-Overhauled",
    "rd": "RD-Repaired",
    "repaired": "RD-Repaired",
    "rd repaired": "RD-Repaired",
    "ex": "EX-Exchange",
    "exchange": "EX-Exchange",
    "ex exchange": "EX-Exchange",
    "ar": "AR-As Removed",
    "as removed": "AR-As Removed",
    "ar as removed": "AR-As Removed",
    "fn": "FN- Factory New",
    "factory new": "FN- Factory New",
    "fn factory new": "FN- Factory New",
    "any": "ANY",
    "sv": "SV- Serviceable",
    "serviceable": "SV- Serviceable",
    "sv serviceable": "SV- Serviceable",
    "rb": "RB-Refurbish",
    "refurbish": "RB-Refurbish",
    "refurbished": "RB-Refurbish",
    "rb refurbish": "RB-Refurbish",
    "none": "None Specified",
    "none specified": "None Specified",
    "n s": "None Specified",
    "not specified": "None Specified",
}

_PRICE_ALIASES: dict[str, str] = {
    "outright": "Outright",
    "firm": "Outright",
    "fixed": "Outright",
    "sale": "Outright",
    "buy": "Outright",
    "purchase": "Outright",
    "exchange": "Exchange",
    "ex": "Exchange",
    "make offer": "Make Offer",
    "mo": "Make Offer",
    "offer": "Make Offer",
    "negotiable": "Negotiable",
    "nego": "Negotiable",
    "need info": "Need info",
    "need information": "Need info",
    "info needed": "Need info",
    "tbd": "Need info",
    "no quote": "No quote",
    "nq": "No quote",
    "not quoting": "No quote",
    "no bid": "No quote",
}

_CERT_ALIASES: dict[str, str] = {
    "faa 8130": "FAA 8130",
    "8130": "FAA 8130",
    "faa": "FAA 8130",
    "8130 3": "FAA 8130",
    "faa form 8130": "FAA 8130",
    "easa form 1": "EASA Form 1",
    "easa": "EASA Form 1",
    "easa f1": "EASA Form 1",
    "form 1": "EASA Form 1",
    "coc": "COC",
    "c of c": "COC",
    "certificate of conformity": "COC",
    "certificate of conformance": "COC",
    "none": "NONE",
    "n a": "NONE",
    "oem cert": "OEM CERT",
    "oem": "OEM CERT",
    "oem certificate": "OEM CERT",
    "dual": "DUAL",
    "dual cert": "DUAL",
    "dual release": "DUAL",
    "material test cert": "MATERIAL TEST CERT",
    "mtc": "MATERIAL TEST CERT",
    "material cert": "MATERIAL TEST CERT",
    "mill cert": "MATERIAL TEST CERT",
    "calibiration": "CALIBIRATION",
    "calibration": "CALIBIRATION",
    "calib": "CALIBIRATION",
    "jaa f1": "JAA F1",
    "jaa": "JAA F1",
    "jaa form 1": "JAA F1",
}


def match_condition(raw: str) -> str | None:
    s = _norm(raw)
    if not s:
        return None
    for opt in CONDITION_OPTIONS:
        if _norm(opt) == s:
            return opt
    return _CONDITION_ALIASES.get(s)


def match_price_type(raw: str) -> str | None:
    s = _norm(raw)
    if not s:
        return None
    for opt in PRICE_TYPE_OPTIONS:
        if _norm(opt) == s:
            return opt
    return _PRICE_ALIASES.get(s)


def match_certification_token(raw: str) -> str | None:
    s = _norm(raw)
    if not s:
        return None
    for opt in CERTIFICATION_OPTIONS:
        if _norm(opt) == s:
            return opt
    return _CERT_ALIASES.get(s)


def _split_multi(raw: str) -> list[str]:
    text = raw.replace("|", ";").replace("/", ";").replace(",", ";")
    text = re.sub(r"\band\b", ";", text, flags=re.IGNORECASE)
    text = re.sub(r"\b&\b", ";", text)
    parts: list[str] = []
    for chunk in text.split(";"):
        t = chunk.strip()
        if t:
            parts.append(t)
    return parts


def _extract_certs_from_blob(raw: str) -> tuple[list[str], list[str]]:
    """Find known certs inside a free-text blob; return (matched, leftover_unmatched)."""
    matched: list[str] = []
    seen: set[str] = set()
    leftover = raw
    # Longest options first so "EASA Form 1" wins over shorter aliases
    search_terms: list[tuple[str, str]] = []
    for opt in CERTIFICATION_OPTIONS:
        search_terms.append((_norm(opt), opt))
    for alias, opt in _CERT_ALIASES.items():
        search_terms.append((alias, opt))
    search_terms.sort(key=lambda x: len(x[0]), reverse=True)

    lower = leftover.lower()
    for alias, opt in search_terms:
        if alias and alias in _norm(leftover):
            if opt not in seen:
                seen.add(opt)
                matched.append(opt)
            # remove a loose occurrence from leftover for notes cleanliness
            pattern = re.compile(re.escape(alias), re.IGNORECASE)
            leftover = pattern.sub(" ", leftover, count=1)

    # Also try token split
    for part in _split_multi(raw):
        m = match_certification_token(part)
        if m and m not in seen:
            seen.add(m)
            matched.append(m)

    leftover_clean = re.sub(r"[\s;|,/&\-]+", " ", leftover).strip()
    # Drop leftover if it's only noise words
    noise = {"and", "or", "with", "plus", "the", "a", "of", "form", "certificate", "cert"}
    leftover_tokens = [t for t in leftover_clean.split() if t.lower() not in noise]
    unmatched = [" ".join(leftover_tokens)] if leftover_tokens and not matched else (
        [leftover_clean] if leftover_clean and not matched else (
            [" ".join(leftover_tokens)] if leftover_tokens and matched and len("".join(leftover_tokens)) > 2 else []
        )
    )
    # If we matched something, only keep leftover if meaningful
    if matched:
        junk = re.sub(r"[^a-zA-Z0-9]+", "", leftover_clean)
        if len(junk) < 3:
            unmatched = []
        elif leftover_tokens:
            unmatched = [" ".join(leftover_tokens)]
        else:
            unmatched = []
    return matched, unmatched


def _append_note(notes: str, extra: str) -> str:
    extra = extra.strip()
    if not extra:
        return notes
    if not notes:
        return extra
    if extra in notes:
        return notes
    return f"{notes.rstrip()}; {extra}"


# Vendor PDFs often label PRICE TYPE as "Quote Type" — fold those keys into PRICE TYPE.
_PRICE_TYPE_KEY_ALIASES = {
    "QUOTE TYPE",
    "QUOTETYPE",
    "TYPE OF QUOTE",
    "PRICING TYPE",
    "SALE TYPE",
    "QUOTE_TYPE",
}


def normalize_offer(offer: dict[str, Any]) -> dict[str, Any]:
    """Map CONDITION / PRICE TYPE / CERTIFICATION to controlled values; leftovers → NOTES."""
    out = {k: v for k, v in offer.items() if v is not None and str(v).strip()}
    notes = str(out.get("NOTES") or "").strip()

    if "PRICE TYPE" not in out:
        for alias in list(out.keys()):
            if alias.upper().strip() in _PRICE_TYPE_KEY_ALIASES:
                out["PRICE TYPE"] = out.pop(alias)
                break

    if "CONDITION" in out:
        raw = str(out["CONDITION"]).strip()
        matched = match_condition(raw)
        if matched:
            out["CONDITION"] = matched
        else:
            del out["CONDITION"]
            notes = _append_note(notes, f"Original CONDITION (unmapped): {raw}")

    if "PRICE TYPE" in out:
        raw = str(out["PRICE TYPE"]).strip()
        matched = match_price_type(raw)
        if matched:
            out["PRICE TYPE"] = matched
        else:
            del out["PRICE TYPE"]
            notes = _append_note(notes, f"Original PRICE TYPE (unmapped): {raw}")

    if "CERTIFICATION DOCUMENTS" in out:
        raw = str(out["CERTIFICATION DOCUMENTS"]).strip()
        matched, unmatched = _extract_certs_from_blob(raw)
        if matched:
            out["CERTIFICATION DOCUMENTS"] = "; ".join(matched)
        else:
            del out["CERTIFICATION DOCUMENTS"]
        if unmatched:
            notes = _append_note(
                notes,
                f"Original CERTIFICATION (unmapped): {'; '.join(unmatched)}",
            )

    if notes:
        out["NOTES"] = notes
    elif "NOTES" in out and not str(out["NOTES"]).strip():
        del out["NOTES"]

    return out


def normalize_offers(offers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [normalize_offer(o) for o in offers if isinstance(o, dict)]


# PDF text often glues the value to the next label, e.g. "Quote Type: OutrightLead Time: 1 Days"
_QUOTE_TYPE_IN_TEXT = re.compile(
    r"(?i)(?:quote\s*type|price\s*type|pricing\s*type|sale\s*type|type\s*of\s*quote)"
    r"\s*[:\-]?\s*"
    r"(outright|exchange|make\s*offer|negotiable|need\s*info(?:rmation)?|no\s*quote|"
    r"firm|fixed|sale|mo|nq|buy|purchase|nego|tbd|not\s*quoting|no\s*bid)",
)


def extract_price_type_from_text(source: str) -> str | None:
    """Pull PRICE TYPE from source text when labeled Quote Type / Price Type / etc."""
    if not source:
        return None
    m = _QUOTE_TYPE_IN_TEXT.search(source)
    if not m:
        return None
    return match_price_type(m.group(1))


def fill_missing_price_types(
    offers: list[dict[str, Any]], source_text: str
) -> list[dict[str, Any]]:
    """If OpenAI left PRICE TYPE blank, fill from Quote Type / Price Type in source text."""
    filled = extract_price_type_from_text(source_text)
    if not filled:
        return offers
    out: list[dict[str, Any]] = []
    for offer in offers:
        if not isinstance(offer, dict):
            continue
        item = dict(offer)
        if not str(item.get("PRICE TYPE") or "").strip():
            item["PRICE TYPE"] = filled
        out.append(item)
    return out
