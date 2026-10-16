"""El POST lee el body CRUDO antes de parsear (el HMAC se calcula sobre esos bytes exactos), responde
200 de inmediato y procesa los eventos en background: si tardáramos, Meta reintentaría y duplicaría
eventos (la idempotencia también cubre ese caso)."""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Request, Response, status

from app.adapters.inbound.http.deps import ContainerDep
from app.adapters.inbound.whatsapp.parser import parse_webhook
from app.adapters.inbound.whatsapp.signature import verify_signature

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks/whatsapp", tags=["webhook"])


@router.get("", summary="Webhook verification (Meta handshake)")
async def verify(request: Request, container: ContainerDep) -> Response:
    params = request.query_params
    token = container.settings.WHATSAPP_VERIFY_TOKEN
    if token and params.get("hub.mode") == "subscribe" and params.get("hub.verify_token") == token:
        return Response(content=params.get("hub.challenge", ""), media_type="text/plain")
    return Response(status_code=status.HTTP_403_FORBIDDEN)


@router.post("", summary="WhatsApp events")
async def receive(request: Request, container: ContainerDep) -> Response:
    settings = container.settings
    declared = int(request.headers.get("content-length") or 0)
    if declared > settings.WEBHOOK_MAX_BODY_BYTES:
        return Response(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
    raw = await request.body()
    if len(raw) > settings.WEBHOOK_MAX_BODY_BYTES:
        return Response(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
    signature = request.headers.get("x-hub-signature-256")
    unsigned_ok = not settings.WHATSAPP_APP_SECRET and settings.APP_ENV == "development"
    if not unsigned_ok and not verify_signature(raw, signature, settings.WHATSAPP_APP_SECRET):
        logger.warning("Rejected webhook with an invalid signature")
        return Response(status_code=status.HTTP_403_FORBIDDEN)
    try:
        body = json.loads(raw)
    except json.JSONDecodeError:
        return Response(status_code=status.HTTP_200_OK)  # JSON inválido: se acusa recibo para que Meta no reintente
    batch = parse_webhook(body)
    if batch.messages or batch.statuses:
        container.tasks.spawn(lambda: container.bot.handle_batch(batch))
    return Response(status_code=status.HTTP_200_OK)
