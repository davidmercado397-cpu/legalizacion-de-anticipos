"""Archivos en Cloudflare R2 (compatible con S3). No hay almacenamiento local a propósito."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import aioboto3
from botocore.exceptions import BotoCoreError, ClientError

from app.domain.errors import ExternalServiceError, NotFoundError

logger = logging.getLogger(__name__)


def storage_reason(exc: Exception) -> str:
    """Lo que respondió R2 (código y mensaje): con eso se sabe si es la llave, el bucket o la dirección."""
    if isinstance(exc, ClientError):
        error = exc.response.get("Error", {})
        return f"{error.get('Code', '?')}: {error.get('Message', '')}".strip()
    return f"{type(exc).__name__}: {exc}"


class R2Storage:
    """Bucket privado: los archivos solo se exponen con URLs firmadas de corta duración."""

    def __init__(
        self,
        endpoint_url: str,
        bucket: str,
        access_key_id: str,
        secret_access_key: str,
        region: str,
        public_endpoint_url: str | None = None,
    ) -> None:
        self._bucket = bucket
        self._endpoint = endpoint_url
        self._public_endpoint = public_endpoint_url or endpoint_url
        self._session = aioboto3.Session(
            aws_access_key_id=access_key_id, aws_secret_access_key=secret_access_key, region_name=region
        )

    def _client(self, endpoint: str | None = None):  # type: ignore[no-untyped-def]
        return self._session.client("s3", endpoint_url=endpoint or self._endpoint)

    @asynccontextmanager
    async def _calling(self, action: str) -> AsyncIterator[Any]:
        """Un fallo de R2 (llave, bucket, red) es un error claro con su motivo en el log, no un 500."""
        try:
            async with self._client() as s3:
                yield s3
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in ("NoSuchKey", "404"):
                raise NotFoundError("file") from exc
            reason = storage_reason(exc)
            logger.warning("Storage %s failed: %s", action, reason)
            raise ExternalServiceError(f"Storage {action} failed: {reason}", code="storage_unavailable") from exc
        except BotoCoreError as exc:
            reason = storage_reason(exc)
            logger.warning("Storage %s failed: %s", action, reason)
            raise ExternalServiceError(f"Storage {action} failed: {reason}", code="storage_unavailable") from exc

    async def save(self, key: str, data: bytes, content_type: str) -> None:
        async with self._calling("save") as s3:
            await s3.put_object(Bucket=self._bucket, Key=key, Body=data, ContentType=content_type)

    async def read(self, key: str) -> bytes:
        async with self._calling("read") as s3:
            response = await s3.get_object(Bucket=self._bucket, Key=key)
            async with response["Body"] as stream:
                return await stream.read()

    async def signed_url(self, key: str, ttl_seconds: int) -> str:
        # La firma incluye el host: se firma con la dirección que va a usar el navegador.
        async with self._client(self._public_endpoint) as s3:
            return await s3.generate_presigned_url(
                "get_object", Params={"Bucket": self._bucket, "Key": key}, ExpiresIn=ttl_seconds
            )
