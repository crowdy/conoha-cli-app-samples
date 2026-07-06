import pytest

from app.personas import PERSONAS, resolve


@pytest.mark.parametrize("mode,marker", [
    ("emergency", "救急"),
    ("military", "作戦"),
    ("callcenter", "ご注文"),
])
def test_each_mode_has_distinct_instructions(mode, marker):
    resolved_mode, instructions = resolve(mode)
    assert resolved_mode == mode
    assert marker in instructions


def test_resolve_rejects_unknown_mode():
    with pytest.raises(ValueError):
        resolve("intergalactic")


def test_all_three_modes_present():
    assert set(PERSONAS) == {"emergency", "military", "callcenter"}
