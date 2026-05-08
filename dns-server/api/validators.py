"""Pure-function validators for the dns-server admin API.

These functions raise ValidationError on policy violations. They have
no IO and are exercised by the unit test suite (tests/test_validators.py).
"""

from __future__ import annotations

import ipaddress
import re
from typing import Iterable

LABEL_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")

RESERVED_LABELS = frozenset({
    "www", "api", "admin", "mail", "ns", "ns1", "ns2", "mx",
    "localhost", "root",
})

ALLOWED_TYPES = frozenset({"A", "AAAA", "CNAME", "TXT"})


class ValidationError(ValueError):
    """Raised when a name or record fails policy."""


def validate_name(name: str, parent_zone: str) -> str:
    """Return the lowercase canonical form, or raise ValidationError."""
    canonical = name.strip().lower().rstrip(".")
    parent = parent_zone.strip().lower().rstrip(".")

    if canonical == parent:
        raise ValidationError(f"name cannot equal parent zone {parent}")
    if not canonical.endswith("." + parent):
        raise ValidationError(f"name must end with .{parent}")

    own_part = canonical[: -(len(parent) + 1)]  # strip ".<parent>"
    labels = own_part.split(".")
    if not labels or labels == [""]:
        raise ValidationError("name has no labels above the parent zone")

    for label in labels:
        if not LABEL_RE.match(label):
            raise ValidationError(
                f"label '{label}' is invalid (1-63 chars, [a-z0-9-], "
                "no leading/trailing hyphen)"
            )
    if labels[0] in RESERVED_LABELS:
        raise ValidationError(f"first label '{labels[0]}' is reserved")

    return canonical


def validate_record(record: dict) -> None:
    rtype = record.get("type")
    value = record.get("value", "")
    if rtype not in ALLOWED_TYPES:
        raise ValidationError(f"type {rtype} not in {sorted(ALLOWED_TYPES)}")

    if rtype == "A":
        try:
            ipaddress.IPv4Address(value)
        except (ipaddress.AddressValueError, ValueError) as e:
            raise ValidationError(f"A record value must be IPv4: {e}")
    elif rtype == "AAAA":
        try:
            ipaddress.IPv6Address(value)
        except (ipaddress.AddressValueError, ValueError) as e:
            raise ValidationError(f"AAAA record value must be IPv6: {e}")
    elif rtype == "CNAME":
        if not value.endswith("."):
            raise ValidationError("CNAME value must have trailing dot (FQDN)")
    elif rtype == "TXT":
        if len(value.encode("utf-8")) > 255:
            raise ValidationError("TXT value exceeds 255 bytes")


def validate_records_set(records: Iterable[dict]) -> None:
    records = list(records)
    types = {r["type"] for r in records}
    if "CNAME" in types and len(types) > 1:
        raise ValidationError("CNAME cannot coexist with other record types")

    seen: set[tuple[str, str]] = set()
    for r in records:
        validate_record(r)
        key = (r["type"], r["value"])
        if key in seen:
            raise ValidationError(f"duplicate record {key}")
        seen.add(key)
