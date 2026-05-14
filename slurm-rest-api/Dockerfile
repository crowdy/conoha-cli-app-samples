FROM giovtorres/slurm-docker-cluster:25.11.4

# Thin layer adding the Python scientific stack our workload examples need.
# The base image's python3 is 3.12 with no pip; bootstrap pip via ensurepip
# then install numpy + scikit-learn (neither has a Rocky 9 RPM for 3.12).
RUN python3 -m ensurepip --upgrade \
    && python3 -m pip install --no-cache-dir \
        'numpy~=2.4' 'scikit-learn~=1.8'
