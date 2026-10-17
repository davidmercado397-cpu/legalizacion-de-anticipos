from __future__ import annotations

from typing import Any

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError

from app.adapters.outbound.storage import R2Storage
from app.domain.errors import ExternalServiceError, NotFoundError
from scripts.check_storage import config_problems, hint_for


class _S3:
    def __init__(self, error: Exception) -> None:
        self._error = error

    async def put_object(self, **_: Any) -> None:
        raise self._error

    async def get_object(self, **_: Any) -> None:
        raise self._error

    async def __aenter__(self) -> _S3:
        return self

    async def __aexit__(self, *_: object) -> None:
        return None


def _storage(error: Exception) -> R2Storage:
    storage = R2Storage("https://cuenta.r2.cloudflarestorage.com", "soportes", "llave", "secreto", "auto")
    storage._client = lambda endpoint=None: _S3(error)  # type: ignore[method-assign]
    return storage


def _client_error(code: str, message: str = "") -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": message}}, "PutObject")


async def test_a_storage_failure_is_a_clear_error_with_the_reason() -> None:
    # Antes salía como un 500 sin explicación; ahora el log dice qué revisar (llave, bucket, dirección).
    with pytest.raises(ExternalServiceError, match="SignatureDoesNotMatch: bad signature") as caught:
        await _storage(_client_error("SignatureDoesNotMatch", "bad signature")).save("k", b"x", "image/jpeg")
    assert caught.value.code == "storage_unavailable"
    with pytest.raises(ExternalServiceError, match="EndpointConnectionError"):
        await _storage(EndpointConnectionError(endpoint_url="https://x")).read("k")


async def test_a_missing_file_is_not_found() -> None:
    with pytest.raises(NotFoundError):
        await _storage(_client_error("NoSuchKey")).read("k")


@pytest.mark.parametrize(
    ("endpoint", "bucket", "expected"),
    [
        ("", "soportes", "Faltan variables: R2_ENDPOINT_URL"),
        ("cuenta.r2.cloudflarestorage.com", "soportes", "debe empezar por https://"),
        ("https://cuenta.r2.cloudflarestorage.com/soportes", "soportes", "no lleva el bucket"),
        ("https://cuenta.r2.cloudflarestorage.com", " soportes", "R2_BUCKET tiene espacios"),
    ],
)
def test_explains_a_wrong_configuration(endpoint: str, bucket: str, expected: str) -> None:
    assert any(expected in p for p in config_problems(endpoint, bucket, "llave", "secreto"))


def test_good_configuration_and_hints() -> None:
    assert config_problems("https://cuenta.r2.cloudflarestorage.com", "soportes", "llave", "secreto") == []
    assert "R2_BUCKET" in hint_for("Storage save failed: NoSuchBucket: The specified bucket does not exist")
    assert hint_for("algo raro") == ""
