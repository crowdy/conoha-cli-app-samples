// opencascade-fem/app/web/app.js
import "@kitware/vtk.js/Rendering/Profiles/Geometry";
import vtkFullScreenRenderWindow from "@kitware/vtk.js/Rendering/Misc/FullScreenRenderWindow";
import vtkXMLUnstructuredGridReader from "@kitware/vtk.js/IO/XML/XMLUnstructuredGridReader";
import vtkActor from "@kitware/vtk.js/Rendering/Core/Actor";
import vtkMapper from "@kitware/vtk.js/Rendering/Core/Mapper";
import vtkColorTransferFunction from "@kitware/vtk.js/Rendering/Core/ColorTransferFunction";
import vtkWarpVector from "@kitware/vtk.js/Filters/General/WarpVector";
import { ColorMode, ScalarMode } from "@kitware/vtk.js/Rendering/Core/Mapper/Constants";

const $ = (id) => document.getElementById(id);
let catalog = [];
let currentJob = null;
let warpFilter = null;
let mapper = null;
let lut = null;

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
    $("log").textContent = `Error: ${r.status} ${JSON.stringify(await r.json())}`;
    $("run").disabled = false;
    return;
  }
  const { job_id } = await r.json();
  currentJob = job_id;

  const stages = ["queued", "shape", "mesh", "assemble", "solve", "postproc", "done"];
  const es = new EventSource(`/jobs/${job_id}/events`);
  es.onmessage = async (ev) => {
    const data = JSON.parse(ev.data);
    $("log").textContent += `${data.stage}\t${data.message}\n`;
    $("progress").value = stages.indexOf(data.stage);
    if (data.stage === "done") {
      es.close();
      await loadResult(job_id);
      $("run").disabled = false;
    } else if (data.stage === "error") {
      es.close();
      $("run").disabled = false;
    }
  };
  es.onerror = () => { es.close(); $("run").disabled = false; };
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
    // setColorByArrayName may not exist in vtk.js v30; omit if browser shows an error
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
