"""Archivos en Cloudflare R2 (compatible con S3). No hay almacenamiento local a propósito."""

from __future__ import annotations

import aioboto3

from app.domain.errors import NotFoundError


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

    async def save(self, key: str, data: bytes, content_type: str) -> None:
        async with self._client() as s3:
            await s3.put_object(Bucket=self._bucket, Key=key, Body=data, ContentType=content_type)

    async def read(self, key: str) -> bytes:
        async with self._client() as s3:
            try:
                response = await s3.get_object(Bucket=self._bucket, Key=key)
            except s3.exceptions.NoSuchKey as exc:
                raise NotFoundError("file") from exc
            async with response["Body"] as stream:
                return await stream.read()

    async def signed_url(self, key: str, ttl_seconds: int) -> str:
        # La firma incluye el host: se firma con la dirección que va a usar el navegador.
        async with self._client(self._public_endpoint) as s3:
            return await s3.generate_presigned_url(
                "get_object", Params={"Bucket": self._bucket, "Key": key}, ExpiresIn=ttl_seconds
            )
