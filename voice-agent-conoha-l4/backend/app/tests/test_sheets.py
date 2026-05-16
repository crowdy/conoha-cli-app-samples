# voice-agent-conoha-l4/backend/app/tests/test_sheets.py
import pytest

from app.sheets import SheetsClient, SheetsConfigError


def test_invalid_json_raises_without_leaking_key():
    with pytest.raises(SheetsConfigError) as ei:
        SheetsClient(credentials_json="not-a-json", sheet_id="x")
    assert "private_key" not in str(ei.value)
    assert "invalid GOOGLE_APPLICATION_CREDENTIALS_JSON" in str(ei.value)


def test_missing_field_raises_without_leaking_key():
    payload = '{"type":"service_account","private_key":"-----BEGIN PRIVATE KEY-----LEAK"}'
    with pytest.raises(SheetsConfigError) as ei:
        SheetsClient(credentials_json=payload, sheet_id="x")
    assert "LEAK" not in str(ei.value)
    assert "private_key" not in str(ei.value)
