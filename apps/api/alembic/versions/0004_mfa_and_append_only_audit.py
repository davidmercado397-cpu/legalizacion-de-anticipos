"""verificación en dos pasos y auditoría inmutable

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-16 12:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# La auditoría solo admite inserciones: ni la aplicación ni alguien con sus credenciales puede editar
# o borrar el rastro. Los tests aplican estas mismas sentencias.
APPEND_ONLY_AUDIT_SQL = [
    """
    CREATE OR REPLACE FUNCTION audit_log_is_append_only() RETURNS trigger AS $$
    BEGIN
        RAISE EXCEPTION 'audit_log is append-only (% blocked)', TG_OP;
    END;
    $$ LANGUAGE plpgsql
    """,
    """
    CREATE TRIGGER audit_log_append_only
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only()
    """,
    """
    CREATE TRIGGER audit_log_no_truncate
    BEFORE TRUNCATE ON audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION audit_log_is_append_only()
    """,
]


def upgrade() -> None:
    op.add_column("employees", sa.Column("mfa_secret", sa.String(length=400), nullable=True))
    op.add_column("employees", sa.Column("mfa_enabled", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column(
        "employees",
        sa.Column("mfa_recovery_codes", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=False),
    )
    op.add_column("employees", sa.Column("mfa_last_code_hash", sa.String(length=64), nullable=True))
    for statement in APPEND_ONLY_AUDIT_SQL:
        op.execute(statement)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log")
    op.execute("DROP TRIGGER IF EXISTS audit_log_append_only ON audit_log")
    op.execute("DROP FUNCTION IF EXISTS audit_log_is_append_only()")
    op.drop_column("employees", "mfa_last_code_hash")
    op.drop_column("employees", "mfa_recovery_codes")
    op.drop_column("employees", "mfa_enabled")
    op.drop_column("employees", "mfa_secret")
