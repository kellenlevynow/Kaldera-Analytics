// Replaces @dimforge/rapier3d/rapier_wasm3d.js at build time (see vite.config.ts).
// The original imports the .wasm as an ES module, which needs a bundler plugin;
// here the binary is fetched as a static asset and bound in loadRapier().
export * from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
