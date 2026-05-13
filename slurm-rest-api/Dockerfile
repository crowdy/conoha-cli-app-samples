FROM giovtorres/slurm-docker-cluster:25.11.4

# Thin layer adding the Python runtime libs our workload examples need.
# The base image has python3 but no scientific stack.
RUN dnf install -y --setopt=install_weak_deps=False \
        python3-numpy python3-scikit-learn \
    && dnf clean all
