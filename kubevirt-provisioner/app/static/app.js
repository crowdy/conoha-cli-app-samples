const $ = (id) => document.getElementById(id);

async function refreshStatus() {
  const s = await fetch("/api/status").then((r) => r.json());
  $("status").textContent = s.available
    ? `KubeVirt ready (phase: ${s.phase})`
    : `KubeVirt initializing… (phase: ${s.phase})`;
}

async function refreshVMs() {
  const vms = await fetch("/api/vms").then((r) => r.json());
  const rows = vms.map((vm) => {
    const toggle = vm.running
      ? `<button data-act="stop" data-name="${vm.name}">Stop</button>`
      : `<button data-act="start" data-name="${vm.name}">Start</button>`;
    return `<tr>
      <td>${vm.name}</td><td>${vm.status}</td>
      <td>
        ${toggle}
        <button data-act="console" data-name="${vm.name}">Console</button>
        <button data-act="delete" data-name="${vm.name}">Delete</button>
      </td></tr>`;
  });
  $("vm-rows").innerHTML = rows.join("");
}

$("create-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("vm-name").value.trim();
  const password = $("vm-pass").value;
  const r = await fetch("/api/vms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, password }),
  });
  if (!r.ok) alert(`create failed: ${r.status} ${await r.text()}`);
  $("vm-name").value = "";
  refreshVMs();
});

let term, socket;
function openConsole(name) {
  $("console-vm").textContent = name;
  if (!term) {
    term = new Terminal({ convertEol: true });
    term.open($("term"));
  }
  term.clear();
  if (socket) socket.close();
  const proto = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${proto}://${location.host}/api/vms/${name}/console`, "plain.kubevirt.io");
  socket.binaryType = "arraybuffer";
  socket.onmessage = (ev) => term.write(new Uint8Array(ev.data));
  term.onData((d) => socket.readyState === 1 && socket.send(new TextEncoder().encode(d)));
}

$("vm-rows").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const { act, name } = btn.dataset;
  if (act === "console") return openConsole(name);
  if (act === "delete") await fetch(`/api/vms/${name}`, { method: "DELETE" });
  else await fetch(`/api/vms/${name}/${act}`, { method: "POST" });
  refreshVMs();
});

refreshStatus();
refreshVMs();
setInterval(refreshStatus, 5000);
setInterval(refreshVMs, 5000);
