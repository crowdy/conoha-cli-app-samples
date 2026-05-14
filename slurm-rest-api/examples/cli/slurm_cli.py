#!/usr/bin/env python3
"""Slurm REST API CLI client.

Subcommands:
  nodes           List cluster nodes and state
  status [JOB]    Show queue (no arg) or single job
  submit SCRIPT   Submit a Python script as a Slurm job
  cancel JOB      Cancel a job
  history         List recent jobs from slurmdbd accounting
"""
from __future__ import annotations

import json
import pathlib
import sys

import click

from slurm_client.config import resolve_config
from slurm_client.fetch import fetch_result
from slurm_client.http import SlurmAPIError, SlurmClient
from slurm_client.payload import build_submit_payload


def _client(ctx: click.Context) -> SlurmClient:
    try:
        cfg = resolve_config(
            ctx.obj["_endpoint"], ctx.obj["_token"], ctx.obj["_user"]
        )
    except RuntimeError as e:
        click.echo(f"error: {e}", err=True)
        sys.exit(2)
    return SlurmClient(cfg.endpoint, cfg.token, cfg.user)


def _print_json(data) -> None:
    click.echo(json.dumps(data, indent=2, sort_keys=True))


@click.group()
@click.option("--endpoint", default=None, help="API base URL (overrides env/file)")
@click.option("--token", default=None, help="JWT token (overrides env/file)")
@click.option("--user", default=None, help="X-SLURM-USER-NAME (defaults to 'slurm')")
@click.pass_context
def cli(ctx: click.Context, endpoint, token, user) -> None:
    # Resolution deferred to _client() so --help works without config
    ctx.ensure_object(dict)
    ctx.obj["_endpoint"] = endpoint
    ctx.obj["_token"] = token
    ctx.obj["_user"] = user


@cli.command()
@click.pass_context
def nodes(ctx):
    """List cluster nodes and state."""
    try:
        data = _client(ctx).nodes()
    except SlurmAPIError as e:
        click.echo(f"error: {e}", err=True); sys.exit(1)
    rows = data.get("nodes", [])
    for n in rows:
        gres = n.get("gres") or ""
        gres_str = f" gres={gres}" if gres else ""
        click.echo(
            f"{n.get('name', '?'):<16} "
            f"state={','.join(n.get('state', []))} "
            f"cpus={n.get('cpus', '?')} "
            f"mem={n.get('real_memory', '?')}MB"
            f"{gres_str}"
        )
    if not rows:
        click.echo("(no nodes)")


@cli.command()
@click.argument("job_id", type=int, required=False)
@click.pass_context
def status(ctx, job_id):
    """Show queue or a single job's status."""
    try:
        data = _client(ctx).jobs(job_id)
    except SlurmAPIError as e:
        click.echo(f"error: {e}", err=True); sys.exit(1)
    for j in data.get("jobs", []):
        click.echo(
            f"{j.get('job_id'):<8} "
            f"{','.join(j.get('job_state', [])):<12} "
            f"{j.get('name', ''):<20} "
            f"user={j.get('user_name', '')} "
            f"part={j.get('partition', '')}"
        )


@cli.command()
@click.argument("script", type=click.Path(exists=True, dir_okay=False, path_type=pathlib.Path))
@click.option("--cpus", default=1, show_default=True, type=int)
@click.option("--mem", "memory_mb", default=256, show_default=True, type=int,
              help="Memory per node (MB)")
@click.option("--time", "time_limit_min", default=10, show_default=True, type=int,
              help="Time limit (minutes)")
@click.option("--array", default=None, help="Array spec, e.g. '0-4'")
@click.option("--name", default=None, help="Job name (defaults to script stem)")
@click.option("--partition", default="cpu", show_default=True,
              help="Slurm partition (the giovtorres image ships 'cpu' and 'gpu')")
@click.option("--gres", default=None,
              help="Generic resources, sbatch-style 'NAME:COUNT' or "
                   "'NAME:TYPE:COUNT'. E.g. 'gpu:1' or 'gpu:nvidia:1' to "
                   "request one GPU from the gpu-worker. Forwarded as "
                   "tres_per_node='gres/gpu:1' to slurmrestd.")
@click.option("--inline/--no-inline", default=True,
              help="--inline (default) embeds the Python source in the job script. "
                   "--no-inline expects /data/scripts/<script_basename> to already "
                   "exist in the cpu-worker container (docker cp it in first).")
@click.pass_context
def submit(ctx, script: pathlib.Path, cpus, memory_mb, time_limit_min,
           array, name, partition, gres, inline):
    """Submit a Python script as a Slurm job."""
    name = name or script.stem
    script_body = script.read_text() if inline else None
    script_path = None if inline else f"/data/scripts/{script.name}"
    try:
        payload = build_submit_payload(
            name=name, script_body=script_body, cpus=cpus, memory_mb=memory_mb,
            time_limit_min=time_limit_min, array=array, inline=inline,
            script_path=script_path, partition=partition, gres=gres,
        )
    except ValueError as e:
        raise click.UsageError(str(e))
    try:
        data = _client(ctx).submit(payload)
    except SlurmAPIError as e:
        click.echo(f"error: {e}", err=True); sys.exit(1)
    job_id = data.get("job_id")
    if job_id:
        click.echo(f"submitted job_id={job_id} name={name}")
    else:
        _print_json(data)


@cli.command()
@click.argument("job_id", type=int)
@click.pass_context
def cancel(ctx, job_id):
    """Cancel a job."""
    try:
        _client(ctx).cancel(job_id)
    except SlurmAPIError as e:
        click.echo(f"error: {e}", err=True); sys.exit(1)
    click.echo(f"cancelled job_id={job_id}")


@cli.command()
@click.option("--limit", default=20, show_default=True, type=int)
@click.pass_context
def history(ctx, limit):
    """List recent finished jobs from slurmdbd accounting."""
    try:
        data = _client(ctx).history(limit=limit)
    except SlurmAPIError as e:
        click.echo(f"error: {e}", err=True); sys.exit(1)
    for j in data.get("jobs", []):
        click.echo(
            f"{j.get('job_id'):<8} "
            f"{j.get('state', {}).get('current', ['?'])[0]:<12} "
            f"{j.get('name', ''):<20} "
            f"start={j.get('time', {}).get('start', 0)} "
            f"end={j.get('time', {}).get('end', 0)}"
        )


@cli.command()
@click.argument("job_id", type=int)
def logs(job_id):
    """Print the shell command to view a job's stdout (slurmrestd can't stream logs)."""
    click.echo(
        "slurmrestd does not stream logs. Run this on the VM to view stdout:\n"
        f"\n"
        f"  docker exec $(docker ps -qf label=com.docker.compose.service=cpu-worker) \\\n"
        f"      cat /tmp/slurm-{job_id}.out\n"
    )


@cli.command()
@click.argument("job_id", type=int)
@click.option("--server", required=True,
              help="conoha server name (used to resolve the VM's IPv4)")
@click.option("--identity", default=None,
              help="SSH private key path (default: ssh's own default)")
@click.option("--ssh-user", default="root", show_default=True,
              help="SSH user on the VM")
@click.option("-o", "--output", default=None,
              help="local output path (default: ./slurm-<job_id>.png)")
@click.option("--remote-path", default=None,
              help="path inside the gpu-worker container "
                   "(default: /tmp/slurm-<job_id>.png)")
def fetch(job_id, server, identity, ssh_user, output, remote_path):
    """Fetch a job's result file (e.g. a CFD plot) from the gpu-worker.

    slurmrestd cannot serve job output files, so this SSHes to the VM and
    `docker exec ... cat`s the file out of the gpu-worker container.
    """
    remote_path = remote_path or f"/tmp/slurm-{job_id}.png"
    output = output or f"slurm-{job_id}.png"
    try:
        fetch_result(
            server=server, job_id=job_id, identity=identity,
            output=output, remote_path=remote_path, ssh_user=ssh_user,
        )
    except (RuntimeError, FileNotFoundError) as e:
        click.echo(f"error: {e}", err=True)
        sys.exit(1)
    click.echo(f"fetched job {job_id} result -> {output}")


if __name__ == "__main__":
    cli()
