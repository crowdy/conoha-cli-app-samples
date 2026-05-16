# voice-agent-conoha-l4/agent/Dockerfile
FROM nvidia/cuda:12.4.1-runtime-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/models/hf \
    TORCH_HOME=/models/torch

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3.12 python3.12-venv python3-pip \
      ffmpeg libsndfile1 git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --break-system-packages -r requirements.txt

COPY app/ ./app/

# Pre-download Silero VAD weights at build time so cold start doesn't hit network.
RUN python3.12 -c "import torch; torch.hub.load('snakers4/silero-vad', 'silero_vad', trust_repo=True)"

# Pre-download Style-BERT-VITS2's required BERT model so cold start doesn't hit network.
# HF_HOME is already set to /models/hf above, so the cache lands in the right volume path.
RUN python3.12 -c "\
from style_bert_vits2.nlp import bert_models; \
from style_bert_vits2.constants import Languages; \
bert_models.load_model(Languages.JP, 'ku-nlp/deberta-v2-large-japanese-char-wwm'); \
bert_models.load_tokenizer(Languages.JP, 'ku-nlp/deberta-v2-large-japanese-char-wwm')"

USER ubuntu
EXPOSE 8080
CMD ["uvicorn", "app.server:app", "--host", "0.0.0.0", "--port", "8080", "--proxy-headers", "--forwarded-allow-ips", "*"]
