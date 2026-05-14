"""Unit tests for slurm_client.fetch pure helpers."""
import pytest

from slurm_client.fetch import build_fetch_command


def test_basic_command_uses_label_and_remote_path():
    cmd = build_fetch_command(
        ip="203.0.113.5", identity=None,
        remote_path="/tmp/slurm-42.png", ssh_user="root",
    )
    assert cmd[0] == "ssh"
    assert "root@203.0.113.5" in cmd
    # the remote command must find the gpu-worker by compose service label
    remote = cmd[-1]
    assert "com.docker.compose.service=gpu-worker" in remote
    assert "cat /tmp/slurm-42.png" in remote


def test_identity_is_passed_as_dash_i():
    cmd = build_fetch_command(
        ip="203.0.113.5", identity="/home/u/.ssh/key",
        remote_path="/tmp/slurm-1.png", ssh_user="root",
    )
    assert "-i" in cmd
    assert cmd[cmd.index("-i") + 1] == "/home/u/.ssh/key"


def test_no_identity_omits_dash_i():
    cmd = build_fetch_command(
        ip="203.0.113.5", identity=None,
        remote_path="/tmp/slurm-1.png", ssh_user="root",
    )
    assert "-i" not in cmd


def test_custom_ssh_user():
    cmd = build_fetch_command(
        ip="203.0.113.5", identity=None,
        remote_path="/tmp/slurm-1.png", ssh_user="ubuntu",
    )
    assert "ubuntu@203.0.113.5" in cmd


def test_remote_path_is_shell_quoted():
    # a path with a space must not break the remote shell command
    cmd = build_fetch_command(
        ip="203.0.113.5", identity=None,
        remote_path="/tmp/a b.png", ssh_user="root",
    )
    assert "'/tmp/a b.png'" in cmd[-1]
