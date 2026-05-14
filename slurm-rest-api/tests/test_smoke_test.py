"""Unit tests for smoke_test.py pure helpers.

The smoke test itself needs a live cluster, but gpu_gres_count() is pure
and parses the slurmrestd node record's flat `gres` string — exactly the
place the GPU check is easy to get subtly wrong (empty field, bare
`gpu:N` with no type, multi-resource strings with a trailing `:0`).

Run from the slurm-rest-api/ directory: `python3 -m pytest tests/`
"""
from smoke_test import gpu_gres_count


def test_typed_gpu_gres():
    assert gpu_gres_count({"gres": "gpu:nvidia:1"}) == 1


def test_multi_gpu_gres():
    assert gpu_gres_count({"gres": "gpu:nvidia:4"}) == 4


def test_bare_gpu_gres_without_type():
    assert gpu_gres_count({"gres": "gpu:2"}) == 2


def test_zero_gpu_gres_is_zero():
    # The INVALID_REG failure mode: node registered Gres=gpu:nvidia:0.
    assert gpu_gres_count({"gres": "gpu:nvidia:0"}) == 0


def test_empty_gres_string_is_zero():
    assert gpu_gres_count({"gres": ""}) == 0


def test_missing_gres_field_is_zero():
    assert gpu_gres_count({}) == 0


def test_none_gres_field_is_zero():
    assert gpu_gres_count({"gres": None}) == 0


def test_multi_resource_string_counts_only_gpu():
    # A non-gpu entry ending in :0 must not fool the parser, and a real
    # gpu count alongside it must still be picked up.
    assert gpu_gres_count({"gres": "gpu:nvidia:1,mps:nvidia:0"}) == 1


def test_non_gpu_resource_only_is_zero():
    assert gpu_gres_count({"gres": "mps:nvidia:100"}) == 0
