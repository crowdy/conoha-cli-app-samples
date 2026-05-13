import os
import pathlib
import pytest

from slurm_client.config import resolve_config, Config


def test_flags_take_precedence_over_env_and_files(tmp_path, monkeypatch):
    monkeypatch.setenv("SLURM_API_ENDPOINT", "https://from-env.example.com")
    monkeypatch.setenv("SLURM_API_TOKEN", "from-env-token")
    monkeypatch.setenv("SLURM_API_USER", "from-env-user")
    cfg = resolve_config(
        cli_endpoint="https://from-flag.example.com",
        cli_token="from-flag-token",
        cli_user="from-flag-user",
        config_dir=tmp_path,
    )
    assert cfg == Config(
        endpoint="https://from-flag.example.com",
        token="from-flag-token",
        user="from-flag-user",
    )


def test_env_takes_precedence_over_files(tmp_path, monkeypatch):
    (tmp_path / "endpoint").write_text("https://from-file.example.com\n")
    (tmp_path / "token").write_text("from-file-token\n")
    monkeypatch.setenv("SLURM_API_ENDPOINT", "https://from-env.example.com")
    monkeypatch.setenv("SLURM_API_TOKEN", "from-env-token")
    monkeypatch.delenv("SLURM_API_USER", raising=False)
    cfg = resolve_config(
        cli_endpoint=None,
        cli_token=None,
        cli_user=None,
        config_dir=tmp_path,
    )
    assert cfg.endpoint == "https://from-env.example.com"
    assert cfg.token == "from-env-token"
    assert cfg.user == "slurm"  # default


def test_files_used_when_no_flags_or_env(tmp_path, monkeypatch):
    (tmp_path / "endpoint").write_text("https://from-file.example.com\n")
    (tmp_path / "token").write_text("from-file-token\n")
    for k in ("SLURM_API_ENDPOINT", "SLURM_API_TOKEN", "SLURM_API_USER"):
        monkeypatch.delenv(k, raising=False)
    cfg = resolve_config(
        cli_endpoint=None,
        cli_token=None,
        cli_user=None,
        config_dir=tmp_path,
    )
    assert cfg.endpoint == "https://from-file.example.com"
    assert cfg.token == "from-file-token"
    assert cfg.user == "slurm"


def test_missing_endpoint_raises(tmp_path, monkeypatch):
    for k in ("SLURM_API_ENDPOINT", "SLURM_API_TOKEN", "SLURM_API_USER"):
        monkeypatch.delenv(k, raising=False)
    with pytest.raises(RuntimeError, match="endpoint"):
        resolve_config(None, None, None, config_dir=tmp_path)


def test_missing_token_raises(tmp_path, monkeypatch):
    for k in ("SLURM_API_ENDPOINT", "SLURM_API_TOKEN", "SLURM_API_USER"):
        monkeypatch.delenv(k, raising=False)
    with pytest.raises(RuntimeError, match="token"):
        resolve_config(
            cli_endpoint="https://x.example.com",
            cli_token=None,
            cli_user=None,
            config_dir=tmp_path,
        )


def test_endpoint_strips_trailing_slash(tmp_path, monkeypatch):
    monkeypatch.setenv("SLURM_API_ENDPOINT", "https://x.example.com/")
    monkeypatch.setenv("SLURM_API_TOKEN", "t")
    monkeypatch.delenv("SLURM_API_USER", raising=False)
    cfg = resolve_config(None, None, None, config_dir=tmp_path)
    assert cfg.endpoint == "https://x.example.com"
