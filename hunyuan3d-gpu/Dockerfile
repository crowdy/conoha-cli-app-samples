# syntax=docker/dockerfile:1.7
FROM pytorch/pytorch:2.4.0-cuda12.4-cudnn9-devel

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TORCH_CUDA_ARCH_LIST=8.9 \
    HF_HUB_ENABLE_HF_TRANSFER=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        git curl ca-certificates build-essential \
        libgl1 libglib2.0-0 libegl1 libgles2 \
        ninja-build pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ARG HUNYUAN3D_REF=f8db63096c8282cb27354314d896feba5ba6ff8a
RUN git clone https://github.com/Tencent-Hunyuan/Hunyuan3D-2.git . \
    && git checkout ${HUNYUAN3D_REF} \
    && git rev-parse HEAD > /app/.commit

RUN pip install --upgrade pip && \
    pip install -r requirements.txt && \
    pip install -e . && \
    pip install "huggingface_hub[cli]" hf_transfer

# Pre-build C++ extensions so first boot only downloads weights
RUN cd /app/hy3dgen/texgen/custom_rasterizer && python3 setup.py install \
 && cd /app/hy3dgen/texgen/differentiable_renderer && python3 setup.py install

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 7860
ENTRYPOINT ["/entrypoint.sh"]
