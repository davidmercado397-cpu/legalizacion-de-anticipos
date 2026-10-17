"""Los mismos usuarios, compañía y tarifas de viaje del entorno local, para probar en un servidor (también en
producción). La contraseña no es la de desarrollo, que está publicada en el repositorio: se pide por consola, es
la misma para todos y cada usuario debe cambiarla en su primer ingreso. En una base que ya los tiene solo agrega
lo que falte.

    python -m scripts.seed_users
"""

from __future__ import annotations

import asyncio
import getpass
import sys

from app.application.auth import PasswordPolicy
from app.application.messages import error_message
from app.config import get_settings
from app.domain.errors import DomainError
from scripts.seed_dev import PASSWORD as DEV_PASSWORD
from scripts.seed_dev import SEED_EMAILS, seed


def password_problem(password: str, confirmation: str, min_length: int) -> str | None:
    if password != confirmation:
        return "Las contraseñas no coinciden."
    if password == DEV_PASSWORD:
        return "Esa es la contraseña de desarrollo, que está publicada en el repositorio: use otra."
    try:
        for email in SEED_EMAILS:
            PasswordPolicy(min_length).check(password, email)
    except DomainError as exc:
        return error_message(exc.code, exc.params)
    return None


async def main() -> int:
    print("Se crearán estos usuarios con la misma contraseña (cada uno la cambia al entrar):")
    print("  " + ", ".join(SEED_EMAILS))
    password = getpass.getpass("Contraseña: ")
    if problem := password_problem(password, getpass.getpass("Repítala: "), get_settings().PASSWORD_MIN_LENGTH):
        print(f"Error: {problem}", file=sys.stderr)
        return 1
    await seed(password, must_change_password=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
