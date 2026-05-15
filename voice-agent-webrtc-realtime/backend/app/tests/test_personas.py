import pytest

from app.personas import resolve, PERSONAS


@pytest.mark.parametrize(
    "mode,expected_substring",
    [
        ("emergency", "救急センター"),
        ("military", "作戦司令部"),
        ("callcenter", "コールセンター"),
    ],
)
def test_resolve_returns_matching_persona(mode, expected_substring):
    resolved_mode, instructions = resolve(mode)
    assert resolved_mode == mode
    assert expected_substring in instructions


def test_resolve_unknown_mode_falls_back_to_callcenter():
    resolved_mode, instructions = resolve("bogus")
    assert resolved_mode == "callcenter"
    assert "コールセンター" in instructions


def test_all_personas_loaded():
    assert set(PERSONAS) == {"emergency", "military", "callcenter"}
    for text in PERSONAS.values():
        assert len(text) > 100
