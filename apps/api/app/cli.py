"""Tareas de línea de comandos. El primer admin de Forsa y el superadmin de la plataforma se crean
solo aquí, nunca por la API.

    python -m app.cli create-admin --email admin@forsa.com --name "Admin" \\
        --company "Forsa S.A." --country CO --currency COP
    python -m app.cli create-superadmin --email ops@nextbyte.com.co --name "Operación NextByte"
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import sys

from app.adapters.outbound.persistence.uow import UnitOfWorkFactory, create_engine
from app.adapters.outbound.security.passwords import Argon2PasswordHasher
from app.application.auth import PasswordPolicy
from app.config import get_settings
from app.domain.entities import AuditEntry, Company, Employee, blocked_concepts_from
from app.domain.enums import Channel, Role
from app.domain.errors import DomainError
from app.domain.settings import SettingMissingError


async def create_admin(email: str, name: str, password: str, company: str, country: str, currency: str) -> None:
    settings = get_settings()
    PasswordPolicy(settings.PASSWORD_MIN_LENGTH).check(password, email)
    engine = create_engine(settings.DATABASE_URL, 2)
    uow_factory = UnitOfWorkFactory(engine)
    try:
        async with uow_factory() as uow:
            if await uow.employees.get_by_email(email):
                print(f"Ya existe un usuario con el correo {email}", file=sys.stderr)
                return
            companies = await uow.companies.find()
            target = next((c for c in companies if c.name == company), None)
            if target is None:
                defaults = await uow.settings.get("defaults.blocked_concepts")
                if defaults is None:
                    raise SettingMissingError("defaults.blocked_concepts")
                target = Company(company, country, currency)
                await uow.companies.add(target)
                await uow.flush()
                for concept in blocked_concepts_from(target.id, defaults.value):
                    await uow.concepts.add(concept)
            admin = Employee(
                full_name=name,
                email=email,
                role=Role.ADMIN,
                company_ids=[c.id for c in companies] or [target.id],
                password_hash=Argon2PasswordHasher().hash(password),
            )
            if target.id not in admin.company_ids:
                admin.company_ids.append(target.id)
            await uow.employees.add(admin)
            await uow.audit.add(AuditEntry("admin_created_cli", "employee", str(admin.id), None, Channel.SYSTEM))
            await uow.commit()
            print(f"Admin {email} creado (compañía: {target.name})")
    finally:
        await engine.dispose()


async def create_superadmin(email: str, name: str, password: str) -> None:
    """El superadmin no pertenece a ninguna compañía: solo administra la configuración del sistema."""
    settings = get_settings()
    PasswordPolicy(settings.PASSWORD_MIN_LENGTH).check(password, email)
    engine = create_engine(settings.DATABASE_URL, 2)
    try:
        async with UnitOfWorkFactory(engine)() as uow:
            if await uow.employees.get_by_email(email):
                print(f"Ya existe un usuario con el correo {email}", file=sys.stderr)
                return
            superadmin = Employee(
                full_name=name,
                email=email,
                role=Role.SUPERADMIN,
                company_ids=[],
                password_hash=Argon2PasswordHasher().hash(password),
            )
            await uow.employees.add(superadmin)
            await uow.audit.add(AuditEntry("superadmin_created_cli", "employee", str(superadmin.id), None, Channel.SYSTEM))
            await uow.commit()
            print(f"Superadmin {email} creado")
    finally:
        await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(prog="app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    admin = sub.add_parser("create-admin")
    admin.add_argument("--email", required=True)
    admin.add_argument("--name", required=True)
    admin.add_argument("--company", required=True)
    admin.add_argument("--country", default="CO")
    admin.add_argument("--currency", default="COP")
    admin.add_argument("--password", help="Si se omite, se pide por consola (recomendado)")
    superadmin = sub.add_parser("create-superadmin")
    superadmin.add_argument("--email", required=True)
    superadmin.add_argument("--name", required=True)
    superadmin.add_argument("--password", help="Si se omite, se pide por consola (recomendado)")
    args = parser.parse_args()
    password = args.password or getpass.getpass("Contraseña: ")
    try:
        if args.command == "create-admin":
            asyncio.run(create_admin(args.email, args.name, password, args.company, args.country, args.currency))
        else:
            asyncio.run(create_superadmin(args.email, args.name, password))
    except DomainError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
