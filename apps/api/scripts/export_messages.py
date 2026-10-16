"""Genera docs/MENSAJES.md con todos los textos que ve el usuario, para revisarlos de corrido.

Uso: python -m scripts.export_messages
"""

from __future__ import annotations

import inspect
import pathlib

from app.application import messages as msg

OUTPUT = pathlib.Path(__file__).resolve().parents[1] / "docs" / "MENSAJES.md"

# Parámetros de ejemplo para mostrar los mensajes que dependen de datos.
SAMPLE = {
    "count": 3,
    "minutes": 5,
    "seconds": 30,
    "min": 10,
    "email": "ana@forsa.com",
    "entity": "advance",
    "action": "submit",
    "status": "in_review",
    "service": "r2",
    "max_mb": 15,
    "rule": "outside_trip_dates",
    "params": "tolerancia",
    "fields": "total",
    "document_type": "pos_ticket",
    "expense_currency": "USD",
    "advance_currency": "COP",
    "request_id": "7f3c9a1b",
}


def _table(rows: list[tuple[str, str]]) -> str:
    lines = ["| Clave | Texto |", "|---|---|"]
    lines += [f"| `{key}` | {text.replace('|', '/').replace(chr(10), ' ')} |" for key, text in rows]
    return "\n".join(lines)


def build() -> str:
    bot = [(name, value) for name, value in vars(msg).items() if name.isupper() and isinstance(value, str) and value != name]
    errors = [(code, msg.error_message(code, SAMPLE)) for code in msg.ERROR_MESSAGES]
    helpers = [
        ("pending_expenses(1) / (3)", f"{msg.pending_expenses(1)} / {msg.pending_expenses(3)}"),
    ]
    sections = [
        "# Mensajes al usuario\n",
        "Generado con `python -m scripts.export_messages` desde `app/application/messages.py`. No editar a mano:",
        "los cambios se hacen en `messages.py` y se vuelve a generar.\n",
        "## WhatsApp\n",
        _table(bot + helpers),
        "\n## Alertas de política\n",
        _table(list(msg.FINDING_LABELS.items())),
        "\n## Advertencias de lectura\n",
        _table([(str(key), value) for key, value in msg.WARNING_LABELS.items()]),
        "\n## Errores de la API y del bot (con datos de ejemplo)\n",
        _table(errors),
        "\n## Problemas por campo (errores 422)\n",
        _table(list(msg.VALIDATION_ISSUES.items())),
        "",
    ]
    return "\n".join(sections)


if __name__ == "__main__":
    assert inspect.ismodule(msg)
    OUTPUT.write_text(build(), encoding="utf-8")
    print(f"Escrito {OUTPUT}")
