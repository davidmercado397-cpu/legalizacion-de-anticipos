"""openpyxl en modo write-only: poca memoria incluso con legalizaciones largas."""

from __future__ import annotations

import io
from datetime import date, datetime
from decimal import Decimal
from enum import Enum

from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell
from openpyxl.styles import Font

from app.domain.ports import ReportTable


class OpenpyxlWriter:
    def write(self, table: ReportTable) -> bytes:
        workbook = Workbook(write_only=True)
        sheet = workbook.create_sheet(_sheet_name(table.title))
        bold = Font(bold=True)
        title = WriteOnlyCell(sheet, value=table.title)
        title.font = Font(bold=True, size=14)
        sheet.append([title])
        for label, value in table.header_rows:
            cell = WriteOnlyCell(sheet, value=label)
            cell.font = bold
            sheet.append([cell, value])
        sheet.append([])
        header = []
        for column in table.columns:
            cell = WriteOnlyCell(sheet, value=column)
            cell.font = bold
            header.append(cell)
        sheet.append(header)
        for row in table.rows:
            sheet.append([_value(v) for v in row])
        buffer = io.BytesIO()
        workbook.save(buffer)
        return buffer.getvalue()


def _sheet_name(title: str) -> str:
    """Excel no admite \\ / ? * [ ] : en el nombre de la hoja y lo limita a 31 caracteres."""
    return "".join("-" if ch in "\\/?*[]:" else ch for ch in title)[:31] or "Hoja"


def _value(value: object) -> object:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, Decimal):
        return float(value)  # Excel guarda los números como float; los montos tienen 2 decimales
    if isinstance(value, datetime) and value.tzinfo is not None:
        return value.replace(tzinfo=None)  # Excel no guarda zonas horarias
    if isinstance(value, date | datetime) or value is None or isinstance(value, int | float | str):
        return value
    return str(value)
