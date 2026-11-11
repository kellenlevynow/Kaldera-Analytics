import type { MotionMode, QualityMode, Store } from '../ui/motion';
import type { QualityTier } from '../scene/types';

export interface WineTelemetry {
  depth: number; // metres below the starting eye position
  bottles: number; // bottles within reach of the camera
  hdg: number; // camera heading in degrees
  found: boolean;
}

export interface WineSceneOptions {
  canvas: HTMLCanvasElement;
  motion: Store<MotionMode>;
  quality: Store<QualityMode>;
  onOnline(): void;
  onSettling(fraction: number): void;
  onTelemetry(telemetry: WineTelemetry): void;
  onTier(tier: QualityTier, staticMode: boolean): void;
  initialProgress?: number;
}

export interface WineDiagnostics {
  tier: QualityTier;
  bottles: number;
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
