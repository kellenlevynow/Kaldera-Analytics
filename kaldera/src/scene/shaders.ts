// GLSL for the custom materials. Linear light, converted to sRGB at the end.

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
  float fogFactor(float dist, float density) {
    float x = dist * density;
    return 1.0 - exp(-x * x);
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
  uniform float uExposure;
  uniform vec3 uEarthshine;
  uniform float uContour;
  uniform float uContourSpacing;
  uniform float uIce;
  uniform float uTime;
  uniform float uFogDensity;
  varying vec3 vWorld;
  varying float vDist;
  ${common}
  void main() {
    // Sun-aligned bake space.
    vec2 g = vec2(vWorld.x * uSunRot.x + vWorld.z * uSunRot.y, -vWorld.x * uSunRot.y + vWorld.z * uSunRot.x);
    float gr = max(abs(g.x), abs(g.y));
    vec4 nearData = texture2D(uNear, g / (2.0 * uNearHalf) + 0.5);
    vec4 farData = texture2D(uFar, g / (2.0 * uFarHalf) + 0.5);
    float wNear = 1.0 - smoothstep(uNearHalf * 0.86, uNearHalf * 0.97, gr);
    float wFar = (1.0 - wNear) * (1.0 - smoothstep(uFarHalf * 0.9, uFarHalf * 0.99, gr)) * uFarReady;
    vec4 data = nearData * wNear + farData * wFar + vec4(0.5, 0.5, 1.0, 1.0) * (1.0 - wNear - wFar);
    vec2 nxz = data.rg * 2.0 - 1.0;
    vec3 n = normalize(vec3(nxz.x, sqrt(max(0.0, 1.0 - dot(nxz, nxz))), nxz.y));
    float shade = data.b;

    // Fine regolith grain near the camera: two rotated octaves so no lattice shows,
    // faded out at grazing view angles where it would smear into streaks.
    vec3 viewDir = normalize(cameraPosition - vWorld);
    float detail = (1.0 - smoothstep(0.8, 4.0, vDist)) * smoothstep(0.12, 0.45, abs(dot(viewDir, n)));
    if (detail > 0.001) {
      vec2 p1 = vWorld.xz * 23.0;
      vec2 p2 = vec2(vWorld.x * 0.83 - vWorld.z * 0.56, vWorld.x * 0.56 + vWorld.z * 0.83) * 61.0;
      float e = 0.4;
      vec2 g1 = vec2(vnoise(p1 + vec2(e, 0.0)) - vnoise(p1 - vec2(e, 0.0)), vnoise(p1 + vec2(0.0, e)) - vnoise(p1 - vec2(0.0, e)));
      vec2 g2 = vec2(vnoise(p2 + vec2(e, 0.0)) - vnoise(p2 - vec2(e, 0.0)), vnoise(p2 + vec2(0.0, e)) - vnoise(p2 - vec2(0.0, e)));
      vec2 grad = g1 * 0.05 + g2 * 0.03;
      n = normalize(n + vec3(-grad.x, 0.0, -grad.y) * detail);
    }

    float ndl = max(dot(n, uSunDir), 0.0);
    float lit = pow(ndl, 0.8) * shade;

    float albedo = 0.5;
    albedo += 0.05 * (vnoise(vWorld.xz * 0.22) - 0.5);
    albedo += 0.035 * (vnoise(vWorld.xz * 1.7) - 0.5);
    albedo += 0.03 * (vnoise(vWorld.xz * 11.0) - 0.5) * detail;

    vec3 color = vec3(albedo) * (lit * uExposure);
    color += albedo * uEarthshine * (0.55 + 0.45 * max(n.y, 0.0));

    // Survey contours: white hairlines at fixed height intervals, index lines stronger.
    float hc = vWorld.y / uContourSpacing;
    float fw = fwidth(hc);
    float f = abs(fract(hc + 0.5) - 0.5);
    float line = 1.0 - smoothstep(0.0, max(fw * 1.4, 0.004), f);
    float density = clamp(1.0 - fw * 2.2, 0.0, 1.0);
    float idx = floor(hc + 0.5);
    float major = 1.0 - min(abs(mod(idx, 5.0)), 1.0);
    // Survey lines read in the shadow; on lit ground they stay faint and fade with distance.
    float contourWeight = mix(1.0, 0.3, clamp(lit * 3.0, 0.0, 1.0)) * (1.0 - smoothstep(14.0, 34.0, vDist));
    float contour = line * density * uContour * mix(0.4, 1.0, major) * contourWeight;
    color = mix(color, vec3(1.0), contour);

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
      color += speck * floorMask * uIce * 0.8;
    }

    float edge = 1.0 - smoothstep(uFarHalf * 1.9, uFarHalf * 2.8, length(vWorld.xz));
    color = mix(color, vec3(0.0), fogFactor(vDist, uFogDensity)) * mix(0.35, 1.0, edge);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

export const structureVertex = /* glsl */ `
  attribute float aAlbedo;
  attribute float aShade;
  varying vec3 vNormal;
  varying float vAlbedo;
  varying float vShade;
  varying float vDist;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
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
  uniform float uExposure;
  uniform vec3 uEarthshine;
  uniform float uFogDensity;
  varying vec3 vNormal;
  varying float vAlbedo;
  varying float vShade;
  varying float vDist;
  ${common}
  void main() {
    vec3 n = normalize(vNormal);
    float ndl = max(dot(n, uSunDir), 0.0);
    // Direct sun plus bounce from the lit regolith around the installation.
    float bounce = (0.1 + 0.08 * (0.5 - 0.5 * n.y)) * vShade;
    vec3 color = vec3(vAlbedo) * (ndl * vShade * uExposure + bounce) + vAlbedo * uEarthshine;
    color = mix(color, vec3(0.0), fogFactor(vDist, uFogDensity));
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
    a *= 1.0 - fogFactor(vDist, uFogDensity);
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
