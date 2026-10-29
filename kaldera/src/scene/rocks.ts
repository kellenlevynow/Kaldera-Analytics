// Boulder field: fractured blocks scattered along the crest and the upper
// walls, one merged flat-shaded mesh. Each rock is a noise-displaced
// icosahedron with its own proportions, half buried in the regolith, carrying
// the baked shade of the ground it stands on.
import { BufferAttribute, BufferGeometry, IcosahedronGeometry, Matrix4, Mesh, Quaternion, ShaderMaterial, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm2, mulberry32 } from './noise';
import { structureFragment, structureVertex } from './shaders';
import { NODE_ANGLES, padMaskAt, rimRadiusAt, sunDir, type TerrainSampler } from './terrain';

const DEG = Math.PI / 180;

export interface RockField {
  mesh: Mesh;
  material: ShaderMaterial;
  count: number;
  dispose(): void;
}

export interface RockOptions {
  count: number;
  // Horizontal distance from (x, z) to the camera path where the path is not
  // well above `top`, km. Rocks keep clear of it and shrink as it nears.
  clearance(x: number, z: number, top: number): number;
  uniforms: {
    uSunDir: { value: Vector3 };
    uEarthDir: { value: Vector3 };
    uExposure: { value: number };
    uEarthshine: { value: Vector3 };
    uFogDensity: { value: number };
  };
}

// Approximately normal deviate from a uniform generator.
function gaussian(rand: () => number): number {
  return (rand() + rand() + rand() - 1.5) * 1.6;
}

function displacedRock(radius: number, detail: number, seed: number, rand: () => number): BufferGeometry {
  const base = new IcosahedronGeometry(1, detail);
  base.deleteAttribute('uv');
  const pos = base.getAttribute('position') as BufferAttribute;
  // Proportions: flattened slabs and elongated blocks, never spheres.
  const sx = 0.7 + 0.7 * rand();
  const sy = 0.5 + 0.5 * rand();
  const sz = 0.7 + 0.7 * rand();
  // A few cleavage planes: vertices beyond a plane are pushed back onto it.
  const planes: Array<[Vector3, number]> = [];
  const planeCount = 1 + Math.floor(rand() * 3);
  for (let k = 0; k < planeCount; k++) {
    const n = new Vector3(gaussian(rand), gaussian(rand), gaussian(rand)).normalize();
    planes.push([n, 0.55 + 0.35 * rand()]);
  }
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const n = fbm2(v.x * 1.4 + seed, v.y * 1.4 + v.z * 0.9 - seed, 3);
    const m = fbm2(v.z * 3.6 - seed, v.x * 3.6 + v.y * 2.3 + seed, 3);
    const k = fbm2(v.y * 7.0 + seed * 2.0, v.x * 7.0 - v.z * 4.0, 2);
    v.multiplyScalar(1 + 0.3 * n + 0.12 * m + 0.05 * k);
    for (const [pn, d] of planes) {
      const over = v.dot(pn) - d;
      if (over > 0) v.addScaledVector(pn, -over);
    }
    pos.setXYZ(i, v.x * sx * radius, v.y * sy * radius, v.z * sz * radius);
  }
  base.computeVertexNormals();
  return base;
}

export function buildRocks(sampler: TerrainSampler, options: RockOptions): RockField {
  const rand = mulberry32(9041);
  const parts: BufferGeometry[] = [];
  const m = new Matrix4();
  const q = new Quaternion();
  const one = new Vector3(1, 1, 1);
  const up = new Vector3(0, 1, 0);
  const normal = new Vector3();
  const pads = NODE_ANGLES.map((a) => {
    const r = rimRadiusAt(a * DEG) - 0.12;
    return new Vector3(Math.cos(a * DEG) * r, 0, Math.sin(a * DEG) * r);
  });
  let placed = 0;
  let attempts = 0;
  while (placed < options.count && attempts < options.count * 12) {
    attempts++;
    const theta = rand() * Math.PI * 2;
    const rr = rimRadiusAt(theta);
    // Most rocks hug the crest; the rest spill down the inner wall or the outer flank.
    const band = rand();
    let d: number;
    if (band < 0.62) d = gaussian(rand) * 0.45;
    else if (band < 0.85) d = -0.8 - rand() * 2.2;
    else d = 0.8 + rand() * 2.6;
    const r = rr + d;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    // Size: power law, the crest holds the biggest blocks, and blocks beside
    // the camera path stay small so the eye never meets a wall of facets.
    const crestness = Math.exp(-(d * d) / 0.5);
    let size = (0.018 + 0.095 * Math.pow(rand(), 2.2)) * (0.6 + 0.6 * crestness);
    if (padMaskAt(x, z) > 0.02) continue;
    let nearPad = false;
    for (const p of pads) if (Math.hypot(x - p.x, z - p.z) < 1.1) nearPad = true;
    if (nearPad) continue;
    const ground = sampler.heightAt(x, z);
    const gap = options.clearance(x, z, ground + size * 1.6);
    if (gap < 0.25) continue;
    size = Math.min(size, 0.015 + 0.025 * gap);

    const detail = size > 0.06 ? 3 : size > 0.035 ? 2 : 1;
    const rock = displacedRock(size, detail, placed * 0.37, rand);
    // Sit on the local surface, a third buried, tilted with the slope.
    sampler.normalAt(x, z, normal);
    const y = ground + size * 0.4;
    q.setFromUnitVectors(up, normal);
    const spin = new Quaternion().setFromAxisAngle(up, rand() * Math.PI * 2);
    q.multiply(spin);
    m.compose(new Vector3(x, y, z), q, one);
    rock.applyMatrix4(m);
    // Shade from the ground at the rock and a radius sunward: a block whose
    // top clears a terrain shadow still catches the sun.
    const shadeHere = sampler.shadeAt(x, z);
    const shadeSun = sampler.shadeAt(x + sunDir.x * size * 2, z + sunDir.z * size * 2);
    const shade = Math.max(shadeHere, shadeSun * 0.85);
    const count = rock.getAttribute('position').count;
    const albedo = 0.3 + 0.12 * rand();
    rock.setAttribute('aAlbedo', new BufferAttribute(new Float32Array(count).fill(albedo), 1));
    rock.setAttribute('aShade', new BufferAttribute(new Float32Array(count).fill(shade), 1));
    parts.push(rock);
    placed++;
  }

  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('Rock merge failed');
  for (const p of parts) p.dispose();
  merged.computeBoundingSphere();
  const material = new ShaderMaterial({
    uniforms: { ...options.uniforms, uGrain: { value: 1 } },
    vertexShader: structureVertex,
    fragmentShader: structureFragment
  });
  const mesh = new Mesh(merged, material);
  mesh.frustumCulled = false;
  return {
    mesh,
    material,
    count: placed,
    dispose() {
      merged.dispose();
      material.dispose();
    }
  };
}
