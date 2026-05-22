# voice-agent-conoha-l4/backend/app/sheets.py
"""Google Sheets append/update wrapper.

Errors are sanitized so service account credentials (private_key, etc.) are
never echoed back in exception messages or logs.
"""
import json
import logging

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

logger = logging.getLogger(__name__)

_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
_SHEET_TAB = "orders"


class SheetsConfigError(Exception):
    pass


class SheetsClient:
    def __init__(self, credentials_json: str, sheet_id: str) -> None:
        try:
            info = json.loads(credentials_json)
        except json.JSONDecodeError as exc:
            raise SheetsConfigError(
                f"invalid GOOGLE_APPLICATION_CREDENTIALS_JSON (parse error at pos {exc.pos})"
            ) from None

        try:
            creds = Credentials.from_service_account_info(info, scopes=_SCOPES)
        except Exception as exc:
            # exc may include parts of the private_key — never re-raise verbatim
            logger.error("service_account credentials rejected: %s", type(exc).__name__)
            raise SheetsConfigError(
                "invalid GOOGLE_APPLICATION_CREDENTIALS_JSON (missing or malformed fields)"
            ) from None

        self._svc = build("sheets", "v4", credentials=creds, cache_discovery=False)
        self._sheet_id = sheet_id

    def append_order(self, row: list[str]) -> None:
        self._svc.spreadsheets().values().append(
            spreadsheetId=self._sheet_id,
            range=f"{_SHEET_TAB}!A1",
            valueInputOption="RAW",
            body={"values": [row]},
        ).execute()

    def find_row(self, order_id: str) -> int | None:
        result = self._svc.spreadsheets().values().get(
            spreadsheetId=self._sheet_id,
            range=f"{_SHEET_TAB}!A:A",
        ).execute()
        values = result.get("values", [])
        for idx, vals in enumerate(values, start=1):
            if vals and vals[0] == order_id:
                return idx
        return None

    def update_row(self, row_number: int, row: list[str]) -> None:
        self._svc.spreadsheets().values().update(
            spreadsheetId=self._sheet_id,
            range=f"{_SHEET_TAB}!A{row_number}",
            valueInputOption="RAW",
            body={"values": [row]},
        ).execute()
