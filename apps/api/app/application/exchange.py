"""Tasas de cambio: descarga diaria desde las fuentes públicas y conversión de gastos en otra moneda."""

from __future__ import annotations

import logging
from datetime import date, timedelta

from app.application.access import AccessPolicy
from app.application.settings import SettingsService
from app.domain.entities import Advance, AuditEntry, Company, Employee, Expense
from app.domain.errors import ExternalServiceError
from app.domain.exchange import PIVOT, Conversion, Leg, combine, rate_day
from app.domain.permissions import Permission
from app.domain.ports import Clock, ExchangeRateProvider, UnitOfWork, UnitOfWorkFactory
from app.domain.time import local_date

logger = logging.getLogger(__name__)


class ExchangeRateService:
    def __init__(
        self,
        uow: UnitOfWorkFactory,
        providers: list[ExchangeRateProvider],
        settings: SettingsService,
        clock: Clock,
        access: AccessPolicy,
    ) -> None:
        self._uow = uow
        self._providers = providers
        self._settings = settings
        self._clock = clock
        self._access = access

    async def sync(self) -> int:
        """Descarga los últimos días de cada fuente. Si una falla, las demás igual se guardan."""
        current = await self._settings.current()
        end = self._clock.now().date()
        start = end - timedelta(days=current.exchange_sync_days_back)
        rates = []
        for provider in self._providers:
            try:
                rates.extend(await provider.fetch(start, end, list(current.supported_currencies)))
            except ExternalServiceError:
                logger.warning("Exchange rate source %s failed", type(provider).__name__, exc_info=True)
        async with self._uow() as uow:
            stored = await uow.exchange_rates.upsert(rates)
            await uow.commit()
        return stored

    async def sync_now(self, actor: Employee) -> int:
        self._access.require(actor, Permission.SETTINGS_MANAGE)
        stored = await self.sync()
        async with self._uow() as uow:
            await uow.audit.add(AuditEntry("exchange_rates_synced", "system", None, actor.id, data={"stored": stored}))
            await uow.commit()
        return stored

    async def quote(self, source: str, target: str, day: date) -> Conversion | None:
        async with self._uow() as uow:
            return await self.conversion(uow, source.upper(), target.upper(), day)

    async def conversion(self, uow: UnitOfWork, source: str, target: str, day: date) -> Conversion | None:
        """Tasa de `source` a `target` en `day`, cruzando por el dólar. None si falta alguna tasa reciente."""
        if source == target:
            return None
        oldest = day - timedelta(days=(await self._settings.current()).exchange_max_rate_age_days)
        legs: list[Leg | None] = []
        for currency in (source, target):
            if currency == PIVOT:
                legs.append(None)
                continue
            rate = await uow.exchange_rates.latest(PIVOT, currency, day, oldest)
            if rate is None:
                return None
            legs.append(Leg(rate.rate, rate.day, rate.source))
        return combine(legs[0], legs[1])

    async def convert_expense(self, uow: UnitOfWork, expense: Expense, advance: Advance | None) -> None:
        """Deja la tasa automática del gasto hacia la moneda del anticipo (o la borra si no aplica).
        El usuario igual puede mandar su propio valor convertido al confirmar (tasa manual)."""
        if advance is None or not expense.currency or expense.currency == advance.currency or expense.total is None:
            expense.clear_conversion()
            return
        company = await uow.companies.get(advance.company_id)
        assert company is not None
        invoice_day = expense.invoice_date or local_date(self._clock.now(), company.timezone)
        conversion = await self.conversion(
            uow, expense.currency, advance.currency, rate_day(invoice_day, company.exchange_rate_policy)
        )
        if conversion is None:
            expense.clear_conversion()
        else:
            expense.apply_conversion(conversion.rate, conversion.source, conversion.day)

    async def to_functional(self, uow: UnitOfWork, advance: Advance, company: Company) -> Conversion | None:
        """Tasa del día para mostrar el saldo de un anticipo en otra moneda también en la de la compañía."""
        return await self.conversion(uow, advance.currency, company.currency, local_date(self._clock.now(), company.timezone))
