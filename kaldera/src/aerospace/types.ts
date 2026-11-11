import type { QualityTier } from '../scene/types';

export interface AeroTelemetry {
  assembly: string; // Integrated, Separating, Exploded, Reassembling
  focus: string; // the assembly the camera is on
  separation: number; // 0 (assembled) to 1 (fully exploded)
}

export interface AeroSceneOptions {
  canvas: HTMLCanvasElement;
  reduced: boolean;
  onOnline(): void;
  // The camera's own progress through the journey, each frame. It trails the scroll position.
  onProgress(progress: number): void;
  onTelemetry(telemetry: AeroTelemetry): void;
  onTier(tier: QualityTier, staticMode: boolean): void;
  initialProgress?: number;
}

export interface AeroDiagnostics {
  tier: QualityTier;
  progress: number;
  separation: number;
  drawCalls: number;
  triangles: number;
  pixelRatio: number;
  avgFrameMs: number;
  online: boolean;
  shadows: boolean;
  reflection: boolean;
  camera: number[]; // position xyz, look-at xyz
}

export interface AeroSceneController {
  setProgress(progress: number): void;
  setReduced(reduced: boolean): void;
  pause(): void;
  resume(): void;
  diagnostics(): AeroDiagnostics;
  dispose(): void;
}
