"""descuento de la factura y extracción v4

El descuento deja de leerse como un producto: va en expenses.discount_amount (en positivo, ya restado del total) y
la verificación lo resta. La versión del prompt pasa a v4 solo si sigue en v3: si el superadmin la cambió, se respeta.

Revision ID: 0021
Revises: 0020
Create Date: 2026-10-18 09:00:00.000000
"""

from __future__ import annotations

import json
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0021"
down_revision: str | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _prompt_version(value_from: str, value_to: str) -> None:
    op.execute(
        sa.text(
            "UPDATE system_settings SET value = CAST(:to AS JSONB), updated_at = now() "
            "WHERE key = 'ai.prompt_version' AND value = CAST(:from_ AS JSONB)"
        ).bindparams(to=json.dumps(value_to), from_=json.dumps(value_from))
    )


def upgrade() -> None:
    op.add_column("expenses", sa.Column("discount_amount", sa.Numeric(18, 2), nullable=True))
    _prompt_version("v3", "v4")


def downgrade() -> None:
    _prompt_version("v4", "v3")
    op.drop_column("expenses", "discount_amount")
