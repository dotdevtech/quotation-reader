"""Save and serve email attachments on disk."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Optional

from .config import BACKEND_ROOT
from .imap_client import AttachmentInfo

ATTACH_ROOT = BACKEND_ROOT / "data" / "attachments"

# Only keep business document files — skip images (png/jpg/gif/…) and similar
DOCUMENT_EXTENSIONS = {
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".xlsm",
    ".csv",
    ".ods",
    ".odt",
    ".rtf",
    ".txt",
    ".ppt",
    ".pptx",
    ".zip",
    ".rar",
    ".7z",
}

DOCUMENT_CONTENT_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/rtf",
    "text/csv",
    "text/plain",
    "application/zip",
    "application/x-zip-compressed",
}

IMAGE_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".bmp",
    ".webp",
    ".svg",
    ".ico",
    ".tif",
    ".tiff",
    ".heic",
}


def guess_media_type(filename: str, content_type: str = "") -> str:
    ext = Path(filename or "").suffix.lower()
    by_ext = {
        ".pdf": "application/pdf",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xls": "application/vnd.ms-excel",
        ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".doc": "application/msword",
        ".csv": "text/csv",
        ".txt": "text/plain",
        ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".ppt": "application/vnd.ms-powerpoint",
        ".zip": "application/zip",
    }
    if ext in by_ext:
        return by_ext[ext]
    ctype = (content_type or "").split(";")[0].strip().lower()
    if ctype and ctype != "application/octet-stream":
        return ctype
    return "application/octet-stream"


def is_document_attachment(filename: str, content_type: str = "") -> bool:
    """Return True for PDF / Excel / Word / etc. False for pictures and junk."""
    name = (filename or "").strip().lower()
    ctype = (content_type or "").split(";")[0].strip().lower()
    ext = Path(name).suffix.lower() if name else ""

    if ext in IMAGE_EXTENSIONS or ctype.startswith("image/"):
        return False
    if ext in DOCUMENT_EXTENSIONS:
        return True
    if ctype in DOCUMENT_CONTENT_TYPES:
        return True
    if "officedocument" in ctype or "msword" in ctype or "ms-excel" in ctype:
        return True
    return False


def _safe_name(name: str) -> str:
    name = Path(name).name.strip() or "attachment"
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name)


def attachment_dir(uid: str) -> Path:
    return ATTACH_ROOT / str(uid)


def clear_all_attachment_files() -> int:
    """Remove all on-disk attachment folders. Returns number of uid folders removed."""
    import shutil

    if not ATTACH_ROOT.exists():
        return 0
    removed = 0
    for child in list(ATTACH_ROOT.iterdir()):
        if child.is_dir():
            shutil.rmtree(child, ignore_errors=True)
            removed += 1
        elif child.is_file():
            child.unlink(missing_ok=True)
    return removed


def store_attachments(uid: str, attachments: list[AttachmentInfo]) -> list[dict[str, Any]]:
    """Write document attachments to disk (skips images)."""
    dest = attachment_dir(uid)
    dest.mkdir(parents=True, exist_ok=True)
    meta: list[dict[str, Any]] = []
    used_names: set[str] = set()

    docs = [
        att
        for att in attachments
        if is_document_attachment(att.filename, att.content_type)
    ]

    for i, att in enumerate(docs):
        filename = _safe_name(att.filename)
        if filename in used_names:
            stem, suffix = Path(filename).stem, Path(filename).suffix
            n = 1
            while f"{stem}_{n}{suffix}" in used_names:
                n += 1
            filename = f"{stem}_{n}{suffix}"
        used_names.add(filename)

        path = dest / filename
        path.write_bytes(att.data)
        meta.append(
            {
                "index": i,
                "filename": filename,
                "content_type": att.content_type,
                "size": att.size,
                "part_index": att.part_index,
                "stored": True,
            }
        )
    return meta


def attachments_on_disk(uid: str, meta: list[dict[str, Any]]) -> bool:
    docs = [
        item
        for item in meta
        if is_document_attachment(item.get("filename") or "", item.get("content_type") or "")
    ]
    if not docs:
        return True
    dest = attachment_dir(uid)
    if not dest.exists():
        return False
    for item in docs:
        name = item.get("filename")
        if not name:
            return False
        if not (dest / name).is_file():
            return False
    return True


def resolve_attachment_path(uid: str, index: int, meta: list[dict[str, Any]]) -> Optional[Path]:
    if index < 0 or index >= len(meta):
        return None
    item = meta[index]
    name = item.get("filename")
    if not name:
        return None
    path = attachment_dir(uid) / name
    if path.is_file():
        return path
    return None


def filter_document_meta(meta: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drop image/non-document entries from cached metadata and re-index."""
    docs = [
        dict(item)
        for item in meta
        if is_document_attachment(item.get("filename") or "", item.get("content_type") or "")
    ]
    for i, item in enumerate(docs):
        item["index"] = i
    return docs
