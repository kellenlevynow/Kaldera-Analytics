# Kaldera Analytics

A sub-60-second microsite for Kaldera Analytics, a marketing and revenue systems studio in Boise, Idaho. A south-polar lunar crater, lit rim in permanent sunlight and a floor in permanent shadow, is the spatial framework: six infrastructure nodes on the rim map to Demand, Acquisition, Conversion, Automation, Data and Revenue operations, revealed by a scroll-driven camera traverse.

Stack: Vite, TypeScript, Three.js, GSAP, modern CSS. No frameworks. Deploys to Cloudflare as static files from `dist/`.

## Before launch: placeholders to fill

Everything the owner still has to supply lives in one file, `src/site.config.ts`:

| Key | Current placeholder | Replace with |
| --- | --- | --- |
| `domain` | `kaldera.example` | the registered domain |
| `url` | `https://kaldera.example` | `https://` plus the domain, no trailing slash |
| `email` | `hello@kaldera.example` | the studio contact address |
| `portfolioUrl` | `https://portfolio.example` | the principal's portfolio URL |

`index.html` reads these at build time (canonical URL, Open Graph tags, mailto link, portfolio link) and `src/main.ts` applies the email and portfolio link at runtime, so nothing else needs editing. After changing them, run `npm run build` again.

`public/og.png` is a 1200 by 630 capture of the hero. Regenerate it after any copy change by opening the site with `?og` appended (HUD hidden) and taking a 1200 by 630 screenshot.

## Scripts

```bash
npm install
npm run dev          # Vite dev server on http://localhost:5173
npm run build        # tsc --noEmit, then vite build into dist/
npm run preview      # serves dist/ on http://localhost:4173
npm run typecheck    # tsc --noEmit only
npm run deploy       # build, then wrangler deploy (Workers static assets path)
```

Useful query flags during review: `?debug` keeps the frame monitor from changing quality tiers (for slow or software-rendered browsers), `?og` hides the HUD for a clean capture.

## Repository layout

```
index.html                 semantic sections, inline SVG contour poster, preload hints
vite.config.ts             manual chunks for three and gsap, es2020 target, site token plugin
tsconfig.json              strict, bundler resolution
public/_headers            Cloudflare cache and security headers (CSP included)
public/fonts/              Barlow 400/500/600 and Barlow Condensed 600, latin woff2
public/favicon.svg, robots.txt, og.png
src/main.ts                HUD wiring, reveals, scroll progress, lazy scene import
src/site.config.ts         domain, email, coordinates (placeholders flagged)
src/styles/                tokens, base, hud, sections, fallback
src/ui/                    hud, reveal (GSAP), motion (preferences)
src/scene/                 index, terrain, shaders, sky, network, camera, noise, quality
wrangler.jsonc             Workers static assets config (assets.directory ./dist)
```

## How it is built

- The hero text renders immediately over an inline SVG contour poster. There is no preloader gate. The Three.js chunk is imported after first paint; the canvas fades in when its first frame is ready and the HUD status flips from POSTER to SCENE ONLINE. The poster doubles as the no-WebGL fallback.
- The crater is an analytic heightfield. Normals and grazing-sun shadows (7 degree sun) are baked once on the CPU into two sun-aligned data textures with a single sweep per row, spread across animation frames so the hero intro stays smooth. The mesh is a polar grid with its vertex budget concentrated around the rim.
- Eleven draw calls at most: terrain, merged structures, beacons, rim link (with the reserve cable), two orbital rings, satellites, uplink, stars, Sun, Earth.
- Native scroll drives a damped camera (frame-rate independent exponential smoothing) along a centripetal Catmull-Rom path through eight waypoints, with a separate look-at spline, a wider field of view in portrait, and a small pointer parallax on desktop.
- `prefers-reduced-motion` or the Motion toggle: the camera cuts between waypoints as sections activate, the scene renders on demand only, idle animation stops, reveals are opacity only.
- Quality tiers: high (DPR up to 2, MSAA under DPR 2), medium (DPR 1.5, default for coarse pointers, low memory or few cores), low (DPR 1). The first 90 frames are timed; above 20 ms average the tier drops, above 40 ms the scene switches to render-on-scroll.

## Deploy to Cloudflare

### 1. Domain on Cloudflare Registrar

1. In the Cloudflare dashboard open **Domain Registration > Register Domains**, search for the domain and complete the purchase. Cloudflare Registrar sells at cost and adds the zone to the account with DNS and proxying managed in place.
2. If the domain already exists elsewhere, open **Domain Registration > Transfer Domains**, unlock the domain at the current registrar, request the auth code and follow the transfer flow (the zone must already be on Cloudflare DNS).
3. Put the final domain into `src/site.config.ts` (`domain` and `url`).

### 2. Hosting, option A: Cloudflare Pages with Git integration (recommended)

1. Push this repository to GitHub.
2. In the dashboard open **Workers & Pages > Create > Pages > Connect to Git**, authorize GitHub and pick the repository.
3. Build settings:
   - Framework preset: **Vite** (or None)
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: `kaldera` (the site lives in this folder of the repository)
   - Environment variable: `NODE_VERSION` = `22`
4. Save and deploy. Every push to the production branch redeploys; other branches get preview URLs.
5. In the project open **Custom domains > Set up a custom domain**, enter the domain (and `www` if wanted). Because the zone is on Cloudflare, the CNAME records are created automatically and TLS is issued within minutes.
6. `public/_headers` ships with the build and applies the cache and security headers, including the Content Security Policy.

### 2. Hosting, option B: Workers static assets with Wrangler

```bash
cd kaldera
npm install -D wrangler
npx wrangler login
npm run deploy
```

`wrangler.jsonc` points `assets.directory` at `./dist`. Add the custom domain under the Worker's **Settings > Domains & Routes > Add > Custom domain**. `_headers` is honored by Workers static assets as well.

### Verify after deploy

- Open the site, confirm the HUD status reads SCENE ONLINE on a WebGL device and POSTER otherwise.
- Check `curl -I https://<domain>/` for the headers from `public/_headers`.
- Run Lighthouse on the production URL. LCP is the hero text, there is no layout shift, and the Three.js chunk loads after first paint.

## Writing rule

No em dashes anywhere: copy, comments, documentation.
