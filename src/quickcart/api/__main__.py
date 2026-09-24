"""QuickCart Intelligence API (kit/03 Phase 14).

Serve locally:

    uv run python -m quickcart.api

Host/port come from APP_HOST/APP_PORT (defaults 127.0.0.1:8000).
Interactive docs: http://127.0.0.1:8000/docs
"""

import os

import uvicorn


def main() -> None:
    host = os.environ.get("APP_HOST", "127.0.0.1")
    port = int(os.environ.get("APP_PORT", "8000"))
    uvicorn.run("quickcart.api.app:create_app", factory=True, host=host, port=port)


if __name__ == "__main__":
    main()
