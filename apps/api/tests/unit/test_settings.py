from __future__ import annotations

import pytest

from app.application.settings import RuntimeSettings
from app.domain.errors import ValidationError
from app.domain.settings import SettingMissingError, SettingType, SystemSetting
from tests.seed import seed_settings


def _setting(value_type: SettingType, constraints: dict | None = None) -> SystemSetting:  # type: ignore[type-arg]
    return SystemSetting("x.key", None, value_type, "test", constraints or {})


def test_values_are_validated_against_the_row_type_and_range() -> None:
    assert _setting(SettingType.INT, {"min": 1, "max": 10}).coerce("7") == 7
    assert _setting(SettingType.DECIMAL, {"min": 0, "max": 1}).coerce("0.25") == 0.25
    assert _setting(SettingType.LIST).coerce([" a ", "", "b"]) == ["a", "b"]
    assert _setting(SettingType.ENUM, {"options": ["x", "y"]}).coerce("y") == "y"
    cases = [
        (SettingType.INT, {"max": 10}, 11, "setting_max"),
        (SettingType.INT, {}, True, "setting_int"),
        (SettingType.DECIMAL, {"min": 0}, -1, "setting_min"),
        (SettingType.DECIMAL, {}, "abc", "setting_decimal"),
        (SettingType.BOOL, {}, "true", "setting_bool"),
        (SettingType.ENUM, {"options": ["x"]}, "z", "setting_options"),
        (SettingType.STRING, {"max_length": 3}, "abcd", "setting_max_length"),
        (SettingType.JSON, {}, "x", "setting_json"),
    ]
    for value_type, constraints, raw, code in cases:
        with pytest.raises(ValidationError) as error:
            _setting(value_type, constraints).coerce(raw)
        assert error.value.code == code


def test_every_key_the_code_reads_is_seeded_by_a_migration() -> None:
    seeded = {row["key"] for row in seed_settings()}
    assert set(RuntimeSettings.setting_keys()) <= seeded


def test_a_missing_key_is_reported_by_name() -> None:
    values = {row["key"]: row["value"] for row in seed_settings()}
    values.pop("ai.routing")
    with pytest.raises(SettingMissingError) as error:
        RuntimeSettings.from_values(values)
    assert error.value.key == "ai.routing"
