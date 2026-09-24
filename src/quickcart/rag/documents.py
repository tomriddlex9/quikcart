"""Versioned internal-document loading (kit/03 Phase 12.2-12.3).

Documents are Markdown files with a small YAML-ish frontmatter block:

```markdown
---
doc_id: refund_policy
title: Refund Policy
version: "2.1"
effective_date: "2026-01-15"
---

# Refund Policy

Intro paragraphs ...

## Refund eligibility

Section text ...
```

`# ` headings carry the document title (must match frontmatter), `## `
headings delimit sections. Markdown sources are preferred over PDFs so tests
can parse them deterministically (kit/03 §12.2).
"""

from dataclasses import dataclass
from pathlib import Path

DEFAULT_FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"

REQUIRED_FRONTMATTER_KEYS = ("doc_id", "title", "version", "effective_date")


@dataclass(frozen=True)
class Section:
    """One `## `-delimited section of an internal document."""

    heading: str
    text: str


@dataclass(frozen=True)
class Document:
    """A versioned internal document with its parsed sections."""

    doc_id: str
    title: str
    version: str
    effective_date: str
    sections: list[Section]


def _parse_frontmatter(lines: list[str], source: Path) -> tuple[dict[str, str], int]:
    """Parse the `---`-delimited frontmatter block; returns (values, body offset)."""
    if not lines or lines[0].strip() != "---":
        raise ValueError(f"{source}: document must start with a '---' frontmatter block")
    try:
        end = next(i for i in range(1, len(lines)) if lines[i].strip() == "---")
    except StopIteration:
        msg = f"{source}: frontmatter block is not closed with '---'"
        raise ValueError(msg) from None

    values: dict[str, str] = {}
    for lineno, raw in enumerate(lines[1:end], start=2):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            msg = f"{source}:{lineno}: frontmatter line must be 'key: value', got {line!r}"
            raise ValueError(msg)
        key, _, value = line.partition(":")
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values, end + 1


def _parse_sections(body: list[str], source: Path) -> tuple[str, list[Section]]:
    """Split the Markdown body into (title, sections) at `# ` / `## ` headings."""
    title: str | None = None
    sections: list[Section] = []
    current_heading: str | None = None
    current_lines: list[str] = []

    def flush() -> None:
        nonlocal current_heading, current_lines
        if current_heading is not None:
            text = "\n".join(current_lines).strip()
            if not text:
                raise ValueError(f"{source}: section {current_heading!r} has no body text")
            sections.append(Section(heading=current_heading, text=text))
        current_heading, current_lines = None, []

    for lineno, raw in enumerate(body, start=1):
        line = raw.rstrip()
        if line.startswith("## "):
            flush()
            current_heading = line[3:].strip()
            if not current_heading:
                raise ValueError(f"{source}:{lineno}: empty section heading")
        elif line.startswith("# "):
            if title is not None:
                raise ValueError(f"{source}:{lineno}: multiple H1 headings found")
            title = line[2:].strip()
        else:
            current_lines.append(line)
    flush()

    if title is None or not title:
        raise ValueError(f"{source}: document body must contain a single '# <title>' heading")
    return title, sections


def _load_one(path: Path) -> Document:
    lines = path.read_text(encoding="utf-8").splitlines()
    frontmatter, offset = _parse_frontmatter(lines, path)
    missing = [key for key in REQUIRED_FRONTMATTER_KEYS if not frontmatter.get(key)]
    if missing:
        raise ValueError(f"{path}: frontmatter missing required keys: {', '.join(missing)}")

    title, sections = _parse_sections(lines[offset:], path)
    if not sections:
        raise ValueError(f"{path}: document has no '## ' sections")
    if title != frontmatter["title"]:
        raise ValueError(
            f"{path}: H1 title {title!r} does not match frontmatter title {frontmatter['title']!r}"
        )
    return Document(
        doc_id=frontmatter["doc_id"],
        title=frontmatter["title"],
        version=frontmatter["version"],
        effective_date=frontmatter["effective_date"],
        sections=sections,
    )


def load_documents(fixtures_dir: Path | None = None) -> list[Document]:
    """Load every `*.md` document under `fixtures_dir` in deterministic order.

    Defaults to the packaged fixtures (six versioned policy/SOP documents plus
    one superseded policy kept for retrieval-recency evaluation). Raises
    `ValueError` on malformed frontmatter, duplicate `doc_id`s, or documents
    without sections — invalid sources are never silently skipped.
    """
    directory = Path(fixtures_dir) if fixtures_dir is not None else DEFAULT_FIXTURES_DIR
    paths = sorted(directory.glob("*.md"))
    if not paths:
        raise ValueError(f"{directory}: no .md documents found")

    documents = [_load_one(path) for path in paths]
    seen: set[str] = set()
    for doc in documents:
        if doc.doc_id in seen:
            raise ValueError(f"{directory}: duplicate doc_id {doc.doc_id!r}")
        seen.add(doc.doc_id)
    return documents
