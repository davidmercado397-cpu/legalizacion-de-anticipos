from __future__ import annotations

from app.domain.enums import Role
from scripts.seed_companies import COMPANIES, create_missing
from tests.conftest import Harness


async def test_creates_the_group_companies_with_their_currency_once(harness: Harness) -> None:
    existing = await harness.add_company()
    await harness.add_employee(existing, "admin@forsa.com", Role.ADMIN)

    created = await create_missing(harness.container)
    assert len(created) == len(COMPANIES) and "Cimbraf (MXN)" in created
    async with harness.container.uow() as uow:
        companies = {c.tax_id: c for c in await uow.companies.find()}
    assert companies["CFO1110054V6"].currency == "MXN" and companies["CFO1110054V6"].timezone == "America/Mexico_City"
    assert companies["1254162159392"].currency == "USD" and companies["1254162159392"].country == "PA"
    assert companies["20600107624"].currency == "COP" and companies["20600107624"].timezone == "America/Lima"
    assert companies["901860757"].legal_name == "CONSTRUFORSA S.A.S."

    assert await create_missing(harness.container) == []  # otra vez: no duplica
