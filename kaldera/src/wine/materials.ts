// Materials and the shared cellar environment. One glass material, one label
// material and one foil material are shared by every instanced bottle; colour
// and label tile vary per instance.
import {
  BackSide,
  BoxGeometry,
  CanvasTexture,
  Color,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PMREMGenerator,
  RepeatWrapping,
  Scene,
  type Texture,
  type WebGLRenderer
} from 'three';

// Glass tints. Filled bottles: the wine shows through flint glass, so those
// read as the wine's own colour.
export const GLASS_COLORS: Array<[Color, number]> = [
  [new Color(0x070506), 5], // Bordeaux glass full of red wine: near black
  [new Color(0x0a0608), 3], // near black with a red cast
  [new Color(0x08110a), 3], // very dark green
  [new Color(0x0c1a0e), 1.5], // antique green
  [new Color(0x160c06), 1.2], // dark amber
  [new Color(0x1f0509), 1], // garnet through flint glass
  [new Color(0x5a4820), 0.4], // white wine through flint glass
  [new Color(0x0a1414), 0.5] // blue-green
];

export const FOIL_COLORS: Array<[Color, number]> = [
  [new Color(0x8c0d18), 5], // claret red
  [new Color(0x6a0a14), 2.5], // deep burgundy
  [new Color(0x101010), 3], // black
  [new Color(0xc49a3c), 1.6], // gold
  [new Color(0x1a2e22), 0.8], // bottle green
  [new Color(0xb9b6ae), 0.7], // pewter
  [new Color(0xe4ddcb), 0.5] // ivory
];

export function pickWeighted<T>(items: Array<[T, number]>, r: number): T {
  const total = items.reduce((sum, [, w]) => sum + w, 0);
  let x = r * total;
  for (const [item, w] of items) {
    x -= w;
    if (x <= 0) return item;
  }
  return items[items.length - 1]![0];
}

// A cellar: a dark room with one long warm strip light overhead, a cool panel
// to one side and a faint floor bounce. Baked with PMREM for reflections.
export function buildEnvironment(renderer: WebGLRenderer): Texture {
  const scene = new Scene();
  const room = new Mesh(new BoxGeometry(8, 5, 8), new MeshBasicMaterial({ color: 0x0b0806, side: BackSide }));
  scene.add(room);
  const strip = new Mesh(new PlaneGeometry(1.6, 6), new MeshBasicMaterial({ color: new Color(0xfff1dc).multiplyScalar(7) }));
  strip.position.set(1.4, 2.45, 0);
  strip.rotation.x = Math.PI / 2;
  strip.rotation.z = -0.35;
  scene.add(strip);
  const strip2 = new Mesh(new PlaneGeometry(0.25, 6), new MeshBasicMaterial({ color: new Color(0xfff2dc).multiplyScalar(9) }));
  strip2.position.set(-1.4, 2.45, 0);
  strip2.rotation.x = Math.PI / 2;
  scene.add(strip2);
  const panel = new Mesh(new PlaneGeometry(2.2, 1.4), new MeshBasicMaterial({ color: new Color(0xa9c4ff).multiplyScalar(2.2) }));
  panel.position.set(-3.95, 0.6, -1.2);
  panel.rotation.y = Math.PI / 2;
  scene.add(panel);
  const panel2 = new Mesh(new PlaneGeometry(1.2, 2.8), new MeshBasicMaterial({ color: new Color(0xffe6c4).multiplyScalar(3.5) }));
  panel2.position.set(3.95, 0.2, 1.4);
  panel2.rotation.y = -Math.PI / 2;
  scene.add(panel2);
  const floor = new Mesh(new PlaneGeometry(8, 8), new MeshBasicMaterial({ color: 0x1a1410 }));
  floor.position.y = -2.49;
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const pmrem = new PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.02);
  pmrem.dispose();
  room.geometry.dispose();
  return target.texture;
}

// Condensation and handling: a sparse field of beads and fine haze in the
// roughness channel. Tiled over the glass; the texture repeats across the lathe.
export function buildRoughnessMap(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D context for the roughness map');
  const base = 16;
  ctx.fillStyle = `rgb(${base},${base},${base})`;
  ctx.fillRect(0, 0, size, size);
  let seed = 11;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // Fine haze.
  for (let i = 0; i < 2600; i++) {
    const v = base + 10 + Math.floor(rnd() * 30);
    ctx.fillStyle = `rgba(${v},${v},${v},0.5)`;
    ctx.fillRect(rnd() * size, rnd() * size, 1, 1);
  }
  // Beads, each a soft disc with a rougher rim.
  for (let i = 0; i < 180; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 1 + rnd() * rnd() * 5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(70,70,70,0.65)');
    g.addColorStop(0.7, 'rgba(120,120,120,0.9)');
    g.addColorStop(1, 'rgba(16,16,16,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(2, 3);
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  return texture;
}

export function createGlassMaterial(roughnessMap: Texture): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 1,
    roughnessMap,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.6,
    specularIntensity: 1,
    ior: 1.5
  });
}

export function createLabelMaterial(atlas: Texture): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ map: atlas, roughness: 0.78, metalness: 0, envMapIntensity: 0.35 });
  // Per-instance atlas tile: offset and scale applied to the map UV.
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aTile;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = vMapUv * aTile.zw + aTile.xy;');
  };
  material.customProgramCacheKey = () => 'wine-label';
  return material;
}

export function createFoilMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.3, envMapIntensity: 1.5 });
}

export function createHeroMaterials(label: Texture): { glass: MeshPhysicalMaterial; label: MeshStandardMaterial; foil: MeshStandardMaterial } {
  return {
    glass: new MeshPhysicalMaterial({ color: 0x050505, roughness: 0.1, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.4, ior: 1.5 }),
    label: new MeshStandardMaterial({ map: label, roughness: 0.62, metalness: 0, envMapIntensity: 0.4 }),
    foil: new MeshStandardMaterial({ color: 0x0e0e0e, metalness: 0.95, roughness: 0.3, envMapIntensity: 1.3 })
  };
}
