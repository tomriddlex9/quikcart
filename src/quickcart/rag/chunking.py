"""Section-aware chunking (kit/02 RAGR-001, kit/03 Phase 12.3).

Chunking policy:
- one chunk per `## ` section;
- sections longer than `max_chars` (default 500) are split further at paragraph
  (`\n\n`) boundaries, carrying `overlap` (default 50) trailing characters of
  the previous chunk into the next one so no context is lost at the seam;
- a single paragraph longer than `max_chars` is hard-split (worst case);
- `chunk_id` is deterministic: SHA-1 over `doc_id | section_heading | index`,
  so identical inputs always produce identical chunks (idempotent ingestion).
"""

import hashlib
from dataclasses import dataclass

from quickcart.rag.documents import Document

DEFAULT_MAX_CHARS = 500
DEFAULT_OVERLAP = 50


@dataclass(frozen=True)
class Chunk:
    """A retrievable unit of an internal document, with full source metadata."""

    chunk_id: str
    doc_id: str
    title: str
    section_heading: str
    version: str
    effective_date: str
    text: str


def chunk_id_for(doc_id: str, section_heading: str, index: int) -> str:
    """Deterministic chunk id (SHA-1 over doc/section/index)."""
    raw = f"{doc_id}|{section_heading}|{index}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def _split_section(text: str, max_chars: int, overlap: int) -> list[str]:
    """Split one section into <= `max_chars` parts at paragraph boundaries."""
    if len(text) <= max_chars:
        return [text]

    parts: list[str] = []
    current = ""
    for paragraph in text.split("\n\n"):
        candidate = paragraph if not current else f"{current}\n\n{paragraph}"
        if len(candidate) <= max_chars:
            current = candidate
            continue
        if current:
            parts.append(current)
        prefix = parts[-1][-overlap:] if parts else ""
        current = f"{prefix}\n\n{paragraph}" if prefix else paragraph
        # A single paragraph may itself exceed max_chars — hard-split as a
        # last resort, still carrying overlap context between the pieces.
        while len(current) > max_chars:
            parts.append(current[:max_chars])
            current = current[max_chars - overlap:]
    if current:
        parts.append(current)
    return parts


def chunk_documents(
    docs: list[Document],
    max_chars: int = DEFAULT_MAX_CHARS,
    overlap: int = DEFAULT_OVERLAP,
) -> list[Chunk]:
    """Chunk every document into section-aware, metadata-carrying chunks."""
    if max_chars <= 0:
        raise ValueError(f"max_chars must be positive, got {max_chars}")
    if not 0 <= overlap < max_chars:
        raise ValueError(f"overlap must satisfy 0 <= overlap < max_chars, got {overlap}")

    chunks: list[Chunk] = []
    for doc in docs:
        for section in doc.sections:
            for index, part in enumerate(_split_section(section.text, max_chars, overlap)):
                chunks.append(
                    Chunk(
                        chunk_id=chunk_id_for(doc.doc_id, section.heading, index),
                        doc_id=doc.doc_id,
                        title=doc.title,
                        section_heading=section.heading,
                        version=doc.version,
                        effective_date=doc.effective_date,
                        text=part,
                    )
                )
    return chunks
