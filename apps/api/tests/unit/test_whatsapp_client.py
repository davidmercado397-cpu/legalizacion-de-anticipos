from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import jwt
import pytest
import respx

from app.adapters.outbound.security.tokens import JwtTokenService
from app.adapters.outbound.whatsapp import GraphWhatsAppClient
from app.domain.entities import Employee
from app.domain.errors import AuthenticationError
from app.domain.ports import FlowMessage
from app.domain.values import WhatsAppAddress

URL = "https://graph.test/v23.0/PHONE1/messages"
SECRET = "s" * 48


@respx.mock
async def test_send_flow_payload_follows_the_cloud_api() -> None:
    route = respx.post(URL).mock(return_value=httpx.Response(200, json={"messages": [{"id": "wamid.F1"}]}))
    async with httpx.AsyncClient() as http:
        client = GraphWhatsAppClient(http, "https://graph.test/v23.0", "PHONE1", "token")
        flow = FlowMessage("123", "Corrige lo que haga falta", "Corregir", "tok", "CORRECT", {"total": "45000"})
        assert await client.send_flow(WhatsAppAddress(user_id="CO.1"), flow) == "wamid.F1"
    body = json.loads(route.calls[0].request.content)
    assert body["recipient"] == "CO.1" and body["type"] == "interactive"
    interactive = body["interactive"]
    assert interactive["type"] == "flow" and interactive["body"] == {"text": "Corrige lo que haga falta"}
    assert interactive["action"]["name"] == "flow"
    assert interactive["action"]["parameters"] == {
        "flow_message_version": "3",
        "flow_id": "123",
        "flow_token": "tok",
        "flow_cta": "Corregir",
        "flow_action": "navigate",
        "flow_action_payload": {"screen": "CORRECT", "data": {"total": "45000"}},
    }


def test_flow_token_carries_who_what_and_expires() -> None:
    tokens = JwtTokenService(SECRET, 900, 300, 1800)
    employee_id, expense_id = uuid.uuid4(), uuid.uuid4()
    claims = tokens.decode_flow_token(tokens.issue_flow_token(employee_id, "expense_correction", str(expense_id)))
    assert (claims.employee_id, claims.purpose, claims.entity_id) == (employee_id, "expense_correction", str(expense_id))

    access, _ = tokens.issue_access_token(Employee("Juan Pérez", "juan@forsa.com"))
    with pytest.raises(AuthenticationError):
        tokens.decode_flow_token(access)  # un access token no sirve como token de formulario
    with pytest.raises(AuthenticationError):
        tokens.decode_access_token(tokens.issue_flow_token(employee_id, "justification", None))
    past = datetime.now(UTC) - timedelta(hours=1)
    expired = jwt.encode(
        {
            "sub": str(employee_id),
            "typ": "flow",
            "flow": "justification",
            "iss": "anticipos-gastos-api",
            "iat": past,
            "exp": past,
        },
        SECRET,
        algorithm="HS256",
    )
    with pytest.raises(AuthenticationError):
        tokens.decode_flow_token(expired)
