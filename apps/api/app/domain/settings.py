"""Parámetros del sistema guardados como llave-valor en la BD.

El tipo y el rango de cada llave también son datos de la fila: la validación es genérica y no hay
valores ni límites quemados en el código. El código solo conoce los nombres de las llaves."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal, InvalidOperation
from enum import StrEnum
from typing import Any

from app.domain.entities import utcnow
from app.domain.errors import DomainError, ValidationError


class SettingType(StrEnum):
    INT = "int"
    DECIMAL = "decimal"
    STRING = "string"
    BOOL = "bool"
    LIST = "list"
    ENUM = "enum"
    JSON = "json"


class SettingMissingError(DomainError):
    """Falta una llave que el código necesita: la función que la usa responde 503."""

    code = "setting_missing"

    def __init__(self, key: str) -> None:
        super().__init__(f"Setting {key} is missing", key=key)
        self.key = key


@dataclass(eq=False)
class SystemSetting:
    key: str
    value: Any
    value_type: SettingType
    description: str
    constraints: dict[str, Any] = field(default_factory=dict)
    updated_by: uuid.UUID | None = None
    updated_at: datetime = field(default_factory=utcnow)

    def change(self, raw: Any, actor_id: uuid.UUID, now: datetime) -> None:
        self.value = self.coerce(raw)
        self.updated_by = actor_id
        self.updated_at = now

    def coerce(self, raw: Any) -> Any:
        """Convierte y valida un valor nuevo según el tipo y las restricciones de la fila."""
        c = self.constraints
        match self.value_type:
            case SettingType.INT:
                if isinstance(raw, bool) or not isinstance(raw, int | str):
                    raise self._invalid("int")
                try:
                    value: Any = int(raw)
                except ValueError as exc:
                    raise self._invalid("int") from exc
                self._check_range(Decimal(value))
            case SettingType.DECIMAL:
                try:
                    number = Decimal(str(raw))
                except InvalidOperation as exc:
                    raise self._invalid("decimal") from exc
                if not number.is_finite() or isinstance(raw, bool):
                    raise self._invalid("decimal")
                self._check_range(number)
                value = float(number)
            case SettingType.BOOL:
                if not isinstance(raw, bool):
                    raise self._invalid("bool")
                value = raw
            case SettingType.STRING:
                if not isinstance(raw, str):
                    raise self._invalid("string")
                value = raw.strip()
                if "max_length" in c and len(value) > int(c["max_length"]):
                    raise self._invalid("max_length", limit=c["max_length"])
            case SettingType.ENUM:
                if raw not in c.get("options", []):
                    raise self._invalid("options", options=", ".join(map(str, c.get("options", []))))
                value = raw
            case SettingType.LIST:
                if not isinstance(raw, list) or not all(isinstance(item, str) for item in raw):
                    raise self._invalid("list")
                value = [item.strip() for item in raw if item.strip()]
            case SettingType.JSON:
                if not isinstance(raw, dict | list):
                    raise self._invalid("json")
                value = raw
        return value

    def _check_range(self, number: Decimal) -> None:
        c = self.constraints
        if "min" in c and number < Decimal(str(c["min"])):
            raise self._invalid("min", limit=c["min"])
        if "max" in c and number > Decimal(str(c["max"])):
            raise self._invalid("max", limit=c["max"])

    def _invalid(self, rule: str, **params: Any) -> ValidationError:
        return ValidationError(f"Invalid value for setting {self.key}", code=f"setting_{rule}", key=self.key, **params)
