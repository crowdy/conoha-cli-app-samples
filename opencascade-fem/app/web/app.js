// opencascade-fem/app/web/app.js
// vtk.js exposed as window.vtk by the UMD bundle in index.html.

const vtkNS = window.vtk;
const vtkFullScreenRenderWindow = vtkNS.Rendering.Misc.vtkFullScreenRenderWindow;
const vtkXMLUnstructuredGridReader = vtkNS.IO.XML.vtkXMLUnstructuredGridReader;
const vtkActor = vtkNS.Rendering.Core.vtkActor;
const vtkMapper = vtkNS.Rendering.Core.vtkMapper;
const vtkColorTransferFunction = vtkNS.Rendering.Core.vtkColorTransferFunction;
const vtkWarpVector = vtkNS.Filters.General.vtkWarpVector;
const { ColorMode, ScalarMode } = vtkNS.Rendering.Core.Mapper.Constants;

const $ = (id) => document.getElementById(id);
let catalog = [];
let warpFilter = null;
let mapper = null;
let lut = null;
let currentSource = null;  // tracks current EventSource so reruns can close it

async function loadCatalog() {
  catalog = await (await fetch("/shapes")).json();
  const sel = $("shape");
  for (const item of catalog) {
    const opt = document.createElement("option");
    opt.value = item.kind;
    opt.textContent = item.kind;
    sel.appendChild(opt);
  }
  sel.addEventListener("change", renderParams);
  renderParams();
}

function renderParams() {
  const kind = $("shape").value;
  const item = catalog.find((x) => x.kind === kind);
  const container = $("params");
  container.innerHTML = "";
  for (const [name, value] of Object.entries(item.defaults)) {
    const [min, max] = item.ranges[name];
    const wrap = document.createElement("label");
    wrap.textContent = `${name} `;
    const input = document.createElement("input");
    input.type = "number";
    input.value = value;
    input.min = min;
    input.max = max;
    input.step = (max - min) / 100;
    input.dataset.param = name;
    wrap.appendChild(input);
    container.appendChild(wrap);
  }
}

function readParams() {
  const out = {};
  for (const el of $("params").querySelectorAll("input")) {
    out[el.dataset.param] = parseFloat(el.value);
  }
  return out;
}

async function runJob() {
  if (currentSource) {
    try { currentSource.close(); } catch (_) {}
    currentSource = null;
  }
  $("run").disabled = true;
  $("log").textContent = "";
  $("progress").value = 0;

  const body = {
    shape: $("shape").value,
    params: readParams(),
    material: { E_GPa: parseFloat($("E").value), nu: parseFloat($("nu").value) },
    traction: { magnitude_MPa: parseFloat($("traction").value) },
    mesh_size: parseFloat($("mesh_size").value),
  };
  const r = await fetch("/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let detail;
    try { detail = await r.json(); } catch (_) { detail = await r.text(); }
    $("log").textContent = `Error: ${r.status} ${JSON.stringify(detail)}`;
    $("run").disabled = false;
    return;
  }
  const { job_id } = await r.json();

  const stages = ["queued", "shape", "mesh", "assemble", "solve", "postproc", "done"];
  const es = new EventSource(`/jobs/${job_id}/events`);
  currentSource = es;
  es.onmessage = async (ev) => {
    const data = JSON.parse(ev.data);
    $("log").textContent += `${data.stage}\t${data.message}\n`;
    $("progress").value = stages.indexOf(data.stage);
    if (data.stage === "done") {
      es.close();
      currentSource = null;
      await loadResult(job_id);
      $("run").disabled = false;
    } else if (data.stage === "error") {
      es.close();
      currentSource = null;
      $("run").disabled = false;
    }
  };
  es.onerror = () => { es.close(); currentSource = null; $("run").disabled = false; };
}

async function loadResult(jobId) {
  const buf = await (await fetch(`/jobs/${jobId}/result.vtu`)).arrayBuffer();
  const reader = vtkXMLUnstructuredGridReader.newInstance();
  reader.parseAsArrayBuffer(buf);
  const ds = reader.getOutputData(0);

  warpFilter = vtkWarpVector.newInstance();
  warpFilter.setInputData(ds);
  warpFilter.setScaleFactor(parseFloat($("warp").value));
  applyField();

  if (!mapper) {
    mapper = vtkMapper.newInstance();
    const actor = vtkActor.newInstance();
    actor.setMapper(mapper);
    fsrw.getRenderer().addActor(actor);
  }
  mapper.setInputConnection(warpFilter.getOutputPort());
  fsrw.getRenderer().resetCamera();
  fsrw.getRenderWindow().render();
}

function applyField() {
  if (!warpFilter) return;
  const fieldName = $("field").value;
  const ds = warpFilter.getInputData();
  const arr = ds.getPointData().getArrayByName(fieldName);
  if (!arr) return;
  ds.getPointData().setActiveScalars(fieldName);
  ds.getPointData().setActiveVectors("displacement");
  const [low, high] = arr.getRange();
  lut = vtkColorTransferFunction.newInstance();
  lut.addRGBPoint(low, 0.231, 0.298, 0.752);
  lut.addRGBPoint((low + high) / 2, 0.865, 0.865, 0.865);
  lut.addRGBPoint(high, 0.706, 0.016, 0.150);
  if (mapper) {
    mapper.setLookupTable(lut);
    mapper.setColorMode(ColorMode.MAP_SCALARS);
    mapper.setScalarMode(ScalarMode.USE_POINT_FIELD_DATA);
    if (typeof mapper.setColorByArrayName === "function") {
      mapper.setColorByArrayName(fieldName);
    }
    mapper.setScalarRange(low, high);
  }
}

$("field").addEventListener("change", applyField);
$("warp").addEventListener("input", () => {
  if (warpFilter) {
    warpFilter.setScaleFactor(parseFloat($("warp").value));
    fsrw.getRenderWindow().render();
  }
});

const fsrw = vtkFullScreenRenderWindow.newInstance({
  rootContainer: document.getElementById("canvas"),
  background: [0.95, 0.95, 0.95],
});

$("run").addEventListener("click", runJob);
loadCatalog();
