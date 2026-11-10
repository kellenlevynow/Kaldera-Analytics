// Procedural label atlas. Every estate on it is invented; the varietals and
// regions are generic. Drawn once on a canvas, deterministic by seed.
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';

export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 6;
export const TILE_W = 256;
export const TILE_H = 160;
export const LABEL_COUNT = ATLAS_COLS * ATLAS_ROWS;

export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOUSES = ['Château', 'Domaine', 'Clos', 'Tenuta', 'Bodega', 'Quinta', 'Weingut', 'Estate', 'Maison', 'Villa'];
const NAMES = [
  'Vallorne', 'Saint-Aubrac', 'Marrowfield', 'Haut-Brisac', 'Alderwyck', 'Pietranera', 'Los Olmos', 'Rosenbach', 'Silverthorn', 'Belmonte',
  'Coldwater', 'Sainte-Ysé', 'Mariposa', 'Vieux Pont', 'Kessler', 'Halcyon Bench', 'Terra Rossa', 'Montalvo', 'Ferreira', 'Oristano',
  'Lindqvist', 'Peregrine', 'Ashcombe', 'Val d’Orcia', 'Brennholz', 'Cerro Blanco', 'Whitlock', 'Nerione', 'Dos Cruces', 'Fallow Hill',
  'Isarco', 'Beaucastel', 'Harrowgate', 'Laurelin', 'Cinq Terres', 'Vosges', 'Orchard Bench', 'Rivière Noire', 'Montcalm', 'Greywacke',
  'Sorrell', 'Caldera Ridge', 'Ebenholz', 'Castelvero', 'Pinnacle', 'Dry Creek Bend', 'Bellefontaine', 'Ironstone'
];
const VARIETALS = ['Cabernet Sauvignon', 'Pinot Noir', 'Syrah', 'Nebbiolo', 'Tempranillo', 'Chardonnay', 'Riesling', 'Grenache', 'Merlot', 'Sangiovese', 'Malbec', 'Viognier', 'Zinfandel', 'Cabernet Franc'];
const DESIGNATIONS = ['Estate Reserve', 'Single Vineyard', 'Old Vines', 'Grand Cru', 'Premier Cru', 'Family Selection', 'Cuvée Prestige', 'Block 7', 'Hillside', 'Late Harvest', 'Riserva', 'Gran Reserva'];

interface Palette {
  paper: string;
  ink: string;
  accent: string;
  soft: string;
}

// Weighted toward cream and ivory paper with red or black ink, the classic claret look.
const PALETTES: Array<[Palette, number]> = [
  [{ paper: '#efe6d2', ink: '#1d1a17', accent: '#8a1c2b', soft: '#8b8371' }, 5],
  [{ paper: '#f4eedf', ink: '#2a2420', accent: '#7a1420', soft: '#9c968a' }, 4],
  [{ paper: '#e9dfc6', ink: '#2b2a28', accent: '#2f4a3a', soft: '#8d8a7c' }, 2],
  [{ paper: '#f7f3ea', ink: '#1a1f2e', accent: '#1a1f2e', soft: '#a0a3ad' }, 2],
  [{ paper: '#ecdfc4', ink: '#3b2414', accent: '#9a6a2c', soft: '#a99a7e' }, 2],
  [{ paper: '#fbf8f1', ink: '#161616', accent: '#b8972e', soft: '#9c968a' }, 2],
  [{ paper: '#111111', ink: '#f0ead8', accent: '#c9a84c', soft: '#7a7568' }, 1],
  [{ paper: '#5b1420', ink: '#f6e9d4', accent: '#d9b35a', soft: '#b08a8e' }, 0.6],
  [{ paper: '#1f2a24', ink: '#efe7d2', accent: '#c7b57a', soft: '#86917f' }, 0.5],
  [{ paper: '#f1e3d3', ink: '#4a1a1a', accent: '#c2452f', soft: '#b39a86' }, 1]
];

function pickPalette(rnd: () => number): Palette {
  const total = PALETTES.reduce((sum, [, w]) => sum + w, 0);
  let x = rnd() * total;
  for (const [palette, w] of PALETTES) {
    x -= w;
    if (x <= 0) return palette;
  }
  return PALETTES[0]![0];
}

const SERIF = "Georgia, 'Times New Roman', Times, serif";
const SANS = "'Barlow', 'Helvetica Neue', Arial, sans-serif";
const COND = "'Barlow Condensed', 'Barlow', 'Arial Narrow', sans-serif";

type Layout = 'classic' | 'modern' | 'initial' | 'band' | 'crest' | 'rule';
const LAYOUTS: Layout[] = ['classic', 'classic', 'crest', 'classic', 'rule', 'classic', 'modern', 'crest', 'classic', 'band', 'classic', 'initial'];

function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, font: (size: number) => string, start: number, min: number): number {
  let size = start;
  ctx.font = font(size);
  while (size > min && ctx.measureText(text).width > maxWidth) {
    size -= 1;
    ctx.font = font(size);
  }
  return size;
}

function wear(ctx: CanvasRenderingContext2D, rnd: () => number, w: number, h: number, dark: boolean): void {
  // Paper grain and a few flecks: imperfections that read at a glance, invisible from afar.
  ctx.save();
  ctx.globalAlpha = 0.12;
  for (let i = 0; i < 260; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    ctx.fillStyle = dark ? '#ffffff' : '#000000';
    ctx.globalAlpha = 0.03 + rnd() * 0.06;
    ctx.fillRect(x, y, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
  }
  // Soft vignette toward the edges, like a label that has been handled.
  const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, w * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, dark ? 'rgba(0,0,0,0.35)' : 'rgba(60,40,20,0.16)');
  ctx.globalAlpha = 1;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function crest(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, kind: number): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (kind === 0) {
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
    ctx.stroke();
  } else if (kind === 1) {
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // A vine leaf, simplified: three lobes.
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.ellipse(x + i * r * 0.55, y + Math.abs(i) * r * 0.25, r * 0.38, r * 0.7, i * 0.6, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(x, y + r * 0.7);
    ctx.lineTo(x, y + r * 1.3);
    ctx.stroke();
  }
  ctx.restore();
}

// An engraved estate: a house with a tower, trees and rows of vines in fine ink lines.
function engraving(ctx: CanvasRenderingContext2D, rnd: () => number, x: number, y: number, w: number, h: number, ink: string): void {
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 0.7;
  ctx.globalAlpha = 0.82;
  const gy = y + h * 0.68;
  // Horizon and a few distant hills.
  ctx.beginPath();
  ctx.moveTo(x, gy);
  ctx.lineTo(x + w, gy);
  ctx.stroke();
  ctx.globalAlpha = 0.4;
  ctx.beginPath();
  ctx.moveTo(x, gy - h * 0.12);
  ctx.quadraticCurveTo(x + w * 0.25, gy - h * 0.3, x + w * 0.5, gy - h * 0.14);
  ctx.quadraticCurveTo(x + w * 0.8, gy - h * 0.32, x + w, gy - h * 0.1);
  ctx.stroke();
  ctx.globalAlpha = 0.85;
  // Main house.
  const bw = w * (0.36 + rnd() * 0.1);
  const bh = h * 0.34;
  const bx = x + w * 0.5 - bw * 0.55;
  const by = gy - bh;
  ctx.strokeRect(bx, by, bw, bh);
  ctx.beginPath();
  ctx.moveTo(bx - 2, by);
  ctx.lineTo(bx + bw * 0.5, by - h * 0.16);
  ctx.lineTo(bx + bw + 2, by);
  ctx.stroke();
  // Tower on one side.
  const tw = bw * 0.24;
  const tx = rnd() < 0.5 ? bx + bw - tw * 0.3 : bx - tw * 0.7;
  const th = bh + h * 0.16;
  ctx.strokeRect(tx, gy - th, tw, th);
  ctx.beginPath();
  ctx.moveTo(tx - 1, gy - th);
  ctx.lineTo(tx + tw / 2, gy - th - h * 0.14);
  ctx.lineTo(tx + tw + 1, gy - th);
  ctx.stroke();
  // Windows.
  const cols = 3 + Math.floor(rnd() * 3);
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < cols; c++) {
      const wx = bx + bw * ((c + 0.5) / cols) - 1.2;
      const wy = by + bh * (0.22 + r * 0.4);
      ctx.fillRect(wx, wy, 2.4, 3.2);
    }
  }
  ctx.fillRect(tx + tw / 2 - 1, gy - th + th * 0.3, 2, 3);
  // Hatching on the shaded facade and the roof.
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 0.5;
  for (let i = 0; i < 8; i++) {
    const hx = bx + bw * 0.55 + (i / 8) * bw * 0.45;
    ctx.beginPath();
    ctx.moveTo(hx, by + 2);
    ctx.lineTo(hx - bh * 0.2, gy - 1);
    ctx.stroke();
  }
  // Trees.
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 0.6;
  const trees = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < trees; i++) {
    const cx = x + w * (0.06 + rnd() * 0.88);
    if (cx > bx - 6 && cx < bx + bw + 6) continue;
    const r = 3 + rnd() * 4;
    const cy = gy - r - 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + r * 0.3, cy - r * 0.2, r * 0.55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy + r);
    ctx.lineTo(cx, gy);
    ctx.stroke();
  }
  // Vine rows converging toward the house.
  ctx.globalAlpha = 0.6;
  const rows = 7;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const sx = x + w * t;
    const ex = x + w * 0.5 + (t - 0.5) * w * 0.35;
    ctx.beginPath();
    ctx.moveTo(sx, y + h);
    ctx.lineTo(ex, gy + 1);
    ctx.stroke();
  }
  for (let i = 1; i < 4; i++) {
    const yy = gy + (y + h - gy) * (i / 4);
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.02, yy);
    ctx.lineTo(x + w * 0.98, yy);
    ctx.stroke();
  }
  ctx.restore();
}

function drawLabel(ctx: CanvasRenderingContext2D, rnd: () => number, index: number): void {
  const w = TILE_W;
  const h = TILE_H;
  const pal = pickPalette(rnd);
  const layout = LAYOUTS[index % LAYOUTS.length] ?? 'classic';
  const house = HOUSES[Math.floor(rnd() * HOUSES.length)] ?? 'Domaine';
  const name = NAMES[(index * 7 + Math.floor(rnd() * 5)) % NAMES.length] ?? 'Vallorne';
  const varietal = VARIETALS[Math.floor(rnd() * VARIETALS.length)] ?? 'Pinot Noir';
  const designation = DESIGNATIONS[Math.floor(rnd() * DESIGNATIONS.length)] ?? 'Estate Reserve';
  const vintage = String(1996 + Math.floor(rnd() * 27));
  const dark = pal.paper === '#111111' || pal.paper === '#5b1420' || pal.paper === '#1f2a24';

  ctx.fillStyle = pal.paper;
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const pad = 14;

  switch (layout) {
    case 'classic': {
      const framed = rnd() < 0.5;
      if (framed) {
        ctx.strokeStyle = pal.accent;
        ctx.lineWidth = 1;
        ctx.strokeRect(pad - 5, pad - 5, w - 2 * (pad - 5), h - 2 * (pad - 5));
        ctx.strokeRect(pad - 2, pad - 2, w - 2 * (pad - 2), h - 2 * (pad - 2));
      }
      engraving(ctx, rnd, w * 0.24, 16, w * 0.52, 54, pal.ink);
      ctx.fillStyle = pal.ink;
      const size = fit(ctx, `${house} ${name}`, w - 2 * pad - 12, (s) => `italic ${s}px ${SERIF}`, 24, 14);
      ctx.font = `italic ${size}px ${SERIF}`;
      ctx.fillText(`${house} ${name}`, w / 2, 94);
      ctx.fillStyle = pal.soft;
      ctx.font = `500 8.5px ${SANS}`;
      ctx.fillText(designation.toUpperCase(), w / 2, 115);
      ctx.fillStyle = pal.ink;
      ctx.font = `500 8px ${SANS}`;
      ctx.fillText(varietal.toUpperCase(), w / 2, 128);
      ctx.fillStyle = pal.accent;
      ctx.font = `600 13px ${SANS}`;
      ctx.fillText(vintage, w / 2, 146);
      break;
    }
    case 'modern': {
      ctx.textAlign = 'left';
      ctx.fillStyle = pal.accent;
      ctx.fillRect(pad, pad, 4, h - 2 * pad);
      ctx.fillStyle = pal.ink;
      const size = fit(ctx, name.toUpperCase(), w - 2 * pad - 20, (s) => `600 ${s}px ${COND}`, 40, 20);
      ctx.font = `600 ${size}px ${COND}`;
      ctx.fillText(name.toUpperCase(), pad + 16, 46);
      ctx.fillStyle = pal.soft;
      ctx.font = `500 10px ${SANS}`;
      ctx.fillText(`${house.toUpperCase()}  ·  ${designation.toUpperCase()}`, pad + 16, 78);
      ctx.fillStyle = pal.ink;
      ctx.font = `400 13px ${SANS}`;
      ctx.fillText(varietal, pad + 16, 104);
      ctx.font = `500 22px ${COND}`;
      ctx.fillText(vintage, pad + 16, 132);
      break;
    }
    case 'initial': {
      ctx.fillStyle = pal.accent;
      ctx.font = `${h * 0.95}px ${SERIF}`;
      ctx.globalAlpha = dark ? 0.5 : 0.18;
      ctx.fillText(name.charAt(0), w * 0.72, h * 0.55);
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
      ctx.fillStyle = pal.soft;
      ctx.font = `500 9px ${SANS}`;
      ctx.fillText(designation.toUpperCase(), pad, 28);
      ctx.fillStyle = pal.ink;
      const size = fit(ctx, name, w * 0.72, (s) => `${s}px ${SERIF}`, 28, 15);
      ctx.font = `${size}px ${SERIF}`;
      ctx.fillText(name, pad, 60);
      ctx.font = `italic 12px ${SERIF}`;
      ctx.fillText(varietal, pad, 90);
      ctx.font = `500 13px ${SANS}`;
      ctx.fillText(vintage, pad, 126);
      break;
    }
    case 'band': {
      ctx.fillStyle = pal.accent;
      ctx.fillRect(0, 0, w, 30);
      ctx.fillRect(0, h - 22, w, 22);
      ctx.fillStyle = pal.paper;
      ctx.font = `500 10px ${SANS}`;
      ctx.fillText(house.toUpperCase(), w / 2, 15);
      ctx.fillText(`${vintage}  ·  750 ML`, w / 2, h - 11);
      ctx.fillStyle = pal.ink;
      const size = fit(ctx, name, w - 2 * pad, (s) => `${s}px ${SERIF}`, 32, 16);
      ctx.font = `${size}px ${SERIF}`;
      ctx.fillText(name, w / 2, 72);
      ctx.fillStyle = pal.soft;
      ctx.font = `500 11px ${SANS}`;
      ctx.fillText(varietal.toUpperCase(), w / 2, 108);
      break;
    }
    case 'crest': {
      if (index % 3 === 2) engraving(ctx, rnd, w * 0.3, 14, w * 0.4, 44, pal.ink);
      else crest(ctx, w / 2, 42, 18, pal.accent, index % 3);
      ctx.fillStyle = pal.ink;
      const size = fit(ctx, name, w - 2 * pad, (s) => `${s}px ${SERIF}`, 26, 14);
      ctx.font = `${size}px ${SERIF}`;
      ctx.fillText(name, w / 2, 88);
      ctx.fillStyle = pal.soft;
      ctx.font = `500 9px ${SANS}`;
      ctx.fillText(`${house.toUpperCase()}  ·  ${varietal.toUpperCase()}`, w / 2, 112);
      ctx.fillStyle = pal.accent;
      ctx.font = `600 14px ${SANS}`;
      ctx.fillText(vintage, w / 2, 136);
      break;
    }
    case 'rule':
    default: {
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = 1;
      for (const y of [pad, h - pad]) {
        ctx.beginPath();
        ctx.moveTo(pad, y);
        ctx.lineTo(w - pad, y);
        ctx.stroke();
      }
      ctx.fillStyle = pal.ink;
      const size = fit(ctx, name.toUpperCase(), w - 2 * pad, (s) => `500 ${s}px ${SANS}`, 20, 11);
      ctx.font = `500 ${size}px ${SANS}`;
      ctx.fillText(name.toUpperCase(), w / 2, 54);
      ctx.fillStyle = pal.soft;
      ctx.font = `400 11px ${SANS}`;
      ctx.fillText(designation, w / 2, 80);
      ctx.fillStyle = pal.ink;
      ctx.font = `italic 13px ${SERIF}`;
      ctx.fillText(`${varietal}  ${vintage}`, w / 2, 106);
      ctx.fillStyle = pal.accent;
      ctx.fillRect(w / 2 - 3, 126, 6, 6);
      break;
    }
  }
  wear(ctx, rnd, w, h, dark);
}

export function buildLabelAtlas(seed = 2026): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TILE_W * ATLAS_COLS;
  canvas.height = TILE_H * ATLAS_ROWS;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D context for the label atlas');
  const rnd = mulberry(seed);
  for (let i = 0; i < LABEL_COUNT; i++) {
    const col = i % ATLAS_COLS;
    const row = Math.floor(i / ATLAS_COLS);
    ctx.save();
    ctx.translate(col * TILE_W, row * TILE_H);
    ctx.beginPath();
    ctx.rect(0, 0, TILE_W, TILE_H);
    ctx.clip();
    drawLabel(ctx, rnd, i);
    ctx.restore();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = true;
  texture.flipY = true;
  return texture;
}

// Tile rectangle in atlas UV space for label i: offset x, offset y, scale x, scale y.
// Atlas rows count from the top of the canvas; with flipY the first row sits at v near 1.
export function tileRect(i: number): [number, number, number, number] {
  const col = i % ATLAS_COLS;
  const row = Math.floor(i / ATLAS_COLS);
  const sx = 1 / ATLAS_COLS;
  const sy = 1 / ATLAS_ROWS;
  const inset = 0.004;
  return [col * sx + inset, 1 - (row + 1) * sy + inset, sx - 2 * inset, sy - 2 * inset];
}

// The hero's label: the only monochrome label in the pile.
export function buildHeroLabel(): CanvasTexture {
  const w = 512;
  const h = 320;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D context for the hero label');
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(22, 22, w - 44, h - 44);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#a7a7a7';
  ctx.font = `500 15px ${SANS}`;
  ctx.letterSpacing = '5px';
  ctx.fillText('ESTATE RESERVE', w / 2, 62);
  ctx.fillStyle = '#ffffff';
  ctx.font = `600 86px ${COND}`;
  ctx.letterSpacing = '12px';
  ctx.fillText('KALDERA', w / 2 + 6, 140);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.moveTo(w / 2 - 70, 192);
  ctx.lineTo(w / 2 + 70, 192);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = `500 15px ${SANS}`;
  ctx.letterSpacing = '4px';
  ctx.fillText('THE ONE YOU WERE LOOKING FOR', w / 2, 222);
  ctx.fillStyle = '#a7a7a7';
  ctx.font = `500 13px ${SANS}`;
  ctx.letterSpacing = '4px';
  ctx.fillText('BOISE, IDAHO  ·  43.61° N  116.20° W', w / 2, 262);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 8;
  return texture;
}
