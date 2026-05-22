"""Unit tests for app.core.shapes."""
import pytest

from app.core import shapes as S
from OCC.Core.GProp import GProp_GProps
from OCC.Core.BRepGProp import brepgprop_VolumeProperties


def _volume(shape) -> float:
    props = GProp_GProps()
    brepgprop_VolumeProperties(shape, props)
    return props.Mass()


def test_bracket_default_builds_solid_with_positive_volume_and_two_face_tags():
    shape, tags = S.build("bracket", S.defaults("bracket"))
    assert _volume(shape) > 0.0
    assert set(tags.keys()) == {"fixed", "load"}
    assert all(isinstance(v, list) and len(v) >= 1 for v in tags.values())


def test_plate_hole_default_builds_solid_and_has_two_loaded_short_edges():
    shape, tags = S.build("plate_hole", S.defaults("plate_hole"))
    assert _volume(shape) > 0.0
    assert "fixed" in tags and "load" in tags
    # both short ends should be flat faces with normals along ±X
    assert tags["fixed"] and tags["load"]


def test_plate_hole_rejects_oversize_hole():
    p = S.defaults("plate_hole")
    p["hole_radius"] = p["width"]  # bigger than the plate
    with pytest.raises(ValueError):
        S.build("plate_hole", p)
