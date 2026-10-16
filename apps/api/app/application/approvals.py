"""Avisa a los aprobadores por WhatsApp cuando se solicita un anticipo (plantilla con botones Aprobar/Rechazar).
La respuesta la maneja el bot con el mismo caso de uso que la API."""

from __future__ import annotations

import logging
import uuid

from app.application import messages as msg
from app.application.settings import SettingsService
from app.domain.entities import Advance, Employee
from app.domain.enums import Role
from app.domain.errors import ServiceNotConfiguredError
from app.domain.ports import EmployeeFilter, MessageSender, Page, UnitOfWork, UnitOfWorkFactory

logger = logging.getLogger(__name__)


class AdvanceApprovalNotifier:
    def __init__(self, uow: UnitOfWorkFactory, sender: MessageSender, settings: SettingsService) -> None:
        self._uow = uow
        self._sender = sender
        self._settings = settings

    async def advance_requested(self, advance_id: uuid.UUID) -> None:
        """Avisa a cada aprobador de la ruta: el jefe directivo también, porque puede aprobar sin esperar."""
        settings = await self._settings.current()
        if not settings.whatsapp_approval_template:
            raise ServiceNotConfiguredError("whatsapp_approval_template")
        async with self._uow() as uow:
            advance = await uow.advances.get(advance_id)
            requester = await uow.employees.get(advance.employee_id) if advance else None
            if advance is None or requester is None:
                return
            approvers = await self._approvers(uow, advance, requester)
        for approver in approvers:
            address = approver.whatsapp_address
            if address is None or not approver.active:
                continue
            try:
                await self._sender.send_template(
                    address,
                    settings.whatsapp_approval_template,
                    settings.whatsapp_template_language,
                    [requester.full_name, msg.money(advance.amount, advance.currency), advance.label],
                    [f"adv_approve:{advance.id}", f"adv_reject:{advance.id}"],
                )
            except Exception:  # noqa: BLE001 - la solicitud ya quedó guardada; el aviso es secundario
                logger.exception("Could not notify an approver of advance %s", advance_id)

    @staticmethod
    async def _approvers(uow: UnitOfWork, advance: Advance, requester: Employee) -> list[Employee]:
        if not advance.approval_steps:  # solicitud anterior a la ruta: su aprobador, como antes
            approver = await uow.employees.get(requester.approver_id) if requester.approver_id else None
            return [approver] if approver else []
        found: list[Employee] = []
        for step in advance.approval_steps:
            if step["approver_id"]:
                person = await uow.employees.get(uuid.UUID(step["approver_id"]))
                found.extend([person] if person else [])
            else:  # gerencia: todos los usuarios de gerencia de la compañía
                flt = EmployeeFilter(company_id=advance.company_id, role=Role.MANAGEMENT, active=True)
                found.extend((await uow.employees.find(flt, Page(20, 0))).items)
        return list({e.id: e for e in found}.values())
