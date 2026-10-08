#!/usr/bin/env node
/**
 * Génère les icônes PNG de l'application (œil de vigie blanc sur le vert Skazy Formation).
 *   node scripts/generate-icons.js
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'site', 'assets', 'img');
const GREEN = [0x50, 0x96, 0x7c];

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

/** Dessin dans un repère 64 × 64 ; renvoie [fond, blanc] pour un point. */
function sample(x, y, { maskable }) {
  let inBackground = true;
  if (!maskable) {
    const r = 14;
    const cx = Math.min(Math.max(x, r), 64 - r);
    const cy = Math.min(Math.max(y, r), 64 - r);
    inBackground = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  }
  // En version « maskable », le motif est réduit pour rester dans la zone sûre.
  const scale = maskable ? 0.72 : 1;
  const px = 32 + (x - 32) / scale;
  const py = 32 + (y - 32) / scale;
  const a = 22;
  const b = 14.5;
  const R = (a * a + b * b) / (2 * b);
  const d = R - b;
  const half = 2.25;
  const inside = (radius) => Math.hypot(px - 32, py - (32 + d)) <= radius && Math.hypot(px - 32, py - (32 - d)) <= radius;
  const outline = inside(R + half) && !inside(R - half);
  const pupil = Math.hypot(px - 32, py - 32) <= 7;
  return [inBackground, inBackground && (outline || pupil)];
}

function render(size, options) {
  const rgba = Buffer.alloc(size * size * 4);
  const steps = 4;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let bg = 0;
      let white = 0;
      for (let sy = 0; sy < steps; sy += 1) {
        for (let sx = 0; sx < steps; sx += 1) {
          const [inBg, isWhite] = sample(((x + (sx + 0.5) / steps) / size) * 64, ((y + (sy + 0.5) / steps) / size) * 64, options);
          if (inBg) bg += 1;
          if (isWhite) white += 1;
        }
      }
      const total = steps * steps;
      const alpha = bg / total;
      const w = bg ? white / bg : 0;
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c += 1) rgba[i + c] = Math.round(GREEN[c] * (1 - w) + 255 * w);
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, rgba);
}

writeFileSync(path.join(OUT, 'icon-192.png'), render(192, { maskable: false }));
writeFileSync(path.join(OUT, 'icon-512.png'), render(512, { maskable: false }));
writeFileSync(path.join(OUT, 'icon-maskable-512.png'), render(512, { maskable: true }));
console.log('Icônes générées dans site/assets/img');
