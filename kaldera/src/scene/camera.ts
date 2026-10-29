// Scroll-driven camera: centripetal Catmull-Rom through eight waypoints with a
// separate look-at spline, frame-rate independent damping, portrait FOV and a
// small damped pointer parallax.
import { CatmullRomCurve3, Vector3, type PerspectiveCamera } from 'three';
import type { Telemetry } from '../ui/hud';
import { SUN_ELEVATION, rimHeightAt, rimRadiusAt, type TerrainSampler } from './terrain';
import type { NodeAnchor } from './network';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const BASE_FOV = 42;
const PARALLAX_DEG = 1.2;
const CLEARANCE = 0.24; // km, minimum eye height above the terrain

export interface Waypoint {
  position: Vector3;
  look: Vector3;
}

function polar(angleDeg: number, radius: number, y: number): Vector3 {
  const a = angleDeg * DEG;
  return new Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius);
}

// portrait: 0 in landscape frames, 1 in a phone-tall frame. Narrow frames pull the
// node toward the centre line and lift it above the text panel.
export function buildWaypoints(sampler: TerrainSampler, nodes: NodeAnchor[], portrait = 0): Waypoint[] {
  const points: Waypoint[] = [];
  const up = new Vector3(0, 1, 0);
  const lateral = 0.62 * (1 - 0.72 * portrait);
  const lift = 0.12 - 0.3 * portrait;

  // 00 Hero: just outside the crest on the sun side, eye a little above the
  // rim blocks, looking across the bowl to the lit far wall and the highlands
  // beyond. The horizon sits in the upper quarter; the crater fills the right
  // of the frame, the foreground crest runs under the headline.
  {
    const angle = 300;
    const crest = rimHeightAt(angle * DEG);
    const radius = rimRadiusAt(angle * DEG) + 0.85;
    const ground = sampler.heightAt(Math.cos(angle * DEG) * radius, Math.sin(angle * DEG) * radius);
    const position = polar(angle, radius, Math.max(ground + 0.3, crest + 0.38));
    const look = new Vector3(0, -2.6, 0);
    const forward = look.clone().sub(position).setY(0).normalize();
    const right = forward.clone().cross(up).normalize();
    look.addScaledVector(right, 3.5 * (1 - 0.8 * portrait)).addScaledVector(forward, 12 - 5.0 * portrait);
    look.y -= 0.9 * portrait;
    points.push({ position, look });
  }

  // 01 to 06: trailing each node by 14 degrees, just outside the crest, node
  // framed on the side opposite the text panel.
  for (const node of nodes) {
    const camAngle = node.angleDeg - 12.5;
    const radius = rimRadiusAt(camAngle * DEG) + 0.65;
    const ground = sampler.heightAt(Math.cos(camAngle * DEG) * radius, Math.sin(camAngle * DEG) * radius);
    const position = polar(camAngle, radius, Math.max(ground, rimHeightAt(camAngle * DEG)) + 0.5);
    const look = node.position.clone();
    look.y += lift;
    const forward = look.clone().sub(position).normalize();
    const right = forward.clone().cross(up).normalize();
    // Node on the right of the frame means the look target moves left, and vice versa.
    look.addScaledVector(right, node.side === 'right' ? -lateral : lateral);
    points.push({ position, look });
  }

  // 07 Close: wide pull-back from the far side.
  {
    const position = polar(196, 22.0, 6.2);
    const look = new Vector3(0, -0.6, 0);
    const forward = look.clone().sub(position).setY(0).normalize();
    const right = forward.clone().cross(up).normalize();
    look.addScaledVector(right, -3.4 * (1 - 0.8 * portrait)).addScaledVector(forward, 22.0 - 5.0 * portrait);
    points.push({ position, look });
  }
  return points;
}

export class CameraRig {
  path: CatmullRomCurve3;
  lookPath: CatmullRomCurve3;
  private portrait = -1;
  target = 0;
  progress = 0;
  private parallaxTarget = { x: 0, y: 0 };
  private parallax = { x: 0, y: 0 };
  private readonly position = new Vector3();
  private readonly look = new Vector3();
  private readonly forward = new Vector3();
  readonly segments: number;

  constructor(private readonly camera: PerspectiveCamera, private readonly sampler: TerrainSampler, private readonly nodes: NodeAnchor[]) {
    const waypoints = buildWaypoints(sampler, nodes, 0);
    this.path = new CatmullRomCurve3(waypoints.map((w) => w.position), false, 'centripetal');
    this.lookPath = new CatmullRomCurve3(waypoints.map((w) => w.look), false, 'centripetal');
    this.segments = waypoints.length - 1;
    this.portrait = 0;
    this.apply();
  }

  private rebuild(portrait: number): void {
    if (Math.abs(portrait - this.portrait) < 0.02) return;
    this.portrait = portrait;
    const waypoints = buildWaypoints(this.sampler, this.nodes, portrait);
    this.path = new CatmullRomCurve3(waypoints.map((w) => w.position), false, 'centripetal');
    this.lookPath = new CatmullRomCurve3(waypoints.map((w) => w.look), false, 'centripetal');
    this.apply();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    // 1.6 and wider is a landscape frame; 0.6 and narrower is a phone-tall frame.
    this.rebuild(Math.min(1, Math.max(0, (1.6 - aspect) / 1.0)));
    // Keep the horizontal field of view of a 16:10 frame; widen in portrait so the crater stays framed.
    const halfH = Math.tan((BASE_FOV / 2) * DEG) * 1.6;
    const fov = aspect >= 1.6 ? BASE_FOV : Math.min(76, 2 * Math.atan(halfH / aspect) * RAD);
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  setParallax(x: number, y: number): void {
    this.parallaxTarget.x = Math.max(-1, Math.min(1, x));
    this.parallaxTarget.y = Math.max(-1, Math.min(1, y));
  }

  snap(progress: number): void {
    this.target = progress;
    this.progress = progress;
    this.parallax.x = this.parallaxTarget.x;
    this.parallax.y = this.parallaxTarget.y;
    this.apply();
  }

  // Returns true while the camera is still settling.
  update(dt: number): boolean {
    const k = 1 - Math.exp(-dt * 4);
    const kp = 1 - Math.exp(-dt * 6);
    const before = this.progress;
    this.progress += (this.target - this.progress) * k;
    this.parallax.x += (this.parallaxTarget.x - this.parallax.x) * kp;
    this.parallax.y += (this.parallaxTarget.y - this.parallax.y) * kp;
    this.apply();
    return Math.abs(this.progress - before) > 1e-6 || Math.abs(this.parallaxTarget.x - this.parallax.x) > 1e-4 || Math.abs(this.parallaxTarget.y - this.parallax.y) > 1e-4;
  }

  private apply(): void {
    const t = Math.min(1, Math.max(0, this.progress));
    this.path.getPoint(t, this.position);
    this.lookPath.getPoint(t, this.look);
    // The spline may dip between waypoints; keep the eye above the rim rocks.
    const ground = this.sampler.heightAt(this.position.x, this.position.z);
    if (this.position.y < ground + CLEARANCE) this.position.y = ground + CLEARANCE;
    this.camera.position.copy(this.position);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.look);
    if (this.parallax.x !== 0 || this.parallax.y !== 0) {
      this.camera.rotateY(-this.parallax.x * PARALLAX_DEG * DEG);
      this.camera.rotateX(-this.parallax.y * PARALLAX_DEG * DEG);
    }
  }

  // Horizontal distance from (x, z) to the camera path, sampled finely. Used
  // to keep boulders out of the camera's way.
  clearanceFn(samples = 600): (x: number, z: number, top: number) => number {
    const pts: number[] = [];
    const p = new Vector3();
    for (let i = 0; i <= samples; i++) {
      this.path.getPoint(i / samples, p);
      const ground = this.sampler.heightAt(p.x, p.z);
      pts.push(p.x, Math.max(p.y, ground + CLEARANCE), p.z);
    }
    // Path points well above the rock's top do not count: the eye passes over it.
    return (x, z, top) => {
      let best = Infinity;
      for (let i = 0; i < pts.length; i += 3) {
        const dx = (pts[i] ?? 0) - x;
        const dz = (pts[i + 2] ?? 0) - z;
        const d = dx * dx + dz * dz;
        if (d >= best) continue;
        const dy = (pts[i + 1] ?? 0) - top;
        // Within 0.15 km of the eye height the rock is in the way; higher up it needs less room.
        const d2 = dy > 0.15 ? d * (1 + (dy - 0.15) * 6) : d;
        if (d2 < best) best = d2;
      }
      return Math.sqrt(best);
    };
  }

  telemetry(): Telemetry {
    const pos = this.camera.position;
    const ground = this.sampler.heightAt(pos.x, pos.z);
    this.camera.getWorldDirection(this.forward);
    const pitch = Math.asin(Math.max(-1, Math.min(1, this.forward.y))) * RAD;
    const hdg = (Math.atan2(this.forward.x, -this.forward.z) * RAD + 360) % 360;
    const lit = this.sampler.shadeAt(this.look.x, this.look.z);
    const temp = 40 + (218 - 40) * lit;
    return { alt: Math.max(0, pos.y - ground), hdg, sun: SUN_ELEVATION - pitch, temp };
  }
}
