from __future__ import annotations

from collections.abc import AsyncIterator

import httpx
import pytest
from fakeredis import FakeAsyncRedis as FakeRedis

from app.adapters.outbound.infra import LimitsRateLimiter
from app.container import Overrides
from app.main import create_app
from tests.conftest import Harness, make_settings
from tests.fakes import FakeExtractor, FakeStorage, FakeWhatsApp, make_jpeg


@pytest.fixture
async def bare_harness() -> AsyncIterator[Harness]:
    """App sin credenciales de R2 ni WhatsApp: debe arrancar y responder con errores claros."""
    extractor = FakeExtractor()
    app = create_app(
        make_settings(WHATSAPP_ACCESS_TOKEN="", WHATSAPP_PHONE_NUMBER_ID=""),
        Overrides(extractor=extractor, rate_limiter=LimitsRateLimiter("async+memory://"), redis=FakeRedis(), rate_providers=[]),
        run_jobs=False,
    )
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield Harness(client, app.state.container, FakeWhatsApp(), FakeStorage(), extractor)


async def test_missing_r2_answers_503_with_the_service_name(bare_harness: Harness) -> None:
    company = await bare_harness.add_company()
    user = await bare_harness.add_employee(company, "juan@forsa.com")
    headers = await bare_harness.login(user)
    upload = await bare_harness.client.post(
        "/api/v1/expenses", headers=headers, files={"file": ("f.jpg", make_jpeg(), "image/jpeg")}
    )
    assert upload.status_code == 503
    assert upload.json()["error"]["code"] == "service_not_configured"


async def test_ready_reports_each_integration(bare_harness: Harness) -> None:
    ready = await bare_harness.client.get("/ready")
    assert ready.status_code == 503
    services = ready.json()["services"]
    assert services["database"] == "ok" and services["r2"] == "not_configured" and services["whatsapp"] == "not_configured"


async def test_health_stays_up_without_integrations(bare_harness: Harness) -> None:
    assert (await bare_harness.client.get("/health")).status_code == 200
