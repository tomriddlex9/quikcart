"""CORS is limited to the Next.js console origins."""

from fastapi.testclient import TestClient

from quickcart.api.app import CONSOLE_ORIGINS, create_app


def test_console_origin_is_allowed() -> None:
    app = create_app()
    with TestClient(app) as client:
        response = client.get("/health", headers={"Origin": "http://localhost:3000"})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"


def test_other_origin_is_not_echoed() -> None:
    app = create_app()
    with TestClient(app) as client:
        response = client.get("/health", headers={"Origin": "http://evil.example"})
    assert response.headers.get("access-control-allow-origin") != "http://evil.example"


def test_preflight_allows_get_from_loopback_console() -> None:
    app = create_app()
    with TestClient(app) as client:
        response = client.options(
            "/health",
            headers={
                "Origin": "http://127.0.0.1:3000",
                "Access-Control-Request-Method": "GET",
            },
        )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:3000"
    assert "GET" in response.headers["access-control-allow-methods"]
    assert set(CONSOLE_ORIGINS) == {"http://localhost:3000", "http://127.0.0.1:3000"}
