from __future__ import annotations

import httpx
import pytest
import respx

from app.application.reading import ConfigProvider, ReadingConfig
from app.config import Settings
from app.domain.ports import ExtractionOptions, ImageOptions
from scripts import check_ai

BASE = "https://openrouter.test/api/v1"
KEY = "sk-or-v1-0123456789abcdef"


def _config() -> ReadingConfig:
    return ReadingConfig(
        primary_model="google/main",
        lite_model="google/lite",
        fallback_model="google/main",
        routing="by_difficulty",
        escalation_threshold=0.7,
        image=ImageOptions(1600, 2400, 60.0, 320),
        extraction=ExtractionOptions("v3", 2500, "minimal", "low", True, ("backup/model",)),
    )


@pytest.fixture
def setup(monkeypatch: pytest.MonkeyPatch):  # type: ignore[no-untyped-def]
    def configure(key: str = KEY) -> None:
        settings = Settings(OPENROUTER_API_KEY=key, OPENROUTER_BASE_URL=BASE)  # type: ignore[call-arg]
        monkeypatch.setattr(check_ai, "get_settings", lambda: settings)

        class _Engine:
            async def dispose(self) -> None:
                return None

        async def provider() -> ReadingConfig:
            return _config()

        def reading_config(_settings: Settings) -> tuple[_Engine, ConfigProvider]:
            return _Engine(), provider

        monkeypatch.setattr(check_ai, "reading_config", reading_config)

    return configure


@pytest.mark.parametrize(
    ("key", "expected"),
    [
        ("", "está vacía"),
        ('"sk-or-v1-abc"', "comillas"),
        ("sk-proj-abc", "No parece una clave de OpenRouter"),
        ("sk-ant-abc", "No parece una clave de OpenRouter"),
    ],
)
async def test_explains_a_wrong_key_without_calling_openrouter(setup, capsys, key: str, expected: str) -> None:  # type: ignore[no-untyped-def]
    setup(key)
    assert await check_ai.main() == 1
    assert expected in capsys.readouterr().out


@respx.mock
async def test_all_good(setup, capsys) -> None:  # type: ignore[no-untyped-def]
    setup()
    respx.get(f"{BASE}/key").mock(return_value=httpx.Response(200, json={"data": {"label": "dev", "limit_remaining": 9.5}}))
    models = [{"id": m} for m in ("google/main", "google/lite", "backup/model")]
    respx.get(f"{BASE}/models").mock(return_value=httpx.Response(200, json={"data": models}))
    chat = respx.post(f"{BASE}/chat/completions").mock(return_value=httpx.Response(200, json={"choices": []}))
    assert await check_ai.main() == 0
    out = capsys.readouterr().out
    assert "le quedan USD 9.5" in out
    assert "Todo listo" in out
    # Cada modelo distinto una vez, con las mismas restricciones de proveedor que la lectura real.
    assert chat.call_count == 3
    assert b'"zdr":true' in chat.calls[0].request.content


@respx.mock
async def test_reports_invalid_key(setup, capsys) -> None:  # type: ignore[no-untyped-def]
    setup()
    respx.get(f"{BASE}/key").mock(return_value=httpx.Response(401, json={"error": {"message": "User not found."}}))
    assert await check_ai.main() == 1
    out = capsys.readouterr().out
    assert "User not found." in out
    assert "La clave no es válida" in out


@respx.mock
async def test_reports_unreachable_openrouter(setup, capsys) -> None:  # type: ignore[no-untyped-def]
    setup()
    respx.get(f"{BASE}/key").mock(side_effect=httpx.ConnectError("boom"))
    assert await check_ai.main() == 1
    assert "No hay conexión" in capsys.readouterr().out


@respx.mock
async def test_reports_missing_models_and_providers_that_refuse(setup, capsys) -> None:  # type: ignore[no-untyped-def]
    setup()
    respx.get(f"{BASE}/key").mock(return_value=httpx.Response(200, json={"data": {"label": "dev"}}))
    models = [{"id": m} for m in ("google/main", "backup/model")]
    respx.get(f"{BASE}/models").mock(return_value=httpx.Response(200, json={"data": models}))
    refused = {"error": {"message": "No endpoints found matching your data policy"}}
    respx.post(f"{BASE}/chat/completions").mock(
        side_effect=[httpx.Response(404, json=refused), httpx.Response(402, json={"error": {"message": "Insufficient credits"}})]
    )
    assert await check_ai.main() == 1
    out = capsys.readouterr().out
    assert "ai.lite_model = google/lite: ese modelo no existe" in out
    assert "No endpoints found matching your data policy" in out
    assert "retención cero" in out
    assert "no tiene créditos" in out
    assert "3 problema(s)" in out
