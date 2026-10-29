# Kaldera Analytics: Cloud Migration Blueprint

Prepared for the move from the browser project chat to Claude Code in the Cloud (claude.ai/code). Bind the new environment to the same claude.ai Project ("Kaldera Analytics Website") so the project instructions and this document travel with it.

---

## 1. The Complete Reconstructed Brief

### 1.1 What we are trying to achieve

A production-ready, sub-60-second microsite for Kaldera Analytics, a marketing and revenue systems studio based in Boise, Idaho. The site positions Kaldera as an architect of interconnected growth systems (demand generation, acquisition, conversion, automation, data infrastructure, revenue operations, agentic AI), not a conventional agency.

The experience is innovation theater by design: it sells the vision, not the proof. No case studies, testimonials, client logos, revenue figures, conversion statistics, fabricated research or credentials. Concise, deliberate copy. Every element must justify its presence.

The site ships to Cloudflare: domain on Cloudflare Registrar, hosting on Cloudflare Pages (or Workers static assets), output directory `dist`.

### 1.2 Master instructions (condensed from the Project instructions)

Role: principal creative technologist, senior frontend/WebGL engineer, technical director.

- First viewport must establish brand, visual identity and concept immediately.
- Lunar caldera and the south-polar lunar base effort are the central metaphor. The crater rim is the spatial framework for a cinematic camera journey; infrastructure nodes on the rim map to marketing and revenue concepts.
- Stack: Vite, TypeScript, Three.js/WebGL, GSAP, modern CSS. Add a library only when it measurably improves fidelity or performance. No React, no Tailwind, no UI frameworks.
- Guardrails: stable 60 FPS on capable desktops; minimal JS and GPU overhead; lazy-load nonessential assets; respect `prefers-reduced-motion`; graceful mobile and low-power fallbacks; readable contrast, semantic HTML, keyboard accessibility; optimized Core Web Vitals; no scroll hijacking.
- Working method: operate autonomously, decide routine details without asking, inspect real browser output, prioritize initial viewport, lunar environment, camera movement, typography, transitions, responsiveness, performance, in that order.
- Definition of done: polished hero, coherent lunar visual system, intentional camera choreography revealing the six concepts, cohesive sub-60-second flow, polished desktop and mobile, performant and accessible motion with degradation, clean production build, visually inspected and refined in a browser.
- Decision rule: quality over feature count; distinctive over conventional, as long as it stays usable.
- Writing rule: never use em dashes in copy, code comments or documentation.

### 1.3 Locked creative direction

Concept: a south-polar crater whose rim sits in near-permanent sunlight while the floor stays in permanent shadow (the Shackleton crater condition). Infrastructure is built on the lit rim and draws from the shadowed floor. The site reads like an advanced lunar mission interface reinterpreted as a studio identity.

Site structure, eight beats, each roughly one viewport, native scroll:

| Index | Beat | Lunar analog (display title) | System concept (eyebrow) |
|---|---|---|---|
| 00 | Hero | Approach vector | Headline: "Growth is an infrastructure problem." |
| 01 | Node | Illumination array | Demand |
| 02 | Node | Relay network | Acquisition |
| 03 | Node | Landing pad | Conversion |
| 04 | Node | Autonomous fleet | Automation (agents qualify, enrich, follow up; judgment calls routed to people) |
| 05 | Node | Shadowed reserve | Data (every number traces back to a source) |
| 06 | Node | Pressurized core | Revenue operations (where every system connects) |
| 07 | Close | Open channel | "Build for permanent light." Email link with copy-to-clipboard, Boise coordinates 43.61° N 116.20° W, engagements open for 2026, link to the principal's portfolio |

Each node panel: uppercase tracked eyebrow `[ 0N ] SYSTEM`, display title (the lunar analog), one or two sentences, a three-row uppercase spec list with hairline rules between rows (for example `INPUT Attention / OUTPUT Qualified pipeline / MODE Always-on`).

Persistent HUD (fixed): wordmark KALDERA (Barlow Condensed) with a small tracked ANALYTICS label; center status line `SITE 01 / SOUTH POLAR RIM / PERMANENT LIGHT` (desktop only); "Open a channel" contact link; a small SYS panel with two toggles, Motion (Full / Reduced) and Quality (Auto / Low); right-hand index rail 00 to 07 as anchor links; bottom-left live telemetry derived from the camera (altitude, heading, sun elevation, floor temperature) plus a thin traverse progress line.

No preloader gate. The hero text renders immediately over a lightweight CSS/SVG contour poster of the crater; the WebGL canvas fades in when its first frame is ready and the HUD status flips to "SCENE ONLINE". The poster doubles as the no-WebGL fallback.

### 1.4 Aesthetic guidelines from the Emotion Agency reference

Study emotion-agency.com for principles, not identity. What we took from it:

- Immersive minimalism: one dominant visual field, generous negative space, very few elements per viewport.
- Typography at large scale with very few words per viewport; small uppercase eyebrows and labels. (Weight, case and tracking now follow the SpaceX-aligned system below, which supersedes Emotion Agency's mixed-case light type.)
- Spec-sheet detailing: index numbers in brackets `[ 01 ]`, numbered lists, metadata rows that look like technical labels, a copy-to-clipboard email with a "Copied" state.
- Motion physics: inertial, damped easing (power4 / expo outs), masked line reveals, elements that settle rather than snap, a quality/settings panel that signals performance awareness.
- Restraint: no decorative clutter, no stock imagery, no gradients for their own sake.

Kaldera visual system (locked, aligned to the SpaceX visual system)

Second reference: spacex.com. Take its system, not its identity: pure black, pure white, one DIN-style typeface set in uppercase with open tracking, photographic full-bleed imagery, hairline rules, no accent color, no decoration. The brand mark, wordmark and imagery of SpaceX are off limits; Kaldera uses the same discipline with its own wordmark and its own lunar scene.

- Palette, strictly monochrome: background `#000000`; ink `#ffffff`; secondary ink `#a7a7a7`; tertiary ink `#6b6b6b`; hairlines `rgba(255,255,255,0.2)`; hover and active states go to full white, never to a color. No amber, no cold blue fill. The only non-neutral pixels on the site are the faint natural blue of the Earth sprite.
- Typography, one family: Barlow (the closest self-hostable DIN-style face, via `@fontsource/barlow`, weights 400, 500, 600) with Barlow Condensed 600 for the wordmark (`@fontsource/barlow-condensed`). D-DIN itself may be substituted if the owner supplies the files; it is free under the SIL Open Font License. No monospace: telemetry and labels use Barlow 500 uppercase with `font-variant-numeric: tabular-nums`. Preload the woff2 files, `font-display: swap`.
- Display sizes: H1 uppercase, `clamp(2.2rem, 5.6vw, 5.2rem)`, weight 500, letter-spacing 0.04em, line-height 1.02. Node titles uppercase, `clamp(1.5rem, 3.2vw, 2.6rem)`, weight 500, letter-spacing 0.05em. Eyebrows and labels 0.7rem, uppercase, weight 500, tracking 0.2em, secondary ink. Body text 1rem, weight 400, line-height 1.6, secondary ink, maximum 34rem measure. Links uppercase with a 1px white underline on hover.
- Interface hardware: 1px hairline rules above and below the HUD bars, square corners everywhere, no shadows, no glows, no blur, no rounded cards. Buttons are text with a 1px white border and 0.2em tracking, inverting to white fill with black text on hover.
- Scene look, photographic and neutral: white sunlight (no warm tint), grazing elevation around 7 degrees with real baked long shadows into the crater floor, neutral grey lit regolith, shadows that fall to true black with only a trace of earthshine, a restrained sun glare sprite, a small Earth low on the horizon as the single point of color, a sparse starfield, white hairline contour lines on the terrain that intensify at the Data node, white ice specks in the permanently shadowed floor, beacons and network pulses in white, a soft black CSS vignette, no post-processing passes. The target impression is a long-exposure documentary photograph, not a rendered concept.

### 1.5 Motion checklist (established)

Camera and scene

- [ ] Native scroll drives a damped camera (frame-rate independent exponential smoothing, roughly `1 - exp(-dt * 4)`); never hijack the scroll.
- [ ] Centripetal Catmull-Rom path through eight waypoints (hero high oblique, six rim positions trailing each node by about 14 degrees, alternating sides so the node sits opposite the text panel, closing wide pull-back). Keyframe k lands at scroll progress k/7.
- [ ] Separate look-at spline; FOV widens in portrait so the crater stays framed.
- [ ] Optional pointer parallax of about 1.2 degrees, desktop only, damped.
- [ ] Idle life: rim network pulses travelling along the link line, two orbital rings with moving satellites, an uplink line that fades in near the Relay node, beacon twinkle, ice specks twinkle.
- [ ] Render loop lives in `gsap.ticker` (one rAF), pauses when the tab is hidden.

Interface

- [ ] Hero intro timeline: HUD items fade and slide (0.8s), headline lines mask-reveal from 110% with 0.09s stagger on `power4.out`, dek at 0.9s, telemetry at 1.2s, scroll cue at 1.6s. Canvas fade-in is independent of the text.
- [ ] Node reveals via GSAP ScrollTrigger (`start: top 65%`, play on enter, reverse on leave back): eyebrow, masked title lines, dek, staggered spec rows.
- [ ] Rail index and HUD "ACTIVE NODE" readout update per section; scroll cue hides after the first scroll.
- [ ] Email copy-to-clipboard with a "Copied" state.

Accessibility and degradation

- [ ] `prefers-reduced-motion` or the Motion toggle: no glide, camera cuts between waypoints as sections activate, render on demand only, idle animations off, reveals are opacity-only or instant.
- [ ] Quality tiers: high (DPR up to 2, 256-segment terrain, about 2000 stars, MSAA when DPR under 2), medium (DPR 1.5, 160 segments, no MSAA; default for mobile, coarse pointers, deviceMemory under 4 or 4 or fewer cores), low (DPR 1, 112 segments). Auto-downgrade when the average frame time over the first 90 frames exceeds 20ms; static render-on-scroll mode above 40ms.
- [ ] No WebGL: keep the poster and the full HTML content.
- [ ] Keyboard: rail anchors focusable, visible focus states, skip link to contact, correct heading order.

Performance budget

- [ ] About 11 draw calls (terrain, merged structures, beacons, rim link, two rings, satellites, uplink, stars, sun, Earth).
- [ ] Heightfield and shadow baking computed once on the CPU after first paint (grid lookups, geometric step march), not per frame.
- [ ] Three.js chunk dynamically imported after first paint; manual chunks for `three` and `gsap`; no preloader blocking LCP (LCP is the headline text).
- [ ] Verify: production build, desktop and mobile screenshots across scroll positions, zero console errors, frame-time sampling, reduced-motion screenshot.

---

## 2. Cloud Infrastructure Requirements

Confirmed working in the previous container: Node 22.x, npm 10.x, Chromium and Playwright 1.63 preinstalled (headless verification), esbuild 0.28 and TypeScript 6 available globally.

Install right out of the gate (and nothing else unless it measurably helps):

| Dependency | Purpose | Version floor |
|---|---|---|
| Node.js | runtime | 22 LTS |
| vite | dev server, bundler | ^7 |
| typescript | type safety, `tsc --noEmit` in the build script | ^5.8 |
| three | WebGL scene | ^0.186 (r186 is current) |
| @types/three | types | matching 0.186 |
| gsap | camera easing, ScrollTrigger reveals, ticker | ^3.13 (3.15 is current; fully free, no club plugins needed) |
| @fontsource/barlow | self-hosted DIN-style text and display face (400, 500, 600) | ^5.2 |
| @fontsource/barlow-condensed | wordmark only (600) | ^5.2 |
| wrangler (optional) | `npx wrangler deploy` to Workers static assets | latest, only if not deploying via Pages Git integration |

Explicitly not required: React, Tailwind CSS, Lenis, postprocessing, any UI kit. The brief is vanilla TypeScript with modern CSS.

`package.json` scripts to recreate:

```json
{
  "dev": "vite",
  "build": "tsc --noEmit && vite build",
  "preview": "vite preview --port 4173",
  "typecheck": "tsc --noEmit",
  "deploy": "npm run build && wrangler deploy"
}
```

Network note from the previous session: `registry.npmjs.org` failed to resolve inside the container, so dependencies had to be pulled from GitHub (`mrdoob/three.js` at tag r186, `greensock/GSAP` at 3.15.0, DefinitelyTyped `types/three`, `types/webxr`, `types/stats.js`) and staged into `node_modules` by hand. In the new environment, run `npm view three version` first. If it fails, that same GitHub fallback works, and Vite can be substituted locally by esbuild for verification while the repo stays a Vite project.

Repository layout the agent should create:

```
kaldera/
  index.html                 semantic sections, inline SVG poster, preload hints
  vite.config.ts             manualChunks for three and gsap, es2020 target
  tsconfig.json              strict, bundler resolution, vite/client types
  public/_headers            Cloudflare cache and security headers
  public/fonts/              copied woff2 files
  public/favicon.svg, robots.txt, og.png (screenshot of the hero)
  src/main.ts                HUD, reveals, scroll progress, lazy scene import
  src/site.config.ts         email, domain, coordinates (placeholders flagged)
  src/styles/*.css           tokens, base, hud, sections, fallback
  src/ui/{hud,reveal,motion}.ts
  src/scene/{index,terrain,shaders,sky,network,camera,noise,quality}.ts
  wrangler.jsonc             assets.directory ./dist
  README.md                  Cloudflare Registrar and Pages deploy steps
```

Open inputs the owner still needs to supply: the final domain and contact email (use clearly marked placeholders in `site.config.ts` until then).

---

## 3. Launch Prompt (copy and paste into Claude Code in the Cloud)

```
You are the principal creative technologist and technical director for Kaldera Analytics. Work at medium effort: decide routine details yourself, ask only about irreversible choices.

STEP 0. Read KALDERA-CLOUD-BLUEPRINT.md in the project docs (or at the repo root if present) in full before touching anything. It is the brief, the locked creative direction, the motion checklist and the infrastructure list. Follow it exactly. Never use em dashes anywhere.

STEP 1. Environment check, then scaffold:
  node -v && npm -v
  npm view three version        # if this fails, use the GitHub fallback described in the blueprint
  mkdir kaldera && cd kaldera
  npm create vite@latest . -- --template vanilla-ts
  npm install three gsap
  npm install -D @types/three @fontsource/barlow @fontsource/barlow-condensed
  Recreate the scripts, vite.config.ts (manualChunks for three and gsap, es2020), tsconfig.json (strict) and the repository layout from the blueprint. Copy the needed woff2 font files (Barlow 400/500/600, Barlow Condensed 600, latin subset) into public/fonts and preload the two used above the fold.

STEP 2. Start the live preview and surface the URL before building anything visual:
  npm run dev -- --host 0.0.0.0 --port 5173
  Report the forwarded preview URL. Keep the server running for the rest of the session and re-check it after every milestone.

STEP 3. Build in this order, inspecting real browser output after each milestone (Playwright screenshots at 1440x900 and 390x844, console errors, frame-time sampling):
  a. Hero viewport: HUD, headline, poster, typography, telemetry.
  b. Lunar caldera scene: procedural heightfield with baked grazing-sun shadows, stars, sun and Earth sprites, fog, contour lines, ice specks.
  c. Six rim installations mapped to Demand, Acquisition, Conversion, Automation, Data, Revenue, plus the rim link line, orbital rings, satellites, uplink.
  d. Camera choreography: damped native-scroll camera on a Catmull-Rom path through eight waypoints, GSAP ScrollTrigger reveals, rail and telemetry updates.
  e. Reduced motion, quality tiers, mobile layout, no-WebGL fallback, keyboard access.
  f. Production: npm run build, vite preview, Lighthouse-style checks, Cloudflare _headers, wrangler.jsonc, README with Registrar and Pages steps, og.png from a hero screenshot.

VISUAL SYSTEM. Follow the SpaceX-aligned system in the blueprint exactly: pure black and white, no accent color, one DIN-style family (Barlow) set uppercase with open tracking, hairline rules, square corners, no glows or shadows, photographic neutral lighting in the scene. Do not reproduce any SpaceX mark, wordmark or imagery.

CONSTRAINTS. Vite, TypeScript, Three.js, GSAP, modern CSS only. No React, no Tailwind, no UI frameworks. No case studies, testimonials, logos, metrics or fabricated claims. Target 60 FPS, about 11 draw calls, dynamic import of the Three.js chunk after first paint, prefers-reduced-motion honored, mobile fallbacks, Core Web Vitals clean. Favor quality over feature count and distinctive over conventional.

REPORTING. After each milestone send a two-line status with what changed and the preview URL. Finish with the production build verified, a list of placeholders the owner must fill (domain, contact email) and the exact Cloudflare deploy commands.
```

Preview-server command sequence, for reference:

```
npm run dev -- --host 0.0.0.0 --port 5173     # live preview; the cloud UI forwards this port
npm run build                                 # tsc --noEmit then vite build into dist/
npm run preview                               # serves dist/ on 4173 for production checks
npx wrangler deploy                           # optional: Workers static assets from dist/
```
