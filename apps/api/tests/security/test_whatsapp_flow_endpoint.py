"""Control W7: el endpoint de datos de los Flows solo atiende peticiones firmadas por Meta, cifradas con la
llave del negocio y con un token de Flow vigente emitido para solicitar un anticipo."""

from __future__ import annotations

import uuid
from typing import cast

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app.domain.ports import TokenService
from tests.conftest import Harness
from tests.flow_meta import enable_flow_endpoint, post_flow, seal
from tests.integration.test_whatsapp_flow_endpoint import _trip_with_rates, flow_token, trip_request


async def test_unsigned_undecryptable_or_unconfigured_requests_get_nothing(harness: Harness) -> None:
    sealed = seal({"version": "3.0", "action": "ping"})
    assert (await post_flow(harness, sealed.body)).status_code == 503  # sin llave configurada
    enable_flow_endpoint(harness)
    assert (await post_flow(harness, sealed.body, secret="otro-secreto")).status_code == 403
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    other_pem = other_key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()
    # Cifrada para otra llave: 421 para que Meta vuelva a leer la llave pública.
    assert (await post_flow(harness, seal({"action": "ping"}, other_pem).body)).status_code == 421
    assert (await post_flow(harness, {"encrypted_flow_data": "x"})).status_code == 421


async def test_the_endpoint_needs_a_live_advance_request_token(harness: Harness) -> None:
    company, juan = await _trip_with_rates(harness)
    for token in ("", "inventado", flow_token(harness, juan, "justification")):
        response = await post_flow(harness, seal(trip_request(token, company)).body)
        assert response.status_code == 427  # Meta cierra el formulario
    tokens = cast(TokenService, harness.container.extras["tokens"])
    nobody = tokens.issue_flow_token(uuid.uuid4(), "advance_request", None)
    assert (await post_flow(harness, seal(trip_request(nobody, company)).body)).status_code == 427
    # Un empleado desactivado ya no calcula nada con un token que emitió antes.
    async with harness.container.uow() as uow:
        employee = await uow.employees.get(juan.id)
        assert employee is not None
        employee.active = False
        await uow.commit()
    assert (await post_flow(harness, seal(trip_request(flow_token(harness, juan), company)).body)).status_code == 427
