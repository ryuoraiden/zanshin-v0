// Dev-only preview: serves the extension pages over http with a fake chrome.* API injected, so the
// UI can be checked in a normal browser tab. Not part of the extension.
// Run: node tools/preview-server.mjs   then open http://localhost:5178
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || 5178;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json',
};
const INJECT = '<script src="/tools/chrome-stub.js"></script><script type="module" src="/tools/stub-seed.mjs"></script>';

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let path = decodeURIComponent(url.pathname);
  if (path === '/') path = '/tools/preview.html';
  // Mock Seek: course pages and the outline API, for checking the "Add to Zanshin" panel.
  if (path.startsWith('/courses/')) path = '/tools/seek-mock.html';
  if (path === '/api/v2/user/course/') path = '/tests/fixtures/seek-course.json';
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    let body = await readFile(file);
    if (extname(file) === '.html' && path.startsWith('/pages/')) body = Buffer.from(body.toString().replace('<head>', `<head>${INJECT}`));
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => console.log(`Zanshin preview on http://localhost:${PORT}`));
