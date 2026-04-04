import type { FractalParams, WorkerRequest, WorkerResponse } from './types';

// ── DOM refs ─────────────────────────────────────────────────────────────────

const fractalSelect    = document.getElementById('fractal-select')    as HTMLSelectElement;
const juliaSection     = document.getElementById('julia-section')     as HTMLElement;
const juliaReInput     = document.getElementById('julia-re')          as HTMLInputElement;
const juliaImInput     = document.getElementById('julia-im')          as HTMLInputElement;
const widthInput       = document.getElementById('img-width')         as HTMLInputElement;
const heightInput      = document.getElementById('img-height')        as HTMLInputElement;
const maxIterSlider    = document.getElementById('max-iter-slider')   as HTMLInputElement;
const maxIterNumber    = document.getElementById('max-iter-number')   as HTMLInputElement;
const bailoutInput     = document.getElementById('bailout')           as HTMLInputElement;
const zoomSlider       = document.getElementById('zoom-slider')       as HTMLInputElement;
const zoomDisplay      = document.getElementById('zoom-display')      as HTMLSpanElement;
const centerReInput    = document.getElementById('center-re')         as HTMLInputElement;
const centerImInput    = document.getElementById('center-im')         as HTMLInputElement;
const colorPicker      = document.getElementById('color-picker')      as HTMLInputElement;
const colorHexDisplay  = document.getElementById('color-hex')        as HTMLSpanElement;
const generateBtn      = document.getElementById('generate-btn')      as HTMLButtonElement;
const downloadBtn      = document.getElementById('download-btn')      as HTMLButtonElement;
const cancelBtn        = document.getElementById('cancel-btn')        as HTMLButtonElement;
const progressWrap     = document.getElementById('progress-wrap')     as HTMLElement;
const progressBar      = document.getElementById('progress-bar')      as HTMLProgressElement;
const progressLabel    = document.getElementById('progress-label')    as HTMLSpanElement;
const canvas           = document.getElementById('fractal-canvas')    as HTMLCanvasElement;
const canvasPlaceholder = document.getElementById('canvas-placeholder') as HTMLElement;
const statusLine       = document.getElementById('status-line')       as HTMLElement;

// ── State ─────────────────────────────────────────────────────────────────────

let activeWorker: Worker | null = null;
let renderStart = 0;

// ── Zoom helpers ──────────────────────────────────────────────────────────────

/** Slider value → zoom multiplier (log scale: 0 = 1×, 50 = 10×, -50 = 0.1×). */
function sliderToZoom(v: number): number {
  return Math.pow(10, v / 50);
}

function formatZoom(z: number): string {
  if (z >= 100)  return z.toFixed(0) + '×';
  if (z >= 10)   return z.toFixed(1) + '×';
  if (z >= 1)    return z.toFixed(2) + '×';
  return z.toFixed(3) + '×';
}

// ── Default centers per fractal type ─────────────────────────────────────────

function defaultCenter(type: string): [number, number] {
  return type === 'mandelbrot' ? [-0.75, 0] : [0, 0];
}

// ── Sync linked slider ↔ number inputs ───────────────────────────────────────

maxIterSlider.addEventListener('input', () => {
  maxIterNumber.value = maxIterSlider.value;
});
maxIterNumber.addEventListener('input', () => {
  const v = Math.max(1, Math.min(10000, parseInt(maxIterNumber.value) || 256));
  maxIterSlider.value = String(v);
  maxIterNumber.value = String(v);
});

zoomSlider.addEventListener('input', () => {
  zoomDisplay.textContent = formatZoom(sliderToZoom(parseFloat(zoomSlider.value)));
});

colorPicker.addEventListener('input', () => {
  colorHexDisplay.textContent = colorPicker.value;
});

fractalSelect.addEventListener('change', () => {
  const type = fractalSelect.value;
  juliaSection.hidden = type !== 'julia';
  // Reset center to sensible default when switching type
  const [re, im] = defaultCenter(type);
  centerReInput.value = String(re);
  centerImInput.value = String(im);
});

// ── Read current params from UI ───────────────────────────────────────────────

function readParams(): FractalParams {
  const type = fractalSelect.value as FractalParams['type'];
  return {
    type,
    width:         Math.max(1, parseInt(widthInput.value)   || 800),
    height:        Math.max(1, parseInt(heightInput.value)  || 600),
    maxIterations: Math.max(1, parseInt(maxIterNumber.value) || 256),
    bailout:       Math.max(2, parseFloat(bailoutInput.value) || 2),
    zoom:          sliderToZoom(parseFloat(zoomSlider.value)),
    centerRe:      parseFloat(centerReInput.value) || 0,
    centerIm:      parseFloat(centerImInput.value) || 0,
    baseColor:     colorPicker.value,
    juliaRe:       parseFloat(juliaReInput.value)  || -0.7,
    juliaIm:       parseFloat(juliaImInput.value)  || 0.27,
  };
}

// ── Render ────────────────────────────────────────────────────────────────────

generateBtn.addEventListener('click', () => startRender());
cancelBtn.addEventListener('click', cancelRender);

function cancelRender() {
  if (activeWorker) {
    activeWorker.terminate();
    activeWorker = null;
  }
  setRendering(false);
  statusLine.textContent = 'Cancelled.';
}

function setRendering(rendering: boolean) {
  generateBtn.disabled  = rendering;
  downloadBtn.disabled  = rendering || canvas.hidden;
  cancelBtn.hidden      = !rendering;
  progressWrap.hidden   = !rendering;
  if (!rendering) {
    progressBar.value = 0;
    progressLabel.textContent = '';
  }
}

function startRender() {
  if (activeWorker) {
    activeWorker.terminate();
    activeWorker = null;
  }

  const params = readParams();

  setRendering(true);
  canvasPlaceholder.hidden = true;
  statusLine.textContent = 'Rendering…';
  renderStart = performance.now();

  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  activeWorker = worker;

  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;

    if (msg.type === 'progress') {
      const pct = Math.round(msg.progress * 100);
      progressBar.value = msg.progress;
      progressLabel.textContent = `${pct}%`;
      return;
    }

    if (msg.type === 'done') {
      const elapsed = ((performance.now() - renderStart) / 1000).toFixed(2);

      // Reconstruct ImageData from the transferred buffer
      const imageData = new ImageData(
        new Uint8ClampedArray(msg.buffer),
        msg.width,
        msg.height,
      );

      // Draw to the single canvas
      canvas.width  = msg.width;
      canvas.height = msg.height;
      canvas.hidden = false;
      const ctx2d = canvas.getContext('2d')!;
      ctx2d.putImageData(imageData, 0, 0);

      activeWorker = null;
      setRendering(false);
      statusLine.textContent =
        `Done — ${msg.width}×${msg.height}px in ${elapsed}s`;
    }
  };

  worker.onerror = (err) => {
    console.error(err);
    activeWorker = null;
    setRendering(false);
    statusLine.textContent = `Error: ${err.message}`;
  };

  const req: WorkerRequest = { type: 'render', params };
  worker.postMessage(req);
}

// ── Download ──────────────────────────────────────────────────────────────────

downloadBtn.addEventListener('click', () => {
  if (canvas.hidden) return;

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    const type = fractalSelect.value;
    a.href     = url;
    a.download = `fractal-${type}-${canvas.width}x${canvas.height}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
});
