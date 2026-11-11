import { defineConfig, type Plugin } from 'vite';
import { site } from './src/site.config';

// Replaces %SITE_*% tokens in index.html with values from src/site.config.ts,
// so the owner edits one file when the domain and contact email are final.
function siteTokens(): Plugin {
  const tokens: Record<string, string> = {
    '%SITE_URL%': site.url,
    '%SITE_EMAIL%': site.email,
    '%SITE_DESCRIPTION%': site.description,
    '%WINE_DESCRIPTION%': site.wine.description
  };
  return {
    name: 'kaldera-site-tokens',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return Object.entries(tokens).reduce((out, [key, value]) => out.split(key).join(value), html);
      }
    }
  };
}

// Inlines each page's built stylesheet into its HTML so first paint needs no
// extra round trip. The CSS is small (a few KB gzipped) and the headline is
// the LCP element on both pages.
function inlineCss(): Plugin {
  return {
    name: 'kaldera-inline-css',
    enforce: 'post',
    apply: 'build',
    generateBundle(_options, bundle) {
      const pages = Object.values(bundle).filter((item) => item.type === 'asset' && item.fileName.endsWith('.html'));
      const scripts = Object.values(bundle).filter((item) => item.type === 'chunk');
      for (const [name, item] of Object.entries(bundle)) {
        if (item.type !== 'asset' || !name.endsWith('.css')) continue;
        const css = typeof item.source === 'string' ? item.source : new TextDecoder().decode(item.source);
        const tag = new RegExp(`<link[^>]+href="/${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`);
        let used = false;
        for (const html of pages) {
          if (html.type !== 'asset' || typeof html.source !== 'string' || !tag.test(html.source)) continue;
          html.source = html.source.replace(tag, `<style>${css}</style>`);
          used = true;
        }
        // A stylesheet shared by both pages can also be listed as a dependency of a
        // dynamic import (the scene chunks). Keep the file whenever a script names it,
        // or that import fails to preload it.
        const referenced = scripts.some((chunk) => chunk.type === 'chunk' && chunk.code.includes(name));
        if (used && !referenced) delete bundle[name];
      }
    }
  };
}

// Rapier's entry imports its .wasm as an ES module. Point that one file at a
// shim that only re-exports the glue; src/wine/rapier.ts fetches and binds the
// binary itself, so it ships as a cacheable static asset.
function rapierWasm(): Plugin {
  return {
    name: 'kaldera-rapier-wasm',
    enforce: 'pre',
    resolveId(source, importer) {
      if (importer && importer.includes('@dimforge/rapier3d') && /rapier_wasm3d(\.js)?$/.test(source) && !source.includes('_bg')) {
        return { id: new URL('./src/wine/vendor/rapier-glue.ts', import.meta.url).pathname };
      }
      return null;
    }
  };
}

export default defineConfig({
  plugins: [siteTokens(), inlineCss(), rapierWasm()],
  build: {
    target: 'es2020',
    cssTarget: 'chrome90',
    sourcemap: false,
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    // The Three.js chunk loads through a dynamic import after first paint; its size is expected.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      input: {
        main: 'index.html',
        wine: 'wine.html'
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three';
          if (id.includes('node_modules/gsap/')) return 'gsap';
          // Rapier ships its WebAssembly inline; it loads after first paint on the wine page only.
          if (id.includes('node_modules/@dimforge/')) return 'rapier';
          return undefined;
        }
      }
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true
  }
});
