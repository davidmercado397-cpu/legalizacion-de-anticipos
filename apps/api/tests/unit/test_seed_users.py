from __future__ import annotations

import pytest

from scripts.seed_users import password_problem


@pytest.mark.parametrize(
    ("password", "confirmation", "expected"),
    [
        ("Clave-Servidor-2026", "Clave-Servidor-2027", "no coinciden"),
        ("Viaticos2026*", "Viaticos2026*", "contraseña de desarrollo"),
        ("corta", "corta", "al menos 10 caracteres"),
        ("Clave-de-Laura-2026", "Clave-de-Laura-2026", "no puede contener tu correo"),
    ],
)
def test_rejects_unsafe_passwords(password: str, confirmation: str, expected: str) -> None:
    problem = password_problem(password, confirmation, 10)
    assert problem is not None
    assert expected in problem


def test_accepts_a_new_password() -> None:
    assert password_problem("Clave-Servidor-2026", "Clave-Servidor-2026", 10) is None
