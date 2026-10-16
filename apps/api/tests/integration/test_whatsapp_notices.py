from __future__ import annotations

from datetime import timedelta
from typing import Any, cast

import sqlalchemy as sa

from app.application.reminders import LegalizationReminders
from app.domain.enums import Role
from app.domain.time import local_date
from tests.conftest import Harness, wa_message

PHONE = "573001112233"


async def _advance_ended(harness: Harness, days_ago: int) -> tuple[Any, dict[str, str], str]:
    company = await harness.add_company()
    approver = await harness.add_employee(company, "ana@forsa.com", Role.APPROVER)
    employee = await harness.add_employee(company, "juan@forsa.com", phone=PHONE, approver=approver)
    emp_h, appr_h = await harness.login(employee), await harness.login(approver)
    end = local_date(harness.container.clock.now(), company.timezone) - timedelta(days=days_ago)
    created = await harness.client.post(
        "/api/v1/advances",
        headers=emp_h,
        json={
            "company_id": str(company.id),
            "kind": "cash",
            "currency": "COP",
            "amount": "400000",
            "purpose": "Obra",
            "destination": "Medellín",
            "start_date": str(end - timedelta(days=2)),
            "end_date": str(end),
        },
    )
    advance_id = created.json()["id"]
    await harness.client.post(f"/api/v1/advances/{advance_id}/approve", headers=appr_h)
    await harness.drain()
    return employee, emp_h, advance_id


def _reminders(harness: Harness) -> LegalizationReminders:
    return cast(LegalizationReminders, harness.container.extras["reminders"])


async def _say_hello(harness: Harness, message_id: str = "wamid.H1") -> None:
    await harness.webhook(wa_message(message_id, phone=PHONE, type="text", text={"body": "hola"}))
    await harness.drain()
    harness.wa.sent.clear()


async def test_reminder_inside_the_window_submits_with_one_tap_and_is_not_repeated(harness: Harness) -> None:
    _, emp_h, advance_id = await _advance_ended(harness, 1)
    await _say_hello(harness)

    assert await _reminders(harness).run() == "1 of 1 reminders sent"
    reminder = harness.wa.of_kind("buttons")[-1]
    assert reminder.text.startswith("⏰ Juan, tu viaje a Medellín terminó el")
    assert "Llevas legalizado $0 COP de $400.000 COP" in reminder.text
    assert await _reminders(harness).run() is None  # el día 1 ya se recordó

    await harness.webhook(
        wa_message(
            "wamid.H2",
            phone=PHONE,
            type="interactive",
            interactive={"type": "button_reply", "button_reply": {"id": reminder.extra[0].id, "title": "Enviar"}},
        )
    )
    await harness.drain()
    assert harness.wa.of_kind("text")[-1].text.startswith("📤 Listo, envié tu legalización")
    assert (await harness.client.get(f"/api/v1/advances/{advance_id}", headers=emp_h)).json()["status"] == "in_review"


async def test_outside_the_window_the_reminder_uses_the_template_once(harness: Harness) -> None:
    await _advance_ended(harness, 4)
    await _say_hello(harness)
    async with harness.container.engine.begin() as conn:
        await conn.execute(sa.text("UPDATE whatsapp_sessions SET last_inbound_at = now() - interval '2 days'"))

    # Sin plantilla configurada no se puede escribir fuera de la ventana: no se envía nada.
    assert await _reminders(harness).run() == "0 of 1 reminders sent"
    assert harness.wa.sent == []

    async with harness.container.engine.begin() as conn:
        await conn.execute(sa.text("UPDATE advances SET reminders_sent = '[]'"))
    await harness.set_setting("whatsapp.notice_template", "aviso_gastos")
    assert await _reminders(harness).run() == "1 of 1 reminders sent"
    template = harness.wa.of_kind("template")[-1]
    assert template.text == "aviso_gastos" and template.extra["params"][0] == "Juan"
    assert "\n" not in template.extra["params"][1] and "recuerda enviar la legalización" in template.extra["params"][1]
    # Los días 1 y 3 ya pasaron: van en un solo recordatorio.
    assert await _reminders(harness).run() is None


async def test_a_trip_that_ends_today_gets_no_reminder_yet(harness: Harness) -> None:
    await _advance_ended(harness, 0)
    await _say_hello(harness)
    assert await _reminders(harness).run() is None
