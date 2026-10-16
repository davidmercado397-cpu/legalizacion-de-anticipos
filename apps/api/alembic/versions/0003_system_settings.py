"""configuración del sistema (llave-valor) y rol superadmin

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-16 09:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Valores iniciales congelados de esta migración. Desde aquí en adelante solo cambian por la API del
# superadmin; una llave nueva llega en su propia migración. Los tests cargan esta misma lista.
SYSTEM_SETTINGS: list[dict] = [
    {"key": "whatsapp.welcome_template", "value": "", "value_type": "string", "constraints": {"max_length": 120},
     "description": "Nombre de la plantilla de bienvenida aprobada en Meta (vacío = no se envía)."},
    {"key": "whatsapp.approval_template", "value": "", "value_type": "string", "constraints": {"max_length": 120},
     "description": "Nombre de la plantilla de aprobación de anticipos aprobada en Meta."},
    {"key": "whatsapp.template_language", "value": "es", "value_type": "string", "constraints": {"max_length": 10},
     "description": "Código de idioma de las plantillas de Meta (es, es_CO, es_MX…)."},
    {"key": "whatsapp.batch_grace_seconds", "value": 3.0, "value_type": "decimal", "constraints": {"min": 0, "max": 60},
     "description": "Segundos que se espera a más fotos de la misma ráfaga antes de enviar el resumen."},
    {"key": "whatsapp.slow_notice_seconds", "value": 45.0, "value_type": "decimal", "constraints": {"min": 5, "max": 600},
     "description": "Si una factura tarda más que esto, se avisa 'sigo revisando'."},
    {"key": "ai.primary_model", "value": "google/gemini-3.8-flash", "value_type": "string", "constraints": {"max_length": 120},
     "description": "Modelo para documentos difíciles (sin QR legible)."},
    {"key": "ai.lite_model", "value": "google/gemini-3.5-flash-lite", "value_type": "string", "constraints": {"max_length": 120},
     "description": "Modelo rápido cuando el QR fiscal o el texto del PDF ya trae los valores."},
    {"key": "ai.fallback_model", "value": "google/gemini-3.8-flash", "value_type": "string", "constraints": {"max_length": 120},
     "description": "Modelo de escalamiento (con razonamiento y alta resolución) cuando la lectura no cuadra."},
    {"key": "ai.availability_fallbacks", "value": ["anthropic/claude-haiku-5.5"], "value_type": "list", "constraints": {},
     "description": "Modelos alternos si el proveedor principal no responde (sin modelos de origen chino)."},
    {"key": "ai.routing", "value": "by_difficulty", "value_type": "enum", "constraints": {"options": ["by_difficulty", "always_primary"]},
     "description": "by_difficulty usa el modelo rápido cuando hay QR; always_primary siempre el principal."},
    {"key": "ai.escalation_threshold", "value": 0.7, "value_type": "decimal", "constraints": {"min": 0, "max": 1},
     "description": "Confianza mínima de la IA; por debajo se escala al modelo fuerte."},
    {"key": "ai.reasoning_off", "value": "minimal", "value_type": "enum", "constraints": {"options": ["minimal", "low", "medium", "high"]},
     "description": "Esfuerzo de razonamiento en lecturas normales."},
    {"key": "ai.reasoning_on", "value": "low", "value_type": "enum", "constraints": {"options": ["minimal", "low", "medium", "high"]},
     "description": "Esfuerzo de razonamiento al escalar."},
    {"key": "ai.max_tokens", "value": 2500, "value_type": "int", "constraints": {"min": 256, "max": 16000},
     "description": "Máximo de tokens de respuesta de la IA por lectura."},
    {"key": "ai.zero_data_retention", "value": True, "value_type": "bool", "constraints": {},
     "description": "Solo enrutar a proveedores con cero retención de datos."},
    {"key": "ai.prompt_version", "value": "v2", "value_type": "string", "constraints": {"max_length": 20},
     "description": "Versión del prompt de extracción (prompts/invoice_extraction/<versión>.md)."},
    {"key": "image.max_side_px", "value": 1600, "value_type": "int", "constraints": {"min": 640, "max": 4096},
     "description": "Lado mayor de la imagen que se envía a la IA en lecturas normales."},
    {"key": "image.hires_max_side_px", "value": 2400, "value_type": "int", "constraints": {"min": 1024, "max": 6000},
     "description": "Lado mayor de la imagen al escalar."},
    {"key": "image.blur_threshold", "value": 15.0, "value_type": "decimal", "constraints": {"min": 0, "max": 500},
     "description": "Por debajo de este puntaje de nitidez se pide otra foto sin llamar a la IA."},
    {"key": "defaults.policy_rules", "value_type": "json", "constraints": {},
     "description": "Acción y parámetros por defecto de cada regla de política (cada compañía puede sobrescribirlos).",
     "value": {
         "duplicate": {"action": "require_justification", "params": {}},
         "missing_tax_id": {"action": "warn", "params": {}},
         "outside_trip_dates": {"action": "require_justification", "params": {"tolerance_days": 1}},
         "blocked_concept": {"action": "require_justification", "params": {"min_confidence": 0.6}},
         "non_fiscal_document": {"action": "require_justification",
                                 "params": {"max_per_receipt": None, "max_monthly": None, "max_yearly": None}},
         "itemized_required": {"action": "warn", "params": {"above_amount": None}},
         "low_confidence": {"action": "warn", "params": {"threshold": 0.7}},
     }},
    {"key": "defaults.blocked_concepts", "value_type": "json", "constraints": {},
     "description": "Conceptos no reembolsables que se copian a cada compañía nueva.",
     "value": [
         {"code": "alcohol", "name": "Bebidas alcohólicas",
          "description": "Cerveza, vino, licores y cocteles, por marca o por tipo",
          "examples": ["cerveza", "Club Colombia", "Águila", "Poker", "vino de la casa", "Old Parr", "aguardiente",
                       "michelada", "house wine"]},
         {"code": "minibar", "name": "Minibar", "description": "Consumos del minibar de la habitación del hotel",
          "examples": ["minibar", "frigobar", "consumo minibar"]},
         {"code": "tobacco", "name": "Tabaco", "description": "Cigarrillos, tabacos y vapeadores",
          "examples": ["cigarrillos", "Marlboro", "vape"]},
     ]},
]


def upgrade() -> None:
    table = op.create_table(
        "system_settings",
        sa.Column("key", sa.String(length=80), nullable=False),
        sa.Column("value", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("value_type", sa.Enum("int", "decimal", "string", "bool", "list", "enum", "json",
                                        name="settingtype", native_enum=False, length=32), nullable=False),
        sa.Column("constraints", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        sa.Column("description", sa.String(length=300), nullable=False),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["updated_by"], ["employees.id"], name=op.f("fk_system_settings_updated_by_employees")),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_system_settings")),
    )
    now = datetime.now(UTC)
    op.bulk_insert(table, [{**row, "updated_at": now} for row in SYSTEM_SETTINGS])


def downgrade() -> None:
    op.drop_table("system_settings")
