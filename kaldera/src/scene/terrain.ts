// Three.js side of the terrain: textures, geometry and the sampler used by
// the camera rig, the installations and the boulder field. The heavy math
// lives in heightfield.ts and normally runs in bake.worker.ts.
import { BufferAttribute, BufferGeometry, ClampToEdgeWrapping, DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, UnsignedByteType, Vector3 } from 'three';
import { SUN_ELEVATION, heightAt, sampleBakeShade, sunCos, sunSin, type BakeData, type GridData } from './heightfield';

export { CRATER_R, FLOOR_R, RIM_H, FLOOR_Y, NEAR_HALF, FAR_HALF, OUTER_R, SUN_AZIMUTH, SUN_ELEVATION, NODE_ANGLES, heightAt, padMaskAt, rimHeightAt, rimRadiusAt, bakeGridData, buildGridData } from './heightfield';
export type { BakeData, GridData, TerrainResolution } from './heightfield';

const DEG = Math.PI / 180;
export const sunDir = new Vector3(sunCos * Math.cos(SUN_ELEVATION * DEG), Math.sin(SUN_ELEVATION * DEG), sunSin * Math.cos(SUN_ELEVATION * DEG)).normalize();
export const sunRotation: [number, number] = [sunCos, sunSin];

export interface BakeGrid extends BakeData {
  texture: DataTexture;
  sampleShade(x: number, z: number): number;
}

function makeTexture(texels: Uint8Array, size: number): DataTexture {
  const texture = new DataTexture(texels, size, size, RGBAFormat, UnsignedByteType);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

export function makeBakeGrid(data: BakeData): BakeGrid {
  return {
    ...data,
    texture: makeTexture(data.texels, data.size),
    sampleShade: (x, z) => sampleBakeShade(data, x, z)
  };
}

export interface TerrainSampler {
  heightAt(x: number, z: number): number;
  shadeAt(x: number, z: number): number;
  normalAt(x: number, z: number, target: Vector3): Vector3;
}

export interface TerrainBuild {
  geometry: BufferGeometry;
  near: BakeGrid;
  sampler: TerrainSampler;
  vertexCount: number;
}

export function makeTerrainBuild(data: GridData): TerrainBuild {
  const near = makeBakeGrid(data.near);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
  geometry.setIndex(new BufferAttribute(data.indices, 1));
  geometry.computeBoundingSphere();

  const eps = 0.04;
  const sampler: TerrainSampler = {
    heightAt,
    shadeAt: (x, z) => near.sampleShade(x, z),
    normalAt(x, z, target) {
      const hx1 = heightAt(x + eps, z);
      const hx0 = heightAt(x - eps, z);
      const hz1 = heightAt(x, z + eps);
      const hz0 = heightAt(x, z - eps);
      return target.set(hx0 - hx1, 2 * eps, hz0 - hz1).normalize();
    }
  };
  return { geometry, near, sampler, vertexCount: data.vertexCount };
}
