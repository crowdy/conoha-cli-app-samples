# Spike notes — kubevirt-provisioner (Phase A)

Validated on a real ConoHa VPS on 2026-06-09. Host: `kubevirt-spike` (163.44.100.31),
`g2l-t-c6m8` (6 vCPU / 8GB), Ubuntu 26.04, Docker 29.5.3 + Compose v5.1.4.
KubeVirt **v1.4.0**, k3s **v1.31.5-k3s1**.

## Headline finding: hardware KVM works — NOT emulation

ConoHa VPS3 **exposes `/dev/kvm`** (`crw-rw---- root kvm 10,232`). Passed into the k3s
container, the node advertised `devices.kubevirt.io/kvm: 1k` and the VM was allocated
`devices.kubevirt.io/kvm: 1`. Guests run with **hardware acceleration**, so the original
design assumption ("no nested virt → `useEmulation: true` → 10–100× slower") is WRONG.
Ship with `useEmulation` unset/false (KubeVirt auto-uses KVM); emulation is only a
fallback. Boot was fast: **~80s first time** (incl. containerDisk pull), **~15s on restart**.

## Confirmed checklist

- [x] **k3s flags that produce a Ready node** — `rancher/k3s:v1.31.5-k3s1`, `privileged: true`,
      `--disable traefik/servicelb/metrics-server`, `--tls-san=k3s`, `--write-kubeconfig`,
      `tmpfs: /run,/var/run`, `devices: /dev/kvm`, `volumes: /lib/modules:ro`. Node Ready in ~1 min.
- [x] **CRITICAL: virt-handler needs `/var/run` to be a SHARED mount.** Without it virt-handler is
      stuck `CreateContainerError`: *"path /var/run/kubevirt is mounted on /var/run but it is not a
      shared mount"* and KubeVirt never goes Available. Fix = run `mount --make-rshared` on `/`, `/run`,
      `/var/run` **before k3s starts**, via the container entrypoint wrapper. **Validated**: with the
      wrapper, virt-handler comes up Ready in ~5s with zero manual steps. (This was the only real
      blocker — not a generic cgroup-v2 problem.)
- [x] **KubeVirt v1.4.0 reaches `Available` / phase `Deployed`** on this k3s. No featureGates needed.
- [x] **No emulation needed** — VMI not Pending on the kvm device; KVM allocated (see headline).
- [x] **A `VirtualMachine` with `spec.running: true` (the shipped shape) reaches Running**, and
      **start/stop toggling works** (patch `spec.running` false→VMI gone in ~10s, true→Running in ~15s).
- [x] **Serial console WebSocket with the admin CLIENT CERTIFICATE works.** Connected to
      `wss://127.0.0.1:6443/apis/subresources.kubevirt.io/v1/namespaces/default/virtualmachineinstances/spike-ubuntu/console`
      with an SSL context built from the kubeconfig's CA + client cert/key, subprotocol negotiated as
      **`plain.kubevirt.io`**, and bytes flowed (got the login-prompt bytes). This is exactly the path
      `app/console.py` + the lifespan will use — auth through the aggregated `virt-api` succeeds with the
      k3s admin cert (cluster-admin RBAC). Subprotocol constant in code (`plain.kubevirt.io`) is correct.
- [x] **`--tls-san=k3s` + kubeconfig server rewrite** — the kubeconfig server is `https://127.0.0.1:6443`;
      the console test used 127.0.0.1 (in the default cert SAN). The app rewrites to `https://k3s:6443`,
      covered by `--tls-san=k3s`. (Cross-container `k3s:6443` rewrite itself to be exercised in Phase E.)
- [x] **VMI IP** = the cluster **pod IP** (e.g. `10.42.0.12`), reported via `status.interfaces`
      (`infoSource: domain`) on the **VMI** (not the VM). It is cluster-internal, not externally routable.
      Decision from review stands: **no IP column** in the UI (or label it clearly as the internal pod IP).
- [x] **Measured boot time** — ~80s first (with pull), ~15s restart. Generous UI/timeout still fine.
- [x] `spec.running` emits the deprecation warning (`use spec.runStrategy instead`) but works in v1.4.0.

## What this means for Phase E (shipped artifacts)

1. **compose.yml `k3s` service** must: be `privileged`, pass `devices: ["/dev/kvm:/dev/kvm"]`, mount
   `/lib/modules:ro`, keep `tmpfs: /run,/var/run`, AND use an **entrypoint wrapper** that runs
   `mount --make-rshared /` + `/run` + `/var/run` before `exec /bin/k3s server …`. (Proven config is in
   the spike's `compose.k3s.yml`.)
2. **KubeVirt CR**: ship with `useEmulation` unset (KVM). Keep an emulation-fallback CR documented for
   hosts without `/dev/kvm`.
3. **Spec/plan updates**: drop the "emulation / 10–100× slower" framing; guests are KVM-fast. `g2l-t-8`
   is comfortable (could even go smaller, but KVM guests + control plane still want headroom).
4. **Console**: code's path/subprotocol/auth are correct as written — no change needed.

## Reproduce

Spike files live on the VPS at `/root/spike/` (`compose.k3s.yml`, `kubevirt-cr.yaml`,
`vm-ubuntu.yaml`, `console_test.py`). SSH: `ssh -i ~/.ssh/conoha_tkim-cli-test-key
-o StrictHostKeyChecking=no root@163.44.100.31`. VPS bills while it exists — stop/delete when done.
