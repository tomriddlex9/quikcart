"""Bot personality + memory context helpers."""

from __future__ import annotations

import pytest

from quickcart.agents.bot_personality import memory_context_block, resolve_bot

pytestmark = pytest.mark.unit


def test_bots_use_bright_fills() -> None:
    bot = resolve_bot("store_manager")
    assert bot.fill.lower() == "#e8954a"


def test_memory_context_includes_local_and_global() -> None:
    block = memory_context_block(
        history=[
            {"role": "user", "text": "How were sales?"},
            {"role": "assistant", "text": "Soft."},
        ],
        memories={"global": ["I manage Store 3"], "local": ["Focus dairy"]},
    )
    assert "I manage Store 3" in block
    assert "Focus dairy" in block
    assert "How were sales?" in block
    assert "never invent metrics" in block.lower()
