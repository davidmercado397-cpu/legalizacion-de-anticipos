"""calidad primero en la IA: todo con el modelo principal, Opus de alterno y aviso de demora a los 20 s

El Lite falla más en valores puntuales; el alterno es de otra familia y otra nube (y ahora el modelo se verifica
contra OpenRouter al guardarlo, que fue lo que llevó a vaciar los alternos en la 0020). Solo cambia lo que siga
con el valor anterior: si el superadmin ya lo cambió, se respeta.

Revision ID: 0025
Revises: 0024
Create Date: 2026-10-26 22:00:00.000000
"""

from __future__ import annotations

import json
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0025"
down_revision: str | None = "0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SETTING_UPDATES: dict[str, object] = {
    "ai.routing": "always_primary",
    "ai.availability_fallbacks": ["anthropic/claude-opus-5.5"],
    "whatsapp.slow_notice_seconds": 20.0,
}
_PREVIOUS: dict[str, list[object]] = {
    "ai.routing": ["by_difficulty"],
    "ai.availability_fallbacks": [[], ["anthropic/claude-haiku-5.5"]],
    "whatsapp.slow_notice_seconds": [45.0, 45],
}


def _set(key: str, value_from: object, value_to: object) -> None:
    op.execute(
        sa.text(
            "UPDATE system_settings SET value = CAST(:to AS JSONB), updated_at = now() "
            "WHERE key = :key AND value = CAST(:from_ AS JSONB)"
        ).bindparams(key=key, to=json.dumps(value_to), from_=json.dumps(value_from))
    )


def upgrade() -> None:
    for key, value in SETTING_UPDATES.items():
        for previous in _PREVIOUS[key]:
            _set(key, previous, value)


def downgrade() -> None:
    for key, value in SETTING_UPDATES.items():
        _set(key, value, _PREVIOUS[key][0])
