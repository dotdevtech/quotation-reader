"""IMAP helpers for listing, fetching, and saving attachments."""

from __future__ import annotations

import email
import imaplib
import re
import ssl
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from email.header import decode_header, make_header
from email.message import Message
from pathlib import Path
from typing import Optional


# IMAP date keywords must always be English month abbreviations
_IMAP_MONTHS = (
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
)


def imap_date(d: date) -> str:
    return f"{d.day:02d}-{_IMAP_MONTHS[d.month - 1]}-{d.year}"


@dataclass
class AttachmentInfo:
    filename: str
    content_type: str
    size: int
    part_index: int
    data: bytes = b""


@dataclass
class EmailSummary:
    uid: str
    subject: str
    from_addr: str
    date_str: str
    date_obj: Optional[datetime]
    has_attachments: bool
    preview: str = ""


@dataclass
class EmailDetail:
    uid: str
    subject: str
    from_addr: str
    to_addr: str
    date_str: str
    body_text: str
    body_html: str
    attachments: list[AttachmentInfo] = field(default_factory=list)


def decode_mime_header(value: Optional[str]) -> str:
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except Exception:
        return value


def parse_email_date(raw: Optional[str]) -> tuple[str, Optional[datetime]]:
    if not raw:
        return "", None
    try:
        dt = email.utils.parsedate_to_datetime(raw)
        if dt.tzinfo is not None:
            dt = dt.astimezone().replace(tzinfo=None)
        return dt.strftime("%Y-%m-%d %H:%M"), dt
    except Exception:
        return raw, None


def _safe_filename(name: str) -> str:
    name = Path(name).name.strip() or "attachment"
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name)


def _month_chunks(start: date, end: date) -> list[tuple[date, date]]:
    """Split a long range into month-sized chunks (safer for IMAP servers)."""
    chunks: list[tuple[date, date]] = []
    cursor = start
    while cursor <= end:
        if cursor.month == 12:
            next_month = date(cursor.year + 1, 1, 1)
        else:
            next_month = date(cursor.year, cursor.month + 1, 1)
        chunk_end = min(end, next_month - timedelta(days=1))
        chunks.append((cursor, chunk_end))
        cursor = next_month
    return chunks


class ImapClient:
    def __init__(self, host: str, port: int = 993, timeout: float = 120.0) -> None:
        self.host = host
        self.port = port
        self.timeout = timeout
        self._username = ""
        self._password = ""
        self._folder = "INBOX"
        self._conn: Optional[imaplib.IMAP4_SSL] = None

    @property
    def connected(self) -> bool:
        return self._conn is not None

    def connect(self, username: str, password: str) -> None:
        self.disconnect()
        self._username = username
        self._password = password
        self._open()

    def _open(self) -> None:
        context = ssl.create_default_context()
        self._conn = imaplib.IMAP4_SSL(self.host, self.port, ssl_context=context)
        try:
            self._conn.sock.settimeout(self.timeout)
        except Exception:
            pass
        self._conn.login(self._username, self._password)
        self.select_folder(self._folder)

    def reconnect(self) -> None:
        self.disconnect()
        if not self._username:
            raise RuntimeError("Not connected to the mail server.")
        self._open()

    def disconnect(self) -> None:
        if self._conn is None:
            return
        try:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn.logout()
        except Exception:
            pass
        self._conn = None

    def _require(self) -> imaplib.IMAP4_SSL:
        if self._conn is None:
            raise RuntimeError("Not connected to the mail server.")
        return self._conn

    def list_folders(self) -> list[str]:
        conn = self._require()
        status, data = conn.list()
        if status != "OK" or not data:
            return ["INBOX"]
        folders: list[str] = []
        for raw in data:
            if not raw:
                continue
            line = raw.decode(errors="replace") if isinstance(raw, bytes) else str(raw)
            match = re.search(r'"([^"]*)"$', line)
            if match:
                folders.append(match.group(1))
            else:
                parts = line.split()
                if parts:
                    folders.append(parts[-1].strip('"'))
        return folders or ["INBOX"]

    def select_folder(self, folder: str = "INBOX") -> None:
        conn = self._require()
        self._folder = folder
        status, _ = conn.select(folder, readonly=True)
        if status != "OK":
            raise RuntimeError(f"Could not open folder: {folder}")

    def search_uids(self, start: date, end: date, progress=None) -> list[str]:
        """Return UIDs for messages with INTERNALDATE in [start, end] inclusive.

        Searches month-by-month so long ranges (e.g. 6–9 months) do not
        overload Bluehost / cPanel IMAP.
        """
        if start > end:
            return []

        seen: set[str] = set()
        ordered: list[str] = []
        chunks = _month_chunks(start, end)

        for idx, (c_start, c_end) in enumerate(chunks, start=1):
            if progress:
                progress(f"Searching mailbox… month {idx}/{len(chunks)}")
            try:
                part = self._search_range(c_start, c_end)
            except (imaplib.IMAP4.abort, imaplib.IMAP4.error, OSError, TimeoutError):
                self.reconnect()
                part = self._search_range(c_start, c_end)
            for uid in part:
                if uid not in seen:
                    seen.add(uid)
                    ordered.append(uid)
        return ordered

    def _search_range(self, start: date, end: date) -> list[str]:
        conn = self._require()
        before = end + timedelta(days=1)
        criterion = f"(SINCE {imap_date(start)} BEFORE {imap_date(before)})"
        status, data = conn.uid("search", None, criterion)
        if status != "OK":
            raise RuntimeError(f"IMAP search failed for {start} → {end}")
        if not data or not data[0]:
            return []
        return data[0].decode().split()

    def fetch_summaries(self, uids: list[str], progress=None) -> list[EmailSummary]:
        if not uids:
            return []
        summaries: list[EmailSummary] = []
        seen_uids: set[str] = set()
        batch_size = 20  # small batches avoid Bluehost command/response limits

        for i in range(0, len(uids), batch_size):
            batch = uids[i : i + batch_size]
            try:
                batch_summaries = self._fetch_header_batch(batch)
            except (imaplib.IMAP4.abort, imaplib.IMAP4.error, OSError, TimeoutError):
                self.reconnect()
                batch_summaries = self._fetch_header_batch(batch)
            except Exception:
                # Fall back to one-by-one for this batch
                batch_summaries = []
                for uid in batch:
                    try:
                        batch_summaries.extend(self._fetch_header_batch([uid]))
                    except Exception:
                        continue

            for s in batch_summaries:
                if s.uid in seen_uids:
                    continue
                seen_uids.add(s.uid)
                summaries.append(s)

            if progress:
                progress(min(i + batch_size, len(uids)), len(uids))

        summaries.sort(
            key=lambda s: s.date_obj or datetime.min,
            reverse=True,
        )
        return summaries

    def _fetch_header_batch(self, batch: list[str]) -> list[EmailSummary]:
        conn = self._require()
        uid_set = ",".join(batch)
        # Headers only — BODYSTRUCTURE on large batches often breaks cPanel IMAP
        status, data = conn.uid(
            "fetch",
            uid_set,
            "(UID BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE CONTENT-TYPE CONTENT-DISPOSITION)])",
        )
        if status != "OK" or not data:
            return []

        results: list[EmailSummary] = []
        for item in data:
            if not isinstance(item, tuple) or len(item) < 2:
                continue
            meta = item[0]
            header_bytes = item[1]
            if not isinstance(header_bytes, (bytes, bytearray)):
                continue
            meta_s = meta.decode(errors="replace") if isinstance(meta, bytes) else str(meta)
            uid_match = re.search(r"UID\s+(\d+)", meta_s)
            if not uid_match:
                continue
            uid = uid_match.group(1)
            msg = email.message_from_bytes(bytes(header_bytes))
            subject = decode_mime_header(msg.get("Subject"))
            from_addr = decode_mime_header(msg.get("From"))
            date_str, date_obj = parse_email_date(msg.get("Date"))
            ctype = (msg.get("Content-Type") or "").lower()
            cdisp = (msg.get("Content-Disposition") or "").lower()
            has_att = (
                "multipart/mixed" in ctype
                or "attachment" in cdisp
                or "filename=" in cdisp
            )
            results.append(
                EmailSummary(
                    uid=uid,
                    subject=subject or "(no subject)",
                    from_addr=from_addr or "",
                    date_str=date_str,
                    date_obj=date_obj,
                    has_attachments=has_att,
                )
            )
        return results

    def fetch_message(self, uid: str) -> EmailDetail:
        try:
            return self._fetch_message_once(uid)
        except (imaplib.IMAP4.abort, imaplib.IMAP4.error, OSError, TimeoutError):
            self.reconnect()
            return self._fetch_message_once(uid)

    def _fetch_message_once(self, uid: str) -> EmailDetail:
        conn = self._require()
        status, data = conn.uid("fetch", uid, "(RFC822)")
        if status != "OK" or not data or not isinstance(data[0], tuple):
            raise RuntimeError(f"Failed to fetch message UID {uid}")
        raw = data[0][1]
        if not isinstance(raw, (bytes, bytearray)):
            raise RuntimeError(f"Empty message body for UID {uid}")
        msg = email.message_from_bytes(bytes(raw))
        subject = decode_mime_header(msg.get("Subject"))
        from_addr = decode_mime_header(msg.get("From"))
        to_addr = decode_mime_header(msg.get("To"))
        date_str, _ = parse_email_date(msg.get("Date"))
        body_text, body_html, attachments = self._extract_parts(msg)
        return EmailDetail(
            uid=uid,
            subject=subject or "(no subject)",
            from_addr=from_addr or "",
            to_addr=to_addr or "",
            date_str=date_str,
            body_text=body_text,
            body_html=body_html,
            attachments=attachments,
        )

    def _extract_parts(
        self, msg: Message
    ) -> tuple[str, str, list[AttachmentInfo]]:
        text_parts: list[str] = []
        html_parts: list[str] = []
        attachments: list[AttachmentInfo] = []
        part_index = 0

        if msg.is_multipart():
            for part in msg.walk():
                content_disposition = str(part.get("Content-Disposition", "")).lower()
                content_type = part.get_content_type()
                filename = part.get_filename()
                if filename:
                    filename = decode_mime_header(filename)
                is_attachment = "attachment" in content_disposition or (
                    filename is not None and content_type not in ("text/plain", "text/html")
                )
                if part.get_content_maintype() == "multipart":
                    continue
                payload = part.get_payload(decode=True)
                if payload is None:
                    continue
                if is_attachment or (filename and "inline" not in content_disposition):
                    if filename or is_attachment:
                        fname = _safe_filename(filename or f"file_{part_index}")
                        # Skip inline/signature pictures — only keep document files
                        from .attachments import is_document_attachment

                        if not is_document_attachment(fname, content_type):
                            part_index += 1
                            continue
                        attachments.append(
                            AttachmentInfo(
                                filename=fname,
                                content_type=content_type,
                                size=len(payload),
                                part_index=part_index,
                                data=payload,
                            )
                        )
                        part_index += 1
                        continue
                charset = part.get_content_charset() or "utf-8"
                try:
                    decoded = payload.decode(charset, errors="replace")
                except LookupError:
                    decoded = payload.decode("utf-8", errors="replace")
                if content_type == "text/plain":
                    text_parts.append(decoded)
                elif content_type == "text/html":
                    html_parts.append(decoded)
        else:
            payload = msg.get_payload(decode=True) or b""
            charset = msg.get_content_charset() or "utf-8"
            try:
                decoded = payload.decode(charset, errors="replace")
            except LookupError:
                decoded = payload.decode("utf-8", errors="replace")
            if msg.get_content_type() == "text/html":
                html_parts.append(decoded)
            else:
                text_parts.append(decoded)

        body_text = "\n\n".join(text_parts).strip()
        body_html = "\n".join(html_parts).strip()
        if not body_text and body_html:
            body_text = self._html_to_text(body_html)
        return body_text, body_html, attachments

    @staticmethod
    def _html_to_text(html: str) -> str:
        text = re.sub(r"(?is)<(script|style).*?>.*?</\1>", "", html)
        text = re.sub(r"(?i)<br\s*/?>", "\n", text)
        text = re.sub(r"(?i)</p>", "\n\n", text)
        text = re.sub(r"(?s)<[^>]+>", "", text)
        entities = {
            "&nbsp;": " ",
            "&amp;": "&",
            "&lt;": "<",
            "&gt;": ">",
            "&quot;": '"',
            "&#39;": "'",
        }
        for k, v in entities.items():
            text = text.replace(k, v)
        return re.sub(r"\n{3,}", "\n\n", text).strip()

    @staticmethod
    def save_attachments(
        attachments: list[AttachmentInfo], dest_dir: Path, selected: Optional[list[int]] = None
    ) -> list[Path]:
        dest_dir.mkdir(parents=True, exist_ok=True)
        saved: list[Path] = []
        indices = selected if selected is not None else list(range(len(attachments)))
        for idx in indices:
            if idx < 0 or idx >= len(attachments):
                continue
            att = attachments[idx]
            path = dest_dir / att.filename
            if path.exists():
                stem, suffix = path.stem, path.suffix
                n = 1
                while path.exists():
                    path = dest_dir / f"{stem}_{n}{suffix}"
                    n += 1
            path.write_bytes(att.data)
            saved.append(path)
        return saved
