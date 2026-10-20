from __future__ import annotations

from scripts.check_whatsapp import subscription_report


def test_without_subscribed_apps_the_report_says_how_to_fix_it() -> None:
    assert subscription_report([])[0].startswith("❌ Ninguna app está suscrita")
    report = subscription_report([{"whatsapp_business_api_data": {"name": "Viaticos", "id": "1"}}])
    assert report[0].startswith("✅ Apps suscritas a la cuenta: Viaticos.")
