"""detalle de la legalización, anular y reabrir, tesorería, suplencias y marcas de devolución

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-17 02:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SYSTEM_SETTINGS: list[dict] = [
    {"key": "image.thumbnail_side_px", "value": 400, "value_type": "int", "constraints": {"min": 120, "max": 1200},
     "description": "Lado mayor de la miniatura JPEG que usan las listas del frontend."},
]

_ADVANCE_TIMES = ("approved_at", "submitted_at", "returned_at", "closed_at", "disbursed_at", "settled_at")
_ADVANCE_ACTORS = ("approved_by", "closed_by", "disbursed_by", "settled_by")


def _enum(name: str, *values: str) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False, length=32)


def upgrade() -> None:
    for column in _ADVANCE_TIMES:
        op.add_column("advances", sa.Column(column, sa.DateTime(timezone=True), nullable=True))
    for column in _ADVANCE_ACTORS:
        op.add_column("advances", sa.Column(column, sa.Uuid(), nullable=True))
        op.create_foreign_key(op.f(f"fk_advances_{column}_employees"), "advances", "employees", [column], ["id"])
    op.add_column("advances", sa.Column("disbursement_method", _enum("disbursementmethod", "cash", "transfer", "card")))
    op.add_column("advances", sa.Column("disbursement_ref", sa.String(length=120), nullable=True))
    op.add_column(
        "advances",
        sa.Column(
            "settlement_status",
            _enum("settlementstatus", "none", "refund_pending", "refunded", "payroll_deducted", "payment_pending", "paid"),
        ),
    )
    op.add_column(
        "advances", sa.Column("settlement_method", _enum("settlementmethod", "refund", "payroll_deduction", "payment"))
    )
    op.add_column("advances", sa.Column("settlement_ref", sa.String(length=120), nullable=True))
    # Historia: lo ya aprobado o cerrado conserva su fecha a partir de la última decisión.
    op.execute("UPDATE advances SET approved_at = decided_at, approved_by = decided_by WHERE status IN ('approved', 'in_review', 'closed')")
    op.execute("UPDATE advances SET closed_at = decided_at, closed_by = decided_by WHERE status = 'closed'")

    op.add_column("expenses", sa.Column("confirmed_by", sa.Uuid(), nullable=True))
    op.create_foreign_key(op.f("fk_expenses_confirmed_by_employees"), "expenses", "employees", ["confirmed_by"], ["id"])
    op.add_column("expenses", sa.Column("thumbnail_key", sa.String(length=300), nullable=True))
    op.add_column("expenses", sa.Column("return_note", sa.String(length=1000), nullable=True))
    op.add_column("expenses", sa.Column("return_resolved_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "approver_delegations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("approver_id", sa.Uuid(), nullable=False),
        sa.Column("delegate_id", sa.Uuid(), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["approver_id"], ["employees.id"], name=op.f("fk_approver_delegations_approver_id_employees"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["delegate_id"], ["employees.id"], name=op.f("fk_approver_delegations_delegate_id_employees"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["created_by"], ["employees.id"], name=op.f("fk_approver_delegations_created_by_employees")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_approver_delegations")),
    )
    op.create_index(op.f("ix_approver_delegations_approver_id"), "approver_delegations", ["approver_id"])
    op.create_index(op.f("ix_approver_delegations_delegate_id"), "approver_delegations", ["delegate_id"])

    settings = sa.table(
        "system_settings",
        sa.column("key", sa.String),
        sa.column("value", postgresql.JSONB),
        sa.column("value_type", sa.String),
        sa.column("constraints", postgresql.JSONB),
        sa.column("description", sa.String),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    op.bulk_insert(settings, [{**row, "updated_at": datetime.now(UTC)} for row in SYSTEM_SETTINGS])


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM system_settings WHERE key = ANY(:k)").bindparams(k=[r["key"] for r in SYSTEM_SETTINGS]))
    op.drop_index(op.f("ix_approver_delegations_delegate_id"), table_name="approver_delegations")
    op.drop_index(op.f("ix_approver_delegations_approver_id"), table_name="approver_delegations")
    op.drop_table("approver_delegations")
    op.drop_column("expenses", "return_resolved_at")
    op.drop_column("expenses", "return_note")
    op.drop_column("expenses", "thumbnail_key")
    op.drop_constraint(op.f("fk_expenses_confirmed_by_employees"), "expenses", type_="foreignkey")
    op.drop_column("expenses", "confirmed_by")
    for column in ("settlement_ref", "settlement_method", "settlement_status", "disbursement_ref", "disbursement_method"):
        op.drop_column("advances", column)
    for column in _ADVANCE_ACTORS:
        op.drop_constraint(op.f(f"fk_advances_{column}_employees"), "advances", type_="foreignkey")
        op.drop_column("advances", column)
    for column in _ADVANCE_TIMES:
        op.drop_column("advances", column)
    op.execute("UPDATE advances SET status = 'rejected' WHERE status IN ('cancelled', 'voided')")
