import { readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Multi-page build: the public pages at the root plus every rendered report
// under reports/<slug>/index.html (written by scripts/render-reports.mjs).
function pages(): Record<string, string> {
  const input: Record<string, string> = {
    index: resolve(__dirname, 'index.html'),
    methodology: resolve(__dirname, 'methodology.html')
  };
  const dir = resolve(__dirname, 'reports');
  if (existsSync(dir)) {
    for (const slug of readdirSync(dir, { withFileTypes: true })) {
      if (!slug.isDirectory()) continue;
      const file = resolve(dir, slug.name, 'index.html');
      if (existsSync(file)) input[`reports/${slug.name}`] = file;
    }
  }
  return input;
}

export default defineConfig({
  build: {
    target: 'es2020',
    sourcemap: false,
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    rollupOptions: { input: pages() }
  },
  server: { host: '0.0.0.0', port: 5174, strictPort: true },
  preview: { host: '0.0.0.0', port: 4174, strictPort: true }
});
