"""Los Flow JSON de `whatsapp_flows/` se publican a mano en WhatsApp Manager: esta prueba evita que el
código y el formulario se desalineen (pantalla, datos precargados y campos de la respuesta)."""

from __future__ import annotations

import json
import pathlib
import re
from typing import Any

import pytest

from app.application import messages as msg
from app.application.whatsapp_flows import BY_ADVANCE, TRIP_FIELDS

FLOWS = pathlib.Path(__file__).resolve().parents[2] / "whatsapp_flows"
# archivo -> (pantalla que abre FlowLauncher, campos de la respuesta final que leen los casos de uso)
EXPECTED = {
    "expense_correction.json": (
        "CORRECT",
        {
            "document_type",
            "category",
            "vendor_name",
            "vendor_tax_id",
            "invoice_number",
            "invoice_date",
            "currency",
            "total",
            "subtotal",
            "tax_amount",
            "tip_amount",
            "discount_amount",
            "payment_method",
            "description",
            "receipt_signed",
        },
    ),
    "justification.json": ("JUSTIFY", {"justification"}),
    "advance_request.json": (
        "REQUEST",
        {"company_id", "destination", "purpose", "start_date", "end_date", "kind", "currency", "amount", "justification"},
    ),
}


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_flow_file_matches_the_code(name: str) -> None:
    flow = json.loads((FLOWS / name).read_text())
    screen_id, fields = EXPECTED[name]
    assert flow["version"] == "7.3" and flow["screens"][0]["id"] == screen_id
    for screen in flow["screens"]:
        declared = set(screen["data"])
        used = set(re.findall(r"\$\{data\.(\w+)\}", json.dumps(screen["layout"])))
        assert used <= declared and all("__example__" in spec for spec in screen["data"].values())
    [terminal] = [s for s in flow["screens"] if s.get("terminal")]
    assert set(_footer(terminal)["payload"]) == fields and _footer(terminal)["name"] == "complete"


def test_the_advance_request_asks_the_endpoint_for_the_calculated_amount() -> None:
    """La primera pantalla manda el viaje al endpoint (FlowDataExchange) y este abre AMOUNT con sus datos."""
    flow = json.loads((FLOWS / "advance_request.json").read_text())
    request, amount = flow["screens"]
    assert flow["data_api_version"] == "3.0" and flow["routing_model"] == {"REQUEST": ["AMOUNT"], "AMOUNT": []}
    assert _footer(request)["name"] == "data_exchange" and set(_footer(request)["payload"]) == set(TRIP_FIELDS)
    assert amount["id"] == "AMOUNT" and set(amount["data"]) == {*TRIP_FIELDS, "summary", "currencies", "currency", "amount"}


def _footer(screen: dict[str, Any]) -> dict[str, Any]:
    action: dict[str, Any] = next(c for c in screen["layout"]["children"] if c["type"] == "Footer")["on-click-action"]
    return action


def _example_ids(name: str, key: str) -> list[str]:
    data = json.loads((FLOWS / name).read_text())["screens"][0]["data"]
    return [option["id"] for option in data[key]["__example__"]]


def test_fixed_lists_show_every_option_in_the_meta_preview() -> None:
    """La vista previa de Meta usa los ejemplos: con una sola opción parece que no se puede cambiar."""
    assert _example_ids("expense_correction.json", "document_types") == list(msg.DOCUMENT_TYPE_LABELS)
    assert _example_ids("expense_correction.json", "payment_methods") == [BY_ADVANCE, *msg.PAYMENT_METHOD_LABELS]
    assert _example_ids("advance_request.json", "kinds") == list(msg.ADVANCE_KIND_LABELS)
