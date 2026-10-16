"""Identidad en WhatsApp: quién escribe y cómo se vincula el BSUID de un empleado registrado.

Con la actualización de usernames de Meta (2026) el teléfono puede no venir en los webhooks, mientras
que el business-scoped user id (BSUID) siempre viene. El BSUID es la identidad; el teléfono es la
semilla del registro. El username es solo para mostrar (el usuario lo cambia y se recicla a los 60 días)."""

from __future__ import annotations

import logging
import secrets
import uuid
from datetime import timedelta

from app.application import messages as msg
from app.application.cache import TtlCache
from app.application.settings import SettingsService
from app.domain.entities import AuditEntry, Employee, WhatsAppLinkCode
from app.domain.enums import Channel, WhatsAppLinkStatus
from app.domain.errors import NotFoundError, ServiceNotConfiguredError
from app.domain.ports import Clock, MessageSender, TokenService, UnitOfWork, UnitOfWorkFactory
from app.domain.values import WhatsAppSender, normalize_phone

logger = logging.getLogger(__name__)

WELCOME_PAYLOAD_PREFIX = "link_confirm:"
LINK_CODE_MAX_ATTEMPTS = 5


class WhatsAppIdentityService:
    def __init__(
        self,
        uow: UnitOfWorkFactory,
        sender: MessageSender,
        tokens: TokenService,
        clock: Clock,
        settings: SettingsService,
        link_code_ttl_minutes: int,
    ) -> None:
        self._uow = uow
        self._sender = sender
        self._tokens = tokens
        self._clock = clock
        self._settings = settings
        self._code_ttl = timedelta(minutes=link_code_ttl_minutes)
        self._cache: TtlCache[str, uuid.UUID] = TtlCache(ttl_seconds=60)

    async def identify(self, sender: WhatsAppSender) -> Employee | None:
        """Primero por BSUID; luego por teléfono (y ahí se vincula el BSUID). None = no es un usuario registrado y activo."""
        async with self._uow() as uow:
            employee = None
            if sender.user_id:
                cached = self._cache.get(sender.user_id)
                employee = await (uow.employees.get(cached) if cached else uow.employees.get_by_wa_user_id(sender.user_id))
                if employee is not None and employee.wa_user_id != sender.user_id:
                    employee = None  # entrada vieja del caché (lo desvincularon entretanto)
                    self._cache.invalidate(sender.user_id)
            if employee is None and sender.phone:
                employee = await uow.employees.get_by_phone(normalize_phone(sender.phone) or "")
                if employee is not None and employee.active and sender.user_id and employee.wa_user_id != sender.user_id:
                    # El teléfono coincide con un usuario registrado: el BSUID es suyo.
                    await self._release_bsuid(uow, sender.user_id, employee.id)
                    employee.link_whatsapp(sender.user_id, self._clock.now())
                    await uow.audit.add(
                        AuditEntry(
                            "whatsapp_linked", "employee", str(employee.id), employee.id, Channel.WHATSAPP, {"via": "phone"}
                        )
                    )
            if employee is None or not employee.active:
                return None
            employee.update_whatsapp_profile(sender.username, sender.profile_name)
            await uow.commit()
        if sender.user_id:
            self._cache.set(sender.user_id, employee.id)
        return employee

    async def link_ok(self, employee: Employee) -> str:
        assistant = (await self._settings.current()).whatsapp_assistant_name
        intro = msg.ASSISTANT_INTRO.format(assistant=assistant) if assistant else ""
        return msg.LINK_OK.format(name=employee.first_name, assistant=intro)

    async def send_welcome(self, employee_id: uuid.UUID) -> None:
        settings = await self._settings.current()
        if not settings.whatsapp_welcome_template:
            raise ServiceNotConfiguredError("whatsapp_welcome_template")
        async with self._uow() as uow:
            employee = await uow.employees.get(employee_id)
            if employee is None or not employee.phone or not employee.active:
                return
            address = employee.whatsapp_address
            assert address is not None
            message_id = await self._sender.send_template(
                address,
                settings.whatsapp_welcome_template,
                settings.whatsapp_template_language,
                [employee.first_name, settings.whatsapp_assistant_name or msg.DEFAULT_ASSISTANT],
                [f"{WELCOME_PAYLOAD_PREFIX}{employee.id}"],
            )
            if message_id:
                employee.record_welcome(message_id)
                await uow.commit()

    async def capture_from_status(self, message_id: str, recipient_user_id: str | None) -> None:
        """Los estados de entrega de la bienvenida traen el BSUID del destinatario: se guarda como
        pendiente hasta que el usuario confirme, para que un teléfono mal digitado nunca vincule a un extraño."""
        if not recipient_user_id:
            return
        async with self._uow() as uow:
            employee = await uow.employees.get_by_welcome_message_id(message_id)
            if employee is None or employee.wa_link_status == WhatsAppLinkStatus.ACTIVE:
                return
            employee.capture_pending_whatsapp_id(recipient_user_id)
            await uow.commit()

    async def confirm_welcome(self, sender: WhatsAppSender, payload: str) -> Employee | None:
        try:
            employee_id = uuid.UUID(payload.removeprefix(WELCOME_PAYLOAD_PREFIX))
        except ValueError:
            return None
        async with self._uow() as uow:
            employee = await uow.employees.get(employee_id)
            if employee is None or not employee.active or not sender.user_id:
                return None
            phone_matches = bool(sender.phone) and normalize_phone(sender.phone) == employee.phone
            pending_matches = employee.wa_pending_user_id == sender.user_id
            if not (phone_matches or pending_matches):
                logger.warning("Welcome confirmation rejected: sender does not match the invited employee")
                return None
            await self._release_bsuid(uow, sender.user_id, employee.id)
            employee.link_whatsapp(sender.user_id, self._clock.now(), accepted_privacy=True)
            await uow.audit.add(
                AuditEntry("whatsapp_linked", "employee", str(employee.id), employee.id, Channel.WHATSAPP, {"via": "welcome"})
            )
            await uow.commit()
        self._cache.set(sender.user_id, employee.id)
        return employee

    async def link_by_shared_contact(self, sender: WhatsAppSender, phones: tuple[str, ...]) -> Employee | None:
        if not sender.user_id:
            return None
        async with self._uow() as uow:
            for phone in phones:
                employee = await uow.employees.get_by_phone(normalize_phone(phone) or "")
                if employee is not None and employee.active:
                    await self._release_bsuid(uow, sender.user_id, employee.id)
                    employee.link_whatsapp(sender.user_id, self._clock.now())
                    await uow.audit.add(
                        AuditEntry(
                            "whatsapp_linked", "employee", str(employee.id), employee.id, Channel.WHATSAPP, {"via": "contact"}
                        )
                    )
                    await uow.commit()
                    self._cache.set(sender.user_id, employee.id)
                    return employee
        return None

    async def issue_link_code(self, employee_id: uuid.UUID) -> str:
        code = f"{secrets.randbelow(1_000_000):06d}"
        now = self._clock.now()
        async with self._uow() as uow:
            employee = await uow.employees.get(employee_id)
            if employee is None or not employee.active:
                raise NotFoundError("employee")
            await uow.link_codes.invalidate_for(employee_id, now)
            await uow.link_codes.add(WhatsAppLinkCode(employee_id, self._tokens.hash_opaque_token(code), now + self._code_ttl))
            await uow.commit()
        return code

    async def link_by_code(self, sender: WhatsAppSender, code: str) -> Employee | None:
        """El rate limiter del bot frena por remitente los intentos de adivinar el código."""
        if not sender.user_id or not code.isdigit():
            return None
        now = self._clock.now()
        async with self._uow() as uow:
            stored = await uow.link_codes.get_by_hash(self._tokens.hash_opaque_token(code))
            if stored is None or not stored.is_usable(now, LINK_CODE_MAX_ATTEMPTS):
                return None
            employee = await uow.employees.get(stored.employee_id)
            if employee is None or not employee.active:
                return None
            stored.used_at = now
            await self._release_bsuid(uow, sender.user_id, employee.id)
            employee.link_whatsapp(sender.user_id, now, accepted_privacy=True)
            await uow.audit.add(
                AuditEntry("whatsapp_linked", "employee", str(employee.id), employee.id, Channel.WHATSAPP, {"via": "code"})
            )
            await uow.commit()
        self._cache.set(sender.user_id, employee.id)
        return employee

    async def handle_user_id_update(self, old_user_id: str | None, new_user_id: str | None, new_phone: str | None) -> None:
        """Meta regenera el BSUID cuando el usuario cambia de número."""
        if not old_user_id or not new_user_id:
            return
        async with self._uow() as uow:
            employee = await uow.employees.get_by_wa_user_id(old_user_id)
            if employee is None:
                return
            employee.wa_user_id = new_user_id
            if new_phone:
                employee.phone = normalize_phone(new_phone)
            await uow.audit.add(AuditEntry("whatsapp_id_updated", "employee", str(employee.id), None, Channel.WHATSAPP))
            await uow.commit()
        self._cache.invalidate(old_user_id)

    async def unlink(self, employee_id: uuid.UUID, actor_id: uuid.UUID) -> None:
        async with self._uow() as uow:
            employee = await uow.employees.get(employee_id)
            if employee is None:
                raise NotFoundError("employee")
            if employee.wa_user_id:
                self._cache.invalidate(employee.wa_user_id)
            employee.unlink_whatsapp()
            await uow.audit.add(AuditEntry("whatsapp_unlinked", "employee", str(employee.id), actor_id))
            await uow.commit()

    async def reply_not_registered(self, sender: WhatsAppSender) -> None:
        if sender.user_id:
            await self._sender.request_contact_info(sender.address, msg.NOT_REGISTERED)
        else:
            await self._sender.send_text(sender.address, msg.NOT_REGISTERED_SHORT)

    @staticmethod
    async def _release_bsuid(uow: UnitOfWork, user_id: str, owner_id: uuid.UUID) -> None:
        """Un BSUID es de un solo empleado: se le quita a cualquier otro (constraint único)."""
        previous = await uow.employees.get_by_wa_user_id(user_id)
        if previous is not None and previous.id != owner_id:
            previous.unlink_whatsapp()
            await uow.audit.add(AuditEntry("whatsapp_unlinked", "employee", str(previous.id), None, Channel.WHATSAPP))
            await uow.flush()  # liberar al dueño anterior antes de que el nuevo tome el valor único
