from __future__ import annotations

import io
from datetime import datetime

import pytest
from openpyxl import Workbook

from app.adapters.outbound.statement_files import SpreadsheetTableReader
from app.domain.errors import ValidationError
from app.domain.reconciliation import read_movements, suggest_profile


def test_csv_separator_is_detected_even_with_a_title_line_above() -> None:
    content = "Banco Prueba, S.A.\nFecha;Descripción;Valor\n13/10/2026;Café, pan;-12.500\n".encode("cp1252")
    rows = SpreadsheetTableReader().read(content, "extracto.csv")
    assert rows[1:] == [["Fecha", "Descripción", "Valor"], ["13/10/2026", "Café, pan", "-12.500"]]


def test_excel_dates_and_numbers_come_out_readable() -> None:
    book = Workbook()
    sheet = book.active
    assert sheet is not None
    sheet.append(["Fecha", "Descripción", "Valor"])
    sheet.append([datetime(2026, 10, 13), "STARBUCKS COF", -12.5])
    buffer = io.BytesIO()
    book.save(buffer)
    rows = SpreadsheetTableReader().read(buffer.getvalue(), "extracto.xlsx")
    assert rows[1] == ["2026-10-13", "STARBUCKS COF", "-12.5"]
    (movement,) = read_movements(rows, suggest_profile(rows, "USD").profile).movements
    assert (str(movement.amount), movement.is_charge) == ("12.5", True)


def test_other_formats_and_damaged_files_are_rejected() -> None:
    with pytest.raises(ValidationError, match="Unsupported"):
        SpreadsheetTableReader().read(b"hola", "extracto.docx")
    with pytest.raises(ValidationError, match="Unreadable"):
        SpreadsheetTableReader().read(b"PK\x03\x04 roto", "extracto.xlsx")


def test_without_titles_the_suggestion_is_a_guess_to_review() -> None:
    suggestion = suggest_profile([["13/10/2026", "Café", "-12.500"]], "COP")
    assert not suggestion.confident and suggestion.profile.amount_col == 2
