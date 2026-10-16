"""Avisa al aprobador por WhatsApp cuando se solicita un anticipo (plantilla con botones Aprobar/Rechazar).
La respuesta la maneja el bot con el mismo caso de uso que la API."""

from __future__ import annotations

import logging
import uuid

from app.application import messages as msg
from app.application.settings import SettingsService
from app.domain.errors import ServiceNotConfiguredError
from app.domain.ports import MessageSender, UnitOfWorkFactory

logger = logging.getLogger(__name__)


class AdvanceApprovalNotifier:
    def __init__(self, uow: UnitOfWorkFactory, sender: MessageSender, settings: SettingsService) -> None:
        self._uow = uow
        self._sender = sender
        self._settings = settings

    async def advance_requested(self, advance_id: uuid.UUID) -> None:
        settings = await self._settings.current()
        if not settings.whatsapp_approval_template:
            raise ServiceNotConfiguredError("whatsapp_approval_template")
        async with self._uow() as uow:
            advance = await uow.advances.get(advance_id)
            requester = await uow.employees.get(advance.employee_id) if advance else None
            approver = await uow.employees.get(requester.approver_id) if requester and requester.approver_id else None
        if advance is None or requester is None or approver is None or not approver.active:
            return
        address = approver.whatsapp_address
        if address is None:
            return
        try:
            await self._sender.send_template(
                address,
                settings.whatsapp_approval_template,
                settings.whatsapp_template_language,
                [requester.full_name, msg.money(advance.amount, advance.currency), advance.label],
                [f"adv_approve:{advance.id}", f"adv_reject:{advance.id}"],
            )
        except Exception:  # noqa: BLE001 - la solicitud ya quedó guardada; el aviso es secundario
            logger.exception("Could not notify the approver of advance %s", advance_id)
