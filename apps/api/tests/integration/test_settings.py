from __future__ import annotations

from app.adapters.outbound.security.passwords import Argon2PasswordHasher
from app.domain.entities import Employee
from app.domain.enums import Role
from app.domain.ports import AuditFilter, Page
from tests.conftest import PASSWORD, Harness
from tests.fakes import make_jpeg


async def _superadmin(harness: Harness) -> Employee:
    superadmin = Employee("Operación NextByte", "ops@nextbyte.com.co", Role.SUPERADMIN, company_ids=[])
    superadmin.password_hash = Argon2PasswordHasher().hash(PASSWORD)
    async with harness.container.uow() as uow:
        await uow.employees.add(superadmin)
        await uow.commit()
    return superadmin


async def test_only_the_superadmin_sees_and_changes_settings(harness: Harness) -> None:
    company = await harness.add_company()
    admin = await harness.add_employee(company, "admin@forsa.com", Role.ADMIN)
    superadmin = await _superadmin(harness)
    admin_h, super_h = await harness.login(admin), await harness.login(superadmin)

    assert (await harness.client.get("/api/v1/settings", headers=admin_h)).status_code == 403
    listed = (await harness.client.get("/api/v1/settings", headers=super_h)).json()["data"]
    threshold = next(row for row in listed if row["key"] == "ai.escalation_threshold")
    assert threshold["value_type"] == "decimal" and threshold["constraints"] == {"min": 0, "max": 1}

    too_high = await harness.client.patch("/api/v1/settings", headers=super_h, json={"values": {"ai.escalation_threshold": 1.5}})
    assert too_high.status_code == 422
    assert too_high.json()["error"]["message"] == "ai.escalation_threshold debe ser menor o igual a 1."

    unknown = await harness.client.patch("/api/v1/settings", headers=super_h, json={"values": {"ai.nope": 1}})
    assert unknown.status_code == 422 and unknown.json()["error"]["code"] == "unknown_setting"

    ok = await harness.client.patch("/api/v1/settings", headers=super_h, json={"values": {"ai.escalation_threshold": 0.8}})
    assert ok.status_code == 200
    assert (await harness.container.runtime.current()).ai_escalation_threshold == 0.8
    async with harness.container.uow() as uow:
        entry = (await uow.audit.find(AuditFilter(entity_type="system"), Page())).items[0]
    assert entry.action == "settings_updated"
    assert entry.data == {"before": {"ai.escalation_threshold": 0.7}, "after": {"ai.escalation_threshold": 0.8}}


async def test_a_model_change_applies_to_the_next_invoice_without_restarting(harness: Harness) -> None:
    company = await harness.add_company()
    user = await harness.add_employee(company, "juan@forsa.com")
    superadmin = await _superadmin(harness)
    headers, super_h = await harness.login(user), await harness.login(superadmin)
    await harness.client.patch("/api/v1/settings", headers=super_h, json={"values": {"ai.primary_model": "google/nuevo"}})
    await harness.client.post("/api/v1/expenses", headers=headers, files={"file": ("f.jpg", make_jpeg(), "image/jpeg")})
    await harness.drain()
    assert harness.extractor.calls[0].model == "google/nuevo"


async def test_superadmin_has_no_access_to_forsa_data(harness: Harness) -> None:
    company = await harness.add_company()
    admin = await harness.add_employee(company, "admin@forsa.com", Role.ADMIN)
    user = await harness.add_employee(company, "juan@forsa.com")
    superadmin = await _superadmin(harness)
    super_h, admin_h = await harness.login(superadmin), await harness.login(admin)

    assert (await harness.client.get("/api/v1/expenses", headers=super_h)).json()["pagination"]["total"] == 0
    assert (await harness.client.get(f"/api/v1/employees/{user.id}", headers=super_h)).status_code == 403
    assert (await harness.client.get("/api/v1/employees", headers=super_h)).status_code == 403

    # Para el admin de Forsa el superadmin no existe y su rol no se puede asignar.
    listed = (await harness.client.get("/api/v1/employees", headers=admin_h)).json()["data"]
    assert superadmin.email not in {e["email"] for e in listed}
    assert (await harness.client.get(f"/api/v1/employees/{superadmin.id}", headers=admin_h)).status_code == 404
    promote = await harness.client.patch(f"/api/v1/employees/{user.id}", headers=admin_h, json={"role": "superadmin"})
    assert promote.status_code == 403 and promote.json()["error"]["code"] == "superadmin_reserved"


async def test_missing_setting_answers_503_and_ready_reports_it(harness: Harness) -> None:
    async with harness.container.uow() as uow:
        row = await uow.settings.get("ai.routing")
        assert row is not None
        await uow._session.delete(row)  # type: ignore[attr-defined]
        await uow.commit()
    await harness.container.runtime._cache.invalidate()
    ready = (await harness.client.get("/ready")).json()
    assert ready["services"]["settings"] == "missing_keys"
    company = await harness.add_company()
    admin = await harness.add_employee(company, "admin@forsa.com", Role.ADMIN)
    created = await harness.client.post(
        "/api/v1/companies",
        headers=await harness.login(admin),
        json={"name": "Forsa Panamá", "country": "PA", "currency": "USD"},
    )
    assert created.status_code == 503 and created.json()["error"]["code"] == "setting_missing"


async def test_every_user_sees_the_supported_currencies_in_me(harness: Harness) -> None:
    employee = await harness.add_employee(await harness.add_company(), "juan@forsa.com", Role.EMPLOYEE)
    await harness.set_setting("operation.supported_currencies", ["COP", "USD"])
    me = (await harness.client.get("/api/v1/me", headers=await harness.login(employee))).json()
    assert me["supported_currencies"] == ["COP", "USD"]
