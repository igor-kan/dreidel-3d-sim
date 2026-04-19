import "./style.css";
import { DreidelSimulation } from "./sim/DreidelSimulation";
import { DREIDEL_MODELS } from "./sim/dreidelModels";
import type { DreidelResult } from "./sim/types";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("#app root element is missing");
}

app.innerHTML = `
  <div class="layout">
    <aside class="panel">
      <h1 class="title">Dreidel Physics Lab</h1>
      <p class="subtle">Real-time rigid body simulation with programmatic value reading after the dreidel settles.</p>

      <div class="control-group">
        <label>
          Dreidel Model
          <select id="model-select"></select>
        </label>

        <div class="range-row">
          <div class="range-label">
            <span>Spin Rate</span>
            <span><strong id="spin-rate-value"></strong> rad/s</span>
          </div>
          <input id="spin-rate" type="range" min="14" max="58" step="1" value="36" />
        </div>

        <div class="range-row">
          <div class="range-label">
            <span>Initial Tilt</span>
            <span><strong id="tilt-value"></strong> rad</span>
          </div>
          <input id="tilt" type="range" min="0.06" max="0.55" step="0.01" value="0.18" />
        </div>
      </div>

      <div class="actions">
        <button id="spin-btn">Spin Dreidel</button>
        <button id="reset-btn" class="secondary">Reset</button>
      </div>

      <div class="result-box" id="result-box">
        Last result: <strong>None yet</strong>
      </div>

      <pre class="code-block" id="api-preview">window.getLastDreidelResult() => null</pre>
    </aside>

    <main class="viewport" id="viewport"></main>
  </div>
`;

function requireEl<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Required element not found: ${selector}`);
  }
  return element;
}

const viewport = requireEl<HTMLElement>("#viewport");
const modelSelect = requireEl<HTMLSelectElement>("#model-select");
const spinRateInput = requireEl<HTMLInputElement>("#spin-rate");
const tiltInput = requireEl<HTMLInputElement>("#tilt");
const spinRateValue = requireEl<HTMLElement>("#spin-rate-value");
const tiltValue = requireEl<HTMLElement>("#tilt-value");
const spinButton = requireEl<HTMLButtonElement>("#spin-btn");
const resetButton = requireEl<HTMLButtonElement>("#reset-btn");
const resultBox = requireEl<HTMLElement>("#result-box");
const apiPreview = requireEl<HTMLElement>("#api-preview");

for (const model of DREIDEL_MODELS) {
  const option = document.createElement("option");
  option.value = model.key;
  option.textContent = model.label;
  modelSelect.append(option);
}

spinRateValue.textContent = spinRateInput.value;
tiltValue.textContent = Number(tiltInput.value).toFixed(2);

function renderResult(result: DreidelResult): void {
  const localTime = new Date(result.timestamp).toLocaleTimeString();
  resultBox.innerHTML =
    `Last result: <strong>${result.value}</strong>` +
    `<br />Confidence: ${(result.confidence * 100).toFixed(1)}%` +
    `<br />Rest speeds: linear ${result.linearSpeedAtRest.toFixed(3)} m/s, angular ${result.spinRateAtRest.toFixed(3)} rad/s` +
    `<br />Model: ${result.modelKey} | at ${localTime}`;

  apiPreview.textContent = `window.getLastDreidelResult() => ${JSON.stringify(result, null, 2)}`;
}

const simulation = new DreidelSimulation(viewport, (result) => {
  renderResult(result);
  window.dispatchEvent(
    new CustomEvent("dreidel:settled", {
      detail: result
    })
  );
});

modelSelect.addEventListener("change", () => {
  simulation.setModel(modelSelect.value);
  resultBox.innerHTML = "Last result: <strong>Model switched</strong>";
  apiPreview.textContent = "window.getLastDreidelResult() => null";
});

spinRateInput.addEventListener("input", () => {
  spinRateValue.textContent = spinRateInput.value;
});

tiltInput.addEventListener("input", () => {
  tiltValue.textContent = Number(tiltInput.value).toFixed(2);
});

spinButton.addEventListener("click", () => {
  const spinRate = Number(spinRateInput.value);
  const tilt = Number(tiltInput.value);
  resultBox.innerHTML = "Spinning... waiting for the dreidel to settle";
  simulation.spin({ spinRate, tilt });
});

resetButton.addEventListener("click", () => {
  simulation.reset();
  resultBox.innerHTML = "Last result: <strong>Reset complete</strong>";
  apiPreview.textContent = "window.getLastDreidelResult() => null";
});

declare global {
  interface Window {
    getLastDreidelResult: () => DreidelResult | null;
  }
}

window.getLastDreidelResult = () => simulation.getLastResult();
