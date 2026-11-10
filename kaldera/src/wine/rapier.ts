// Loads the Rapier WebAssembly binary as a plain static asset, then binds the
// wasm-bindgen glue to it. The compat package would inline the binary as
// base64 and cost half again as much over the wire.
import * as glue from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import wasmUrl from '@dimforge/rapier3d/rapier_wasm3d_bg.wasm?url';

let ready: Promise<typeof import('@dimforge/rapier3d')> | null = null;

export function loadRapier(): Promise<typeof import('@dimforge/rapier3d')> {
  if (ready) return ready;
  ready = (async () => {
    const imports = { './rapier_wasm3d_bg.js': glue } as WebAssembly.Imports;
    let instance: WebAssembly.Instance;
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error(`Physics binary failed to load: ${response.status}`);
    if (typeof WebAssembly.instantiateStreaming === 'function' && response.headers.get('Content-Type')?.includes('application/wasm')) {
      instance = (await WebAssembly.instantiateStreaming(response, imports)).instance;
    } else {
      instance = (await WebAssembly.instantiate(await response.arrayBuffer(), imports)).instance;
    }
    (glue as unknown as { __wbg_set_wasm(exports: WebAssembly.Exports): void }).__wbg_set_wasm(instance.exports);
    return import('@dimforge/rapier3d');
  })();
  return ready;
}
