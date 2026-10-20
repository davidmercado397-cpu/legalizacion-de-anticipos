"""Eventos entrantes de WhatsApp sin acoplarse al formato de Meta: el adaptador del webhook traduce el JSON a estos."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any

from app.domain.values import WhatsAppSender


class MessageKind(StrEnum):
    TEXT = "text"
    MEDIA = "media"  # imagen o documento
    REPLY = "reply"  # quick reply, botón o selección de lista (trae un id)
    CONTACTS = "contacts"  # tarjeta de contacto que comparte el usuario (respuesta a request_contact_info)
    USER_ID_UPDATE = "user_id_update"  # BSUID regenerado (el usuario cambió de número)
    FLOW_REPLY = "flow_reply"  # respuesta de un WhatsApp Flow (formulario)
    OTHER = "other"


@dataclass(frozen=True)
class InboundMessage:
    message_id: str
    sender: WhatsAppSender
    kind: MessageKind
    timestamp: datetime | None = None
    text: str | None = None
    reply_id: str | None = None
    media_id: str | None = None
    mime_type: str | None = None
    shared_phones: tuple[str, ...] = ()
    contact_origin: str | None = None
    new_user_id: str | None = None
    new_phone: str | None = None
    flow_response: dict[str, Any] | None = None  # campos del formulario, incluido su flow_token


@dataclass(frozen=True)
class StatusUpdate:
    message_id: str
    status: str
    recipient_phone: str | None = None
    recipient_user_id: str | None = None
    error: str | None = None  # código y título del error de Meta cuando status == "failed"


@dataclass(frozen=True)
class WebhookBatch:
    messages: list[InboundMessage] = field(default_factory=list)
    statuses: list[StatusUpdate] = field(default_factory=list)
