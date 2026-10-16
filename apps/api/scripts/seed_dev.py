"""Datos de DESARROLLO: una compañía y un usuario por rol, todos con la misma contraseña. Es idempotente
(si el admin ya existe no hace nada) y se niega a correr en producción.

    python -m scripts.seed_dev
"""

from __future__ import annotations

import asyncio
import sys

from app.adapters.outbound.security.passwords import Argon2PasswordHasher
from app.application.companies import CompanyData
from app.application.employees import EmployeeData
from app.config import get_settings
from app.container import build_container
from app.domain.entities import Employee
from app.domain.enums import Role, StaffType

PASSWORD = "Viaticos2026*"  # gitleaks:allow (solo desarrollo local)
ADMIN_EMAIL = "andres@empresa.co"


async def seed() -> None:
    settings = get_settings()
    if settings.is_production:
        raise SystemExit("seed_dev no corre en producción")
    container = build_container(settings)
    try:
        async with container.uow() as uow:
            if await uow.employees.get_by_email(ADMIN_EMAIL):
                print("Los datos de desarrollo ya existen")
                return
            admin = Employee(
                full_name="Andrés Administrador",
                email=ADMIN_EMAIL,
                role=Role.ADMIN,
                password_hash=Argon2PasswordHasher().hash(PASSWORD),
            )
            await uow.employees.add(admin)
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

        async def create(name: str, email: str, role: Role, approver: Employee | None = None) -> Employee:
            data = EmployeeData(
                full_name=name,
                email=email,
                role=role,
                company_ids=[company.id],
                approver_id=approver.id if approver else None,
                password=PASSWORD,
                staff_type=StaffType.ADMINISTRATIVE,
            )
            employee = (await container.employees.create(admin, data)).employee
            created.append(employee)
            return employee

        created: list[Employee] = []
        diana = await create("Diana Directora", "diana@empresa.co", Role.APPROVER)
        carlos = await create("Carlos Coordinador", "carlos@empresa.co", Role.APPROVER, diana)
        await create("Ana Analista", "ana@empresa.co", Role.EMPLOYEE, carlos)
        await create("Laura Contadora", "laura@empresa.co", Role.ACCOUNTANT)

        async with container.uow() as uow:
            for employee_id in (e.id for e in created):
                stored = await uow.employees.get(employee_id)
                assert stored is not None
                stored.must_change_password = False
            await uow.commit()
        print(f"Datos de desarrollo creados. Contraseña de todos: {PASSWORD}")
    finally:
        await container.close()


if __name__ == "__main__":
    try:
        asyncio.run(seed())
    except Exception as exc:  # noqa: BLE001
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
