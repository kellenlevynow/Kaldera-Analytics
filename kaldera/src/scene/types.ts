import type { MotionMode, QualityMode, Store } from '../ui/motion';
import type { Telemetry } from '../ui/hud';

export type QualityTier = 'high' | 'medium' | 'low';

export interface SceneOptions {
  canvas: HTMLCanvasElement;
  motion: Store<MotionMode>;
  quality: Store<QualityMode>;
  onOnline(): void;
  onTelemetry(telemetry: Telemetry): void;
  onTier(tier: QualityTier, staticMode: boolean): void;
  initialProgress?: number;
  initialActive?: number;
}

export interface SceneDiagnostics {
  tier: QualityTier;
  staticMode: boolean;
  drawCalls: number;
  triangles: number;
  pixelRatio: number;
  avgFrameMs: number;
  online: boolean;
  vertices: number;
}

export interface SceneController {
  setProgress(progress: number): void;
  setActive(index: number): void;
  diagnostics(): SceneDiagnostics;
  dispose(): void;
}
