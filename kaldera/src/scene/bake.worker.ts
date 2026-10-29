// Bake worker: runs the heightfield bakes and the mesh grid off the main
// thread so the hero intro never stutters. One job at a time, results are
// transferred, not copied.
import { FAR_HALF, bakeGridData, buildGridData, runToEnd, type TerrainResolution } from './heightfield';

export type BakeJob = { id: number; kind: 'grid'; res: TerrainResolution } | { id: number; kind: 'far'; size: number };

self.onmessage = (event: MessageEvent<BakeJob>) => {
  const job = event.data;
  if (job.kind === 'grid') {
    const data = runToEnd(buildGridData(job.res));
    const transfer = [data.near.heights.buffer, data.near.texels.buffer, data.positions.buffer, data.indices.buffer];
    self.postMessage({ id: job.id, kind: job.kind, data }, { transfer });
  } else {
    const data = runToEnd(bakeGridData(FAR_HALF, job.size));
    self.postMessage({ id: job.id, kind: job.kind, data }, { transfer: [data.heights.buffer, data.texels.buffer] });
  }
};
