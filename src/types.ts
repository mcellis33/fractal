export type FractalType = 'mandelbrot' | 'julia';

export interface FractalParams {
  type: FractalType;
  width: number;
  height: number;
  maxIterations: number;
  bailout: number;
  zoom: number;
  centerRe: number;
  centerIm: number;
  baseColor: string; // CSS hex, e.g. "#2060ff"
  juliaRe: number;
  juliaIm: number;
}

// Worker message types
export interface RenderRequest {
  type: 'render';
  params: FractalParams;
}

export interface ProgressResponse {
  type: 'progress';
  progress: number; // 0–1
}

export interface DoneResponse {
  type: 'done';
  buffer: ArrayBuffer;
  width: number;
  height: number;
}

export type WorkerRequest = RenderRequest;
export type WorkerResponse = ProgressResponse | DoneResponse;
