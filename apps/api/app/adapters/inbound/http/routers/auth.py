"""Autenticación y recursos propios del usuario actual (/auth, /me)."""

from __future__ import annotations

from fastapi import APIRouter, Request, status

from app.adapters.inbound.http.deps import ContainerDep, CurrentEmployee, CurrentEmployeeAny, client_ip, enforce_limit
from app.adapters.inbound.http.schemas import (
    BalanceOut,
    EmployeeOut,
    LinkCodeOut,
    ListOut,
    LoginIn,
    LoginOut,
    MfaCodeIn,
    MfaSetupOut,
    MfaVerifyIn,
    OpenBalanceOut,
    PasswordChangeIn,
    RecoveryCodesOut,
    RefreshIn,
    TokenOut,
    advance_out,
    employee_out,
)
from app.application.auth import MfaChallenge, TokenPair

router = APIRouter(tags=["auth"])


@router.post("/auth/login", response_model=LoginOut, summary="Log in with email and password (step 1)")
async def login(body: LoginIn, request: Request, container: ContainerDep) -> LoginOut:
    ip = client_ip(request)
    settings = container.settings
    await enforce_limit(container, "login_ip", ip, settings.RATE_LIMIT_LOGIN)
    await enforce_limit(container, "login_email", body.email.lower(), settings.RATE_LIMIT_LOGIN)
    result = await container.auth.login(body.email, body.password, ip)
    if isinstance(result, MfaChallenge):
        return LoginOut(mfa_required=True, mfa_token=result.token, expires_in=result.expires_in)
    return _tokens_out(result)


@router.post("/auth/mfa", response_model=LoginOut, summary="Second factor: TOTP or recovery code (step 2)")
async def login_mfa(body: MfaVerifyIn, request: Request, container: ContainerDep) -> LoginOut:
    ip = client_ip(request)
    await enforce_limit(container, "mfa_ip", ip, container.settings.RATE_LIMIT_MFA)
    return _tokens_out(await container.auth.verify_mfa(body.mfa_token, body.code, ip))


@router.post("/me/mfa/setup", response_model=MfaSetupOut, tags=["me"], summary="Start enabling two-step verification")
async def mfa_setup(employee: CurrentEmployeeAny, container: ContainerDep) -> MfaSetupOut:
    setup = await container.mfa.setup(employee)
    return MfaSetupOut(secret=setup.secret, provisioning_uri=setup.provisioning_uri)


@router.post("/me/mfa/enable", response_model=RecoveryCodesOut, tags=["me"], summary="Confirm with the first code")
async def mfa_enable(body: MfaCodeIn, employee: CurrentEmployeeAny, container: ContainerDep) -> RecoveryCodesOut:
    await enforce_limit(container, "mfa_enable", str(employee.id), container.settings.RATE_LIMIT_MFA)
    return RecoveryCodesOut(recovery_codes=await container.mfa.enable(employee, body.code))


def _tokens_out(pair: TokenPair) -> LoginOut:
    return LoginOut(
        access_token=pair.access_token,
        refresh_token=pair.refresh_token,
        expires_in=pair.expires_in,
        must_change_password=pair.employee.must_change_password,
    )


@router.post("/auth/refresh", response_model=TokenOut, summary="Rotate the refresh token")
async def refresh(body: RefreshIn, request: Request, container: ContainerDep) -> TokenOut:
    await enforce_limit(container, "refresh", client_ip(request), container.settings.RATE_LIMIT_REFRESH)
    pair = await container.auth.refresh(body.refresh_token)
    return TokenOut(
        access_token=pair.access_token,
        refresh_token=pair.refresh_token,
        expires_in=pair.expires_in,
        must_change_password=pair.employee.must_change_password,
    )


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT, summary="Revoke the session")
async def logout(body: RefreshIn, container: ContainerDep) -> None:
    await container.auth.logout(body.refresh_token)


@router.get("/me", response_model=EmployeeOut, tags=["me"])
async def me(employee: CurrentEmployeeAny, container: ContainerDep) -> EmployeeOut:
    # Lectura fresca: el actor autenticado se cachea unos segundos y puede venir desactualizado (p. ej. tras vincular WhatsApp).
    return employee_out(await container.employees.get(employee, employee.id))


@router.post("/me/password", status_code=status.HTTP_204_NO_CONTENT, tags=["me"])
async def change_password(body: PasswordChangeIn, employee: CurrentEmployeeAny, container: ContainerDep) -> None:
    await container.auth.change_own_password(employee, body.current_password, body.new_password)


@router.get("/me/balances", response_model=ListOut[OpenBalanceOut], tags=["me"], summary="Open advances and their balance")
async def my_balances(employee: CurrentEmployee, container: ContainerDep) -> ListOut[OpenBalanceOut]:
    balances = await container.advances.open_balances(employee.id)
    return ListOut[OpenBalanceOut](
        data=[OpenBalanceOut(advance=advance_out(b.advance), balance=BalanceOut.of(b.balance, b.functional)) for b in balances]
    )


@router.post("/me/whatsapp-link-code", response_model=LinkCodeOut, tags=["me"], summary="Code to link WhatsApp")
async def my_link_code(employee: CurrentEmployee, container: ContainerDep) -> LinkCodeOut:
    code = await container.identity.issue_link_code(employee.id)
    return LinkCodeOut(
        code=code,
        expires_in_minutes=container.settings.LINK_CODE_TTL_MINUTES,
        instructions=f"Envía por WhatsApp el mensaje: VINCULAR {code}",
    )
