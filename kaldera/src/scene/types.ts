import type { Vector3 } from 'three';
import type { MotionMode, QualityMode, Store } from '../ui/motion';
import type { Telemetry } from '../ui/hud';

export type QualityTier = 'high' | 'medium' | 'low';

// Lighting uniforms shared by the terrain, the structures and the boulders,
// so one exposure change reaches every material.
export interface LightUniforms {
  uSunDir: { value: Vector3 };
  uEarthDir: { value: Vector3 };
  uExposure: { value: number };
  uEarthshine: { value: Vector3 };
  uFogDensity: { value: number };
}

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
  rocks: number;
  threaded: boolean;
}

export interface SceneController {
  setProgress(progress: number): void;
  setActive(index: number): void;
  diagnostics(): SceneDiagnostics;
  dispose(): void;
}
