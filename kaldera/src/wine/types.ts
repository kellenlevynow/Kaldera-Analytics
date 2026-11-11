import type { QualityTier } from '../scene/types';

export interface WineTelemetry {
  depth: number; // metres below the starting eye position
  bottles: number; // bottles within reach of the camera
  layer: string; // the stratum of the pile the camera is in
  found: boolean;
}

export interface WineSceneOptions {
  canvas: HTMLCanvasElement;
  onOnline(): void;
  // The camera's own progress through the journey, each frame. It trails the scroll position.
  onProgress(progress: number): void;
  onTelemetry(telemetry: WineTelemetry): void;
  onTier(tier: QualityTier, staticMode: boolean): void;
  initialProgress?: number;
}

export interface WineDiagnostics {
  tier: QualityTier;
  bottles: number;
  visible: number;
  awake: number;
  live: number;
  progress: number;
  drawCalls: number;
  triangles: number;
  pixelRatio: number;
  avgFrameMs: number;
  physicsMs: number;
  online: boolean;
  dof: boolean;
  shadows: boolean;
}

export interface WineSceneController {
  setProgress(progress: number): void;
  pause(): void;
  resume(): void;
  diagnostics(): WineDiagnostics;
  dispose(): void;
}
