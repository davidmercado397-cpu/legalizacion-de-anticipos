from __future__ import annotations

from typing import Any, cast

import sqlalchemy as sa

from app.application.whatsapp_notifier import WhatsAppSessions
from app.domain.enums import Role
from tests.conftest import Harness, wa_message
from tests.fakes import invoice, make_jpeg

PHONE = "573001112233"
APPROVER_PHONE = "573005550000"


class Chat:
    """Conversación de prueba de un número con el bot."""

    def __init__(self, harness: Harness, phone: str) -> None:
        self.harness = harness
        self.phone = phone
        self.count = 0

    def _id(self) -> str:
        self.count += 1
        return f"wamid.{self.phone[-4:]}.{self.count}"

    async def say(self, text: str) -> None:
        await self.harness.webhook(wa_message(self._id(), phone=self.phone, type="text", text={"body": text}))
        await self.harness.drain()

    async def tap(self, reply_id: str) -> None:
        payload = {"type": "list_reply", "list_reply": {"id": reply_id, "title": "-"}}
        await self.harness.webhook(wa_message(self._id(), phone=self.phone, type="interactive", interactive=payload))
        await self.harness.drain()

    async def photo(self, seed: int) -> None:
        media = f"M{self.phone[-4:]}{seed}"
        self.harness.wa.media[media] = (make_jpeg(seed=seed), "image/jpeg")
        await self.harness.webhook(
            wa_message(self._id(), phone=self.phone, type="image", image={"id": media, "mime_type": "image/jpeg"})
        )
        await self.harness.drain()

    def last(self, kind: str) -> Any:
        return [s for s in self.harness.wa.of_kind(kind) if s.to and s.to.phone == self.phone][-1]

    @property
    def received(self) -> int:
        """Cuántos mensajes le ha enviado el bot a este número."""
        return sum(1 for s in self.harness.wa.sent if s.to and s.to.phone == self.phone)


async def _scenario(harness: Harness) -> tuple[Chat, Chat, dict[str, str], str]:
    company = await harness.add_company()
    approver = await harness.add_employee(company, "ana@forsa.com", Role.APPROVER, phone=APPROVER_PHONE)
    employee = await harness.add_employee(company, "juan@forsa.com", phone=PHONE, approver=approver)
    emp_h, appr_h = await harness.login(employee), await harness.login(approver)
    created = await harness.client.post(
        "/api/v1/advances",
        headers=emp_h,
        json={
            "company_id": str(company.id),
            "kind": "cash",
            "currency": "COP",
            "amount": "400000",
            "purpose": "Obra Medellín",
            "destination": "Medellín",
            "start_date": "2026-10-12",
            "end_date": "2026-10-15",
        },
    )
    advance_id = created.json()["id"]
    await harness.client.post(f"/api/v1/advances/{advance_id}/approve", headers=appr_h)
    await harness.drain()
    harness.wa.sent.clear()
    return Chat(harness, PHONE), Chat(harness, APPROVER_PHONE), emp_h, advance_id


async def _expire_sessions(harness: Harness) -> None:
    async with harness.container.engine.begin() as conn:
        await conn.execute(sa.text("UPDATE whatsapp_sessions SET last_inbound_at = now() - interval '1 hour'"))


async def test_greeting_menu_by_role_session_expiry_and_farewell(harness: Harness) -> None:
    juan, ana, _, _ = await _scenario(harness)
    await harness.set_setting("whatsapp.assistant_name", "Rinda")

    await juan.say("Buenas")
    menu = juan.last("list")
    assert menu.text.startswith("Hola Juan 👋 Soy Rinda. ¿Qué necesitas?") and "📸" in menu.text
    assert "menu:approvals" not in [r.id for r in menu.extra] and menu.extra[0].title == "💰 Mis anticipos"

    await juan.say("otra cosa")  # misma conversación: solo el menú
    assert juan.last("list").text == "¿En qué más te ayudo?"

    await _expire_sessions(harness)
    await juan.say("hola")
    assert juan.last("list").text.startswith("Hola Juan 👋")

    await juan.say("¡Gracias!")
    assert juan.last("text").text == "¡Con gusto, Juan! Aquí estoy cuando me necesites 👋"
    await juan.say("menú")
    assert juan.last("list").text.startswith("Hola Juan 👋")  # tras despedirse, se saluda de nuevo

    await ana.say("hola")
    assert "menu:approvals" in [r.id for r in ana.last("list").extra]


async def test_balance_advances_and_my_expenses(harness: Harness) -> None:
    juan, _, emp_h, advance_id = await _scenario(harness)
    await juan.photo(1)
    await juan.say("Saldo")
    assert "Pendiente: $400.000 COP" in juan.last("text").text

    await juan.tap("menu:advances")
    assert "• *Medellín 12/10–15/10* · abierto · $400.000 COP" in juan.last("text").text

    await juan.say("mis gastos")
    rows = juan.last("list").extra
    assert rows[0].id.startswith("exp_view:") and rows[0].title == "Restaurante El Cielo"
    await juan.tap(rows[0].id)
    detail = juan.last("buttons")
    assert [b.title for b in detail.extra] == ["✅ Está bien", "✏️ Corregir", "🗑️ Descartar"]
    await juan.tap(detail.extra[2].id)
    assert juan.last("text").text.startswith("🗑️ Gasto descartado.\n📌 En Medellín 12/10–15/10 te quedan $400.000 COP")

    await juan.tap("menu:expenses")
    assert juan.last("text").text.startswith("Todavía no tienes gastos")


async def test_submit_legalization_from_the_menu(harness: Harness) -> None:
    juan, _, emp_h, advance_id = await _scenario(harness)
    await juan.photo(1)
    await juan.tap("menu:submit")
    blocked = juan.last("buttons")
    assert "Antes de enviarla, confirma o descarta el gasto pendiente." in blocked.text
    await juan.tap(blocked.extra[0].id)  # Ver pendientes
    pending = juan.last("list")
    assert pending.text.startswith("📝 Tienes 1 gasto por confirmar")
    await juan.tap(pending.extra[0].id)
    await juan.tap(juan.last("buttons").extra[0].id)  # Está bien

    await juan.say("menu")
    await juan.tap("menu:submit")
    ready = juan.last("buttons")
    assert "Legalizado: $45.000 COP de $400.000 COP en 1 gasto." in ready.text and ready.extra[0].title == "📤 Enviar"
    await juan.tap(ready.extra[0].id)
    assert juan.last("text").text.startswith("📤 Listo, envié tu legalización")
    detail = await harness.client.get(f"/api/v1/advances/{advance_id}", headers=emp_h)
    assert detail.json()["status"] == "in_review"
    await juan.tap("menu:submit")
    assert juan.last("text").text == "No tienes anticipos abiertos en este momento."


async def test_approvals_from_the_menu_only_for_approvers(harness: Harness) -> None:
    juan, ana, emp_h, _ = await _scenario(harness)
    company_id = (await harness.client.get("/api/v1/me", headers=emp_h)).json()["company_ids"][0]
    requested = await harness.client.post(
        "/api/v1/advances",
        headers=emp_h,
        json={"company_id": company_id, "kind": "cash", "currency": "COP", "amount": "200000", "purpose": "Cali"},
    )
    await harness.drain()

    await juan.tap("menu:approvals")
    assert juan.last("text").text == "❌ Tu usuario no tiene permiso para hacer esto."

    await ana.tap("menu:approvals")
    item = ana.last("buttons")
    assert item.text == "👤 Juan Pérez pide $200.000 COP para Cali." and item.extra[0].title == "✅ Aprobar"
    await ana.tap(item.extra[0].id)
    assert "aprobado" in ana.last("text").text
    status = (await harness.client.get(f"/api/v1/advances/{requested.json()['id']}", headers=emp_h)).json()["status"]
    assert status == "approved"
    await ana.tap("menu:approvals")
    assert ana.last("text").text == "No tienes anticipos por aprobar 👍"

    # Un aprobador ve los gastos de su equipo en la app, pero en el chat solo maneja los suyos.
    await juan.photo(1)
    expense_id = (await harness.client.get("/api/v1/expenses", headers=emp_h)).json()["data"][0]["id"]
    await ana.tap(f"exp_view:{expense_id}")
    assert ana.last("text").text.startswith("❌ No encontramos el gasto")


async def test_idle_session_is_closed_with_a_single_reminder(harness: Harness) -> None:
    juan, _, _, _ = await _scenario(harness)
    harness.extractor.respond = lambda _r, _n: [invoice()]
    await juan.photo(1)
    sessions = cast(WhatsAppSessions, harness.container.extras["sessions"])
    assert await sessions.close_idle() is None  # todavía activa

    await _expire_sessions(harness)
    assert await sessions.close_idle() == "1 sessions closed"
    reminder = juan.last("buttons")
    assert reminder.text.startswith("Juan, quedó pendiente: 1 gasto por confirmar") and reminder.extra[0].id == "menu:pending"
    sent = len(harness.wa.sent)
    assert await sessions.close_idle() is None and len(harness.wa.sent) == sent

    await juan.say("hola")  # nueva conversación: saludo
    assert juan.last("list").text.startswith("Hola Juan 👋")
