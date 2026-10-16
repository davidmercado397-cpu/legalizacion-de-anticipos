"""Presupuestos de viaje: zonas, tarifas (zona x tipo de personal x categoría) y su cálculo.

Contabilidad administra las tarifas (`policies:manage`); el empleado solo ve el valor calculado de su
viaje, nunca la tabla completa."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

from app.application import messages as msg
from app.application.access import AccessPolicy
from app.application.exchange import ExchangeRateService
from app.application.settings import SettingsService
from app.domain.budgets import LegRates, TravelBudget, TripLeg, advance_currency, calculate_legs, ordered_legs, zone_for
from app.domain.entities import AuditEntry, Employee, TravelBudgetRate, TravelZone
from app.domain.enums import BudgetUnit, StaffType
from app.domain.errors import NotFoundError, ValidationError
from app.domain.permissions import Permission
from app.domain.ports import Clock, UnitOfWork, UnitOfWorkFactory
from app.domain.time import local_date


@dataclass(frozen=True)
class RateData:
    zone_id: uuid.UUID
    staff_type: StaffType
    category_code: str
    amount: Decimal
    currency: str
    unit: BudgetUnit
    valid_from: date
    valid_to: date | None = None


@dataclass(frozen=True)
class TripQuery:
    company_id: uuid.UUID
    destination: str | None
    start_date: date | None
    end_date: date | None
    zone_id: uuid.UUID | None = None
    legs: tuple[TripLeg, ...] = ()

    def trip_legs(self) -> list[TripLeg]:
        """Los tramos ordenados; un viaje de un solo destino es un tramo."""
        if self.legs:
            return ordered_legs(list(self.legs))
        if self.start_date is None or self.end_date is None:
            return []
        return ordered_legs([TripLeg(self.destination or "", self.start_date, self.end_date)])


class TravelBudgetService:
    def __init__(
        self,
        uow: UnitOfWorkFactory,
        access: AccessPolicy,
        settings: SettingsService,
        exchange: ExchangeRateService,
        clock: Clock,
    ) -> None:
        self._uow = uow
        self._access = access
        self._settings = settings
        self._exchange = exchange
        self._clock = clock

    def _check(self, actor: Employee, company_id: uuid.UUID, manage: bool) -> None:
        if manage:
            self._access.require(actor, Permission.POLICIES_MANAGE)
        if not (actor.is_admin or actor.works_for(company_id)):
            raise NotFoundError("company")

    # --- Zonas ---------------------------------------------------------------------------------

    async def zones(self, actor: Employee, company_id: uuid.UUID) -> list[TravelZone]:
        self._check(actor, company_id, manage=True)
        async with self._uow() as uow:
            return await uow.travel_zones.list_for_company(company_id, active_only=False)

    async def add_zone(self, actor: Employee, company_id: uuid.UUID, name: str, places: list[str]) -> TravelZone:
        self._check(actor, company_id, manage=True)
        zone = TravelZone(company_id, name.strip(), _clean(places))
        async with self._uow() as uow:
            await uow.travel_zones.add(zone)
            await uow.audit.add(AuditEntry("travel_zone_created", "company", str(company_id), actor.id, data={"name": zone.name}))
            await uow.commit()
        return zone

    async def update_zone(
        self, actor: Employee, company_id: uuid.UUID, zone_id: uuid.UUID, changes: dict[str, Any]
    ) -> TravelZone:
        self._check(actor, company_id, manage=True)
        async with self._uow() as uow:
            zone = await uow.travel_zones.get(zone_id)
            if zone is None or zone.company_id != company_id:
                raise NotFoundError("travel zone")
            if changes.get("name"):
                zone.name = changes["name"].strip()
            if changes.get("places") is not None:
                zone.places = _clean(changes["places"])
            if changes.get("active") is not None:
                zone.active = changes["active"]
            await uow.audit.add(AuditEntry("travel_zone_updated", "company", str(company_id), actor.id, data=changes))
            await uow.commit()
        return zone

    # --- Tarifas -------------------------------------------------------------------------------

    async def rates(self, actor: Employee, company_id: uuid.UUID, zone_id: uuid.UUID | None) -> list[TravelBudgetRate]:
        self._check(actor, company_id, manage=True)
        async with self._uow() as uow:
            return await uow.budget_rates.list_for_company(company_id, zone_id)

    async def add_rate(self, actor: Employee, company_id: uuid.UUID, data: RateData) -> TravelBudgetRate:
        self._check(actor, company_id, manage=True)
        async with self._uow() as uow:
            rate = await self._build_rate(uow, company_id, data)
            await uow.budget_rates.add(rate)
            await uow.audit.add(
                AuditEntry("travel_rate_created", "company", str(company_id), actor.id, data={"rate": str(rate.id)})
            )
            await uow.commit()
        return rate

    async def deactivate_rate(self, actor: Employee, company_id: uuid.UUID, rate_id: uuid.UUID) -> None:
        self._check(actor, company_id, manage=True)
        async with self._uow() as uow:
            rate = await uow.budget_rates.get(rate_id)
            if rate is None or rate.company_id != company_id:
                raise NotFoundError("travel rate")
            rate.active = False
            await uow.audit.add(
                AuditEntry("travel_rate_deactivated", "company", str(company_id), actor.id, data={"rate": str(rate_id)})
            )
            await uow.commit()

    async def import_rates(self, actor: Employee, company_id: uuid.UUID, rows: list[dict[str, Any]]) -> int:
        """Todo o nada: si una fila tiene problemas no se guarda ninguna y la respuesta dice cuáles."""
        self._check(actor, company_id, manage=True)
        async with self._uow() as uow:
            zones = {z.name.strip().lower(): z for z in await uow.travel_zones.list_for_company(company_id)}
            problems: list[dict[str, Any]] = []
            rates: list[TravelBudgetRate] = []
            for number, row in enumerate(rows, start=2):  # la fila 1 es el encabezado
                data, issues = _parse_row(row, zones)
                if data is not None:
                    try:
                        rates.append(await self._build_rate(uow, company_id, data))
                    except ValidationError as exc:
                        issues.append(
                            {"field": exc.params.get("field", "categoria"), "issue": msg.error_message(exc.code, exc.params)}
                        )
                problems.extend({"row": number, **issue} for issue in issues)
            if not rows:
                raise ValidationError("Empty budget file", code="invalid_spreadsheet")
            if problems:
                rows_with_problems = len({p["row"] for p in problems})
                error = ValidationError("Invalid budget file", code="budget_import_invalid", count=rows_with_problems)
                error.details = problems
                raise error
            for rate in rates:
                await uow.budget_rates.add(rate)
            await uow.audit.add(
                AuditEntry("travel_rates_imported", "company", str(company_id), actor.id, data={"rows": len(rates)})
            )
            await uow.commit()
        return len(rates)

    async def _build_rate(self, uow: UnitOfWork, company_id: uuid.UUID, data: RateData) -> TravelBudgetRate:
        zone = await uow.travel_zones.get(data.zone_id)
        if zone is None or zone.company_id != company_id:
            raise NotFoundError("travel zone")
        categories = {c.code for c in await uow.categories.list_for_company(company_id)}
        if data.category_code not in categories:
            raise ValidationError("Unknown category", code="unknown_category", category=data.category_code)
        supported = (await self._settings.current()).supported_currencies
        if data.currency.upper() not in supported:
            raise ValidationError(
                "Unsupported currency",
                code="unsupported_currency",
                currency=data.currency.upper(),
                supported=", ".join(supported),
                field="moneda",
            )
        if data.valid_to is not None and data.valid_to < data.valid_from:
            raise ValidationError("Invalid validity", code="end_before_start", field="hasta")
        return TravelBudgetRate(
            company_id,
            data.zone_id,
            data.staff_type,
            data.category_code,
            data.amount,
            data.currency.upper(),
            data.unit,
            data.valid_from,
            data.valid_to,
        )

    # --- Cálculo -------------------------------------------------------------------------------

    async def for_trip(self, uow: UnitOfWork, staff_type: StaffType | None, query: TripQuery) -> TravelBudget | None:
        """Presupuesto del viaje, o None si no aplica (sin fechas, algún tramo sin zona o la compañía no usa
        tarifas). Las tarifas de cada tramo son las vigentes en la fecha de salida del viaje."""
        legs = query.trip_legs()
        if not legs or staff_type is None:
            return None
        departure = legs[0].start
        if query.zone_id is not None and len(legs) == 1:
            zone = await uow.travel_zones.get(query.zone_id)
            if zone is None or zone.company_id != query.company_id or not zone.active:
                raise NotFoundError("travel zone")
            zones = [zone]
        else:
            available = await uow.travel_zones.list_for_company(query.company_id)
            found = [zone_for(leg.destination, available) for leg in legs]
            if any(z is None for z in found):
                return None
            zones = [z for z in found if z is not None]
        priced: list[LegRates] = []
        for leg, zone in zip(legs, zones, strict=True):
            rates = await uow.budget_rates.applicable(query.company_id, zone.id, staff_type, departure)
            if not rates:
                return None
            priced.append(LegRates(leg, zone.id, rates))
        return calculate_legs(priced, await self._factors(uow, priced))

    async def _factors(self, uow: UnitOfWork, legs: list[LegRates]) -> dict[str, Decimal]:
        """Tasas del día del cálculo (decisión 1.4) para pasar cada tarifa a la moneda del anticipo."""
        target = advance_currency(legs)
        company = await uow.companies.get(legs[0].rates[0].company_id)
        assert company is not None
        today = local_date(self._clock.now(), company.timezone)
        factors: dict[str, Decimal] = {}
        for currency in {r.currency for leg in legs for r in leg.rates} - {target}:
            conversion = await self._exchange.conversion(uow, currency, target, today)
            if conversion is not None:
                factors[currency] = conversion.rate
        return factors

    async def preview(self, actor: Employee, query: TripQuery) -> TravelBudget:
        self._access.require(actor, Permission.ADVANCES_REQUEST)
        if not actor.works_for(query.company_id):
            raise NotFoundError("company")
        if actor.staff_type is None:
            raise ValidationError("Staff type missing", code="staff_type_missing")
        async with self._uow() as uow:
            budget = await self.for_trip(uow, actor.staff_type, query)
        if budget is None:
            raise NotFoundError("travel budget")
        return budget


def _clean(places: list[str]) -> list[str]:
    return list(dict.fromkeys(p.strip() for p in places if p and p.strip()))


_COLUMNS = ("zona", "tipo_personal", "categoria", "valor", "moneda", "unidad", "desde", "hasta")


def _parse_row(row: dict[str, Any], zones: dict[str, TravelZone]) -> tuple[RateData | None, list[dict[str, str]]]:
    issues: list[dict[str, str]] = []

    def issue(field: str, key: str, **params: Any) -> None:
        issues.append({"field": field, "issue": msg.BUDGET_IMPORT_ISSUES[key].format(**params)})

    zone = zones.get(str(row.get("zona") or "").strip().lower())
    if zone is None:
        issue("zona", "unknown_zone", value=row.get("zona") or "")
    staff = str(row.get("tipo_personal") or "").strip().lower()
    staff_type = msg.STAFF_TYPE_ALIASES.get(staff)
    if staff_type is None:
        issue("tipo_personal", "unknown_staff_type", value=staff)
    unit = msg.BUDGET_UNIT_ALIASES.get(str(row.get("unidad") or "").strip().lower())
    if unit is None:
        issue("unidad", "unknown_unit", value=row.get("unidad") or "")
    try:
        amount = Decimal(str(row.get("valor")).replace(",", "")) if row.get("valor") not in (None, "") else None
    except InvalidOperation:
        amount = None
    if amount is None or amount <= 0:
        issue("valor", "invalid_amount")
    valid_from, valid_to = _date(row.get("desde")), _date(row.get("hasta"))
    if valid_from is None:
        issue("desde", "invalid_date")
    if row.get("hasta") not in (None, "") and valid_to is None:
        issue("hasta", "invalid_date")
    if issues or zone is None or staff_type is None or unit is None or amount is None or valid_from is None:
        return None, issues
    data = RateData(
        zone.id,
        StaffType(staff_type),
        str(row.get("categoria") or "").strip().lower(),
        amount,
        str(row.get("moneda") or "").strip(),
        BudgetUnit(unit),
        valid_from,
        valid_to,
    )
    return data, issues


def _date(value: Any) -> date | None:
    if isinstance(value, date):
        return value if not hasattr(value, "date") else value.date()  # las celdas de Excel llegan como datetime
    try:
        return date.fromisoformat(str(value)[:10]) if value not in (None, "") else None
    except ValueError:
        return None
