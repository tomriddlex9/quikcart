"""Environment-driven CORS origin parsing for the console integrator."""

from quickcart.api.live import resolve_cors_origins


def test_cors_origins_default_to_loopback_console(monkeypatch) -> None:
    monkeypatch.delenv("QUICKCART_CORS_ORIGINS", raising=False)

    assert resolve_cors_origins() == [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]


def test_cors_origins_parse_trim_and_deduplicate_environment(monkeypatch) -> None:
    monkeypatch.setenv(
        "QUICKCART_CORS_ORIGINS",
        " https://console.example ,http://localhost:3000,,https://console.example ",
    )

    assert resolve_cors_origins() == [
        "https://console.example",
        "http://localhost:3000",
    ]


def test_blank_cors_environment_uses_defaults(monkeypatch) -> None:
    monkeypatch.setenv("QUICKCART_CORS_ORIGINS", " , ")

    assert resolve_cors_origins() == [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
