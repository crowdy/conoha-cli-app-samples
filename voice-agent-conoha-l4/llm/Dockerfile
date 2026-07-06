# voice-agent-conoha-l4/llm/Dockerfile
FROM vllm/vllm-openai:v0.6.4.post1

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV LLM_MODEL=Qwen/Qwen2.5-7B-Instruct-AWQ \
    GPU_MEMORY_UTILIZATION=0.40 \
    MAX_MODEL_LEN=4096

EXPOSE 8000
ENTRYPOINT ["/entrypoint.sh"]
