"""sin modelos alternos de disponibilidad por defecto

Si un alterno no existe en OpenRouter, toda la lectura falla, así que por defecto no hay alternos. Solo se vacía
si sigue con el valor inicial: si el superadmin ya lo cambió, se respeta.

Revision ID: 0020
Revises: 0019
Create Date: 2026-10-17 03:00:00.000000
"""

from __future__ import annotations

import json
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

KEY = "ai.availability_fallbacks"
INITIAL = ["anthropic/claude-haiku-5.5"]
DESCRIPTION = "Modelos alternos si el proveedor principal no responde (sin modelos de origen chino). Vacía: sin alternos."
PREVIOUS_DESCRIPTION = "Modelos alternos si el proveedor principal no responde (sin modelos de origen chino)."


def _set(value_from: list[str], value_to: list[str], description: str) -> None:
    op.execute(
        sa.text(
            "UPDATE system_settings SET value = CAST(:to AS JSONB), updated_at = now() "
            "WHERE key = :key AND value = CAST(:from_ AS JSONB)"
        ).bindparams(key=KEY, to=json.dumps(value_to), from_=json.dumps(value_from))
    )
    op.execute(sa.text("UPDATE system_settings SET description = :d WHERE key = :key").bindparams(d=description, key=KEY))


def upgrade() -> None:
    _set(INITIAL, [], DESCRIPTION)


def downgrade() -> None:
    _set([], INITIAL, PREVIOUS_DESCRIPTION)
