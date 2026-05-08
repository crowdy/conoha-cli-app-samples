import pytest

from api.validators import (
    ValidationError,
    validate_name,
    validate_record,
    validate_records_set,
)

PARENT = "users.example.com"


class TestValidateName:
    def test_simple_subdomain(self):
        validate_name("tkim.users.example.com", PARENT)

    def test_nested_subdomain(self):
        validate_name("blog.tkim.users.example.com", PARENT)

    def test_uppercase_normalized_lowercase(self):
        assert validate_name("TKim.Users.Example.Com", PARENT) == "tkim.users.example.com"

    def test_must_end_with_parent_zone(self):
        with pytest.raises(ValidationError, match="must end with"):
            validate_name("tkim.example.com", PARENT)

    def test_cannot_equal_parent(self):
        with pytest.raises(ValidationError, match="cannot equal"):
            validate_name("users.example.com", PARENT)

    def test_reserved_label_www(self):
        with pytest.raises(ValidationError, match="reserved"):
            validate_name("www.users.example.com", PARENT)

    def test_reserved_label_admin(self):
        with pytest.raises(ValidationError, match="reserved"):
            validate_name("admin.users.example.com", PARENT)

    def test_label_too_long(self):
        long_label = "a" * 64
        with pytest.raises(ValidationError, match="label"):
            validate_name(f"{long_label}.users.example.com", PARENT)

    def test_label_with_invalid_char(self):
        with pytest.raises(ValidationError, match="label"):
            validate_name("tk_im.users.example.com", PARENT)

    def test_label_starts_with_hyphen(self):
        with pytest.raises(ValidationError, match="label"):
            validate_name("-tkim.users.example.com", PARENT)


class TestValidateRecord:
    def test_a_record_valid(self):
        validate_record({"type": "A", "value": "203.0.113.42", "ttl": 300})

    def test_a_record_invalid_ipv4(self):
        with pytest.raises(ValidationError, match="IPv4"):
            validate_record({"type": "A", "value": "not-an-ip", "ttl": 300})

    def test_a_record_rejects_ipv6(self):
        with pytest.raises(ValidationError, match="IPv4"):
            validate_record({"type": "A", "value": "2001:db8::1", "ttl": 300})

    def test_aaaa_record_valid(self):
        validate_record({"type": "AAAA", "value": "2001:db8::42", "ttl": 300})

    def test_aaaa_record_rejects_ipv4(self):
        with pytest.raises(ValidationError, match="IPv6"):
            validate_record({"type": "AAAA", "value": "203.0.113.42", "ttl": 300})

    def test_cname_record_valid_with_trailing_dot(self):
        validate_record({"type": "CNAME", "value": "tkim.users.example.com.", "ttl": 300})

    def test_cname_record_requires_trailing_dot(self):
        with pytest.raises(ValidationError, match="trailing dot"):
            validate_record({"type": "CNAME", "value": "tkim.users.example.com", "ttl": 300})

    def test_txt_record_valid(self):
        validate_record({"type": "TXT", "value": "v=spf1 -all", "ttl": 300})

    def test_txt_record_too_long(self):
        with pytest.raises(ValidationError, match="255"):
            validate_record({"type": "TXT", "value": "a" * 256, "ttl": 300})


class TestValidateRecordsSet:
    def test_multiple_a_records_allowed(self):
        validate_records_set([
            {"type": "A", "value": "203.0.113.1", "ttl": 300},
            {"type": "A", "value": "203.0.113.2", "ttl": 300},
        ])

    def test_duplicate_record_rejected(self):
        with pytest.raises(ValidationError, match="duplicate"):
            validate_records_set([
                {"type": "A", "value": "203.0.113.1", "ttl": 300},
                {"type": "A", "value": "203.0.113.1", "ttl": 300},
            ])

    def test_cname_alone_allowed(self):
        validate_records_set([
            {"type": "CNAME", "value": "tkim.users.example.com.", "ttl": 300},
        ])

    def test_cname_with_other_type_rejected(self):
        with pytest.raises(ValidationError, match="CNAME"):
            validate_records_set([
                {"type": "CNAME", "value": "tkim.users.example.com.", "ttl": 300},
                {"type": "A", "value": "203.0.113.1", "ttl": 300},
            ])
