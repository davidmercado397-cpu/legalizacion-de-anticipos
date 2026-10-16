"""viajes con varios destinos: tramos del anticipo (decisiones 2.4 y 4.8)

Revision ID: 0017
Revises: 0016
Create Date: 2026-10-20 12:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("advances", sa.Column("legs", postgresql.JSONB, server_default="[]", nullable=False))


def downgrade() -> None:
    op.drop_column("advances", "legs")
