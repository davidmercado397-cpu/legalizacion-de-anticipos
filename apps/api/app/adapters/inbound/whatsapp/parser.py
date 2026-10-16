"""Desde la actualización de nombres de usuario de Meta (2026), cada mensaje trae el id de usuario del
negocio (`from_user_id` / `contacts[].user_id`), mientras que el teléfono (`from` / `wa_id`) puede no venir."""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Any

from app.application.whatsapp_events import InboundMessage, MessageKind, StatusUpdate, WebhookBatch
from app.domain.values import WhatsAppSender, is_bsuid

logger = logging.getLogger(__name__)

_MEDIA_TYPES = ("image", "document")
_DOCUMENT_MIME_TYPES = ("application/pdf", "image/jpeg", "image/png", "image/webp")


def parse_webhook(body: dict[str, Any]) -> WebhookBatch:
    batch = WebhookBatch()
    for entry in body.get("entry") or []:
        for change in entry.get("changes") or []:
            value = change.get("value") or {}
            contacts = value.get("contacts") or []
            for raw in value.get("messages") or []:
                try:
                    batch.messages.append(_message(raw, contacts))
                except Exception:  # noqa: BLE001 - un mensaje malformado no debe tumbar el lote
                    logger.exception("Could not parse a WhatsApp message")
            for raw in value.get("statuses") or []:
                batch.statuses.append(
                    StatusUpdate(
                        message_id=str(raw.get("id", "")),
                        status=str(raw.get("status", "")),
                        recipient_phone=raw.get("recipient_id"),
                        recipient_user_id=raw.get("recipient_user_id"),
                    )
                )
    return batch


def _sender(raw: dict[str, Any], contacts: list[dict[str, Any]]) -> WhatsAppSender:
    raw_from = raw.get("from")
    user_id = raw.get("from_user_id")
    phone = None
    if raw_from:
        if is_bsuid(raw_from):
            user_id = user_id or raw_from  # algunos payloads traen el BSUID en `from`
        else:
            phone = raw_from
    contact = _matching_contact(contacts, phone, user_id)
    profile = contact.get("profile") or {}
    return WhatsAppSender(
        user_id=user_id or contact.get("user_id"),
        phone=phone or contact.get("wa_id"),
        username=profile.get("username"),
        profile_name=profile.get("name"),
    )


def _matching_contact(contacts: list[dict[str, Any]], phone: str | None, user_id: str | None) -> dict[str, Any]:
    for contact in contacts:
        if (user_id and contact.get("user_id") == user_id) or (phone and contact.get("wa_id") == phone):
            return contact
    return contacts[0] if len(contacts) == 1 else {}


def _timestamp(raw: dict[str, Any]) -> datetime | None:
    try:
        return datetime.fromtimestamp(int(raw["timestamp"]), tz=UTC)
    except (KeyError, TypeError, ValueError):
        return None


def _flow_response(interactive: dict[str, Any]) -> dict[str, Any]:
    """`response_json` llega como texto JSON; si no se puede leer, la respuesta queda vacía y el bot la rechaza."""
    try:
        parsed = json.loads((interactive.get("nfm_reply") or {}).get("response_json") or "{}")
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _message(raw: dict[str, Any], contacts: list[dict[str, Any]]) -> InboundMessage:
    kind_raw = raw.get("type")
    base: dict[str, Any] = {
        "message_id": str(raw["id"]),
        "sender": _sender(raw, contacts),
        "timestamp": _timestamp(raw),
    }
    if kind_raw == "text":
        return InboundMessage(kind=MessageKind.TEXT, text=(raw.get("text") or {}).get("body"), **base)
    if kind_raw in _MEDIA_TYPES:
        media = raw.get(kind_raw) or {}
        mime = media.get("mime_type")
        if kind_raw == "document" and mime not in _DOCUMENT_MIME_TYPES:
            return InboundMessage(kind=MessageKind.OTHER, **base)
        return InboundMessage(kind=MessageKind.MEDIA, media_id=media.get("id"), mime_type=mime, text=media.get("caption"), **base)
    if kind_raw == "interactive":
        interactive = raw.get("interactive") or {}
        if interactive.get("type") == "nfm_reply":
            return InboundMessage(kind=MessageKind.FLOW_REPLY, flow_response=_flow_response(interactive), **base)
        reply = interactive.get("button_reply") or interactive.get("list_reply") or {}
        return InboundMessage(kind=MessageKind.REPLY, reply_id=reply.get("id"), text=reply.get("title"), **base)
    if kind_raw == "button":  # respuesta rápida de un mensaje de plantilla
        button = raw.get("button") or {}
        return InboundMessage(kind=MessageKind.REPLY, reply_id=button.get("payload"), text=button.get("text"), **base)
    if kind_raw == "contacts":
        shared = raw.get("contacts") or []
        phones: list[str] = []
        origin = raw.get("origin")
        for card in shared:
            origin = origin or card.get("origin")
            for phone in card.get("phones") or []:
                value = phone.get("wa_id") or phone.get("phone")
                if value:
                    phones.append(value)
        return InboundMessage(kind=MessageKind.CONTACTS, shared_phones=tuple(phones), contact_origin=origin, **base)
    if kind_raw == "system":
        system = raw.get("system") or {}
        if system.get("type") in ("user_id_update", "user_changed_number"):
            return InboundMessage(
                kind=MessageKind.USER_ID_UPDATE,
                new_user_id=system.get("user_id") or system.get("new_user_id"),
                new_phone=system.get("new_wa_id"),
                **base,
            )
    return InboundMessage(kind=MessageKind.OTHER, **base)
