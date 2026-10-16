"""ruta de aprobación por niveles: pasos por solicitud, motivos de escalamiento y reglas por compañía

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-19 09:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Las solicitudes anteriores quedan sin ruta y conservan la regla de entonces (el aprobador del empleado).
    op.add_column("advances", sa.Column("approval_steps", postgresql.JSONB, server_default="[]", nullable=False))
    op.add_column("advances", sa.Column("escalation_reasons", postgresql.JSONB, server_default="[]", nullable=False))
    # Decisión 4.1: tolerancia del 10 % sobre el presupuesto; 4.2: sin umbral por monto hasta que contabilidad lo fije.
    op.add_column("companies", sa.Column("approval_tolerance_pct", sa.Numeric(5, 2), server_default="10", nullable=False))
    op.add_column("companies", sa.Column("approval_thresholds", postgresql.JSONB, server_default="{}", nullable=False))


def downgrade() -> None:
    op.drop_column("companies", "approval_thresholds")
    op.drop_column("companies", "approval_tolerance_pct")
    op.drop_column("advances", "escalation_reasons")
    op.drop_column("advances", "approval_steps")
