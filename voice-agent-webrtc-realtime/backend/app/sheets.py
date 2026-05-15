import json

from google.oauth2 import service_account
from googleapiclient.discovery import build

_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
_RANGE_ALL = "Orders!A:H"


class SheetsClient:
    """Thin wrapper over the Google Sheets v4 API.

    Row layout (see app.models.order_to_row):
      A order_id | B created_at | C mode | D customer_label
      E items_json | F language | G status | H notes
    """

    def __init__(self, credentials_json: str, sheet_id: str) -> None:
        # Wrap with `from None` so tracebacks never include the parsed
        # credential dict (it contains private_key). Re-raise a sanitized
        # error that's safe to log.
        try:
            info = json.loads(credentials_json)
            creds = service_account.Credentials.from_service_account_info(
                info, scopes=_SCOPES
            )
        except Exception:
            raise RuntimeError(
                "invalid GOOGLE_APPLICATION_CREDENTIALS_JSON"
            ) from None
        self._svc = build("sheets", "v4", credentials=creds, cache_discovery=False)
        self._sheet_id = sheet_id

    def append_order(self, row: list[str]) -> None:
        self._svc.spreadsheets().values().append(
            spreadsheetId=self._sheet_id,
            range=_RANGE_ALL,
            valueInputOption="USER_ENTERED",
            insertDataOption="INSERT_ROWS",
            body={"values": [row]},
        ).execute()

    def find_row(self, order_id: str) -> int | None:
        """Return the 1-based row number whose column A equals order_id."""
        resp = (
            self._svc.spreadsheets()
            .values()
            .get(spreadsheetId=self._sheet_id, range="Orders!A:A")
            .execute()
        )
        for idx, row in enumerate(resp.get("values", [])):
            if row and row[0] == order_id:
                return idx + 1
        return None

    def update_row(self, row_number: int, row: list[str]) -> None:
        self._svc.spreadsheets().values().update(
            spreadsheetId=self._sheet_id,
            range=f"Orders!A{row_number}:H{row_number}",
            valueInputOption="USER_ENTERED",
            body={"values": [row]},
        ).execute()
