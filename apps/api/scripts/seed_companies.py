"""Compañías del grupo Forsa con su moneda principal: en ella se entregan y se legalizan sus anticipos. En una base
que ya las tiene (mismo NIT) no cambia nada: solo crea las que falten. El país y la moneda se corrigen después en
Administración → Compañías.

    python -m scripts.seed_companies
"""

from __future__ import annotations

import asyncio
import sys

from app.application.companies import CompanyData
from app.config import get_settings
from app.container import Container, build_container
from app.domain.enums import Role
from app.domain.ports import EmployeeFilter, Page

# Perú y República Dominicana no están en defaults.countries: llevan su zona horaria.
COMPANIES = (
    CompanyData("Forsa", "CO", "COP", tax_id="817000790", legal_name="FORSA S.A.S"),
    CompanyData(
        "Rentas y Formaletas",
        "DO",
        "COP",
        tax_id="131237738",
        legal_name="RENTAS Y FORMALETAS S.A.S",
        timezone="America/Santo_Domingo",
    ),
    CompanyData("Cimbraf", "MX", "MXN", tax_id="CFO1110054V6", legal_name="CIMBRAF S.A. DE C.V."),
    CompanyData(
        "Arrendadora de Sistemas Constructivos",
        "PE",
        "COP",
        tax_id="20563072815",
        legal_name="ARRENDADORA DE SISTEMAS CONSTRUCTIVOS S.A.C.",
        timezone="America/Lima",
    ),
    CompanyData("Forsa Renta", "CO", "COP", tax_id="900320561", legal_name="FORSA RENTA SAS"),
    CompanyData("Construcomer", "CO", "COP", tax_id="901428628", legal_name="CONSTRUCOMER S.A.S."),
    CompanyData("Ascend Group", "CO", "COP", tax_id="901555910", legal_name="ASCEND GROUP SAS"),
    CompanyData(
        "Compañía de Importaciones y Agenciamientos Comerciales",
        "PA",
        "USD",
        tax_id="1254162159392",
        legal_name="COMPAÑIA DE IMPORTACIONES Y AGENCIAMIENTOS COMERCIALES SA",
    ),
    CompanyData(
        "Formaequipos Perú",
        "PE",
        "COP",
        tax_id="20600107624",
        legal_name="FORMAEQUIPOS PERU S.A.C.",
        timezone="America/Lima",
    ),
    CompanyData("Construforsa", "CO", "COP", tax_id="901860757", legal_name="CONSTRUFORSA S.A.S."),
)


async def create_missing(container: Container) -> list[str]:
    """Crea las compañías que falten (por NIT) a nombre del primer administrador activo; devuelve sus nombres."""
    async with container.uow() as uow:
        admins = await uow.employees.find(EmployeeFilter(role=Role.ADMIN, active=True), Page(limit=1))
        existing = {c.tax_id for c in await uow.companies.find()}
    if not admins.items:
        raise SystemExit("Error: no hay un administrador activo. Cree uno primero (python -m scripts.seed_users).")
    created = []
    for data in COMPANIES:
        if data.tax_id not in existing:
            company = await container.companies.create(admins.items[0], data)
            created.append(f"{company.name} ({company.currency})")
    return created


async def main() -> int:
    container = build_container(get_settings())
    try:
        created = await create_missing(container)
    finally:
        await container.close()
    print("Compañías creadas: " + ", ".join(created) if created else "Las compañías ya existían: no se creó ninguna.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
