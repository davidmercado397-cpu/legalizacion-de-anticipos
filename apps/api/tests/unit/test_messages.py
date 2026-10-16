from __future__ import annotations

import ast
import pathlib
import re

from app.application import messages as msg
from app.domain import errors, settings  # noqa: F401 - registra SettingMissingError como subclase

APP = pathlib.Path(__file__).resolve().parents[2] / "app"

# Frases genéricas que suenan a texto automático: no se usan en lo que lee el usuario.
BANNED = (
    "lo sentimos",
    "ha ocurrido un error",
    "no dudes en",
    "¡excelente",
    "es importante tener en cuenta",
    "por favor, ten en cuenta",
    "estimado usuario",
    "te ayudo con gusto",
    "su solicitud",
    "(s)",
)


def _codes_raised_in_app() -> set[str]:
    codes = set()
    for path in APP.rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text())):
            if isinstance(node, ast.keyword) and node.arg == "code" and isinstance(node.value, ast.Constant):
                codes.add(node.value.value)
    return codes


def _default_codes() -> set[str]:
    def walk(cls: type[errors.DomainError]) -> set[type[errors.DomainError]]:
        return {cls}.union(*(walk(sub) for sub in cls.__subclasses__()))

    return {cls.code for cls in walk(errors.DomainError)}


def _dynamic_setting_codes() -> set[str]:
    # SystemSetting arma el código como f"setting_{regla}": se listan las reglas que usa.
    source = (APP / "domain" / "settings.py").read_text()
    return {f"setting_{rule}" for rule in re.findall(r'_invalid\("(\w+)"', source)}


def test_every_error_code_has_a_spanish_message() -> None:
    missing = (_codes_raised_in_app() | _default_codes() | _dynamic_setting_codes()) - msg.ERROR_MESSAGES.keys()
    assert not missing, f"Códigos sin mensaje en messages.ERROR_MESSAGES: {sorted(missing)}"


def test_user_texts_avoid_generic_phrases() -> None:
    texts = [value for name, value in vars(msg).items() if name.isupper() and isinstance(value, str)]
    for table in (msg.ERROR_MESSAGES, msg.FINDING_LABELS, msg.WARNING_LABELS, msg.VALIDATION_ISSUES):
        texts += [value for value in table.values() if isinstance(value, str)]
    offenders = [text for text in texts for phrase in BANNED if phrase in text.lower()]
    assert not offenders, offenders


def test_messages_interpolate_their_parameters() -> None:
    assert msg.error_message("pending_expenses", {"count": 1}).endswith("el gasto pendiente.")
    assert "los 3 gastos pendientes" in msg.error_message("pending_expenses", {"count": 3})
    assert msg.error_message("invalid_advance_transition", {"action": "submit", "status": "in_review"}) == (
        "No se puede enviar a revisión un anticipo que está en revisión."
    )
    assert msg.error_message("not_found", {"entity": "advance"}) == "No encontramos el anticipo."
    # Si falta un parámetro, nunca se muestran llaves sin reemplazar.
    assert "{" not in msg.error_message("email_taken", {})
