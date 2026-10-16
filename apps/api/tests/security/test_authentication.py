from __future__ import annotations

from typing import Any

import pytest

from app.domain.enums import Role
from tests.conftest import PASSWORD, Harness


async def test_login_refresh_rotation_and_reuse_detection(harness: Harness) -> None:
    company = await harness.add_company()
    user = await harness.add_employee(company, "juan@forsa.com")
    login = await harness.client.post("/api/v1/auth/login", json={"email": user.email, "password": PASSWORD})
    assert login.status_code == 200
    first_refresh = login.json()["refresh_token"]

    rotated = await harness.client.post("/api/v1/auth/refresh", json={"refresh_token": first_refresh})
    assert rotated.status_code == 200
    second_refresh = rotated.json()["refresh_token"]

    # Si reusan el token rotado es porque se filtró: se revoca toda la familia.
    reused = await harness.client.post("/api/v1/auth/refresh", json={"refresh_token": first_refresh})
    assert reused.status_code == 401
    after = await harness.client.post("/api/v1/auth/refresh", json={"refresh_token": second_refresh})
    assert after.status_code == 401


async def test_wrong_password_locks_the_account(harness: Harness) -> None:
    company = await harness.add_company()
    user = await harness.add_employee(company, "juan@forsa.com")
    harness.container.settings.RATE_LIMIT_LOGIN = "100/minute"
    for _ in range(5):
        bad = await harness.client.post("/api/v1/auth/login", json={"email": user.email, "password": "wrong-password"})
        assert bad.status_code == 401
    locked = await harness.client.post("/api/v1/auth/login", json={"email": user.email, "password": PASSWORD})
    assert locked.status_code == 423 and int(locked.headers["Retry-After"]) > 0


async def test_unknown_email_and_wrong_password_look_the_same(harness: Harness) -> None:
    company = await harness.add_company()
    await harness.add_employee(company, "juan@forsa.com")
    a = await harness.client.post("/api/v1/auth/login", json={"email": "nobody@forsa.com", "password": "x"})
    b = await harness.client.post("/api/v1/auth/login", json={"email": "juan@forsa.com", "password": "x"})
    assert a.status_code == b.status_code == 401
    # Mismo código y mensaje: la respuesta no revela si el correo existe (solo cambia el request_id).
    assert {**a.json()["error"], "request_id": None} == {**b.json()["error"], "request_id": None}


@pytest.mark.parametrize("settings_overrides", [{"RATE_LIMIT_LOGIN": "3/minute"}])
async def test_login_rate_limit(harness: Harness, settings_overrides: dict[str, Any]) -> None:
    codes = [
        (await harness.client.post("/api/v1/auth/login", json={"email": "x@forsa.com", "password": "x"})).status_code
        for _ in range(4)
    ]
    assert codes[:3] == [401, 401, 401] and codes[3] == 429


async def test_deactivated_user_loses_access_immediately(harness: Harness) -> None:
    company = await harness.add_company()
    admin = await harness.add_employee(company, "admin@forsa.com", Role.ADMIN)
    user = await harness.add_employee(company, "juan@forsa.com")
    user_headers = await harness.login(user)
    assert (await harness.client.get("/api/v1/me", headers=user_headers)).status_code == 200
    admin_headers = await harness.login(admin)
    response = await harness.client.post(f"/api/v1/employees/{user.id}/deactivate", headers=admin_headers)
    assert response.status_code == 200
    assert (await harness.client.get("/api/v1/me", headers=user_headers)).status_code == 401


async def test_temporary_password_must_be_changed_first(harness: Harness) -> None:
    company = await harness.add_company()
    user = await harness.add_employee(company, "juan@forsa.com", must_change_password=True)
    headers = await harness.login(user)
    assert (await harness.client.get("/api/v1/advances", headers=headers)).status_code == 403
    weak = await harness.client.post(
        "/api/v1/me/password", headers=headers, json={"current_password": PASSWORD, "new_password": "short"}
    )
    assert weak.status_code == 422
    ok = await harness.client.post(
        "/api/v1/me/password", headers=headers, json={"current_password": PASSWORD, "new_password": "A-much-better-pass-1"}
    )
    assert ok.status_code == 204
    # Cambiar la contraseña revoca los tokens anteriores.
    assert (await harness.client.get("/api/v1/me", headers=headers)).status_code == 401
    login = await harness.client.post("/api/v1/auth/login", json={"email": user.email, "password": "A-much-better-pass-1"})
    assert login.json()["must_change_password"] is False


async def test_tampered_or_missing_tokens_are_rejected(harness: Harness) -> None:
    assert (await harness.client.get("/api/v1/me")).status_code == 401
    bad = await harness.client.get("/api/v1/me", headers={"Authorization": "Bearer abc.def.ghi"})
    assert bad.status_code == 401 and "WWW-Authenticate" in bad.headers


async def test_security_headers(harness: Harness) -> None:
    response = await harness.client.get("/health")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"


async def test_role_permissions_return_403(harness: Harness) -> None:
    company = await harness.add_company()
    user = await harness.add_employee(company, "juan@forsa.com")
    headers = await harness.login(user)
    response = await harness.client.post(
        "/api/v1/companies", headers=headers, json={"name": "Nueva", "country": "CO", "currency": "COP"}
    )
    assert response.status_code == 403
    assert (await harness.client.get("/api/v1/employees", headers=headers)).status_code == 403
    assert (await harness.client.get("/api/v1/audit", headers=headers)).status_code == 403
