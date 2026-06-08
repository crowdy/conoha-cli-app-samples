import pytest
from app.manifest import validate_name


@pytest.mark.parametrize("name", ["vm1", "my-ubuntu", "a", "a1-b2-c3"])
def test_validate_name_accepts_valid(name):
    validate_name(name)  # must not raise


@pytest.mark.parametrize("name", ["", "-leads", "trails-", "UPPER", "has_underscore", "a" * 41, "spa ce"])
def test_validate_name_rejects_invalid(name):
    with pytest.raises(ValueError):
        validate_name(name)
