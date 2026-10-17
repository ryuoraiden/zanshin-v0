// Generates the ensō toolbar icons as PNGs. No dependencies: raw PNG chunks + zlib.
// Run: node tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const COLOR = [229, 83, 61]; // vermilion
const START = (-55 * Math.PI) / 180; // stroke starts upper right
const SWEEP = (315 * Math.PI) / 180; // leaves a gap before closing

function coverage(x, y, size) {
  const c = size / 2;
  const R = size * 0.33;
  const base = Math.max(size * 0.16, 2.2);
  const dx = x - c;
  const dy = y - c;
  const d = Math.hypot(dx, dy);
  let a = Math.atan2(dy, dx) - START;
  a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const t = a / SWEEP;
  if (t > 1) return 0;
  // brush: heavy at the start, thinning out, tapered tail
  let w = base * (1.05 - 0.45 * t);
  w *= Math.min(1, (1 - t) / 0.18);
  w *= Math.min(1, 0.55 + t / 0.06);
  return Math.abs(d - R) < w / 2 ? 1 : 0;
}

function png(size) {
  const SS = 4;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) hit += coverage(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS, size);
      const alpha = Math.round((255 * hit) / (SS * SS));
      row.set([...COLOR, alpha], 1 + x * 4);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = new URL('../icons/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const size of [16, 32, 48, 128]) writeFileSync(new URL(`icon${size}.png`, out), png(size));
console.log('icons written');
