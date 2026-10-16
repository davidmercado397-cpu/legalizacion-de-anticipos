"""Recordatorio de legalizar: los días configurados después del fin del viaje (en la fecha local de la
compañía), a quien tiene el anticipo abierto. Cada día se recuerda una sola vez."""

from __future__ import annotations

import logging

from app.application.messages import NumberFormat
from app.application.settings import SettingsService
from app.application.whatsapp_notifier import WhatsAppNotifier
from app.application.whatsapp_presenter import legalization_reminder
from app.domain.entities import Advance, Employee
from app.domain.enums import ExpenseStatus
from app.domain.ports import Clock, UnitOfWorkFactory
from app.domain.time import local_date

logger = logging.getLogger(__name__)

_OPEN_EXPENSES = (ExpenseStatus.RECEIVED, ExpenseStatus.PROCESSING, ExpenseStatus.EXTRACTED)


class LegalizationReminders:
    def __init__(self, uow: UnitOfWorkFactory, notifier: WhatsAppNotifier, settings: SettingsService, clock: Clock) -> None:
        self._uow = uow
        self._notifier = notifier
        self._settings = settings
        self._clock = clock

    async def run(self) -> str | None:
        current = await self._settings.current()
        days = sorted({int(d) for d in current.whatsapp_reminder_days if int(d) >= 0})
        if not days:
            return None
        now = self._clock.now()
        due: list[tuple[Advance, Employee, NumberFormat]] = []
        async with self._uow() as uow:
            companies = {c.id: c for c in await uow.companies.find()}
            for advance in await uow.advances.list_ended(now.date()):
                company = companies.get(advance.company_id)
                if company is None or advance.end_date is None:
                    continue
                elapsed = (local_date(now, company.timezone) - advance.end_date).days
                reached = [d for d in days if d <= elapsed and d not in advance.reminders_sent]
                if not reached:
                    continue
                # Se marca antes de enviar: si el envío falla, no se insiste (es un recordatorio).
                advance.reminders_sent = sorted({*advance.reminders_sent, *reached})
                employee = await uow.employees.get(advance.employee_id)
                if employee is not None and employee.active:
                    country = current.country_defaults.get(company.country) or {}
                    due.append((advance, employee, NumberFormat.of(country.get("number_format"))))
            expenses = await uow.expenses.list_for_advances([a.id for a, _, _ in due])
            await uow.commit()
        sent = 0
        for advance, employee, fmt in due:
            mine = [e for e in expenses if e.advance_id == advance.id]
            open_count = sum(1 for e in mine if e.status in _OPEN_EXPENSES)
            reply, notice = legalization_reminder(employee.first_name, advance, advance.balance(mine).applied, open_count, fmt)
            sent += await self._notifier.notify(employee, reply, notice)
        return f"{sent} of {len(due)} reminders sent" if due else None
