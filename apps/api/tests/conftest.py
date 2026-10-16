"""Los tests corren contra un PostgreSQL real (TEST_DATABASE_URL) porque es la única base de datos
soportada; los servicios externos se reemplazan por fakes."""

from __future__ import annotations

import asyncio
import json
import os
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import httpx
import pytest
import sqlalchemy as sa
from fakeredis import FakeAsyncRedis as FakeRedis
from sqlalchemy.ext.asyncio import create_async_engine

from app.adapters.inbound.whatsapp.signature import sign
from app.adapters.outbound.infra import LimitsRateLimiter
from app.adapters.outbound.persistence.mapping import start_mappers
from app.adapters.outbound.persistence.tables import metadata, system_settings
from app.adapters.outbound.security.passwords import Argon2PasswordHasher
from app.config import Settings
from app.container import Container, Overrides
from app.domain.entities import Company, Employee, blocked_concepts_from, categories_from
from app.domain.enums import Role, StaffType
from app.main import create_app
from tests.fakes import FakeErp, FakeExtractor, FakeRateProvider, FakeStorage, FakeWhatsApp
from tests.seed import database_sql, extensions_sql, seed_settings, setting_value

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "postgresql+asyncpg://gastos:gastos@localhost:5432/gastos_test")
APP_SECRET = "test-app-secret"
PASSWORD = "Correct-Horse-42"
MFA_KEY = "x6rXhbMybM3IU7DmO7c2gE6PS-VzlI7nKeRuTzvYsBo="  # gitleaks:allow (llave solo de pruebas)


@pytest.fixture(scope="session", autouse=True)
def _schema() -> None:
    start_mappers()

    async def create() -> None:
        engine = create_async_engine(TEST_DATABASE_URL)
        async with engine.begin() as conn:
            await conn.run_sync(metadata.drop_all)
            for statement in extensions_sql():
                await conn.execute(sa.text(statement))
            await conn.run_sync(metadata.create_all)
            for statement in database_sql():
                await conn.execute(sa.text(statement))
        await engine.dispose()

    asyncio.run(create())


@pytest.fixture(autouse=True)
async def _clean_tables() -> None:
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as conn:
        names = ", ".join(t.name for t in reversed(metadata.sorted_tables))
        # La auditoría es inmutable (trigger); solo el dueño de la tabla puede saltarlo para limpiar.
        await conn.execute(sa.text("ALTER TABLE audit_log DISABLE TRIGGER USER"))
        await conn.execute(sa.text(f"TRUNCATE {names} CASCADE"))
        await conn.execute(sa.text("ALTER TABLE audit_log ENABLE TRIGGER USER"))
        now = datetime.now(UTC)
        await conn.execute(system_settings.insert(), [{**row, "updated_at": now} for row in seed_settings()])
    await engine.dispose()


def make_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = dict(
        APP_ENV="test",
        DATABASE_URL=TEST_DATABASE_URL,
        DB_POOL_SIZE=5,
        JWT_SECRET="test-secret-" + "x" * 40,
        WHATSAPP_APP_SECRET=APP_SECRET,
        WHATSAPP_VERIFY_TOKEN="verify-me",
        OPENROUTER_API_KEY="test-key",
        REDIS_URL="redis://unused-in-tests",
        MFA_ENCRYPTION_KEY=MFA_KEY,
        MFA_REQUIRED_ROLES="",
        LOG_LEVEL="WARNING",
    )
    values.update(overrides)
    return Settings(_env_file=None, **values)  # type: ignore[call-arg]


@dataclass
class Harness:
    client: httpx.AsyncClient
    container: Container
    wa: FakeWhatsApp
    storage: FakeStorage
    extractor: FakeExtractor
    erp: FakeErp

    async def drain(self) -> None:
        await self.container.tasks.drain(max_wait=10)

    async def set_setting(self, key: str, value: Any) -> None:
        async with self.container.uow() as uow:
            row = await uow.settings.get(key)
            assert row is not None
            row.value = value
            await uow.commit()
        await self.container.runtime._cache.invalidate()

    async def add_company(self, name: str = "Forsa Colombia", country: str = "CO", currency: str = "COP") -> Company:
        country_defaults = setting_value("defaults.countries")[country]
        company = Company(
            name,
            country,
            currency,
            generic_tax_id=country_defaults["generic_tax_id"],
            deductibility=dict(setting_value("defaults.deductibility")),
            timezone=country_defaults["timezone"],
        )
        async with self.container.uow() as uow:
            await uow.companies.add(company)
            await uow.flush()
            for concept in blocked_concepts_from(company.id, setting_value("defaults.blocked_concepts")):
                await uow.concepts.add(concept)
            for category in categories_from(company.id, setting_value("defaults.categories")):
                await uow.categories.add(category)
            await uow.commit()
        return company

    async def add_employee(
        self,
        company: Company,
        email: str,
        role: Role = Role.EMPLOYEE,
        phone: str | None = None,
        approver: Employee | None = None,
        wa_user_id: str | None = None,
        must_change_password: bool = False,
        staff_type: StaffType | None = None,
    ) -> Employee:
        employee = Employee(
            full_name=email.split("@")[0].title() + " Pérez",
            email=email,
            role=role,
            phone=phone,
            company_ids=[company.id],
            approver_id=approver.id if approver else None,
            password_hash=Argon2PasswordHasher().hash(PASSWORD),
            must_change_password=must_change_password,
            staff_type=staff_type,
        )
        if wa_user_id:
            employee.link_whatsapp(wa_user_id, datetime.now(UTC))
        async with self.container.uow() as uow:
            await uow.employees.add(employee)
            await uow.commit()
        return employee

    async def login(self, employee: Employee) -> dict[str, str]:
        response = await self.client.post("/api/v1/auth/login", json={"email": employee.email, "password": PASSWORD})
        assert response.status_code == 200, response.text
        return {"Authorization": f"Bearer {response.json()['access_token']}"}

    async def webhook(self, payload: dict[str, Any], secret: str = APP_SECRET) -> httpx.Response:
        raw = json.dumps(payload).encode()
        return await self.client.post(
            "/webhooks/whatsapp",
            content=raw,
            headers={"Content-Type": "application/json", "X-Hub-Signature-256": sign(raw, secret)},
        )


@pytest.fixture
def extractor() -> FakeExtractor:
    return FakeExtractor()


@pytest.fixture
def settings_overrides() -> dict[str, Any]:
    return {}


@pytest.fixture
async def harness(extractor: FakeExtractor, settings_overrides: dict[str, Any]) -> AsyncIterator[Harness]:
    wa = FakeWhatsApp()
    storage = FakeStorage()
    erp = FakeErp()
    app = create_app(
        make_settings(**settings_overrides),
        Overrides(
            storage=storage,
            sender=wa,
            media=wa,
            extractor=extractor,
            erp=erp,
            rate_limiter=LimitsRateLimiter("async+memory://"),
            redis=FakeRedis(),
            rate_providers=[FakeRateProvider({"COP": Decimal("4000")}), FakeRateProvider({"EUR": Decimal("0.9")}, "ecb")],
        ),
        run_jobs=False,
    )
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield Harness(client, app.state.container, wa, storage, extractor, erp)


def wa_message(
    message_id: str,
    *,
    phone: str | None = None,
    user_id: str | None = None,
    username: str | None = None,
    name: str = "Juan",
    **body: Any,
) -> dict[str, Any]:
    """Payload de webhook de Meta con un solo mensaje entrante."""
    message: dict[str, Any] = {"id": message_id, "timestamp": str(int(time.time())), **body}
    contact: dict[str, Any] = {"profile": {"name": name}}
    if phone:
        message["from"] = phone
        contact["wa_id"] = phone
    if user_id:
        message["from_user_id"] = user_id
        contact["user_id"] = user_id
    if username:
        contact["profile"]["username"] = username
    return {
        "object": "whatsapp_business_account",
        "entry": [{"changes": [{"field": "messages", "value": {"contacts": [contact], "messages": [message]}}]}],
    }


def wa_status(message_id: str, status: str, recipient_phone: str | None, recipient_user_id: str | None) -> dict[str, Any]:
    return {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "changes": [
                    {
                        "field": "messages",
                        "value": {
                            "statuses": [
                                {
                                    "id": message_id,
                                    "status": status,
                                    "recipient_id": recipient_phone,
                                    "recipient_user_id": recipient_user_id,
                                }
                            ]
                        },
                    }
                ]
            }
        ],
    }
