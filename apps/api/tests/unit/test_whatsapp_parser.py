from __future__ import annotations

from app.adapters.inbound.whatsapp.parser import parse_webhook
from app.adapters.inbound.whatsapp.signature import sign, verify_signature
from app.application.whatsapp_events import MessageKind
from tests.conftest import wa_message, wa_status


def test_signature_is_checked_over_raw_bytes() -> None:
    raw = b'{"a": 1}'
    assert verify_signature(raw, sign(raw, "s3cret"), "s3cret")
    assert not verify_signature(b'{"a":1}', sign(raw, "s3cret"), "s3cret")
    assert not verify_signature(raw, None, "s3cret")
    assert not verify_signature(raw, sign(raw, "s3cret"), "")


def test_username_user_without_phone_is_identified_by_bsuid() -> None:
    batch = parse_webhook(wa_message("m1", user_id="CO.111", username="juanp", type="text", text={"body": "saldo"}))
    message = batch.messages[0]
    assert message.kind == MessageKind.TEXT and message.text == "saldo"
    assert message.sender.user_id == "CO.111" and message.sender.phone is None
    assert message.sender.username == "juanp"


def test_bsuid_in_from_field_is_not_taken_as_a_phone() -> None:
    payload = wa_message("m1", type="text", text={"body": "hola"})
    payload["entry"][0]["changes"][0]["value"]["messages"][0]["from"] = "CO.999"
    sender = parse_webhook(payload).messages[0].sender
    assert sender.user_id == "CO.999" and sender.phone is None


def test_image_document_and_unsupported_media() -> None:
    image = parse_webhook(
        wa_message("m1", phone="573001112233", user_id="CO.1", type="image", image={"id": "MEDIA1", "mime_type": "image/jpeg"})
    )
    assert image.messages[0].kind == MessageKind.MEDIA and image.messages[0].media_id == "MEDIA1"
    pdf = parse_webhook(wa_message("m2", phone="57300", type="document", document={"id": "M2", "mime_type": "application/pdf"}))
    assert pdf.messages[0].kind == MessageKind.MEDIA
    docx = parse_webhook(
        wa_message("m3", phone="57300", type="document", document={"id": "M3", "mime_type": "application/msword"})
    )
    assert docx.messages[0].kind == MessageKind.OTHER


def test_button_list_and_template_replies() -> None:
    button = parse_webhook(
        wa_message(
            "m1",
            user_id="CO.1",
            type="interactive",
            interactive={"type": "button_reply", "button_reply": {"id": "exp_confirm:1", "title": "Confirmar"}},
        )
    )
    assert button.messages[0].reply_id == "exp_confirm:1"
    row = parse_webhook(
        wa_message(
            "m2",
            user_id="CO.1",
            type="interactive",
            interactive={"type": "list_reply", "list_reply": {"id": "assign:a:b", "title": "x"}},
        )
    )
    assert row.messages[0].reply_id == "assign:a:b"
    template = parse_webhook(
        wa_message("m3", user_id="CO.1", type="button", button={"payload": "link_confirm:abc", "text": "Sí"})
    )
    assert template.messages[0].kind == MessageKind.REPLY and template.messages[0].reply_id == "link_confirm:abc"


def test_shared_contact_from_request_contact_info() -> None:
    payload = wa_message(
        "m1",
        user_id="CO.1",
        type="contacts",
        contacts=[
            {"origin": "contact_request", "phones": [{"phone": "+57 300 111 2233", "wa_id": "573001112233", "type": "MOBILE"}]}
        ],
    )
    message = parse_webhook(payload).messages[0]
    assert message.kind == MessageKind.CONTACTS
    assert message.shared_phones == ("573001112233",) and message.contact_origin == "contact_request"


def test_user_id_update_system_message() -> None:
    payload = wa_message(
        "m1", user_id="CO.old", type="system", system={"type": "user_id_update", "user_id": "CO.new", "body": "x"}
    )
    message = parse_webhook(payload).messages[0]
    assert message.kind == MessageKind.USER_ID_UPDATE and message.new_user_id == "CO.new"


def test_status_with_recipient_bsuid() -> None:
    status = parse_webhook(wa_status("wamid.1", "delivered", "573001112233", "CO.42")).statuses[0]
    assert status.message_id == "wamid.1" and status.recipient_user_id == "CO.42"


def test_flow_reply_parses_the_response_json() -> None:
    reply = {
        "type": "nfm_reply",
        "nfm_reply": {"name": "flow", "body": "Sent", "response_json": '{"flow_token": "t1", "total": "45000"}'},
    }
    message = parse_webhook(wa_message("m1", user_id="CO.1", type="interactive", interactive=reply)).messages[0]
    assert message.kind == MessageKind.FLOW_REPLY and message.flow_response == {"flow_token": "t1", "total": "45000"}
    broken = {"type": "nfm_reply", "nfm_reply": {"response_json": "no es json"}}
    message = parse_webhook(wa_message("m2", user_id="CO.1", type="interactive", interactive=broken)).messages[0]
    assert message.kind == MessageKind.FLOW_REPLY and message.flow_response == {}
