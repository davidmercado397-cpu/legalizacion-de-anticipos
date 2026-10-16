"""Control: verificación en dos pasos obligatoria para roles con privilegios (ASVS V2.8 / ISO 27001 A.8.5)."""

from __future__ import annotations

from typing import Any

import pyotp
import pytest

from app.domain.enums import Role
from tests.conftest import PASSWORD, Harness

MFA_ON = {"MFA_REQUIRED_ROLES": "admin,accountant,superadmin"}


async def _enroll(harness: Harness, headers: dict[str, str]) -> tuple[str, list[str]]:
    setup = (await harness.client.post("/api/v1/me/mfa/setup", headers=headers)).json()
    assert setup["provisioning_uri"].startswith("otpauth://totp/")
    enabled = await harness.client.post(
        "/api/v1/me/mfa/enable", headers=headers, json={"code": pyotp.TOTP(setup["secret"]).now()}
    )
    assert enabled.status_code == 200, enabled.text
    return setup["secret"], enabled.json()["recovery_codes"]


async def _login(harness: Harness, email: str) -> dict[str, Any]:
    return (await harness.client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})).json()


@pytest.mark.parametrize("settings_overrides", [MFA_ON])
async def test_privileged_roles_must_enable_mfa_before_using_the_api(
    harness: Harness, settings_overrides: dict[str, Any]
) -> None:
    company = await harness.add_company()
    admin = await harness.add_employee(company, "admin@forsa.com", Role.ADMIN)
    employee = await harness.add_employee(company, "juan@forsa.com")
    admin_h = await harness.login(admin)

    blocked = await harness.client.get("/api/v1/employees", headers=admin_h)
    assert blocked.status_code == 403 and blocked.json()["error"]["code"] == "mfa_setup_required"
    me = await harness.client.get("/api/v1/me", headers=admin_h)
    assert me.status_code == 200 and me.json()["mfa_setup_required"] is True and me.json()["mfa_enabled"] is False
    # Un empleado normal no está obligado.
    assert (await harness.client.get("/api/v1/advances", headers=await harness.login(employee))).status_code == 200


@pytest.mark.parametrize("settings_overrides", [MFA_ON])
async def test_login_with_mfa_needs_a_valid_unused_code(harness: Harness, settings_overrides: dict[str, Any]) -> None:
    company = await harness.add_company()
    admin = await harness.add_employee(company, "admin@forsa.com", Role.ADMIN)
    old_h = await harness.login(admin)
    secret, recovery = await _enroll(harness, old_h)
    # Activar el MFA cierra las sesiones abiertas.
    assert (await harness.client.get("/api/v1/me", headers=old_h)).status_code == 401

    step1 = await _login(harness, admin.email)
    assert step1["mfa_required"] is True and step1["access_token"] is None
    wrong = await harness.client.post("/api/v1/auth/mfa", json={"mfa_token": step1["mfa_token"], "code": "000000"})
    assert wrong.status_code == 401 and wrong.json()["error"]["code"] == "invalid_mfa_code"

    code = pyotp.TOTP(secret).now()
    ok = await harness.client.post("/api/v1/auth/mfa", json={"mfa_token": step1["mfa_token"], "code": code})
    assert ok.status_code == 200
    headers = {"Authorization": f"Bearer {ok.json()['access_token']}"}
    assert (await harness.client.get("/api/v1/employees", headers=headers)).status_code == 200

    replay = await harness.client.post(
        "/api/v1/auth/mfa", json={"mfa_token": (await _login(harness, admin.email))["mfa_token"], "code": code}
    )
    assert replay.status_code == 401  # el mismo código no sirve dos veces

    challenge = (await _login(harness, admin.email))["mfa_token"]
    assert (await harness.client.post("/api/v1/auth/mfa", json={"mfa_token": challenge, "code": recovery[0]})).status_code == 200
    challenge = (await _login(harness, admin.email))["mfa_token"]
    assert (await harness.client.post("/api/v1/auth/mfa", json={"mfa_token": challenge, "code": recovery[0]})).status_code == 401


@pytest.mark.parametrize("settings_overrides", [MFA_ON])
async def test_mfa_token_and_access_token_are_not_interchangeable(harness: Harness, settings_overrides: dict[str, Any]) -> None:
    company = await harness.add_company()
    admin = await harness.add_employee(company, "admin@forsa.com", Role.ADMIN)
    secret, _ = await _enroll(harness, await harness.login(admin))
    challenge = (await _login(harness, admin.email))["mfa_token"]
    as_access = await harness.client.get("/api/v1/me", headers={"Authorization": f"Bearer {challenge}"})
    assert as_access.status_code == 401
    tokens = (
        await harness.client.post("/api/v1/auth/mfa", json={"mfa_token": challenge, "code": pyotp.TOTP(secret).now()})
    ).json()
    as_challenge = await harness.client.post("/api/v1/auth/mfa", json={"mfa_token": tokens["access_token"], "code": "123456"})
    assert as_challenge.status_code == 401


@pytest.mark.parametrize("settings_overrides", [MFA_ON])
async def test_an_admin_resets_someone_elses_mfa_but_not_their_own(harness: Harness, settings_overrides: dict[str, Any]) -> None:
    company = await harness.add_company()
    admin = await harness.add_employee(company, "admin@forsa.com", Role.ADMIN)
    accountant = await harness.add_employee(company, "carlos@forsa.com", Role.ACCOUNTANT)
    await _enroll(harness, await harness.login(accountant))
    secret, _ = await _enroll(harness, await harness.login(admin))
    challenge = (await _login(harness, admin.email))["mfa_token"]
    tokens = (
        await harness.client.post("/api/v1/auth/mfa", json={"mfa_token": challenge, "code": pyotp.TOTP(secret).now()})
    ).json()
    admin_h = {"Authorization": f"Bearer {tokens['access_token']}"}

    own = await harness.client.post(f"/api/v1/employees/{admin.id}/mfa/reset", headers=admin_h)
    assert own.status_code == 409 and own.json()["error"]["code"] == "mfa_self_reset"
    assert (await harness.client.post(f"/api/v1/employees/{accountant.id}/mfa/reset", headers=admin_h)).status_code == 204
    after = await _login(harness, accountant.email)
    assert after["mfa_required"] is False and after["access_token"]  # deberá activarlo de nuevo
