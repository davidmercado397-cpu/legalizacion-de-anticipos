"""conciliación con el extracto bancario: extractos, movimientos, medio de pago y valor del banco por gasto

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-19 09:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Decisiones 7.3 y 7.4: mismo día o máximo 1 de diferencia; ponderación valor 50 %, fecha 30 %, comercio 20 %.
SYSTEM_SETTINGS: list[dict] = [
    {"key": "reconciliation.match", "value_type": "json", "constraints": {},
     "description": "Cruce del extracto con los gastos: días de diferencia aceptados, tolerancia del valor (misma moneda y "
                    "con conversión), pesos del puntaje y umbrales para cruzar solo o solo sugerir.",
     "value": {"max_days": 1, "same_currency_tolerance": 0.01, "other_currency_tolerance": 0.06,
               "weights": {"amount": 0.5, "date": 0.3, "merchant": 0.2},
               "auto_threshold": 0.8, "suggest_threshold": 0.55}},
    {"key": "reconciliation.max_file_mb", "value": 5, "value_type": "int", "constraints": {"min": 1, "max": 20},
     "description": "Tamaño máximo del archivo del extracto (CSV, Excel o PDF)."},
    {"key": "ai.statement_prompt_version", "value": "v1", "value_type": "string", "constraints": {"max_length": 20},
     "description": "Versión del prompt que lee los extractos en PDF (prompts/statement_extraction/<versión>.md)."},
]

_SETTINGS = sa.table(
    "system_settings",
    sa.column("key", sa.String),
    sa.column("value", postgresql.JSONB),
    sa.column("value_type", sa.String),
    sa.column("constraints", postgresql.JSONB),
    sa.column("description", sa.String),
    sa.column("updated_at", sa.DateTime(timezone=True)),
)

_TZ = sa.DateTime(timezone=True)
_MONEY = sa.Numeric(18, 2)


def _enum(name: str, *values: str) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False, length=32)


def upgrade() -> None:
    op.add_column("expenses", sa.Column("payment_method", _enum("paymentmethod", "card", "cash", "transfer")))
    op.add_column("expenses", sa.Column("bank_status", _enum("bankstatus", "matched", "no_charge")))
    op.add_column("expenses", sa.Column("bank_amount", _MONEY))
    op.add_column("expenses", sa.Column("bank_currency", sa.String(3)))
    op.add_column("expenses", sa.Column("amount_before_bank", _MONEY))
    op.create_table(
        "bank_statements",
        sa.Column("id", sa.Uuid, nullable=False),
        sa.Column("advance_id", sa.Uuid, nullable=False),
        sa.Column("company_id", sa.Uuid, nullable=False),
        sa.Column("employee_id", sa.Uuid, nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("card_last4", sa.String(4)),
        sa.Column("file_name", sa.String(200), nullable=False),
        sa.Column("file_sha256", sa.String(64), nullable=False),
        sa.Column("file_key", sa.String(300), nullable=False),
        sa.Column("profile", postgresql.JSONB, nullable=False),
        sa.Column("uploaded_by", sa.Uuid, nullable=False),
        sa.Column("uploaded_at", _TZ, nullable=False),
        sa.ForeignKeyConstraint(["advance_id"], ["advances.id"], name=op.f("fk_bank_statements_advance_id_advances")),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], name=op.f("fk_bank_statements_company_id_companies")),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], name=op.f("fk_bank_statements_employee_id_employees")),
        sa.ForeignKeyConstraint(["uploaded_by"], ["employees.id"], name=op.f("fk_bank_statements_uploaded_by_employees")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_bank_statements")),
        sa.UniqueConstraint("company_id", "file_sha256", name="uq_bank_statements_company_file"),
    )
    op.create_index(op.f("ix_bank_statements_advance_id"), "bank_statements", ["advance_id"])
    op.create_table(
        "statement_movements",
        sa.Column("id", sa.Uuid, nullable=False),
        sa.Column("statement_id", sa.Uuid, nullable=False),
        sa.Column("row", sa.Integer, nullable=False),
        sa.Column("day", sa.Date, nullable=False),
        sa.Column("description", sa.String(300), nullable=False),
        sa.Column("reference", sa.String(120)),
        sa.Column("amount", _MONEY, nullable=False),
        sa.Column("is_charge", sa.Boolean, nullable=False),
        sa.Column("in_trip", sa.Boolean, nullable=False),
        sa.Column("expense_id", sa.Uuid),
        sa.Column("match_status", _enum("matchstatus", "auto", "suggested", "confirmed", "manual")),
        sa.Column("match_score", sa.Numeric(6, 3)),
        sa.Column("matched_by", sa.Uuid),
        sa.Column("matched_at", _TZ),
        sa.Column("rejected_expense_ids", postgresql.JSONB, server_default="[]", nullable=False),
        sa.Column("charge_decision", _enum("chargedecision", "absorb", "discount")),
        sa.Column("absorbed_expense_id", sa.Uuid),
        sa.Column("decided_by", sa.Uuid),
        sa.Column("decided_at", _TZ),
        sa.ForeignKeyConstraint(
            ["statement_id"], ["bank_statements.id"], ondelete="CASCADE",
            name=op.f("fk_statement_movements_statement_id_bank_statements"),
        ),
        sa.ForeignKeyConstraint(["expense_id"], ["expenses.id"], name=op.f("fk_statement_movements_expense_id_expenses")),
        sa.ForeignKeyConstraint(
            ["absorbed_expense_id"], ["expenses.id"], name=op.f("fk_statement_movements_absorbed_expense_id_expenses")
        ),
        sa.ForeignKeyConstraint(["matched_by"], ["employees.id"], name=op.f("fk_statement_movements_matched_by_employees")),
        sa.ForeignKeyConstraint(["decided_by"], ["employees.id"], name=op.f("fk_statement_movements_decided_by_employees")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_statement_movements")),
    )  # fmt: skip
    op.create_index(op.f("ix_statement_movements_statement_id"), "statement_movements", ["statement_id"])
    op.create_index(op.f("ix_statement_movements_expense_id"), "statement_movements", ["expense_id"])
    now = datetime.now(UTC)
    op.bulk_insert(_SETTINGS, [{**row, "updated_at": now} for row in SYSTEM_SETTINGS])


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM system_settings WHERE key = ANY(:k)").bindparams(k=[r["key"] for r in SYSTEM_SETTINGS]))
    op.drop_table("statement_movements")
    op.drop_table("bank_statements")
    for column in ("amount_before_bank", "bank_currency", "bank_amount", "bank_status", "payment_method"):
        op.drop_column("expenses", column)
