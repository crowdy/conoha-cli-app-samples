# slurm_cli.py

Python client for the deployed Slurm REST API.

## Install

```bash
cd examples/cli
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Configure

The CLI reads endpoint / token / user with this precedence:

1. CLI flags (`--endpoint`, `--token`, `--user`)
2. Env vars (`SLURM_API_ENDPOINT`, `SLURM_API_TOKEN`, `SLURM_API_USER`)
3. Files (`~/.slurm-api/endpoint`, `~/.slurm-api/token`; user defaults to `slurm`)

Typical setup after deploy:

```bash
mkdir -p ~/.slurm-api
echo "https://slurm.example.com" > ~/.slurm-api/endpoint
conoha server ssh myserver -- ./examples/get-token.sh slurm 86400 \
    > ~/.slurm-api/token
```

## Commands

```bash
./slurm_cli.py nodes
./slurm_cli.py status [JOB_ID]
./slurm_cli.py submit ../workloads/numpy_matmul.py --cpus 2 --mem 512 --inline
./slurm_cli.py submit ../workloads/hyperparam_sweep.py --array 0-4 --inline
./slurm_cli.py cancel JOB_ID
./slurm_cli.py history --limit 20
./slurm_cli.py logs   # prints SSH instructions; slurmrestd does not stream logs
```

## Tests

```bash
python -m pytest tests/ -v
```
