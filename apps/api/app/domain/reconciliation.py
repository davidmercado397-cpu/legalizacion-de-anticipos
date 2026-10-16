"""Conciliación con el extracto bancario (decisiones 7.1 a 7.9): cómo leer el extracto de cualquier banco
y cómo cruzar sus cargos con los gastos pagados con tarjeta. Funciones puras, sin I/O."""

from __future__ import annotations

import re
import unicodedata
import uuid
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any

from app.domain.errors import ValidationError

DATE_FORMATS = ("DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "DD/MM/YY", "YYYYMMDD")


@dataclass(frozen=True)
class StatementProfile:
    """Qué columna es qué (índices desde 0) y cómo vienen fechas y números. Sirve para cualquier banco."""

    header_row: int  # fila de los títulos, desde 1 (0 = sin títulos)
    date_col: int
    description_col: int
    currency: str
    amount_col: int | None = None  # una sola columna con signo...
    debit_col: int | None = None  # ...o débito y crédito por separado
    credit_col: int | None = None
    reference_col: int | None = None
    date_format: str = "DD/MM/YYYY"
    decimal_separator: str = ","
    charges_negative: bool = True  # con columna de valor: los cargos vienen con signo menos

    def __post_init__(self) -> None:
        if self.amount_col is None and self.debit_col is None:
            raise ValidationError("Profile without amount column", code="statement_profile_invalid")
        if self.amount_col is not None and (self.debit_col is not None or self.credit_col is not None):
            raise ValidationError("Profile with amount and debit/credit columns", code="statement_profile_invalid")
        if self.date_format not in DATE_FORMATS or self.decimal_separator not in (",", "."):
            raise ValidationError("Profile with an unknown format", code="statement_profile_invalid")

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def of(cls, data: dict[str, Any]) -> StatementProfile:
        try:
            return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})
        except TypeError as exc:
            raise ValidationError("Incomplete profile", code="statement_profile_invalid") from exc


@dataclass(frozen=True)
class Movement:
    row: int
    day: date
    description: str
    reference: str | None
    amount: Decimal  # siempre positivo
    is_charge: bool  # False = abono


@dataclass(frozen=True)
class StatementReading:
    movements: list[Movement]
    skipped: list[tuple[int, str]]  # (fila, motivo): parecían movimientos pero no se pudieron leer


def read_movements(rows: Sequence[Sequence[str]], profile: StatementProfile) -> StatementReading:
    movements: list[Movement] = []
    skipped: list[tuple[int, str]] = []

    def cell(row: Sequence[str], col: int | None) -> str:
        return "" if col is None or col >= len(row) else str(row[col] or "").strip()

    for number, row in enumerate(rows, start=1):
        if number <= profile.header_row or not any(str(c or "").strip() for c in row):
            continue
        raw_date = cell(row, profile.date_col)
        day = parse_date(raw_date, profile.date_format)
        if day is None:
            # Totales, saldos y pies de página no tienen fecha: se ignoran en silencio.
            if raw_date:
                skipped.append((number, f"Fecha no reconocida: {raw_date[:40]}"))
            continue
        if profile.amount_col is not None:
            value = parse_number(cell(row, profile.amount_col), profile.decimal_separator)
            if value is None:
                skipped.append((number, "Valor no reconocido"))
                continue
            is_charge = (value < 0) == profile.charges_negative
            amount = abs(value)
        else:
            debit = parse_number(cell(row, profile.debit_col), profile.decimal_separator)
            credit = parse_number(cell(row, profile.credit_col), profile.decimal_separator)
            is_charge = debit is not None and debit != 0
            chosen = debit if is_charge else credit
            if chosen is None:
                skipped.append((number, "Sin valor de débito ni de crédito"))
                continue
            amount = abs(chosen)
        if amount == 0:
            continue
        description = re.sub(r"\s+", " ", cell(row, profile.description_col))[:300] or "(sin descripción)"
        movements.append(Movement(number, day, description, cell(row, profile.reference_col)[:120] or None, amount, is_charge))
    return StatementReading(movements, skipped)


def parse_number(text: str, decimal_separator: str) -> Decimal | None:
    """Números escritos como en el banco: "1.234.567,89", "1,234.56", "$ -45.000", "(1.200,00)" o "1.200,00-"."""
    t = text.strip()
    if not t:
        return None
    negative = False
    if t.startswith("(") and t.endswith(")"):
        negative, t = True, t[1:-1]
    if t.rstrip().endswith("-"):
        negative, t = True, t.rstrip()[:-1]
    t = re.sub(r"[A-Za-z$€£\s ]", "", t)
    if t.startswith("-"):
        negative, t = not negative, t[1:]
    elif t.startswith("+"):
        t = t[1:]
    thousands = "." if decimal_separator == "," else ","
    t = t.replace(thousands, "")
    if decimal_separator == ",":
        t = t.replace(",", ".")
    if not re.fullmatch(r"\d+(\.\d+)?", t):
        return None
    try:
        value = Decimal(t)
    except InvalidOperation:
        return None
    return -value if negative and value != 0 else value


def parse_date(text: str, fmt: str) -> date | None:
    """Fecha según el formato del perfil; las ISO (como las que entrega Excel) se aceptan siempre."""
    t = re.split(r"[ T]", text.strip(), maxsplit=1)[0]
    parts: tuple[str, str, str] | None = None
    if m := re.fullmatch(r"(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})", t):
        parts = (m[1], m[2], m[3])
    elif fmt == "YYYYMMDD":
        if m := re.fullmatch(r"(\d{4})(\d{2})(\d{2})", t):
            parts = (m[1], m[2], m[3])
    elif m := re.fullmatch(r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})", t):
        year = f"20{m[3]}" if len(m[3]) == 2 else m[3]
        parts = (year, m[1], m[2]) if fmt == "MM/DD/YYYY" else (year, m[2], m[1])
    if parts is None:
        return None
    try:
        return date(int(parts[0]), int(parts[1]), int(parts[2]))
    except ValueError:
        return None


_TITLES = {
    "date": ("fecha", "fecha transaccion", "fecha movimiento", "fecha operacion", "data", "date", "transaction date", "posting date"),
    "description": (
        "descripcion", "concepto", "detalle", "establecimiento", "comercio", "historico", "descricao", "description",
        "merchant", "details",
    ),
    "reference": ("referencia", "documento", "numero documento", "autorizacion", "comprobante", "reference", "ref"),
    "amount": ("valor", "monto", "importe", "amount", "valor transaccion", "movimiento"),
    "debit": ("debito", "debitos", "cargo", "cargos", "retiro", "retiros", "egreso", "debit", "withdrawal", "saida"),
    "credit": ("credito", "creditos", "abono", "abonos", "deposito", "ingreso", "credit", "deposit", "entrada"),
}  # fmt: skip


def normalize(text: str) -> str:
    plain = unicodedata.normalize("NFD", str(text)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", plain)).strip()


def _column(headers: list[str], words: Sequence[str], used: set[int]) -> int | None:
    for matches in (lambda h, w: h == w, lambda h, w: h.startswith(f"{w} ")):
        for word in words:
            for i, h in enumerate(headers):
                if i not in used and matches(h, word):
                    return i
    return None


@dataclass(frozen=True)
class ProfileSuggestion:
    profile: StatementProfile
    confident: bool  # False: tesorería debe revisar el mapeo en la vista previa


def suggest_profile(rows: Sequence[Sequence[str]], currency: str) -> ProfileSuggestion:
    """Propone el perfil mirando los títulos (es/pt/en) y una muestra de valores."""
    header_row, headers = 0, []
    for i, row in enumerate(rows[:15]):
        normalized = [normalize(c) for c in row]
        has_amount = any(_column(normalized, _TITLES[k], set()) is not None for k in ("amount", "debit"))
        if _column(normalized, _TITLES["date"], set()) is not None and has_amount:
            header_row, headers = i + 1, normalized
            break
    used: set[int] = set()

    def take(kind: str) -> int | None:
        col = _column(headers, _TITLES[kind], used)
        if col is not None:
            used.add(col)
        return col

    date_col = take("date")
    debit_col = take("debit")
    credit_col = take("credit") if debit_col is not None else None
    amount_col = take("amount") if debit_col is None else None
    description_col = take("description")
    reference_col = take("reference")
    date_col = 0 if date_col is None else date_col
    if description_col is None:
        description_col = 1 if date_col == 0 else 0
    sample = rows[header_row : header_row + 50]
    dates = [str(r[date_col]).strip() for r in sample if date_col < len(r) and str(r[date_col] or "").strip()]
    numeric_cols = [c for c in (amount_col, debit_col, credit_col) if c is not None]
    numbers = [str(r[c]).strip() for r in sample for c in numeric_cols if c < len(r) and str(r[c] or "").strip()]
    if amount_col is None and debit_col is None:
        # Sin títulos reconocibles: una suposición para que tesorería la corrija en la vista previa.
        amount_col = max(c for c in (date_col, description_col, 1) if c is not None) + 1
    profile = StatementProfile(
        header_row=header_row,
        date_col=date_col,
        description_col=description_col,
        currency=currency.upper(),
        amount_col=amount_col if debit_col is None else None,
        debit_col=debit_col,
        credit_col=credit_col,
        reference_col=reference_col,
        date_format=_best_date_format(dates),
        decimal_separator=_best_separator(numbers),
    )
    return ProfileSuggestion(profile, header_row > 0 and (amount_col is not None or debit_col is not None))


def _best_date_format(texts: list[str]) -> str:
    """El formato que reconoce más fechas; si DD/MM y MM/DD empatan, gana DD/MM (uso en Colombia y Brasil)."""
    return max(DATE_FORMATS, key=lambda f: (sum(parse_date(t, f) is not None for t in texts), f == "DD/MM/YYYY"))


def _best_separator(texts: list[str]) -> str:
    """'1.234,56' → coma; '1,234.56' → punto. Con un solo separador, tres dígitos después suelen ser miles."""
    comma = dot = 0
    for t in texts:
        last_dot, last_comma = t.rfind("."), t.rfind(",")
        if last_dot >= 0 and last_comma >= 0:
            comma, dot = (comma + 1, dot) if last_comma > last_dot else (comma, dot + 1)
        elif last_comma >= 0:
            if re.search(r",\d{3}$", t):
                dot += 1
            elif re.search(r",\d{1,2}$", t):
                comma += 1
        elif last_dot >= 0:
            if re.search(r"\.\d{3}$", t):
                comma += 1
            elif re.search(r"\.\d{1,2}$", t):
                dot += 1
    chosen = "," if comma > dot else "."
    other = "." if chosen == "," else ","

    def readable(sep: str) -> int:
        return sum(parse_number(t, sep) is not None for t in texts)

    return chosen if readable(chosen) >= readable(other) else other


# --- Cruce ----------------------------------------------------------------------------------------


@dataclass(frozen=True)
class MatchParams:
    """Parámetros del cruce (system_settings `reconciliation.*`)."""

    max_days: int  # el banco registra la compra el mismo día o hasta N días antes o después
    same_currency_tolerance: Decimal  # diferencia de valor aceptada si la factura está en la moneda del extracto
    other_currency_tolerance: Decimal  # con conversión: el banco usa su tasa y suele sumar comisión
    weights: dict[str, Decimal]  # amount, date, merchant
    auto_threshold: Decimal
    suggest_threshold: Decimal

    @classmethod
    def of(cls, raw: dict[str, Any]) -> MatchParams:
        d = lambda v: Decimal(str(v))  # noqa: E731
        return cls(
            max_days=int(raw["max_days"]),
            same_currency_tolerance=d(raw["same_currency_tolerance"]),
            other_currency_tolerance=d(raw["other_currency_tolerance"]),
            weights={k: d(v) for k, v in raw["weights"].items()},
            auto_threshold=d(raw["auto_threshold"]),
            suggest_threshold=d(raw["suggest_threshold"]),
        )


@dataclass(frozen=True)
class Charge:
    movement_id: uuid.UUID
    day: date
    description: str
    amount: Decimal  # en la moneda del extracto


@dataclass(frozen=True)
class CardPayment:
    expense_id: uuid.UUID
    day: date
    merchant: str
    same_currency: bool  # la factura está en la moneda del extracto
    amount: Decimal | None  # total en la moneda del extracto; None si no hubo cómo convertirlo


@dataclass(frozen=True)
class Proposal:
    movement_id: uuid.UUID
    expense_id: uuid.UUID
    score: Decimal
    automatic: bool


# Puntaje de la fecha por días de diferencia: el mismo día es lo ideal.
_DATE_SCORE = (Decimal(1), Decimal("0.8"), Decimal("0.5"), Decimal("0.3"))


def score(charge: Charge, payment: CardPayment, params: MatchParams) -> Decimal | None:
    if payment.amount is None or payment.amount <= 0:
        return None
    days = abs((charge.day - payment.day).days)
    if days > params.max_days:
        return None
    difference = abs(charge.amount - payment.amount) / payment.amount
    tolerance = params.same_currency_tolerance if payment.same_currency else params.other_currency_tolerance
    if difference > tolerance:
        return None
    amount_score = 1 - (difference / tolerance) * Decimal("0.5") if tolerance else Decimal(1)
    date_score = _DATE_SCORE[days] if days < len(_DATE_SCORE) else Decimal("0.1")
    merchant_score = merchant_similarity(charge.description, payment.merchant)
    w = params.weights
    total = w["amount"] * amount_score + w["date"] * date_score + w["merchant"] * merchant_score
    return total.quantize(Decimal("0.001"))


def match(
    charges: Sequence[Charge],
    payments: Sequence[CardPayment],
    params: MatchParams,
    rejected: frozenset[tuple[uuid.UUID, uuid.UUID]] = frozenset(),
) -> list[Proposal]:
    """Cruce uno a uno: se puntúan todos los pares y se asignan de mayor a menor puntaje. Cada cargo y
    cada gasto se usan una sola vez; los pares que contabilidad rechazó no se vuelven a proponer."""
    pairs: list[Proposal] = []
    for charge in charges:
        for payment in payments:
            if (charge.movement_id, payment.expense_id) in rejected:
                continue
            points = score(charge, payment, params)
            if points is None or points < params.suggest_threshold:
                continue
            pairs.append(Proposal(charge.movement_id, payment.expense_id, points, points >= params.auto_threshold))
    pairs.sort(key=lambda p: p.score, reverse=True)
    used_charges: set[uuid.UUID] = set()
    used_payments: set[uuid.UUID] = set()
    chosen = []
    for pair in pairs:
        if pair.movement_id in used_charges or pair.expense_id in used_payments:
            continue
        used_charges.add(pair.movement_id)
        used_payments.add(pair.expense_id)
        chosen.append(pair)
    return chosen


_STOP_WORDS = frozenset(
    [
        "sas",
        "ltda",
        "ltd",
        "inc",
        "llc",
        "eireli",
        "cia",
        "compra",
        "pago",
        "pos",
        "debito",
        "tarjeta",
        "internacional",
        "nacional",
        "tienda",
        "store",
        "the",
        "del",
        "los",
        "las",
        "com",
        "www",
        "purchase",
        "compras",
        "retiro",
    ]
)


def _tokens(text: str) -> set[str]:
    return {t for t in normalize(text).split() if len(t) >= 3 and t not in _STOP_WORDS and not t.isdigit()}


def merchant_similarity(bank_description: str, vendor: str) -> Decimal:
    """0..1: qué tanto se parece la descripción del banco al comercio de la factura. Los bancos truncan
    los nombres ("STARBUCKS COF" frente a "Starbucks Coffee"), así que un prefijo también cuenta."""
    a, b = _tokens(bank_description), _tokens(vendor)
    if not a or not b:
        return Decimal(0)
    common = sum(1 for t in b if t in a or any(t.startswith(x) or x.startswith(t) for x in a))
    return min(Decimal(1), Decimal(common) / Decimal(min(len(a), len(b)))).quantize(Decimal("0.001"))


@dataclass(frozen=True)
class TripWindow:
    """Los cargos del extracto fuera del viaje (con el margen del cruce) no son de esta legalización."""

    start: date | None
    end: date | None
    margin_days: int = 1

    def contains(self, day: date) -> bool:
        if self.start is None or self.end is None:
            return True
        margin = timedelta(days=self.margin_days)
        return self.start - margin <= day <= self.end + margin
