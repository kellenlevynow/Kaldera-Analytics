import { defineConfig, type Plugin } from 'vite';
import { site } from './src/site.config';

// Replaces %SITE_*% tokens in index.html with values from src/site.config.ts,
// so the owner edits one file when the domain and contact email are final.
function siteTokens(): Plugin {
  const tokens: Record<string, string> = {
    '%SITE_URL%': site.url,
    '%SITE_EMAIL%': site.email,
    '%SITE_PORTFOLIO%': site.portfolioUrl,
    '%SITE_DESCRIPTION%': site.description
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

// Inlines the single built stylesheet into index.html so first paint needs no
// extra round trip. The CSS is small (about 3.5 KB gzipped) and the headline
// is the LCP element.
function inlineCss(): Plugin {
  return {
    name: 'kaldera-inline-css',
    enforce: 'post',
    apply: 'build',
    generateBundle(_options, bundle) {
      const html = Object.values(bundle).find((item) => item.type === 'asset' && item.fileName === 'index.html');
      if (!html || html.type !== 'asset' || typeof html.source !== 'string') return;
      for (const [name, item] of Object.entries(bundle)) {
        if (item.type !== 'asset' || !name.endsWith('.css')) continue;
        const css = typeof item.source === 'string' ? item.source : new TextDecoder().decode(item.source);
        const tag = new RegExp(`<link[^>]+href="/${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`);
        if (!tag.test(html.source)) continue;
        html.source = html.source.replace(tag, `<style>${css}</style>`);
        delete bundle[name];
      }
    }
  };
}

export default defineConfig({
  plugins: [siteTokens(), inlineCss()],
  build: {
    target: 'es2020',
    cssTarget: 'chrome90',
    sourcemap: false,
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    // The Three.js chunk loads through a dynamic import after first paint; its size is expected.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three';
          if (id.includes('node_modules/gsap/')) return 'gsap';
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
