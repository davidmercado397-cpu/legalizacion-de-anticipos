"""Control: la auditoría es inmutable (ASVS V7.3 / ISO 27001 A.8.15)."""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import DBAPIError

from app.domain.entities import AuditEntry
from tests.conftest import Harness


async def test_audit_entries_cannot_be_updated_or_deleted(harness: Harness) -> None:
    async with harness.container.uow() as uow:
        await uow.audit.add(AuditEntry("login", "employee", None))
        await uow.commit()
    async with harness.container.engine.connect() as conn:
        for statement in ("UPDATE audit_log SET action = 'x'", "DELETE FROM audit_log", "TRUNCATE audit_log"):
            with pytest.raises(DBAPIError, match="append-only"):
                await conn.execute(sa.text(statement))
            await conn.rollback()
