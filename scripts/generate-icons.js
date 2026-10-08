#!/usr/bin/env node
/**
 * Génère les icônes PNG de l'application à partir de site/assets/img/favicon.svg :
 * jumelles blanches (Font Awesome Free, CC BY 4.0) sur un dégradé jaune,
 * la couleur de Vigie dans l'arc-en-ciel des outils Skazy Formation.
 *   node scripts/generate-icons.js
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'site', 'assets', 'img');

// Couleurs, position et tracé lus dans le SVG : les PNG restent identiques au favicon.
const svg = readFileSync(path.join(OUT, 'favicon.svg'), 'utf8');
const STOPS = [...svg.matchAll(/stop-color="#([0-9a-f]{6})"/gi)].map(([, hex]) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)));
const [, TX, TY, SCALE] = /translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+)\)/.exec(svg).map(Number);
const PATH = /<path[^>]* d="([^"]+)"/.exec(svg)[1];
const RADIUS = Number(/rx="([\d.]+)"/.exec(svg)[1]);

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // profondeur
  header[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Tracé SVG (M, L, H, V, C, Z, absolus ou relatifs) converti en polygones, courbes découpées en segments. */
function polygons(d) {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g);
  const shapes = [];
  let shape = null;
  let x = 0;
  let y = 0;
  let command = '';
  let i = 0;
  const number = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) command = tokens[i++];
    const relative = command === command.toLowerCase();
    const ox = relative ? x : 0;
    const oy = relative ? y : 0;
    switch (command.toUpperCase()) {
      case 'M':
        x = ox + number();
        y = oy + number();
        shape = [[x, y]];
        shapes.push(shape);
        command = relative ? 'l' : 'L'; // les paires suivantes sont des lignes
        break;
      case 'L':
        x = ox + number();
        y = oy + number();
        shape.push([x, y]);
        break;
      case 'H':
        x = ox + number();
        shape.push([x, y]);
        break;
      case 'V':
        y = oy + number();
        shape.push([x, y]);
        break;
      case 'C': {
        const [x1, y1, x2, y2, x3, y3] = [ox + number(), oy + number(), ox + number(), oy + number(), ox + number(), oy + number()];
        for (let step = 1; step <= 16; step += 1) {
          const t = step / 16;
          const u = 1 - t;
          shape.push([u ** 3 * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x3, u ** 3 * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y3]);
        }
        x = x3;
        y = y3;
        break;
      }
      case 'Z':
        [x, y] = shape[0];
        shape = [[x, y]];
        shapes.push(shape);
        break;
      default:
        throw new Error(`Commande de tracé non prise en charge : ${command}`);
    }
  }
  return shapes.filter((points) => points.length > 2);
}

/** Segments du pictogramme dans le repère 64 × 64, réduit de « glyph » autour du centre. */
function edges(glyph) {
  const list = [];
  for (const points of polygons(PATH)) {
    const mapped = points.map(([px, py]) => [32 + (TX + px * SCALE - 32) * glyph, 32 + (TY + py * SCALE - 32) * glyph]);
    for (let k = 0; k < mapped.length; k += 1) {
      const [x0, y0] = mapped[k];
      const [x1, y1] = mapped[(k + 1) % mapped.length];
      if (y0 !== y1) list.push({ x0, y0, x1, y1, dir: y1 > y0 ? 1 : -1 });
    }
  }
  return list;
}

/** Parties d'une ligne horizontale situées dans le pictogramme (règle « nonzero » du SVG). */
function spans(list, y) {
  const crossings = [];
  for (const { x0, y0, x1, y1, dir } of list) {
    if ((y >= y0 && y < y1) || (y >= y1 && y < y0)) crossings.push([x0 + ((y - y0) / (y1 - y0)) * (x1 - x0), dir]);
  }
  crossings.sort((a, b) => a[0] - b[0]);
  const result = [];
  let winding = 0;
  for (const [cx, dir] of crossings) {
    const before = winding;
    winding += dir;
    if (before === 0 && winding !== 0) result.push([cx, cx]);
    else if (before !== 0 && winding === 0) result[result.length - 1][1] = cx;
  }
  return result;
}

/**
 * rounded : coins arrondis transparents (favicon, icônes d'application) ;
 * sinon fond plein (icône « maskable » et icône Apple, que le système découpe lui-même).
 */
function render(size, { rounded = true, glyph = 1 } = {}) {
  const list = edges(glyph);
  const steps = 4;
  const rgba = Buffer.alloc(size * size * 4);
  const background = new Float64Array(size * size);
  const white = new Float64Array(size * size);
  for (let row = 0; row < size * steps; row += 1) {
    const y = ((row + 0.5) / (size * steps)) * 64;
    const inside = spans(list, y);
    const py = Math.floor(row / steps);
    for (let col = 0; col < size * steps; col += 1) {
      const x = ((col + 0.5) / (size * steps)) * 64;
      if (rounded) {
        const cx = Math.min(Math.max(x, RADIUS), 64 - RADIUS);
        const cy = Math.min(Math.max(y, RADIUS), 64 - RADIUS);
        if ((x - cx) ** 2 + (y - cy) ** 2 > RADIUS * RADIUS) continue;
      }
      const index = py * size + Math.floor(col / steps);
      background[index] += 1;
      if (inside.some(([from, to]) => x >= from && x <= to)) white[index] += 1;
    }
  }
  const samples = steps * steps;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const index = py * size + px;
      // Dégradé en diagonale, du coin haut gauche au coin bas droit.
      const t = (px + py + 1) / (2 * size);
      const share = background[index] ? white[index] / background[index] : 0;
      for (let c = 0; c < 3; c += 1) {
        const base = STOPS[0][c] * (1 - t) + STOPS[1][c] * t;
        rgba[index * 4 + c] = Math.round(base * (1 - share) + 255 * share);
      }
      rgba[index * 4 + 3] = Math.round((background[index] / samples) * 255);
    }
  }
  return encodePng(size, rgba);
}

writeFileSync(path.join(OUT, 'favicon-32.png'), render(32));
writeFileSync(path.join(OUT, 'icon-192.png'), render(192));
writeFileSync(path.join(OUT, 'icon-512.png'), render(512));
// Zone sûre des icônes « maskable » : un cercle de 80 % du côté.
writeFileSync(path.join(OUT, 'icon-maskable-512.png'), render(512, { rounded: false, glyph: 0.85 }));
writeFileSync(path.join(OUT, 'apple-touch-icon.png'), render(180, { rounded: false }));
console.log('Icônes générées dans site/assets/img');
