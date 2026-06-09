# Reuse the k3s image — it ships kubectl + a shell, and is already pulled by the
# k3s service, so no extra image to fetch and the kubectl version matches.
FROM rancher/k3s:v1.31.5-k3s1
COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
