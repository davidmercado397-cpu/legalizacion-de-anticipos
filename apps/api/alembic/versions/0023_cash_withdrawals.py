"""retiros en efectivo y legalización en la moneda de la compañía

Un anticipo calculado en la moneda del destino (p. ej. BRL) se entrega y se liquida en la de la compañía:
advances.settlement_*. Los retiros en el exterior (cash_withdrawals) son bolsas con su tasa que las facturas en
efectivo gastan en orden (expenses.cash_allocations); lo que no cubren va con la tasa del día y lo revisa
contabilidad (regla cash_without_withdrawal, acción review). Los anticipos anteriores quedan como estaban.

Revision ID: 0023
Revises: 0022
Create Date: 2026-10-20 10:00:00.000000
"""

from __future__ import annotations

import json
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

from alembic import op

revision: str = "0023"
down_revision: str | None = "0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

RULE = "cash_without_withdrawal"
RULE_DEFAULT = {"action": "review", "params": {}}
# Llaves que se agregan a un objeto de configuración sin pisar las demás (tests/seed.py las aplica igual).
SETTING_MERGES: dict[str, dict[str, object]] = {"defaults.policy_rules": {RULE: RULE_DEFAULT}}
MONEY = sa.Numeric(18, 2)
SOURCES = ("trm", "ecb", "ecb_cross", "manual", "withdrawal")


def upgrade() -> None:
    op.add_column("advances", sa.Column("settlement_currency", sa.String(3)))
    op.add_column("advances", sa.Column("settlement_amount", MONEY))
    op.add_column("advances", sa.Column("settlement_rate", sa.Numeric(18, 8)))
    op.add_column("advances", sa.Column("settlement_rate_date", sa.Date))
    op.add_column("expenses", sa.Column("cash_allocations", pg.JSONB, server_default="[]", nullable=False))
    op.add_column("expenses", sa.Column("cash_uncovered", MONEY))
    op.create_table(
        "cash_withdrawals",
        sa.Column("id", sa.Uuid, primary_key=True),
        sa.Column("advance_id", sa.Uuid, sa.ForeignKey("advances.id", ondelete="CASCADE"), nullable=False),
        sa.Column("employee_id", sa.Uuid, sa.ForeignKey("employees.id"), nullable=False),
        sa.Column("withdrawn_on", sa.Date, nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("amount", MONEY, nullable=False),
        sa.Column("official_rate", sa.Numeric(18, 8)),
        sa.Column("official_rate_date", sa.Date),
        sa.Column("official_source", sa.Enum(*SOURCES, name="exchangeratesource", native_enum=False, length=32)),
        sa.Column("debited_amount", MONEY),
        sa.Column("fee_amount", MONEY),
        sa.Column("fee_expense_id", sa.Uuid, sa.ForeignKey("expenses.id")),
        sa.Column("note", sa.String(300)),
        sa.Column("updated_by", sa.Uuid, sa.ForeignKey("employees.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_cash_withdrawals_advance_id", "cash_withdrawals", ["advance_id"])
    # Por llave, para no pisar lo que el superadmin haya cambiado en las demás reglas.
    op.execute(
        sa.text(
            "UPDATE system_settings SET value = jsonb_set(value, :path, CAST(:rule AS jsonb)), updated_at = now() "
            "WHERE key = 'defaults.policy_rules'"
        ).bindparams(path=[RULE], rule=json.dumps(RULE_DEFAULT))
    )


def downgrade() -> None:
    op.execute(sa.text("UPDATE system_settings SET value = value - :rule WHERE key = 'defaults.policy_rules'").bindparams(rule=RULE))
    op.execute(sa.text("DELETE FROM policy_rules WHERE rule_type = :rule").bindparams(rule=RULE))
    op.drop_index("ix_cash_withdrawals_advance_id", table_name="cash_withdrawals")
    op.drop_table("cash_withdrawals")
    op.drop_column("expenses", "cash_uncovered")
    op.drop_column("expenses", "cash_allocations")
    op.drop_column("advances", "settlement_rate_date")
    op.drop_column("advances", "settlement_rate")
    op.drop_column("advances", "settlement_amount")
    op.drop_column("advances", "settlement_currency")
