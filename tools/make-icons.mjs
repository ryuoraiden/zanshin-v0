// Builds every Zanshin icon from the brush calligraphy in icons/source/zanshin-brush.png.
//
// Everything is vermilion ink on transparent with the double ring dropped and the characters
// cropped tight. 48 px, 128 px and the page logo (icons/brand.png) show 残心. The toolbar
// (16 and 32 px) shows 残 alone: it's tall and dense enough to keep its shape at 16 px, and its
// top half stays visible above the session badge. Small sizes also get their strokes thickened
// before downscaling and their edges sharpened after. The other cuts (seals, 心 alone, the full
// ringed piece) stay available through --variants for comparing.
//
// No dependencies: PNG decode/encode with node:zlib.
//   node tools/make-icons.mjs                    writes icons/
//   node tools/make-icons.mjs --variants <dir>   writes every candidate cut, for comparing
import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const VERMILION = [229, 83, 61];
const PAPER = [255, 247, 240];

// Which cut ships at which size.
const SHIP = { 16: 'ink-zan', 32: 'ink-zan', 48: 'ink-both', 128: 'ink-both' };

// ---------------------------------------------------------------------------------------------
// PNG

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

function encodePng(w, h, rgba) {
  const rows = [];
  for (let y = 0; y < h; y++) rows.push(Buffer.from([0]), rgba.subarray(y * w * 4, (y + 1) * w * 4));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function decodePng(buf) {
  let pos = 8;
  let w, h, depth, ctype, interlace;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      ctype = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype];
  if (depth !== 8 || interlace !== 0 || !channels) throw new Error('Only 8-bit, non-interlaced grey/RGB/RGBA PNGs');
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const s = x * channels;
      const d = (y * w + x) * 4;
      if (channels >= 3) {
        out[d] = line[s];
        out[d + 1] = line[s + 1];
        out[d + 2] = line[s + 2];
        out[d + 3] = channels === 4 ? line[s + 3] : 255;
      } else {
        out[d] = out[d + 1] = out[d + 2] = line[s];
        out[d + 3] = channels === 2 ? line[s + 1] : 255;
      }
    }
    prev = line;
  }
  return { w, h, rgba: out };
}

// ---------------------------------------------------------------------------------------------
// Masks: Float32 coverage in [0, 1], { w, h, m }

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function inkMask({ w, h, rgba }) {
  const m = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const lum = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    m[i] = clamp01((230 - lum) / 195) * (rgba[i * 4 + 3] / 255);
  }
  return { w, h, m };
}

// 8-connected components over pixels with coverage above `thr`.
function components({ w, h, m }, thr = 0.1) {
  const label = new Int32Array(w * h).fill(-1);
  const comps = [];
  const stack = [];
  for (let start = 0; start < w * h; start++) {
    if (m[start] <= thr || label[start] !== -1) continue;
    const id = comps.length;
    const c = { id, x0: w, y0: h, x1: 0, y1: 0, count: 0 };
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop();
      const x = p % w;
      const y = (p - x) / w;
      c.count++;
      c.x0 = Math.min(c.x0, x);
      c.x1 = Math.max(c.x1, x);
      c.y0 = Math.min(c.y0, y);
      c.y1 = Math.max(c.y1, y);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (m[q] > thr && label[q] === -1) {
            label[q] = id;
            stack.push(q);
          }
        }
    }
    comps.push(c);
  }
  return { label, comps };
}

// Keeps only the characters: drops the rings (components spanning most of the width) and specks.
function charactersOnly(M) {
  const { label, comps } = components(M);
  const keep = new Set(comps.filter((c) => c.x1 - c.x0 < 0.8 * M.w && c.count >= 12).map((c) => c.id));
  const m = new Float32Array(M.m.length);
  for (let i = 0; i < m.length; i++) if (keep.has(label[i])) m[i] = M.m[i];
  return { w: M.w, h: M.h, m };
}

function bbox({ w, h, m }, thr = 0.05) {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (m[y * w + x] > thr) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  return { x0, y0, x1, y1 };
}

// Splits 残 (top) from 心 (bottom) at the emptiest row in the middle band.
function splitRow(M) {
  const b = bbox(M);
  const from = Math.round(b.y0 + 0.38 * (b.y1 - b.y0));
  const to = Math.round(b.y0 + 0.62 * (b.y1 - b.y0));
  let best = from;
  let bestSum = Infinity;
  for (let y = from; y <= to; y++) {
    let sum = 0;
    for (let x = 0; x < M.w; x++) sum += M.m[y * M.w + x];
    if (sum < bestSum) {
      bestSum = sum;
      best = y;
    }
  }
  return best;
}

function rows(M, y0, y1) {
  const m = new Float32Array(M.m.length);
  for (let y = y0; y < y1; y++) for (let x = 0; x < M.w; x++) m[y * M.w + x] = M.m[y * M.w + x];
  return { w: M.w, h: M.h, m };
}

// Crops to the ink and centres it in a square where it fills `fill` of the side.
function cropSquare(M, fill) {
  const b = bbox(M);
  const bw = b.x1 - b.x0 + 1;
  const bh = b.y1 - b.y0 + 1;
  const S = Math.ceil(Math.max(bw, bh) / fill);
  const ox = Math.round((S - bw) / 2) - b.x0;
  const oy = Math.round((S - bh) / 2) - b.y0;
  const m = new Float32Array(S * S);
  for (let y = b.y0; y <= b.y1; y++)
    for (let x = b.x0; x <= b.x1; x++) {
      const tx = x + ox;
      const ty = y + oy;
      if (tx >= 0 && ty >= 0 && tx < S && ty < S) m[ty * S + tx] = M.m[y * M.w + x];
    }
  return { w: S, h: S, m };
}

// Grey-scale dilation with a disc: thickens strokes so thin brush tails survive the downscale.
function dilate(M, r) {
  if (r < 0.5) return M;
  const { w, h } = M;
  const R = Math.ceil(r);
  const offs = [];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= r * r) offs.push([dx, dy]);
  const m = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (const [dx, dy] of offs) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && M.m[ny * w + nx] > v) v = M.m[ny * w + nx];
      }
      m[y * w + x] = v;
    }
  return { w, h, m };
}

// Area-average downscale (box filter with fractional edges), separable.
function resample(M, N) {
  const s = M.w / N;
  const tmp = new Float32Array(N * M.h);
  for (let y = 0; y < M.h; y++)
    for (let x = 0; x < N; x++) {
      const a = x * s;
      const b = (x + 1) * s;
      let sum = 0;
      for (let i = Math.floor(a); i < Math.ceil(b); i++) sum += M.m[y * M.w + Math.min(i, M.w - 1)] * (Math.min(i + 1, b) - Math.max(i, a));
      tmp[y * N + x] = sum / s;
    }
  const m = new Float32Array(N * N);
  for (let x = 0; x < N; x++)
    for (let y = 0; y < N; y++) {
      const a = y * s;
      const b = (y + 1) * s;
      let sum = 0;
      for (let i = Math.floor(a); i < Math.ceil(b); i++) sum += tmp[Math.min(i, M.h - 1) * N + x] * (Math.min(i + 1, b) - Math.max(i, a));
      m[y * N + x] = sum / s;
    }
  return { w: N, h: N, m };
}

function levels(M, lo, hi) {
  const m = M.m.map((v) => clamp01((v - lo) / (hi - lo)));
  return { w: M.w, h: M.h, m };
}

// Anti-aliased seal shape at N px: 'square' (rounded, like a hanko) or 'disc'.
function shape(N, kind) {
  const m = new Float32Array(N * N);
  const SS = 4;
  const inset = N <= 16 ? 0.5 : 1;
  const r = kind === 'disc' ? N / 2 - inset : N * 0.2;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          if (kind === 'disc') hit += Math.hypot(px - N / 2, py - N / 2) <= r ? 1 : 0;
          else {
            const qx = Math.max(Math.abs(px - N / 2) - (N / 2 - inset - r), 0);
            const qy = Math.max(Math.abs(py - N / 2) - (N / 2 - inset - r), 0);
            hit += Math.hypot(qx, qy) <= r ? 1 : 0;
          }
        }
      m[y * N + x] = hit / (SS * SS);
    }
  return { w: N, h: N, m };
}

// ---------------------------------------------------------------------------------------------
// Compositing

function inkRgba(M, rgb) {
  const out = Buffer.alloc(M.w * M.h * 4);
  for (let i = 0; i < M.m.length; i++) out.set([...rgb, Math.round(M.m[i] * 255)], i * 4);
  return out;
}

// Vermilion seal with the characters knocked out in paper white.
function sealRgba(seal, chars) {
  const out = Buffer.alloc(seal.w * seal.h * 4);
  for (let i = 0; i < seal.m.length; i++) {
    const c = chars.m[i];
    const rgb = VERMILION.map((v, k) => Math.round(v + (PAPER[k] - v) * c));
    out.set([...rgb, Math.round(seal.m[i] * 255)], i * 4);
  }
  return out;
}

// Thickening in target pixels: more at small sizes, none at 128.
const THICKEN = { 16: 0.55, 32: 0.35, 48: 0.2, 128: 0 };
const thickenAt = (M, N, extra = 0) => dilate(M, ((THICKEN[N] ?? 0) + extra) * (M.w / N));

function render(name, N, art) {
  const { full, chars, kokoro, zan } = art;
  const crisp = (M) => (N <= 32 ? levels(M, 0.12, 0.78) : M);
  switch (name) {
    case 'full': {
      const M = resample(thickenAt(full, N), N);
      return inkRgba(N <= 48 ? levels(M, 0.05, 0.85) : M, VERMILION);
    }
    case 'ink-both':
      return inkRgba(crisp(resample(thickenAt(cropSquare(chars, 0.96), N), N)), VERMILION);
    case 'ink-kokoro':
      return inkRgba(crisp(resample(thickenAt(cropSquare(kokoro, 0.96), N), N)), VERMILION);
    case 'seal-both':
      return sealRgba(shape(N, 'square'), crisp(resample(thickenAt(cropSquare(chars, 0.8), N), N)));
    case 'seal-kokoro':
      return sealRgba(shape(N, 'square'), crisp(resample(thickenAt(cropSquare(kokoro, 0.78), N), N)));
    case 'disc-both':
      return sealRgba(shape(N, 'disc'), crisp(resample(thickenAt(cropSquare(chars, 0.66), N), N)));
    case 'disc-kokoro':
      return sealRgba(shape(N, 'disc'), crisp(resample(thickenAt(cropSquare(kokoro, 0.64), N), N)));
    case 'ink-zan':
      return inkRgba(crisp(resample(thickenAt(cropSquare(zan, 0.96), N), N)), VERMILION);
    case 'seal-zan':
      return sealRgba(shape(N, 'square'), crisp(resample(thickenAt(cropSquare(zan, 0.78), N), N)));
    case 'disc-zan':
      return sealRgba(shape(N, 'disc'), crisp(resample(thickenAt(cropSquare(zan, 0.64), N), N)));
  }
  throw new Error(`unknown cut ${name}`);
}

function loadArt() {
  const src = decodePng(readFileSync(new URL('../icons/source/zanshin-brush.png', import.meta.url)));
  const full = inkMask(src);
  const chars = charactersOnly(full);
  const split = splitRow(chars);
  return { full, chars, kokoro: rows(chars, split, chars.h), zan: rows(chars, 0, split) };
}

const art = loadArt();
const argIdx = process.argv.indexOf('--variants');
if (argIdx !== -1) {
  const dir = process.argv[argIdx + 1];
  mkdirSync(dir, { recursive: true });
  const cuts = ['full', 'ink-both', 'ink-kokoro', 'ink-zan', 'seal-both', 'seal-kokoro', 'seal-zan', 'disc-both', 'disc-kokoro', 'disc-zan'];
  for (const name of cuts)
    for (const N of [16, 32, 48, 128]) writeFileSync(`${dir}/${name}-${N}.png`, encodePng(N, N, render(name, N, art)));
  console.log(`variants written to ${dir}`);
} else {
  const out = new URL('../icons/', import.meta.url);
  for (const [N, name] of Object.entries(SHIP)) writeFileSync(new URL(`icon${N}.png`, out), encodePng(+N, +N, render(name, +N, art)));
  // Page logo: 残心 at the source's own resolution, never upscaled.
  const logo = cropSquare(art.chars, 0.96);
  writeFileSync(new URL('brand.png', out), encodePng(logo.w, logo.h, inkRgba(logo, VERMILION)));
  console.log('icons written');
}
