# Kaldera Analytics

A sub-60-second microsite for Kaldera Analytics, a marketing and revenue systems studio in Boise, Idaho. A south-polar lunar crater, lit rim in permanent sunlight and a floor in permanent shadow, is the spatial framework: six installations on the rim mark the six parts of the system the copy describes (demand generation, paid acquisition, conversion, automation, analytics, revenue operations), revealed by a scroll-driven camera traverse. The scene is the visual identity; the copy stands on its own without it. The hero opens just outside the fractured crest, eye level with the rim blocks, looking across the bowl to the sunlit far wall with the Earth low in the sky.

Stack: Vite, TypeScript, Three.js, GSAP, modern CSS. No frameworks. Deploys to Cloudflare as static files from `dist/`.

## Copy and positioning

The copy sells marketing expertise, judgment, execution and connected systems, not the lunar scene. Keep these rules when editing it.

- Core claim: Kaldera builds and runs the marketing and revenue systems that help companies attract the right customers, convert more of them, and make revenue measurable and repeatable. Headline: "Marketing you can run a business on."
- Hierarchy: the hero states the claim and names the six parts of the system. Each section is one part: the eyebrow names the service, the title states the idea in plain words, the paragraph explains how it works and what it produces, and the three spec rows read Includes (scope), Measures (the metrics it is judged by) and Feeds (the part it hands off to). The close asks for the visitor's growth problem and says what they get back.
- Voice: plain, declarative, specific, composed. Outcomes before mechanics. Name the metric. No invented clients, results, guarantees or credentials. No generic agency language.
- The scene, telemetry and coordinates are an aesthetic layer. No sentence may depend on a lunar reference to make sense.

## The wine page (`/wine`)

`wine.html` is a second entry: a scroll-driven search, straight down, through a deep pile of wine bottles, for wineries, vineyards, estates, wine bars, storage facilities, private collections and wine country tour operators. The animation is the pitch. The copy is a paced narrative about where the wine trade is going, one short moment at a time, and one message at the floor.

**The journey.** The page is 27 screens tall. The camera looks straight down the whole way. It starts with its probe resting on the pile, so the first scroll moves bottles; the descent is linear in scroll, so every step moves the same distance; near the floor it slows and stops over one bottle, lying label up, and leans in. The pile has four strata, each with its own glass, foil and labels: the shelf, the list, the cellar and the library. The hero is the only bottle with a white label.

**The text.** Every line lives in `wine.html` as a `.moment` with `data-from` and `data-to` (fractions of the journey). Moments are fixed at the centre of the screen and fade with the camera's own progress, which trails the scroll position, so words and picture stay in step (`src/wine/moments.ts`). Edit the copy and the timings there and nowhere else. Voice: someone who knows the trade, not an agency pitching it. No service lists, no claims about clients or results.

**How it is built.**

- `src/wine.ts` wires the HUD, the moments and the lazy scene import. `src/wine/scene.ts` assembles the scene; `bottle.ts` builds the lathe shapes and colliders; `labels.ts` draws the label atlas (every estate on it is invented) and the hero label; `materials.ts` holds the reflection maps and shared materials; `physics.ts` runs the pile; `layout.ts` holds what the browser and the bake script share.
- The pile is baked. `npm run bake:pile` pours 2,800 bottles into a well and settles them offline (about fifteen minutes; add `-- --bench` to drive a probe through the result and print timings) and writes `src/wine/pile.bin`, 82 KB. The page loads it and starts with no simulation at all. Rebake only if the well, the shapes or the count change.
- Physics is Rapier (`@dimforge/rapier3d`; the bake uses the node-friendly `-compat` build, a dev dependency). The WebAssembly binary ships as a static asset (about 1.1 MB gzipped, cached immutably); `src/wine/rapier.ts` fetches and binds it, and `vite.config.ts` aliases the package's wasm import to `src/wine/vendor/rapier-glue.ts`. The CSP in `public/_headers` carries `'wasm-unsafe-eval'` for it.
- Only a thin shell of bottles around the camera is simulated, about 180 at a time. A contact pile is a single island to the solver, so waking any of it would wake all of it. The rest follow an analytic field: a hole the shape of the camera's probe, with a nose reaching ahead, opens along the path and every far bottle slides radially out of it, exactly in step with scroll, then closes behind. Bottles inside the shell are live rigid bodies pushed by the probe; they collide with each other and with the far bottles, which have already made room, and are handed back to the field once left at rest. `physics.ts` has the detail.
- Rendering draws only the bottles inside the camera's downward cone, a few hundred of the 2,900, into three instanced meshes per shape. Depth of field (BokehPass) and shadows run on the high tier only; lower tiers shorten the view, thicken the fog and cut segments and pixel ratio. Reduced motion drops the roll, the drift and the parallax.
- The reveal: the nose of the field lengthens to open the floor, the lamp gives way to a narrow key light, the hero has its own reflection map (two side softboxes and an overhead strip, for the lines down the black glass), and a CSS pool of shade closes in around it.
- Review flags: `?debug` keeps the frame monitor from changing tiers, `?tier=high|medium|low` forces a tier, `?instant` lets the camera chase scroll four times faster, `?og` hides the HUD and text for a capture. `window.__kaldera.diagnostics()` reports progress, visible and live bottle counts, draw calls, triangles and physics time.

## Email signature assets

`public/email/` holds images referenced by email signatures. Every email ever sent points at these exact URLs, so they are permanent: never rename, move, edit in place or delete a file here, and keep this folder through any redesign. To change the mark, add a new file under a new name and update the signature; old emails keep showing the old mark.

| File | Used by | Notes |
|---|---|---|
| `email/kaldera-mark.png` | Gmail signature | Orbit mark on a black tile, 168 px, shown at 56 px. Served with a one-year immutable cache. |

## Site settings

Everything site-specific lives in one file, `src/site.config.ts`:

| Key | Value |
| --- | --- |
| `domain` | `kaldera-analytics.com` |
| `url` | `https://kaldera-analytics.com` |
| `email` | `hello@kaldera-analytics.com` |

`index.html` reads these at build time (canonical URL, Open Graph tags, mailto link) and `src/main.ts` applies the email at runtime, so nothing else needs editing. After changing them, run `npm run build` again.

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
wine.html, src/wine.ts     the wine page entry (see above)
src/wine/                  scene, bottle, labels, materials, physics, layout, rapier loader, hud, moments, pile.bin
scripts/bake-pile.mjs      pours and settles the wine page's pile offline
src/site.config.ts         domain, email, coordinates (placeholders flagged)
src/styles/                tokens, base, hud, sections, fallback
src/ui/                    hud, reveal (GSAP), motion (preferences)
src/scene/                 index, heightfield, terrain, bake, bake.worker, rocks, shaders, sky, network, camera, noise, quality
wrangler.jsonc             Workers static assets config (assets.directory ./dist)
```

## How it is built

- The hero text renders immediately over an inline SVG contour poster. There is no preloader gate. The Three.js chunk is imported after first paint; the canvas fades in when its first frame is ready and the HUD status flips from POSTER to SCENE ONLINE. The poster doubles as the no-WebGL fallback.
- The crater is an analytic heightfield (`src/scene/heightfield.ts`, pure math, no three.js): a 21 km bowl with a ridged, block-strewn crest, terraced inner walls with debris chutes, a deterministic crater population at four scales on every surface, hummocky ejecta, highland massifs on the horizon and the Moon's curvature. Installations sit on levelled pads where the fine relief is suppressed.
- Normals, grazing-sun shadows (12 degree sun, floor still in permanent shadow) and a relief channel are baked into two sun-aligned data textures with a single sweep per row. The bake and the mesh grid run in a Web Worker (`bake.worker.ts`), so the main thread never stalls; browsers without workers fall back to the time-sliced generator. The mesh is a polar grid with half-step twisted rings and its vertex budget concentrated around the rim and the camera path.
- Below the bake resolution the terrain shader adds analytic relief per fragment: two crater scales, boulders, fractured slabs on the crest and regolith grain, each with an exact gradient, faded by distance and view angle. Lighting is a Lambert and Lommel-Seeliger mix with an opposition surge, bounce from the blurred lit bake, directional earthshine and a filmic tonemap. Beyond the bakes the mesh facets shade from their geometric normal.
- A boulder field (`rocks.ts`) scatters noise-displaced, plane-cut icosahedra along the crest and the upper walls in one merged flat-shaded mesh, half buried, carrying the baked shade of their ground, kept clear of the camera path and the installation pads.
- Twelve draw calls at most: terrain, boulders, merged structures, beacons, rim link (with the reserve cable), two orbital rings, satellites, uplink, stars, Sun, Earth.
- Native scroll drives a damped camera (frame-rate independent exponential smoothing) along a centripetal Catmull-Rom path through eight waypoints, with a separate look-at spline, a wider field of view in portrait, and a small pointer parallax on desktop.
- `prefers-reduced-motion` or the Motion toggle: the camera cuts between waypoints as sections activate, the scene renders on demand only, idle animation stops, reveals are opacity only.
- Quality tiers: high (DPR up to 2, MSAA under DPR 2, 1024 by 1024 near bake, 1600 boulders), medium (DPR 1.5, default for coarse pointers, low memory or few cores, 768 bake, 1000 boulders), low (DPR 1, 512 bake, 500 boulders, reduced shader relief). The first 90 frames are timed; above 20 ms average the tier drops, above 40 ms the scene switches to render-on-scroll.

## Deploy to Cloudflare

### 1. Domain on Cloudflare Registrar

1. In the Cloudflare dashboard open **Domain Registration > Register Domains**, search for the domain and complete the purchase. Cloudflare Registrar sells at cost and adds the zone to the account with DNS and proxying managed in place.
2. If the domain already exists elsewhere, open **Domain Registration > Transfer Domains**, unlock the domain at the current registrar, request the auth code and follow the transfer flow (the zone must already be on Cloudflare DNS).
3. The domain in `src/site.config.ts` (`domain` and `url`) already matches: `kaldera-analytics.com`.

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
