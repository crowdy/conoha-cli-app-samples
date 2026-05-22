// opencascade-fem/app/web/app.js
// ESM imports via jspm.io — vtk.js v30 is ES Module; jspm handles xmlbuilder2 named exports.

import vtkFullScreenRenderWindow from "https://ga.jspm.io/npm:@kitware/vtk.js@30.10.0/Rendering/Misc/FullScreenRenderWindow.js";
import vtkXMLPolyDataReader from "https://ga.jspm.io/npm:@kitware/vtk.js@30.10.0/IO/XML/XMLPolyDataReader.js";
import vtkActor from "https://ga.jspm.io/npm:@kitware/vtk.js@30.10.0/Rendering/Core/Actor.js";
import vtkMapper from "https://ga.jspm.io/npm:@kitware/vtk.js@30.10.0/Rendering/Core/Mapper.js";
import vtkColorTransferFunction from "https://ga.jspm.io/npm:@kitware/vtk.js@30.10.0/Rendering/Core/ColorTransferFunction.js";

const $ = (id) => document.getElementById(id);
let catalog = [];
let warpScale = 50;
let actor = null;
let mapper = null;
let polydata = null;
let restPoints = null;  // original (unwarped) point coordinates
let displacementArray = null;  // (n,3) array reference for warp computation
let currentSource = null;

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
  const buf = await (await fetch(`/jobs/${jobId}/result.vtp`)).arrayBuffer();
  const reader = vtkXMLPolyDataReader.newInstance();
  reader.parseAsArrayBuffer(buf);
  polydata = reader.getOutputData(0);

  // Save the unwarped point coordinates and grab the displacement array
  restPoints = new Float32Array(polydata.getPoints().getData());
  const dispArr = polydata.getPointData().getArrayByName("displacement");
  displacementArray = dispArr ? dispArr.getData() : null;

  if (!actor) {
    mapper = vtkMapper.newInstance();
    actor = vtkActor.newInstance();
    actor.setMapper(mapper);
    fsrw.getRenderer().addActor(actor);
  }
  mapper.setInputData(polydata);

  applyField();
  applyWarp(warpScale);
  fsrw.getRenderer().resetCamera();
  fsrw.getRenderWindow().render();
}

function applyWarp(scale) {
  if (!polydata || !restPoints || !displacementArray) return;
  const pts = polydata.getPoints();
  const arr = pts.getData();
  for (let i = 0; i < restPoints.length / 3; i++) {
    arr[3 * i + 0] = restPoints[3 * i + 0] + scale * displacementArray[3 * i + 0];
    arr[3 * i + 1] = restPoints[3 * i + 1] + scale * displacementArray[3 * i + 1];
    arr[3 * i + 2] = restPoints[3 * i + 2] + scale * displacementArray[3 * i + 2];
  }
  pts.modified();
  polydata.modified();
}

function applyField() {
  if (!polydata) return;
  const fieldName = $("field").value;
  const arr = polydata.getPointData().getArrayByName(fieldName);
  if (!arr) return;
  polydata.getPointData().setActiveScalars(fieldName);
  const [low, high] = arr.getRange();
  const lut = vtkColorTransferFunction.newInstance();
  lut.addRGBPoint(low, 0.231, 0.298, 0.752);
  lut.addRGBPoint((low + high) / 2, 0.865, 0.865, 0.865);
  lut.addRGBPoint(high, 0.706, 0.016, 0.150);
  mapper.setLookupTable(lut);
  mapper.setScalarRange(low, high);
}

$("field").addEventListener("change", () => { applyField(); fsrw.getRenderWindow().render(); });
$("warp").addEventListener("input", () => {
  warpScale = parseFloat($("warp").value);
  applyWarp(warpScale);
  fsrw.getRenderWindow().render();
});

const fsrw = vtkFullScreenRenderWindow.newInstance({
  rootContainer: document.getElementById("canvas"),
  background: [0.95, 0.95, 0.95],
});

$("run").addEventListener("click", runJob);
loadCatalog();
