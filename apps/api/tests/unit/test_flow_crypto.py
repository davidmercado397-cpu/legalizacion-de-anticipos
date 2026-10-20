from __future__ import annotations

import pytest

from app.adapters.inbound.whatsapp.flow_crypto import FlowCrypto, FlowDecryptionError
from tests.flow_meta import private_key_pem, seal


def test_decrypts_what_meta_sends_and_meta_can_read_the_answer() -> None:
    # En el .env la llave va en una línea con "\n" escritos.
    crypto = FlowCrypto(private_key_pem().replace("\n", "\\n"))
    sealed = seal({"action": "ping", "version": "3.0"})
    request = crypto.decrypt(sealed.body)
    assert request.payload == {"action": "ping", "version": "3.0"}
    assert sealed.open(crypto.encrypt({"data": {"status": "active"}}, request)) == {"data": {"status": "active"}}
    assert "BEGIN PUBLIC KEY" in crypto.public_key_pem()


def test_tampered_or_foreign_requests_are_rejected() -> None:
    crypto = FlowCrypto(private_key_pem())
    sealed = seal({"action": "ping"})
    with pytest.raises(FlowDecryptionError):
        crypto.decrypt({**sealed.body, "encrypted_flow_data": sealed.body["encrypted_flow_data"][:-8] + "AAAAAAA="})
    with pytest.raises(FlowDecryptionError):
        crypto.decrypt({"initial_vector": sealed.body["initial_vector"]})
