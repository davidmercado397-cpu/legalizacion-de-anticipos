"""Datos de DESARROLLO: una compañía, un usuario por rol (todos con la misma contraseña) y zonas con tarifas de
viaje por país para probar el presupuesto del anticipo. Es idempotente: en una base que ya tiene los usuarios solo
agrega lo que falte (las tarifas si la compañía no tiene zonas). Se niega a correr en producción.

    python -m scripts.seed_dev
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from datetime import date
from decimal import Decimal

from app.adapters.outbound.security.passwords import Argon2PasswordHasher
from app.application.budgets import RateData
from app.application.companies import CompanyData
from app.application.employees import EmployeeData
from app.config import get_settings
from app.container import Container, build_container
from app.domain.entities import Employee
from app.domain.enums import BudgetUnit, Role, StaffType

PASSWORD = "Viaticos2026*"  # gitleaks:allow (solo desarrollo local)
ADMIN_EMAIL = "andres@empresa.co"
OPERATOR_EMAIL = "soporte@nextbyte.co"  # superadmin de la plataforma: no pertenece a ninguna compañía
OPERATIONAL_EMAIL = "oscar@empresa.co"  # personal operativo: su tarifa es distinta a la del administrativo
SEED_EMAILS = (
    ADMIN_EMAIL,
    OPERATOR_EMAIL,
    "diana@empresa.co",
    "carlos@empresa.co",
    "ana@empresa.co",
    "laura@empresa.co",
    "tomas@empresa.co",
    "gabriela@empresa.co",
    OPERATIONAL_EMAIL,
)

# Zona -> (lugares, moneda, {categoría: (unidad, administrativo, operativo)}). Colombia en pesos; el exterior en
# dólares, así un viaje que mezcla Colombia y el exterior va en USD (decisión 4.8).
_COLOMBIA_PRINCIPAL = {
    "lodging": (BudgetUnit.PER_NIGHT, "280000", "220000"),
    "meals": (BudgetUnit.PER_DAY, "110000", "85000"),
    "transport": (BudgetUnit.PER_DAY, "60000", "45000"),
}
TRAVEL_ZONES: dict[str, tuple[list[str], str, dict[str, tuple[BudgetUnit, str, str]]]] = {
    "Ciudades principales": (["Bogotá", "Medellín", "Cali", "Barranquilla", "Cartagena"], "COP", _COLOMBIA_PRINCIPAL),
    "Resto de Colombia": (
        ["Colombia", "Pasto", "Manizales", "Pereira", "Bucaramanga", "Santa Marta"],
        "COP",
        {
            "lodging": (BudgetUnit.PER_NIGHT, "200000", "160000"),
            "meals": (BudgetUnit.PER_DAY, "85000", "70000"),
            "transport": (BudgetUnit.PER_DAY, "45000", "35000"),
        },
    ),
    "Estados Unidos": (
        ["Estados Unidos", "Miami", "Nueva York", "Houston", "Orlando", "US", "USA"],
        "USD",
        {
            "lodging": (BudgetUnit.PER_NIGHT, "180", "150"),
            "meals": (BudgetUnit.PER_DAY, "75", "60"),
            "transport": (BudgetUnit.PER_DAY, "40", "30"),
            "airport_tax": (BudgetUnit.PER_TRIP, "50", "50"),
        },
    ),
    # Brasil y México en su moneda: el anticipo se calcula en BRL o MXN y se entrega y legaliza en pesos (decisión 9.2).
    "Brasil": (
        ["Brasil", "São Paulo", "Rio de Janeiro", "Brasilia", "BR"],
        "BRL",
        {
            "lodging": (BudgetUnit.PER_NIGHT, "750", "600"),
            "meals": (BudgetUnit.PER_DAY, "300", "250"),
            "transport": (BudgetUnit.PER_DAY, "150", "125"),
            "airport_tax": (BudgetUnit.PER_TRIP, "200", "200"),
        },
    ),
    "México": (
        ["México", "Ciudad de México", "Monterrey", "Guadalajara", "Cancún", "MX"],
        "MXN",
        {
            "lodging": (BudgetUnit.PER_NIGHT, "2700", "2100"),
            "meals": (BudgetUnit.PER_DAY, "1100", "900"),
            "transport": (BudgetUnit.PER_DAY, "550", "450"),
        },
    ),
    "Panamá": (
        ["Panamá", "Ciudad de Panamá", "Colón", "PA"],
        "USD",
        {
            "lodging": (BudgetUnit.PER_NIGHT, "140", "110"),
            "meals": (BudgetUnit.PER_DAY, "55", "45"),
            "transport": (BudgetUnit.PER_DAY, "30", "25"),
        },
    ),
}


async def seed(password: str = PASSWORD, must_change_password: bool = False) -> None:
    """Crea la compañía, los usuarios y las tarifas; en una base que ya los tiene, agrega lo que falte.
    `must_change_password`: cada usuario cambia la contraseña en su primer ingreso (servidores; ver seed_users)."""
    container = build_container(get_settings())
    try:
        async with container.uow() as uow:
            existing = await uow.employees.get_by_email(ADMIN_EMAIL)
        if existing is not None:
            await _complete(container, existing, password, must_change_password)
            return
        async with container.uow() as uow:
            admin = Employee(
                full_name="Andrés Administrador",
                email=ADMIN_EMAIL,
                role=Role.ADMIN,
                password_hash=Argon2PasswordHasher().hash(password),
                must_change_password=must_change_password,
            )
            await uow.employees.add(admin)
            # La API no crea superadmins (nadie se puede dar ese rol); en desarrollo va directo a la base.
            await uow.employees.add(_operator(password, must_change_password))
            await uow.commit()

        company = await container.companies.create(
            admin, CompanyData("Empresa Principal", "CO", "COP", tax_id="900123456", legal_name="Empresa Principal S.A.S.")
        )
        async with container.uow() as uow:
            stored = await uow.employees.get(admin.id)
            assert stored is not None
            stored.company_ids = [company.id]
            await uow.commit()
            admin = stored

        async def create(
            name: str, email: str, role: Role, approver: Employee | None = None, staff: StaffType = StaffType.ADMINISTRATIVE
        ) -> Employee:
            data = EmployeeData(
                full_name=name,
                email=email,
                role=role,
                company_ids=[company.id],
                approver_id=approver.id if approver else None,
                password=password,
                staff_type=staff,
            )
            employee = (await container.employees.create(admin, data)).employee
            created.append(employee)
            return employee

        created: list[Employee] = []
        diana = await create("Diana Directora", "diana@empresa.co", Role.APPROVER)
        carlos = await create("Carlos Coordinador", "carlos@empresa.co", Role.APPROVER, diana)
        await create("Ana Analista", "ana@empresa.co", Role.EMPLOYEE, carlos)
        await create("Laura Contadora", "laura@empresa.co", Role.ACCOUNTANT)
        await create("Tomás Tesorero", "tomas@empresa.co", Role.TREASURY)
        await create("Gabriela Gerente", "gabriela@empresa.co", Role.MANAGEMENT)
        await create("Óscar Operario", OPERATIONAL_EMAIL, Role.EMPLOYEE, carlos, StaffType.OPERATIONAL)

        async with container.uow() as uow:
            for employee_id in (e.id for e in created):
                stored = await uow.employees.get(employee_id)
                assert stored is not None
                stored.must_change_password = must_change_password
            await uow.commit()
        await _travel_rates(container, admin, company.id)
        print(f"Usuarios creados: {', '.join(SEED_EMAILS)}")
    finally:
        await container.close()


def _operator(password: str, must_change_password: bool) -> Employee:
    return Employee(
        full_name="Soporte NextByte",
        email=OPERATOR_EMAIL,
        role=Role.SUPERADMIN,
        password_hash=Argon2PasswordHasher().hash(password),
        must_change_password=must_change_password,
    )


async def _complete(container: Container, admin: Employee, password: str, must_change_password: bool) -> None:
    """Base creada con una versión anterior de este script: agrega lo que le falte."""
    company_id = admin.company_ids[0]
    added = await _travel_rates(container, admin, company_id)
    async with container.uow() as uow:
        missing_operational = await uow.employees.get_by_email(OPERATIONAL_EMAIL) is None
        boss = await uow.employees.get_by_email("carlos@empresa.co")
        if await uow.employees.get_by_email(OPERATOR_EMAIL) is None:
            await uow.employees.add(_operator(password, must_change_password))
            await uow.commit()
            added = True
    if missing_operational:
        data = EmployeeData(
            full_name="Óscar Operario",
            email=OPERATIONAL_EMAIL,
            role=Role.EMPLOYEE,
            company_ids=[company_id],
            approver_id=boss.id if boss else None,
            password=password,
            staff_type=StaffType.OPERATIONAL,
        )
        oscar = (await container.employees.create(admin, data)).employee
        async with container.uow() as uow:
            stored = await uow.employees.get(oscar.id)
            assert stored is not None
            stored.must_change_password = must_change_password
            await uow.commit()
    if added or missing_operational:
        print("Datos completados (tarifas de viaje por país y usuarios nuevos)")
    else:
        print("Los usuarios ya existen: no se cambió nada")


async def _travel_rates(container: Container, admin: Employee, company_id: uuid.UUID) -> bool:
    """Las zonas y tarifas de ejemplo, si la compañía aún no tiene zonas. Devuelve si las creó."""
    if await container.budgets.zones(admin, company_id):
        return False
    for name, (places, currency, rates) in TRAVEL_ZONES.items():
        zone = await container.budgets.add_zone(admin, company_id, name, places)
        for category, (unit, administrative, operational) in rates.items():
            for staff, amount in ((StaffType.ADMINISTRATIVE, administrative), (StaffType.OPERATIONAL, operational)):
                data = RateData(zone.id, staff, category, Decimal(amount), currency, unit, date(2026, 1, 1))
                await container.budgets.add_rate(admin, company_id, data)
    return True


async def main() -> None:
    if get_settings().is_production:
        raise SystemExit("seed_dev no corre en producción: use python -m scripts.seed_users")
    await seed()
    print(f"Contraseña de todos: {PASSWORD}")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:  # noqa: BLE001
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
