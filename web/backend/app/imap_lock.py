"""Serialize all IMAP access — Bluehost often allows only one active session."""

from __future__ import annotations

import threading
from contextlib import contextmanager
from typing import Iterator

_lock = threading.RLock()


@contextmanager
def imap_exclusive(timeout: float = 120.0, purpose: str = "IMAP") -> Iterator[None]:
    """Block until the IMAP lock is free, or raise if still busy after timeout."""
    got = _lock.acquire(timeout=timeout)
    if not got:
        raise RuntimeError(
            f"Mail server is busy ({purpose} waiting). "
            "If a sync is running, wait until it finishes, then try again."
        )
    try:
        yield
    finally:
        _lock.release()
