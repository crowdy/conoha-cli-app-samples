FROM giovtorres/slurm-docker-cluster:25.11.4

# Thin layer adding the Python scientific stack our workload examples need.
# The base image has python3 but no numpy/sklearn — Rocky 9's default repos
# don't ship scikit-learn and the base python3 has no pip either, so install
# pip first then numpy+sklearn.
RUN dnf install -y --setopt=install_weak_deps=False python3-pip \
    && dnf clean all \
    && python3 -m pip install --no-cache-dir --break-system-packages \
        numpy scikit-learn
