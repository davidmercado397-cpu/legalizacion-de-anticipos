"""Destinatario: `to` cuando se conoce el teléfono; si no, `recipient` con el id de usuario del negocio
(BSUID), disponible desde julio de 2026 para quienes ocultan su número tras un nombre de usuario."""

from __future__ import annotations

import logging
from typing import Any

import httpx
from tenacity import AsyncRetrying, retry_if_exception, stop_after_attempt, wait_exponential

from app.domain.errors import ExternalServiceError
from app.domain.ports import Button, FlowMessage, ListRow
from app.domain.values import WhatsAppAddress

logger = logging.getLogger(__name__)


def _retryable(exc: BaseException) -> bool:
    if isinstance(exc, httpx.TimeoutException | httpx.TransportError):
        return True
    return isinstance(exc, httpx.HTTPStatusError) and (exc.response.status_code == 429 or exc.response.status_code >= 500)


def _recipient(to: WhatsAppAddress) -> dict[str, str]:
    return {"to": to.phone} if to.phone else {"recipient": to.user_id or ""}


def _mask(value: str | None) -> str:
    return f"…{value[-4:]}" if value else "?"


class GraphWhatsAppClient:
    def __init__(self, client: httpx.AsyncClient, base_url: str, phone_number_id: str, access_token: str) -> None:
        self._client = client
        self._messages_url = f"{base_url}/{phone_number_id}/messages"
        self._base_url = base_url
        self._headers = {"Authorization": f"Bearer {access_token}"}

    async def _request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        async for attempt in AsyncRetrying(
            retry=retry_if_exception(_retryable),
            stop=stop_after_attempt(3),
            wait=wait_exponential(multiplier=0.5, min=0.5, max=4),
            reraise=True,
        ):
            with attempt:
                response = await self._client.request(method, url, headers=self._headers, timeout=15.0, **kwargs)
                if response.status_code >= 400:
                    logger.warning("Graph API %s answered %s: %s", method, response.status_code, response.text[:300])
                response.raise_for_status()
                return response
        raise AssertionError("unreachable")

    async def _send(self, to: WhatsAppAddress, body: dict[str, Any]) -> str | None:
        payload = {"messaging_product": "whatsapp", "recipient_type": "individual", **_recipient(to), **body}
        try:
            response = await self._request("POST", self._messages_url, json=payload)
        except httpx.HTTPError as exc:
            raise ExternalServiceError(
                f"WhatsApp send failed for {_mask(to.phone or to.user_id)}", code="whatsapp_unavailable"
            ) from exc
        messages = response.json().get("messages") or [{}]
        return messages[0].get("id")

    async def send_text(self, to: WhatsAppAddress, text: str) -> str | None:
        return await self._send(to, {"type": "text", "text": {"body": text[:4096], "preview_url": False}})

    async def send_buttons(self, to: WhatsAppAddress, text: str, buttons: list[Button]) -> str | None:
        return await self._send(
            to,
            {
                "type": "interactive",
                "interactive": {
                    "type": "button",
                    "body": {"text": text[:1024]},
                    "action": {"buttons": [{"type": "reply", "reply": {"id": b.id, "title": b.title[:20]}} for b in buttons[:3]]},
                },
            },
        )

    async def send_list(self, to: WhatsAppAddress, text: str, button_label: str, rows: list[ListRow]) -> str | None:
        section_rows = []
        for row in rows[:10]:
            item = {"id": row.id, "title": row.title[:24]}
            if row.description:
                item["description"] = row.description[:72]
            section_rows.append(item)
        return await self._send(
            to,
            {
                "type": "interactive",
                "interactive": {
                    "type": "list",
                    "body": {"text": text[:1024]},
                    "action": {"button": button_label[:20], "sections": [{"title": "Opciones", "rows": section_rows}]},
                },
            },
        )

    async def send_flow(self, to: WhatsAppAddress, flow: FlowMessage) -> str | None:
        action_payload: dict[str, Any] = {"screen": flow.screen}
        if flow.data:
            action_payload["data"] = flow.data
        return await self._send(
            to,
            {
                "type": "interactive",
                "interactive": {
                    "type": "flow",
                    "body": {"text": flow.text[:1024]},
                    "action": {
                        "name": "flow",
                        "parameters": {
                            "flow_message_version": "3",
                            "flow_id": flow.flow_id,
                            "flow_token": flow.token,
                            "flow_cta": flow.cta[:30],
                            "flow_action": "navigate",
                            "flow_action_payload": action_payload,
                        },
                    },
                },
            },
        )

    async def send_template(
        self, to: WhatsAppAddress, name: str, language: str, body_params: list[str], button_payloads: list[str]
    ) -> str | None:
        components: list[dict[str, Any]] = []
        if body_params:
            components.append({"type": "body", "parameters": [{"type": "text", "text": p} for p in body_params]})
        for index, payload in enumerate(button_payloads):
            components.append(
                {
                    "type": "button",
                    "sub_type": "quick_reply",
                    "index": str(index),
                    "parameters": [{"type": "payload", "payload": payload}],
                }
            )
        return await self._send(
            to, {"type": "template", "template": {"name": name, "language": {"code": language}, "components": components}}
        )

    async def request_contact_info(self, to: WhatsAppAddress, text: str) -> str | None:
        return await self._send(
            to,
            {"type": "interactive", "interactive": {"type": "request_contact_info", "body": {"text": text[:1024]}}},
        )

    async def react(self, to: WhatsAppAddress, message_id: str, emoji: str) -> None:
        await self._send(to, {"type": "reaction", "reaction": {"message_id": message_id, "emoji": emoji}})

    async def mark_read(self, message_id: str, typing: bool = True) -> None:
        payload: dict[str, Any] = {"messaging_product": "whatsapp", "status": "read", "message_id": message_id}
        if typing:
            payload["typing_indicator"] = {"type": "text"}
        try:
            await self._request("POST", self._messages_url, json=payload)
        except httpx.HTTPError as exc:
            raise ExternalServiceError("WhatsApp mark-read failed", code="whatsapp_unavailable") from exc

    async def download(self, media_id: str) -> tuple[bytes, str]:
        """Media id -> URL temporal -> bytes. Las URLs de Meta caducan, por eso el archivo se archiva en R2 de inmediato."""
        try:
            meta = (await self._request("GET", f"{self._base_url}/{media_id}")).json()
            response = await self._request("GET", meta["url"])
        except (httpx.HTTPError, KeyError) as exc:
            raise ExternalServiceError("WhatsApp media download failed", code="whatsapp_unavailable") from exc
        return response.content, meta.get("mime_type") or response.headers.get("content-type", "application/octet-stream")
