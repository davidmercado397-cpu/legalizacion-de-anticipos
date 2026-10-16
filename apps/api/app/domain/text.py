"""Normalización de texto de líneas de factura (para comparar y aprender clasificaciones de líneas)."""

from __future__ import annotations

import re
import unicodedata

_NUMBERS = re.compile(r"[\d.,$%]+")
_UNITS = re.compile(r"\b(\d+)?\s?(ml|cl|lt|l|gr|g|kg|oz|und|un|uds|x)\b", re.IGNORECASE)
_NON_WORD = re.compile(r"[^a-z\s]")
_SPACES = re.compile(r"\s+")


def normalize_line_text(text: str) -> str:
    """'2 CERVEZA Club Colombia Dorada 330ml $12.000' -> 'cerveza club colombia dorada'."""
    without_accents = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    lowered = without_accents.lower()
    lowered = _UNITS.sub(" ", lowered)
    lowered = _NUMBERS.sub(" ", lowered)
    lowered = _NON_WORD.sub(" ", lowered)
    # Lo que queda de cantidades como "x3" o "3x" son letras sueltas: se descartan.
    return " ".join(token for token in _SPACES.split(lowered) if len(token) > 1)
