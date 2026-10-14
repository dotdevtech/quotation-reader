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
    "o/h": "OH-Overhauled",
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
    # Values sometimes appear under a "CD" column header
    "cd ne": "NE-NEW",
    "cd ns": "NS-New Surplus",
    "cd sn": "SN-Stock New",
    "cd oh": "OH-Overhauled",
    "cd rd": "RD-Repaired",
    "cd ex": "EX-Exchange",
    "cd ar": "AR-As Removed",
    "cd fn": "FN- Factory New",
    "cd sv": "SV- Serviceable",
    "cd rb": "RB-Refurbish",
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

_CONDITION_KEY_ALIASES = {
    "CD",
    "COND",
    "COND.",
    "C/D",
    "COND CODE",
    "CONDITION CODE",
    "MATERIAL CONDITION",
    "PART CONDITION",
}

_PRICE_UNIT_KEY_ALIASES = {
    "UNIT PRICE",
    "PRICE EACH",
    "EACH",
    "UNIT EACH",
    "UNIT EA",
    "EA PRICE",
    "PER UNIT",
    "PRICE UNIT $",
    "SELL PRICE",
    "NET UNIT PRICE",
}

_TOTAL_PRICE_KEY_ALIASES = {
    "TOTAL",
    "EXT",
    "EXT.",
    "EXTENSION",
    "EXT PRICE",
    "EXTENDED",
    "EXTENDED PRICE",
    "LINE TOTAL",
    "LINE EXT",
    "AMOUNT",
    "NET AMOUNT",
    "LINE AMOUNT",
}


def _fold_key_alias(
    out: dict[str, Any], target: str, aliases: set[str]
) -> None:
    if target in out:
        return
    for alias in list(out.keys()):
        if alias.upper().strip() in aliases:
            out[target] = out.pop(alias)
            break


# US states for country inference when COUNTRY is missing
_US_STATE_BY_CODE: dict[str, str] = {
    "AL": "AL", "AK": "AK", "AZ": "AZ", "AR": "AR", "CA": "CA", "CO": "CO", "CT": "CT",
    "DE": "DE", "FL": "FL", "GA": "GA", "HI": "HI", "ID": "ID", "IL": "IL", "IN": "IN",
    "IA": "IA", "KS": "KS", "KY": "KY", "LA": "LA", "ME": "ME", "MD": "MD", "MA": "MA",
    "MI": "MI", "MN": "MN", "MS": "MS", "MO": "MO", "MT": "MT", "NE": "NE", "NV": "NV",
    "NH": "NH", "NJ": "NJ", "NM": "NM", "NY": "NY", "NC": "NC", "ND": "ND", "OH": "OH",
    "OK": "OK", "OR": "OR", "PA": "PA", "RI": "RI", "SC": "SC", "SD": "SD", "TN": "TN",
    "TX": "TX", "UT": "UT", "VT": "VT", "VA": "VA", "WA": "WA", "WV": "WV", "WI": "WI",
    "WY": "WY", "DC": "DC",
}

_US_STATE_BY_NAME: dict[str, str] = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA",
    "colorado": "CO", "connecticut": "CT", "delaware": "DE", "florida": "FL", "georgia": "GA",
    "hawaii": "HI", "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA",
    "kansas": "KS", "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
    "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV", "new hampshire": "NH",
    "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
    "north dakota": "ND", "ohio": "OH", "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA",
    "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", "tennessee": "TN",
    "texas": "TX", "utah": "UT", "vermont": "VT", "virginia": "VA", "washington": "WA",
    "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY", "district of columbia": "DC",
}

_US_ZIP_RE = re.compile(r"^\d{5}(?:-\d{4})?$")
_CITY_STATE_ZIP_RE = re.compile(
    r"^\s*(?P<city>.+?)[,\s]+(?P<state>[A-Za-z]{2}|[A-Za-z][A-Za-z\s]+?)(?:\s+(?P<zip>\d{5}(?:-\d{4})?))?\s*$"
)


def _match_us_state(raw: str) -> str | None:
    s = (raw or "").strip()
    if not s:
        return None
    code = s.upper()
    if code in _US_STATE_BY_CODE:
        return code
    return _US_STATE_BY_NAME.get(_norm(s))


def _normalize_country(raw: str) -> str:
    s = (raw or "").strip()
    n = _norm(s)
    if n in {
        "usa",
        "us",
        "u s",
        "u s a",
        "united states",
        "united states of america",
        "america",
    }:
        return "USA"
    return s


def _looks_us_zip(raw: str) -> bool:
    return bool(_US_ZIP_RE.match((raw or "").strip()))


def normalize_vendor_address(out: dict[str, Any]) -> None:
    """Infer/normalize vendor city, state, country and INTERNATIONAL VENDOR."""
    city = str(out.get("VENDOR ADDRESS CITY") or "").strip()
    state = str(out.get("VENDOR ADDRESS STATE") or "").strip()
    zip_code = str(out.get("VENDOR ADDRESS ZIP CODE") or "").strip()
    country = str(out.get("VENDOR ADDRESS COUNTRY") or "").strip()

    # Try to split "City, ST 12345" left in CITY (or LINE 1 spill)
    if city and (not state or not zip_code):
        m = _CITY_STATE_ZIP_RE.match(city)
        if m:
            maybe_state = _match_us_state(m.group("state"))
            if maybe_state or (not state and len(m.group("state").strip()) >= 2):
                city = m.group("city").strip(" ,")
                if not state:
                    state = maybe_state or m.group("state").strip()
                if not zip_code and m.group("zip"):
                    zip_code = m.group("zip").strip()

    us_state = _match_us_state(state) if state else None
    if us_state:
        state = us_state

    if country:
        country = _normalize_country(country)
    elif us_state or _looks_us_zip(zip_code):
        country = "USA"

    if city:
        out["VENDOR ADDRESS CITY"] = city
    if state:
        out["VENDOR ADDRESS STATE"] = state
    if zip_code:
        out["VENDOR ADDRESS ZIP CODE"] = zip_code
    if country:
        out["VENDOR ADDRESS COUNTRY"] = country

    intl = str(out.get("INTERNATIONAL VENDOR") or "").strip().lower()
    if country == "USA" or us_state or _looks_us_zip(zip_code):
        out["INTERNATIONAL VENDOR"] = "No"
    elif country and country != "USA":
        out["INTERNATIONAL VENDOR"] = "Yes"
    elif state and not us_state:
        # Non-US-looking region and no USA country → international
        out["INTERNATIONAL VENDOR"] = "Yes"
    elif intl in ("yes", "y", "true", "1"):
        out["INTERNATIONAL VENDOR"] = "Yes"
    elif intl in ("no", "n", "false", "0"):
        out["INTERNATIONAL VENDOR"] = "No"


def normalize_offer(offer: dict[str, Any]) -> dict[str, Any]:
    """Map CONDITION / PRICE TYPE / CERTIFICATION to controlled values; leftovers → NOTES."""
    out = {k: v for k, v in offer.items() if v is not None and str(v).strip()}
    notes = str(out.get("NOTES") or "").strip()

    _fold_key_alias(out, "PRICE TYPE", _PRICE_TYPE_KEY_ALIASES)
    _fold_key_alias(out, "CONDITION", _CONDITION_KEY_ALIASES)
    _fold_key_alias(out, "PRICE UNIT", _PRICE_UNIT_KEY_ALIASES)
    _fold_key_alias(out, "TOTAL PRICE", _TOTAL_PRICE_KEY_ALIASES)

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

    normalize_vendor_address(out)

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


# Known IMPEX sourcing platforms (marketplace channels — not vendor companies)
_PLATFORM_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bils(?:\.com)?\b|inventory\s+locator\s+service", re.I), "ILS"),
    (re.compile(r"\bpart\s*base\b|partbase\.com", re.I), "PartBase"),
    (
        re.compile(
            r"\bnet\s*components?\b|\bnet\s*componets?\b|\bnet\s*componet\b|"
            r"\bnetcomponents?\b|\bnetcomponet\b|netcomponents\.com",
            re.I,
        ),
        "Net Components",
    ),
]


def extract_platforms_from_text(source: str) -> str | None:
    """Detect ILS / PartBase / Net Components mentions → PLATFORM string."""
    if not source:
        return None
    found: list[str] = []
    for pattern, name in _PLATFORM_PATTERNS:
        if pattern.search(source) and name not in found:
            found.append(name)
    return "; ".join(found) if found else None


def _normalize_platform_value(raw: str) -> str:
    """Canonicalize known platform names inside an existing PLATFORM value."""
    parts = [p.strip() for p in re.split(r"[;,|/]+", raw) if p.strip()]
    out: list[str] = []
    for part in parts:
        matched = extract_platforms_from_text(part)
        if matched:
            for name in matched.split("; "):
                if name not in out:
                    out.append(name)
        elif part not in out:
            out.append(part)
    return "; ".join(out)


def fill_missing_platforms(
    offers: list[dict[str, Any]], source_text: str
) -> list[dict[str, Any]]:
    """Fill or normalize PLATFORM from known marketplace names in source text."""
    detected = extract_platforms_from_text(source_text)
    out: list[dict[str, Any]] = []
    for offer in offers:
        if not isinstance(offer, dict):
            continue
        item = dict(offer)
        existing = str(item.get("PLATFORM") or "").strip()
        if existing:
            item["PLATFORM"] = _normalize_platform_value(existing)
        elif detected:
            item["PLATFORM"] = detected
        out.append(item)
    return out
