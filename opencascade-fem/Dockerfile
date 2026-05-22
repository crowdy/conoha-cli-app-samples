FROM mambaorg/micromamba:1.5-bookworm-slim AS base
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgl1 libglu1-mesa libxrender1 libxi6 libxkbcommon0 \
    && rm -rf /var/lib/apt/lists/*
USER mambauser
COPY --chown=mambauser environment.yml /tmp/env.yml
RUN micromamba install -y -n base -f /tmp/env.yml && micromamba clean -afy
ARG MAMBA_DOCKERFILE_ACTIVATE=1

WORKDIR /app
COPY --chown=mambauser app/ ./app/
COPY --chown=mambauser pyproject.toml ./
ENV PYTHONUNBUFFERED=1 \
    OCFEM_JOB_DIR=/tmp/jobs \
    OCFEM_MAX_CONCURRENT=2 \
    OCFEM_MAX_ELEMENTS=200000 \
    OCFEM_SOLVER_TIMEOUT_SECONDS=60 \
    OCFEM_JOB_TTL_SECONDS=1800
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
