import pytest

from slurm_client.payload import build_submit_payload


def test_minimal_inline_payload():
    script_body = "print('hello')\n"
    payload = build_submit_payload(
        name="hello",
        script_body=script_body,
        cpus=1,
        memory_mb=128,
        time_limit_min=5,
        array=None,
        inline=True,
    )
    job = payload["job"]
    assert job["name"] == "hello"
    assert job["partition"] == "debug"
    assert job["cpus_per_task"] == 1
    assert job["memory_per_node"] == 128
    assert job["time_limit"] == 5
    assert "array" not in job
    assert job["current_working_directory"] == "/work"
    assert job["standard_output"] == "/work/logs/%j.out"
    assert job["standard_error"] == "/work/logs/%j.err"
    assert payload["script"].startswith("#!/bin/bash\n")
    assert "print('hello')" in payload["script"]


def test_array_payload_includes_array_field():
    payload = build_submit_payload(
        name="sweep",
        script_body="print('x')\n",
        cpus=1,
        memory_mb=128,
        time_limit_min=5,
        array="0-4",
        inline=True,
    )
    assert payload["job"]["array"] == "0-4"


def test_non_inline_payload_uses_file_path():
    payload = build_submit_payload(
        name="workload",
        script_body=None,
        cpus=2,
        memory_mb=512,
        time_limit_min=10,
        array=None,
        inline=False,
        script_path="/work/scripts/workload.py",
    )
    assert payload["script"] == "#!/bin/bash\npython3 /work/scripts/workload.py\n"


def test_inline_requires_script_body():
    with pytest.raises(ValueError, match="script_body"):
        build_submit_payload(
            name="x", script_body=None, cpus=1, memory_mb=128,
            time_limit_min=5, array=None, inline=True,
        )


def test_non_inline_requires_script_path():
    with pytest.raises(ValueError, match="script_path"):
        build_submit_payload(
            name="x", script_body=None, cpus=1, memory_mb=128,
            time_limit_min=5, array=None, inline=False,
        )
