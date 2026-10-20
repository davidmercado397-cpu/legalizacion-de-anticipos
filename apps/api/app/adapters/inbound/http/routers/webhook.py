"""El POST lee el body CRUDO antes de parsear (el HMAC se calcula sobre esos bytes exactos), responde
200 de inmediato y procesa los eventos en background: si tardáramos, Meta reintentaría y duplicaría
eventos (la idempotencia también cubre ese caso)."""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Request, Response, status
from fastapi.responses import PlainTextResponse

from app.adapters.inbound.http.deps import ContainerDep
from app.adapters.inbound.whatsapp.flow_crypto import FlowDecryptionError
from app.adapters.inbound.whatsapp.parser import parse_webhook
from app.adapters.inbound.whatsapp.signature import verify_signature
from app.config import Settings
from app.domain.errors import AuthenticationError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks/whatsapp", tags=["webhook"])


@router.get("", summary="Webhook verification (Meta handshake)")
async def verify(request: Request, container: ContainerDep) -> Response:
    params = request.query_params
    token = container.settings.WHATSAPP_VERIFY_TOKEN
    if token and params.get("hub.mode") == "subscribe" and params.get("hub.verify_token") == token:
        return Response(content=params.get("hub.challenge", ""), media_type="text/plain")
    return Response(status_code=status.HTTP_403_FORBIDDEN)


async def _signed_body(request: Request, settings: Settings) -> bytes | Response:
    """El body crudo si su tamaño y su firma son válidos; si no, la respuesta de rechazo."""
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
    return raw


@router.post("", summary="WhatsApp events")
async def receive(request: Request, container: ContainerDep) -> Response:
    raw = await _signed_body(request, container.settings)
    if isinstance(raw, Response):
        return raw
    try:
        body = json.loads(raw)
    except json.JSONDecodeError:
        return Response(status_code=status.HTTP_200_OK)  # JSON inválido: se acusa recibo para que Meta no reintente
    batch = parse_webhook(body)
    if batch.messages or batch.statuses:
        container.tasks.spawn(lambda: container.bot.handle_batch(batch))
    return Response(status_code=status.HTTP_200_OK)


@router.post("/flows", summary="WhatsApp Flows data endpoint (encrypted)")
async def flow_data(request: Request, container: ContainerDep) -> Response:
    """Códigos que Meta entiende: 421 = no se pudo descifrar (vuelve a leer la llave pública), 427 = el
    token del Flow ya no sirve (cierra el formulario). Sin llave configurada, 503."""
    raw = await _signed_body(request, container.settings)
    if isinstance(raw, Response):
        return raw
    crypto = container.flow_crypto
    if crypto is None:
        logger.warning("WhatsApp Flows endpoint called without WHATSAPP_FLOWS_PRIVATE_KEY")
        return Response(status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
    try:
        flow_request = crypto.decrypt(json.loads(raw))
    except (json.JSONDecodeError, FlowDecryptionError):
        logger.warning("Rejected a WhatsApp Flows request that could not be decrypted")
        return Response(status_code=421)
    try:
        reply = await container.flow_exchange.handle(flow_request.payload)
    except AuthenticationError:
        return Response(status_code=427)
    return PlainTextResponse(crypto.encrypt(reply, flow_request))
