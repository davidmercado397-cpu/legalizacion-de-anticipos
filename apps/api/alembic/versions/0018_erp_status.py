"""Siesa: estado y referencia del anticipo y de la legalización en el ERP (decisiones 8.1 y 8.2)

Revision ID: 0018
Revises: 0017
Create Date: 2026-10-21 12:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_STATUS = sa.Enum("pending", "sent", "failed", native_enum=False, length=32, name="erpstatus")


def upgrade() -> None:
    op.add_column("advances", sa.Column("erp_advance_status", _STATUS))
    op.add_column("advances", sa.Column("erp_advance_ref", sa.String(80)))
    op.add_column("advances", sa.Column("erp_legalization_status", _STATUS))
    op.add_column("advances", sa.Column("erp_legalization_ref", sa.String(80)))
    op.add_column("advances", sa.Column("erp_error", sa.String(500)))


def downgrade() -> None:
    for column in ("erp_error", "erp_legalization_ref", "erp_legalization_status", "erp_advance_ref", "erp_advance_status"):
        op.drop_column("advances", column)
