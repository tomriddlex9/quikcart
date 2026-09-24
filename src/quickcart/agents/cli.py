"""CLI for the Phase 13 agent.

```bash
uv run python -m quickcart.agents.cli "Why are deliveries late at Store 8 today?"
```

Prints the grounded answer, an evidence summary, and the trace path. Exit
code 0 when the agent produced an answer (including degraded answers), 1 on
usage errors.
"""

import argparse
import json
import sys

from quickcart.logging import configure_logging


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="quickcart.agents.cli",
        description="Ask the QuickCart operations agent one question.",
    )
    parser.add_argument("question", help="the user question to answer")
    parser.add_argument("--session-id", default=None, help="optional session id")
    parser.add_argument(
        "--json", action="store_true", help="print the full raw result JSON instead"
    )
    args = parser.parse_args(argv)

    from quickcart.config.settings import get_settings

    configure_logging(get_settings().log_level)

    from quickcart.agents import service

    result = service.chat(message=args.question, session_id=args.session_id)

    if args.json:
        print(json.dumps(result, indent=2, default=str))
        return 0

    print("== Agent answer ==")
    print(result["answer"])
    print()
    print("== Evidence ==")
    evidence = result["evidence"]
    if not evidence:
        print("(none)")
    for item in evidence:
        kind = item.get("type", "fact")
        if kind == "document":
            chunks = item.get("chunks", [])
            for chunk in chunks:
                print(
                    f"- document {chunk['doc_id']} §{chunk['section_heading']} "
                    f"(v{chunk['version']}, score {chunk['score']}): {chunk['text'][:120]}..."
                )
            if item.get("supported") is False:
                print(f"- documents: unsupported — {item.get('message')}")
        else:
            facts = {k: v for k, v in item.items() if k != "type"}
            print(f"- {kind} via {item.get('tool', '?')}: {json.dumps(facts, default=str)[:300]}")
    print()
    print("== Tool trace ==")
    for step in result["tool_trace"]:
        print(
            f"- step {step['step']}: {step['tool']} ({step['arguments_summary']})"
            f" -> {step['result_summary']}"
        )
    print()
    print(f"Trace: {result.get('trace_path') or '(not written)'}")
    print(f"Request: {result.get('request_id')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
