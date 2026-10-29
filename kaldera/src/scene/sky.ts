// Stars, the Sun and the Earth. All three follow the camera so they read as
// infinitely distant.
import { AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, NormalBlending, Points, ShaderMaterial, Sprite, SpriteMaterial, SRGBColorSpace, Vector3, type PerspectiveCamera } from 'three';
import { mulberry32 } from './noise';
import { starFragment, starVertex } from './shaders';
import { sunDir } from './terrain';

const DEG = Math.PI / 180;
export const EARTH_AZIMUTH = 136;
export const EARTH_ELEVATION = 8.5;
export const earthDir = new Vector3(
  Math.cos(EARTH_AZIMUTH * DEG) * Math.cos(EARTH_ELEVATION * DEG),
  Math.sin(EARTH_ELEVATION * DEG),
  Math.sin(EARTH_AZIMUTH * DEG) * Math.cos(EARTH_ELEVATION * DEG)
).normalize();

const SKY_RADIUS = 300;
const BODY_DISTANCE = 280;

export interface Sky {
  stars: Points;
  sun: Sprite;
  earth: Sprite;
  update(camera: PerspectiveCamera): void;
  setDpr(dpr: number): void;
  dispose(): void;
}

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  return [canvas, ctx];
}

function sunTexture(): CanvasTexture {
  const size = 256;
  const [canvas, ctx] = makeCanvas(size);
  const c = size / 2;
  // Restrained glare: steep falloff, neutral white.
  const glare = ctx.createRadialGradient(c, c, 6, c, c, c);
  glare.addColorStop(0, 'rgba(255,255,255,0.42)');
  glare.addColorStop(0.08, 'rgba(255,255,255,0.18)');
  glare.addColorStop(0.2, 'rgba(255,255,255,0.07)');
  glare.addColorStop(0.45, 'rgba(255,255,255,0.02)');
  glare.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glare;
  ctx.fillRect(0, 0, size, size);
  // Hard disc.
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(c, c, 7, 0, Math.PI * 2);
  ctx.fill();
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function earthTexture(): CanvasTexture {
  const size = 256;
  const [canvas, ctx] = makeCanvas(size);
  const c = size / 2;
  const r = 100;
  // Phase: lit fraction from the angle between the Sun and the Earth as seen here.
  const phase = Math.acos(Math.max(-1, Math.min(1, sunDir.dot(earthDir))));
  const litFraction = (1 + Math.cos(phase)) / 2;
  const rand = mulberry32(11);

  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.clip();
  // Lit hemisphere: desaturated natural blue with faint cloud mottling.
  ctx.fillStyle = '#5c7596';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 260; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const rad = 3 + rand() * 16;
    ctx.fillStyle = rand() > 0.55 ? 'rgba(214,222,232,0.28)' : 'rgba(54,78,112,0.3)';
    ctx.beginPath();
    ctx.ellipse(x, y, rad * (1.2 + rand()), rad * 0.55, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // Limb darkening.
  const limb = ctx.createRadialGradient(c, c, r * 0.6, c, c, r);
  limb.addColorStop(0, 'rgba(0,0,0,0)');
  limb.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = limb;
  ctx.fillRect(0, 0, size, size);
  // Night side. Lit side faces the Sun; the Sun sits to the right of the Earth from the rim.
  const night = '#000000';
  const k = Math.abs(2 * litFraction - 1);
  ctx.fillStyle = night;
  ctx.fillRect(0, 0, c, size);
  ctx.beginPath();
  ctx.ellipse(c, c, Math.max(0.001, r * k), r, 0, 0, Math.PI * 2);
  if (litFraction >= 0.5) {
    ctx.fillStyle = '#5c7596';
    ctx.fill();
    // Re-apply mottling and limb on the recovered sliver, cheaply, with the limb only.
    ctx.fillStyle = limb;
    ctx.fill();
  } else {
    ctx.fillStyle = night;
    ctx.fill();
  }
  ctx.restore();
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function createSky(starCount: number, dpr: number): Sky {
  const rand = mulberry32(2026);
  const positions = new Float32Array(starCount * 3);
  const sizes = new Float32Array(starCount);
  const bright = new Float32Array(starCount);
  // The galactic band: a great circle tilted across the sky, holding faint,
  // dense stars so the Milky Way reads without a painted texture.
  const bandNormal = new Vector3(0.62, 0.55, -0.56).normalize();
  const bandU = new Vector3(0, 1, 0).cross(bandNormal).normalize();
  const bandV = bandNormal.clone().cross(bandU).normalize();
  const dir = new Vector3();
  for (let i = 0; i < starCount; i++) {
    const inBand = i >= Math.floor(starCount * 0.45);
    if (inBand) {
      // Along the band uniformly, across it a narrow Gaussian.
      const along = rand() * Math.PI * 2;
      const across = (rand() + rand() + rand() - 1.5) * 0.11;
      dir.copy(bandU).multiplyScalar(Math.cos(along)).addScaledVector(bandV, Math.sin(along)).addScaledVector(bandNormal, across).normalize();
      if (dir.y < 0.02) {
        dir.y = 0.02 + rand() * 0.05;
        dir.normalize();
      }
    } else {
      // Uniform on the sphere, kept above the horizon.
      const theta = rand() * Math.PI * 2;
      const y = 0.015 + (1 - 0.015) * Math.pow(rand(), 0.85);
      const s = Math.sqrt(Math.max(0, 1 - y * y));
      dir.set(Math.cos(theta) * s, y, Math.sin(theta) * s);
    }
    positions[i * 3] = dir.x * SKY_RADIUS;
    positions[i * 3 + 1] = dir.y * SKY_RADIUS;
    positions[i * 3 + 2] = dir.z * SKY_RADIUS;
    const m = Math.pow(rand(), inBand ? 4.0 : 2.6); // most stars are faint, band stars fainter still
    sizes[i] = (inBand ? 0.8 : 1.0) + m * 1.6;
    bright[i] = (inBand ? 0.14 : 0.25) + m * 0.75;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new BufferAttribute(sizes, 1));
  geometry.setAttribute('aBright', new BufferAttribute(bright, 1));
  const starMaterial = new ShaderMaterial({
    uniforms: { uDpr: { value: dpr } },
    vertexShader: starVertex,
    fragmentShader: starFragment,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: NormalBlending
  });
  const stars = new Points(geometry, starMaterial);
  stars.frustumCulled = false;
  stars.renderOrder = -10;

  const sunMaterial = new SpriteMaterial({ map: sunTexture(), transparent: true, depthWrite: false, depthTest: true, fog: false, blending: AdditiveBlending });
  const sun = new Sprite(sunMaterial);
  sun.scale.setScalar(52);
  sun.renderOrder = -5;

  const earthMaterial = new SpriteMaterial({ map: earthTexture(), transparent: true, depthWrite: false, depthTest: true, fog: false });
  const earth = new Sprite(earthMaterial);
  // Earth subtends about 1.9 degrees from the Moon; the disc is 200 of 256
  // texels. Drawn a third larger than life so the crescent reads at phone sizes.
  earth.scale.setScalar(BODY_DISTANCE * Math.tan(1.25 * DEG) * 2 * (256 / 200));
  earth.renderOrder = -6;

  const tmp = new Vector3();
  return {
    stars,
    sun,
    earth,
    update(camera) {
      stars.position.copy(camera.position);
      sun.position.copy(camera.position).add(tmp.copy(sunDir).multiplyScalar(BODY_DISTANCE));
      earth.position.copy(camera.position).add(tmp.copy(earthDir).multiplyScalar(BODY_DISTANCE));
    },
    setDpr(next) {
      starMaterial.uniforms.uDpr!.value = next;
    },
    dispose() {
      geometry.dispose();
      starMaterial.dispose();
      sunMaterial.map?.dispose();
      sunMaterial.dispose();
      earthMaterial.map?.dispose();
      earthMaterial.dispose();
    }
  };
}
