"""Los valores iniciales de system_settings se toman de las mismas migraciones que los cargan en
producción (los tests crean el esquema con create_all, sin correr Alembic)."""

from __future__ import annotations

import importlib.util
import pathlib
from typing import Any

VERSIONS = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions"

# Valores propios de los tests (modelos falsos, sin espera entre fotos de una ráfaga).
TEST_VALUES: dict[str, Any] = {
    "whatsapp.welcome_template": "bienvenida",
    "whatsapp.approval_template": "aprobacion_anticipo",
    "whatsapp.batch_grace_seconds": 0.0,
    "ai.primary_model": "primary-model",
    "ai.lite_model": "lite-model",
    "ai.fallback_model": "strong-model",
}


def _migrations() -> list[Any]:
    modules = []
    for path in sorted(VERSIONS.glob("[0-9]*.py")):
        spec = importlib.util.spec_from_file_location(path.stem, path)
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        modules.append(module)
    return modules


def extensions_sql() -> list[str]:
    """Extensiones que las migraciones crean antes de las tablas (p. ej. pg_trgm para el aprendizaje)."""
    return [sql for module in _migrations() for sql in getattr(module, "EXTENSIONS_SQL", [])]


def database_sql() -> list[str]:
    """Sentencias que las migraciones aplican además de las tablas (p. ej. triggers de auditoría)."""
    return [sql for module in _migrations() for sql in getattr(module, "APPEND_ONLY_AUDIT_SQL", [])]


def seed_settings() -> list[dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    for module in _migrations():
        for row in getattr(module, "SYSTEM_SETTINGS", []):
            rows[row["key"]] = dict(row)
        for key, value in getattr(module, "SETTING_UPDATES", {}).items():
            rows[key]["value"] = value
        for key, value in getattr(module, "SETTING_MERGES", {}).items():
            rows[key]["value"] = {**rows[key]["value"], **value}
        for row in getattr(module, "REMOVED_SETTINGS", []):
            rows.pop(row["key"], None)
    for key, value in TEST_VALUES.items():
        rows[key]["value"] = value
    return list(rows.values())


def setting_value(key: str) -> Any:
    return next(row["value"] for row in seed_settings() if row["key"] == key)
