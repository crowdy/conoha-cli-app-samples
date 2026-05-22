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
