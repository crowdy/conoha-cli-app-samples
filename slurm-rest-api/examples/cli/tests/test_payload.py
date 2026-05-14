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
    assert job["partition"] == "cpu"
    assert job["cpus_per_task"] == 1
    assert job["memory_per_node"] == 128
    assert job["time_limit"] == 5
    assert "array" not in job
    assert job["current_working_directory"] == "/tmp"
    assert job["standard_output"] == "/tmp/slurm-%j.out"
    assert job["standard_error"] == "/tmp/slurm-%j.err"
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
        script_path="/data/scripts/workload.py",
    )
    assert payload["script"] == "#!/bin/bash\npython3 /data/scripts/workload.py\n"


def test_partition_override():
    payload = build_submit_payload(
        name="x",
        script_body="pass\n",
        cpus=1, memory_mb=64, time_limit_min=1,
        array=None, inline=True,
        partition="gpu",
    )
    assert payload["job"]["partition"] == "gpu"


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


def test_gres_flag_emits_tres_per_task():
    payload = build_submit_payload(
        name="g", script_body="pass\n",
        cpus=1, memory_mb=64, time_limit_min=1,
        array=None, inline=True, partition="gpu",
        gres="gpu:1",
    )
    assert payload["job"]["tres_per_task"] == "gres/gpu:1"


def test_gres_accepts_tres_form_too():
    payload = build_submit_payload(
        name="g", script_body="pass\n",
        cpus=1, memory_mb=64, time_limit_min=1,
        array=None, inline=True, partition="gpu",
        gres="gres/gpu:2",
    )
    assert payload["job"]["tres_per_task"] == "gres/gpu:2"


def test_gres_absent_means_no_tres_field():
    payload = build_submit_payload(
        name="g", script_body="pass\n",
        cpus=1, memory_mb=64, time_limit_min=1,
        array=None, inline=True,
    )
    assert "tres_per_task" not in payload["job"]
