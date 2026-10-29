// GLSL for the custom materials. Linear light, filmic tonemap, converted to
// sRGB at the end.

const common = /* glsl */ `
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  // Distance desaturation and lift toward the dark horizon tone. Not fog: the
  // Moon has no air, but a faint lift keeps the far ground from reading as a
  // black cut-out and gives the plains their scale.
  vec3 distanceFade(vec3 color, float dist, float density) {
    float x = dist * density;
    float f = 1.0 - exp(-x * x);
    return mix(color, vec3(0.035, 0.036, 0.04), f * 0.85);
  }
  // ACES-style filmic curve (Narkowicz fit).
  vec3 filmic(vec3 x) {
    x = max(x, 0.0);
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }
  // Regolith reflectance: Lambert mixed with Lommel-Seeliger (the lunar
  // surface stays flat in brightness toward grazing view) plus the
  // opposition surge when the Sun sits behind the viewer.
  float lunarDirect(float ndl, float mu, float phase) {
    float ls = ndl / (ndl + mu + 0.05);
    float surge = 1.0 + 0.4 * pow(max(phase, 0.0), 10.0);
    // A little gamma on the Lambert term deepens the half-lit slopes.
    return mix(pow(ndl, 1.2), ls * 0.5, 0.3) * surge;
  }
  // Direct sun, bounce from the lit regolith around, earthshine.
  vec3 lunarLight(vec3 n, vec3 viewDir, vec3 sunDir, float shade, float ao, float exposure, vec3 earthDir, vec3 earthshine, float bounceLit, float albedo) {
    float ndl = max(dot(n, sunDir), 0.0);
    float mu = max(dot(n, viewDir), 0.0);
    float phase = dot(viewDir, sunDir);
    // Occlusion weighs on the indirect light; direct sun keeps the inner slopes of a bowl bright.
    float direct = lunarDirect(ndl, mu, phase) * shade * mix(1.0, ao, 0.35) * exposure;
    float up = 0.5 + 0.5 * n.y;
    float bounce = bounceLit * 0.12 * (0.35 + 0.65 * up) * ao * exposure;
    // Earthshine: a directional part from the Earth's disc and a diffuse part
    // for light scattered off the surrounding lit terrain. The relief term
    // keeps benches and bowls legible inside the shadow.
    float earth = 0.5 * max(dot(n, earthDir), 0.0) + 0.5 * up * up;
    return albedo * (vec3(direct + bounce) + earthshine * earth * ao * ao);
  }
`;

// Procedural relief evaluated per fragment below the bake resolution: a
// deterministic crater population (two scales), boulders and regolith grain.
// Every term returns an analytic height and gradient, so normals come out
// exact without finite differences.
const relief = /* glsl */ `
  // Bowl crater layer: cells of size c, at most one crater per cell, jitter
  // under a quarter cell and radius under 0.35 cell so the four nearest cells
  // cover every crater that can reach p. Returns (h / depth, dh/dx, dh/dz).
  vec3 craterLayer(vec2 p, float c, float seed, float density) {
    vec2 i0 = floor(p / c - 0.5);
    vec3 acc = vec3(0.0);
    for (int j = 0; j <= 1; j++) {
      for (int i = 0; i <= 1; i++) {
        vec2 cell = i0 + vec2(float(i), float(j));
        float hs = hash21(cell * 1.71 + seed);
        if (hs > density) continue;
        vec2 jitter = vec2(hash21(cell + seed * 0.31), hash21(cell * 2.3 + seed)) - 0.5;
        vec2 center = (cell + 0.5 + jitter * 0.5) * c;
        float r = c * (0.12 + 0.23 * hash21(cell * 3.1 + seed * 1.3));
        vec2 d = p - center;
        float dist = length(d);
        if (dist > r * 2.2) continue;
        float age = hash21(cell * 5.3 + seed * 0.7);
        float depth = r * (0.12 + 0.3 * age * age);
        float u = dist / r;
        float h;
        float dhdu;
        if (u < 1.0) {
          float t = clamp((u - 0.55) / 0.45, 0.0, 1.0);
          float s = t * t * (3.0 - 2.0 * t);
          float ds = 6.0 * t * (1.0 - t) / 0.45;
          h = -depth * (1.0 - u * u) + depth * 0.3 * s;
          dhdu = depth * 2.0 * u + depth * 0.3 * ds;
        } else {
          float e = u - 1.0;
          float g = exp(-e * e * 18.0);
          float t = clamp(e / 1.2, 0.0, 1.0);
          float s2 = 1.0 - t * t * (3.0 - 2.0 * t);
          float ds2 = -6.0 * t * (1.0 - t) / 1.2;
          h = depth * 0.3 * g * s2;
          dhdu = depth * 0.3 * g * (-36.0 * e * s2 + ds2);
        }
        vec2 grad = dhdu * d / (r * max(dist, 1e-5));
        acc += vec3(h / depth, grad);
      }
    }
    return acc;
  }
  // Boulders: rounded bumps in a fraction of the cells. Returns (h, dh/dx, dh/dz).
  vec3 boulderLayer(vec2 p, float c, float seed, float density) {
    vec2 i0 = floor(p / c - 0.5);
    vec3 acc = vec3(0.0);
    for (int j = 0; j <= 1; j++) {
      for (int i = 0; i <= 1; i++) {
        vec2 cell = i0 + vec2(float(i), float(j));
        float hs = hash21(cell * 2.13 + seed);
        if (hs > density) continue;
        vec2 jitter = vec2(hash21(cell * 1.3 + seed), hash21(cell * 3.7 - seed)) - 0.5;
        vec2 center = (cell + 0.5 + jitter * 0.5) * c;
        float rr = c * (0.16 + 0.3 * hash21(cell * 4.1 + seed));
        vec2 d = p - center;
        float q = dot(d, d) / (rr * rr);
        if (q >= 1.0) continue;
        float a = rr * (0.5 + 0.5 * hash21(cell * 6.1 + seed));
        float w = 1.0 - q;
        // h = a * w^2, dh/dp = -4 a w d / rr^2
        acc += vec3(a * w * w, -4.0 * a * w * d / (rr * rr));
      }
    }
    return acc;
  }
  // Fractured slabs: Worley cells raised to plateaus with short ramps between
  // them. The F1 gradient is the unit vector from the nearest feature point.
  // Returns (h, dh/dx, dh/dz).
  vec3 slabLayer(vec2 p, float c, float seed, float height) {
    vec2 q = p / c;
    vec2 i0 = floor(q);
    float f1 = 8.0;
    vec2 toNearest = vec2(0.0);
    float id = 0.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 cell = i0 + vec2(float(i), float(j));
        vec2 feature = cell + vec2(hash21(cell * 1.3 + seed), hash21(cell * 2.9 - seed));
        vec2 d = q - feature;
        float dist = dot(d, d);
        if (dist < f1) {
          f1 = dist;
          toNearest = d;
          id = hash21(cell * 4.7 + seed);
        }
      }
    }
    f1 = sqrt(f1);
    float t = clamp((f1 - 0.3) / 0.22, 0.0, 1.0);
    float ramp = 1.0 - t * t * (3.0 - 2.0 * t);
    float dRamp = -6.0 * t * (1.0 - t) / 0.22;
    float h = height * (id - 0.3);
    vec2 grad = h * dRamp * toNearest / (max(f1, 1e-4) * c);
    return vec3(h * ramp, grad);
  }
  // Regolith grain: two rotated value-noise octaves, gradient by central difference.
  vec2 grainGradient(vec2 p) {
    vec2 p1 = p * 23.0;
    vec2 p2 = vec2(p.x * 0.83 - p.y * 0.56, p.x * 0.56 + p.y * 0.83) * 61.0;
    float e = 0.4;
    vec2 g1 = vec2(vnoise(p1 + vec2(e, 0.0)) - vnoise(p1 - vec2(e, 0.0)), vnoise(p1 + vec2(0.0, e)) - vnoise(p1 - vec2(0.0, e)));
    vec2 g2 = vec2(vnoise(p2 + vec2(e, 0.0)) - vnoise(p2 - vec2(e, 0.0)), vnoise(p2 + vec2(0.0, e)) - vnoise(p2 - vec2(0.0, e)));
    return g1 * 0.05 + g2 * 0.03;
  }
`;

export const terrainVertex = /* glsl */ `
  varying vec3 vWorld;
  varying float vDist;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vec4 mv = viewMatrix * world;
    vDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

export const terrainFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D uNear;
  uniform sampler2D uFar;
  uniform float uNearHalf;
  uniform float uFarHalf;
  uniform float uFarReady;
  uniform vec2 uSunRot;
  uniform vec3 uSunDir;
  uniform vec3 uEarthDir;
  uniform float uExposure;
  uniform vec3 uEarthshine;
  uniform float uContour;
  uniform float uContourSpacing;
  uniform float uIce;
  uniform float uTime;
  uniform float uDetail;
  uniform float uFogDensity;
  uniform float uCraterR;
  varying vec3 vWorld;
  varying float vDist;
  ${common}
  ${relief}
  void main() {
    // Sun-aligned bake space.
    vec2 g = vec2(vWorld.x * uSunRot.x + vWorld.z * uSunRot.y, -vWorld.x * uSunRot.y + vWorld.z * uSunRot.x);
    float gr = max(abs(g.x), abs(g.y));
    vec2 nearUv = g / (2.0 * uNearHalf) + 0.5;
    vec4 nearData = texture2D(uNear, nearUv);
    vec4 farData = texture2D(uFar, g / (2.0 * uFarHalf) + 0.5);
    float wNear = 1.0 - smoothstep(uNearHalf * 0.86, uNearHalf * 0.97, gr);
    float wFar = (1.0 - wNear) * (1.0 - smoothstep(uFarHalf * 0.9, uFarHalf * 0.99, gr)) * uFarReady;
    float wBake = wNear + wFar;
    vec4 data = (nearData * wNear + farData * wFar) / max(wBake, 1e-4);
    vec2 nxz = data.rg * 2.0 - 1.0;
    vec3 bakeN = normalize(vec3(nxz.x, sqrt(max(0.0, 1.0 - dot(nxz, nxz))), nxz.y));
    // Beyond the bakes the mesh facets carry the relief: use the geometric normal.
    vec3 geoN = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    geoN *= sign(geoN.y + 1e-6);
    vec3 n = normalize(mix(geoN, bakeN, wBake));
    float shade = mix(1.0, data.b, wBake);
    float reliefC = (data.a * 2.0 - 1.0) * wBake;
    // Blurred lit fraction of the near bake: the sunlit regolith around a point
    // throws light into the shadows beside it.
    float bounceLit = texture2D(uNear, nearUv, 5.0).b * wNear;

    vec3 viewDir = normalize(cameraPosition - vWorld);
    float facing = smoothstep(0.08, 0.4, abs(dot(viewDir, n)));
    float ao = 1.0 - 0.3 * clamp(-reliefC, 0.0, 1.0);

    // Sub-bake relief in three distance bands, faded at grazing view angles
    // where it would smear into streaks.
    float bandA = (1.0 - smoothstep(7.0, 20.0, vDist)) * facing * uDetail;
    float bandB = (1.0 - smoothstep(1.6, 5.5, vDist)) * facing * uDetail;
    vec2 grad = vec2(0.0);
    float albedoShift = 0.0;
    float radius = length(vWorld.xz);
    float theta = atan(vWorld.z, vWorld.x);
    if (bandA > 0.002) {
      vec3 ca = craterLayer(vWorld.xz, 0.3, 7.0, 0.74);
      grad += ca.yz * bandA * 0.8;
      ao *= 1.0 + 0.35 * min(ca.x, 0.0) * bandA;
      float mid = bandA * (1.0 - smoothstep(3.0, 10.0, vDist));
      if (mid > 0.002) {
        vec3 cm = craterLayer(vWorld.xz, 0.15, 13.0, 0.62);
        grad += cm.yz * mid * 0.6;
        ao *= 1.0 + 0.3 * min(cm.x, 0.0) * mid;
        vec3 ba = boulderLayer(vWorld.xz, 0.045, 3.0, 0.28);
        grad += ba.yz * mid;
      }
    }
    if (bandB > 0.002) {
      vec3 cb = craterLayer(vWorld.xz, 0.07, 19.0, 0.42);
      grad += cb.yz * bandB * 0.4;
      ao *= 1.0 + 0.25 * min(cb.x, 0.0) * bandB;
      vec3 bb = boulderLayer(vWorld.xz, 0.012, 11.0, 0.3);
      grad += bb.yz * bandB;
      grad += grainGradient(vWorld.xz) * bandB;
      // Fractured bedrock shows through on the crest and the upper walls.
      float rr = uCraterR * (1.0 + 0.034 * sin(2.0 * theta + 1.3) + 0.024 * sin(3.0 * theta + 0.4) + 0.011 * sin(7.0 * theta + 2.0) + 0.006 * sin(11.0 * theta + 4.1));
      float crest = exp(-(radius - rr) * (radius - rr) / 1.4) * bandB;
      if (crest > 0.01) {
        vec3 sl = slabLayer(vWorld.xz, 0.075, 5.0, 0.009);
        vec3 sl2 = slabLayer(vWorld.xz, 0.19, 29.0, 0.016);
        grad += (sl.yz + sl2.yz) * crest;
        albedoShift += (0.025 * sl.x / 0.007 + 0.02 * sl2.x / 0.012) * crest;
      }
    }
    if (dot(grad, grad) > 0.0) n = normalize(n + vec3(-grad.x, 0.0, -grad.y));

    float albedo = 0.46;
    albedo += 0.06 * (vnoise(vWorld.xz * 0.11) - 0.5);
    albedo += 0.04 * (vnoise(vWorld.xz * 0.9) - 0.5);
    albedo += 0.03 * (vnoise(vWorld.xz * 11.0) - 0.5) * bandB;
    // Fresh rays and bright rims where the baked relief is convex; slab tops brighter.
    albedo += 0.03 * clamp(reliefC, 0.0, 1.0) + albedoShift;

    vec3 color = lunarLight(n, viewDir, uSunDir, shade, ao, uExposure, uEarthDir, uEarthshine, bounceLit, albedo);

    // Survey contours: white hairlines at fixed height intervals, index lines stronger.
    float hc = vWorld.y / uContourSpacing;
    float fw = fwidth(hc);
    float f = abs(fract(hc + 0.5) - 0.5);
    float line = 1.0 - smoothstep(0.0, max(fw * 1.4, 0.004), f);
    float density = clamp(1.0 - fw * 2.2, 0.0, 1.0);
    float idx = floor(hc + 0.5);
    float major = 1.0 - min(abs(mod(idx, 5.0)), 1.0);
    // Survey lines read in the shadow; on lit ground they stay faint and fade with distance.
    float lit = shade * max(dot(n, uSunDir), 0.0);
    float contourWeight = mix(1.0, 0.2, clamp(lit * 4.0, 0.0, 1.0)) * (1.0 - smoothstep(10.0, 30.0, vDist));
    float contour = line * density * uContour * mix(0.4, 1.0, major) * contourWeight;
    color = mix(color, vec3(0.7), contour);

    // Ice specks in the permanently shadowed floor.
    float floorMask = smoothstep(-1.9, -2.7, vWorld.y) * (1.0 - smoothstep(0.03, 0.25, shade));
    if (floorMask > 0.001) {
      float cellSize = 0.05;
      vec2 cp = vWorld.xz / cellSize;
      vec2 cell = floor(cp);
      float hs = hash21(cell);
      vec2 jitter = vec2(hash21(cell + 7.0), hash21(cell + 13.0)) - 0.5;
      vec2 local = fract(cp) - 0.5 - jitter * 0.55;
      float cw = fwidth(cp.x);
      float dotMask = 1.0 - smoothstep(0.0, cw * 1.1 + 0.05, length(local));
      float twinkle = 0.5 + 0.5 * sin(uTime * (1.2 + hs * 2.4) + hs * 60.0);
      float speck = step(0.984, hs) * dotMask * twinkle * clamp(1.0 - cw * 0.7, 0.0, 1.0);
      color += speck * floorMask * uIce * 0.5;
    }

    color = distanceFade(color, vDist, uFogDensity);
    color = filmic(color);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

export const structureVertex = /* glsl */ `
  attribute float aAlbedo;
  attribute float aShade;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vAlbedo;
  varying float vShade;
  varying float vDist;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vAlbedo = aAlbedo;
    vShade = aShade;
    vec4 mv = viewMatrix * world;
    vDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

export const structureFragment = /* glsl */ `
  precision highp float;
  uniform vec3 uSunDir;
  uniform vec3 uEarthDir;
  uniform float uExposure;
  uniform vec3 uEarthshine;
  uniform float uFogDensity;
  uniform float uGrain;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vAlbedo;
  varying float vShade;
  varying float vDist;
  ${common}
  void main() {
    vec3 n = normalize(vNormal);
    vec3 viewDir = normalize(cameraPosition - vWorld);
    // Rock grain: a little surface roughness in the normal and the albedo.
    float albedo = vAlbedo;
    if (uGrain > 0.0) {
      float near = 1.0 - smoothstep(1.0, 6.0, vDist);
      vec3 p = vWorld * 40.0;
      float e = 0.5;
      vec3 gn = vec3(vnoise(p.yz + e) - vnoise(p.yz - e), vnoise(p.xz + e) - vnoise(p.xz - e), vnoise(p.xy + e) - vnoise(p.xy - e));
      vec3 p2 = vWorld * 140.0;
      vec3 gn2 = vec3(vnoise(p2.yz + e) - vnoise(p2.yz - e), vnoise(p2.xz + e) - vnoise(p2.xz - e), vnoise(p2.xy + e) - vnoise(p2.xy - e));
      n = normalize(n + (gn * 0.6 + gn2 * 0.35 * (1.0 - smoothstep(0.3, 2.5, vDist))) * uGrain * near);
      albedo *= 1.0 + uGrain * (0.16 * (vnoise(vWorld.xz * 9.0 + vWorld.y * 3.0) - 0.5) + 0.12 * (vnoise(p.xy) - 0.5) * near);
    }
    // Structures on the lit crest also catch bounce from the regolith around them.
    float bounceLit = vShade * 0.5;
    vec3 color = lunarLight(n, viewDir, uSunDir, vShade, 1.0, uExposure, uEarthDir, uEarthshine, bounceLit, albedo);
    color = distanceFade(color, vDist, uFogDensity);
    color = filmic(color);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

export const linkVertex = /* glsl */ `
  attribute float aT;
  varying float vT;
  varying float vDist;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vT = aT;
    vDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

export const linkFragment = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uBase;
  uniform float uPulse;
  uniform float uFogDensity;
  varying float vT;
  varying float vDist;
  ${common}
  void main() {
    float a = uBase;
    // Three pulses travelling along the link, each with a short tail.
    for (int k = 0; k < 3; k++) {
      float d = fract(vT - uTime * 0.045 - float(k) / 3.0);
      a += uPulse * smoothstep(0.0, 0.012, d) * exp(-d * 34.0);
    }
    float x = vDist * uFogDensity;
    a *= exp(-x * x);
    gl_FragColor = vec4(vec3(1.0), a);
  }
`;

export const beaconVertex = /* glsl */ `
  attribute float aPhase;
  uniform float uTime;
  uniform float uDpr;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float blink = 0.55 + 0.45 * sin(uTime * 2.4 + aPhase);
    vAlpha = blink * (1.0 - clamp((length(mv.xyz) - 12.0) / 30.0, 0.0, 0.7));
    gl_PointSize = (2.6 + 1.2 * blink) * uDpr;
    gl_Position = projectionMatrix * mv;
  }
`;

export const beaconFragment = /* glsl */ `
  precision highp float;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.55, 1.0, d)) * vAlpha;
    gl_FragColor = vec4(vec3(1.0), a);
  }
`;

export const starVertex = /* glsl */ `
  attribute float aSize;
  attribute float aBright;
  uniform float uDpr;
  varying float vBright;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vBright = aBright;
    gl_PointSize = aSize * uDpr;
    gl_Position = projectionMatrix * mv;
  }
`;

export const starFragment = /* glsl */ `
  precision highp float;
  varying float vBright;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.4, 1.0, d)) * vBright;
    gl_FragColor = vec4(vec3(1.0), a);
  }
`;

export const satelliteVertex = /* glsl */ `
  attribute vec3 aU;
  attribute vec3 aV;
  attribute float aRadius;
  attribute float aPhase;
  attribute float aSpeed;
  uniform vec3 uCenter;
  uniform float uTime;
  uniform float uDpr;
  void main() {
    float a = aPhase + uTime * aSpeed;
    vec3 p = uCenter + aRadius * (cos(a) * aU + sin(a) * aV);
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_PointSize = 3.2 * uDpr;
    gl_Position = projectionMatrix * mv;
  }
`;

export const satelliteFragment = /* glsl */ `
  precision highp float;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = 1.0 - smoothstep(0.5, 1.0, d);
    gl_FragColor = vec4(vec3(1.0), a);
  }
`;
