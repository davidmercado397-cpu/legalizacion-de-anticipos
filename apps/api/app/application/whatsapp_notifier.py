"""Conversación con el empleado: sesión (cuándo saludar de nuevo) y avisos que respetan la ventana de
24 h de Meta. Dentro de la ventana se escribe libre y con botones; afuera solo con plantilla, y el
mensaje completo queda guardado para entregarlo cuando el empleado escriba o toque [Ver detalle]."""

from __future__ import annotations

import logging
import uuid
from datetime import timedelta

from app.application import messages as msg
from app.application.settings import SettingsService
from app.application.whatsapp_presenter import Reply
from app.domain.entities import Employee, HeldNotice
from app.domain.enums import ExpenseStatus
from app.domain.ports import Button, Clock, MessageSender, UnitOfWorkFactory
from app.domain.values import WhatsAppAddress

logger = logging.getLogger(__name__)

# Botón [Ver detalle] de la plantilla de aviso. Si ya no hay nada guardado (se mostró o venció), el
# menú lo atiende como «ver opciones».
NOTICE_DETAIL_PAYLOAD = "menu:menu"


async def send_reply(sender: MessageSender, to: WhatsAppAddress, reply: Reply) -> None:
    if reply.buttons:
        await sender.send_buttons(to, reply.text, list(reply.buttons))
    else:
        await sender.send_text(to, reply.text)


class WhatsAppSessions:
    def __init__(self, uow: UnitOfWorkFactory, settings: SettingsService, clock: Clock, sender: MessageSender) -> None:
        self._sender = sender
        self._uow = uow
        self._settings = settings
        self._clock = clock

    async def register_inbound(self, employee_id: uuid.UUID) -> bool:
        """Cada mensaje del usuario abre (o renueva) la ventana; devuelve True si empieza conversación."""
        ttl = timedelta(minutes=(await self._settings.current()).whatsapp_session_ttl_minutes)
        now = self._clock.now()
        async with self._uow() as uow:
            session, created = await uow.whatsapp_sessions.open(employee_id, now)
            new = created or session.register_inbound(now, ttl)
            await uow.commit()
        return new

    async def hold(self, employee_id: uuid.UUID, reply: Reply) -> None:
        buttons = [{"id": b.id, "title": b.title} for b in reply.buttons]
        async with self._uow() as uow:
            uow.held_notices.add(HeldNotice(employee_id, reply.text, buttons, self._clock.now()))
            await uow.commit()

    async def deliver_held(self, employee_id: uuid.UUID, to: WhatsAppAddress) -> bool:
        """Entrega los avisos que salieron por plantilla y siguen vigentes; True si entregó alguno."""
        days = (await self._settings.current()).whatsapp_notice_hold_days
        since = self._clock.now() - timedelta(days=days)
        async with self._uow() as uow:
            notices = [n for n in await uow.held_notices.take_for(employee_id) if n.created_at >= since]
            await uow.commit()
        for notice in notices:
            buttons = tuple(Button(b["id"], b["title"]) for b in notice.buttons)
            try:
                await send_reply(self._sender, to, Reply(notice.text, buttons))
            except Exception:  # noqa: BLE001 - el aviso es secundario
                logger.warning("Held notice for %s not delivered", employee_id, exc_info=True)
        return bool(notices)

    async def close(self, employee_id: uuid.UUID) -> None:
        """Despedida: el siguiente mensaje empieza otra conversación (y se saluda)."""
        async with self._uow() as uow:
            session = await uow.whatsapp_sessions.get(employee_id)
            if session is not None:
                session.close(self._clock.now())
                await uow.commit()

    async def close_idle(self) -> str | None:
        """Tarea periódica: cierra las conversaciones inactivas. Si quedó algo sin terminar en esa
        conversación, se recuerda una sola vez (la ventana de 24 h sigue abierta). De paso borra los
        avisos guardados que ya vencieron."""
        current = await self._settings.current()
        now = self._clock.now()
        reminders: list[tuple[Employee, int, bool]] = []
        async with self._uow() as uow:
            await uow.held_notices.purge(now - timedelta(days=current.whatsapp_notice_hold_days))
            sessions = await uow.whatsapp_sessions.list_idle(now - timedelta(minutes=current.whatsapp_session_ttl_minutes), 200)
            for session in sessions:
                session.close(now)
                if session.reminder_sent_at is not None:
                    continue
                pending = len(await uow.expenses.list_by_status_for(session.employee_id, ExpenseStatus.EXTRACTED))
                unreadable = any(
                    e.created_at >= session.started_at
                    for e in await uow.expenses.list_by_status_for(session.employee_id, ExpenseStatus.UNREADABLE)
                )
                employee = await uow.employees.get(session.employee_id)
                if (pending or unreadable) and employee is not None and employee.active:
                    session.reminder_sent_at = now
                    reminders.append((employee, pending, unreadable))
            await uow.commit()
        for employee, pending, unreadable in reminders:
            address = employee.whatsapp_address
            if address is None:
                continue
            parts = [msg.expenses_count(pending) + " por confirmar"] if pending else []
            if unreadable:
                parts.append(msg.IDLE_UNREADABLE)
            text = msg.IDLE_REMINDER.format(name=employee.first_name, what=" y ".join(parts))
            buttons = (Button("menu:pending", msg.BUTTON_SEE_PENDING),) if pending else ()
            try:
                await send_reply(self._sender, address, Reply(text, buttons))
            except Exception:  # noqa: BLE001 - recordatorio secundario
                logger.warning("Idle reminder to %s not delivered", employee.id, exc_info=True)
        return f"{len(sessions)} sessions closed" if sessions else None

    async def window_open(self, employee_id: uuid.UUID) -> bool:
        async with self._uow() as uow:
            session = await uow.whatsapp_sessions.get(employee_id)
        return session is not None and session.window_open(self._clock.now())


class WhatsAppNotifier:
    """Avisos que inicia el sistema (recordatorios, cambios de estado). Nunca rompen el flujo que los
    origina: si WhatsApp falla o no hay plantilla, queda en el log."""

    def __init__(self, sender: MessageSender, sessions: WhatsAppSessions, settings: SettingsService) -> None:
        self._sender = sender
        self._sessions = sessions
        self._settings = settings

    async def notify(self, employee: Employee, reply: Reply, notice: str) -> bool:
        """`notice` es la versión de una línea que va como parámetro de la plantilla fuera de la ventana;
        el mensaje completo se guarda para cuando el empleado escriba."""
        address = employee.whatsapp_address
        if address is None or not employee.active:
            return False
        try:
            if await self._sessions.window_open(employee.id):
                await send_reply(self._sender, address, reply)
                return True
            current = await self._settings.current()
            if not current.whatsapp_notice_template:
                logger.info("WhatsApp notice for %s not sent: window closed and no template configured", employee.id)
                return False
            await self._sender.send_template(
                address,
                current.whatsapp_notice_template,
                current.whatsapp_template_language,
                [employee.first_name, notice],
                [NOTICE_DETAIL_PAYLOAD],
            )
        except Exception:  # noqa: BLE001 - el aviso es secundario
            logger.exception("WhatsApp notice to %s failed", employee.id)
            return False
        try:
            await self._sessions.hold(employee.id, reply)
        except Exception:  # noqa: BLE001 - la plantilla ya salió: no se reintenta el aviso
            logger.exception("WhatsApp notice for %s not held", employee.id)
        return True
