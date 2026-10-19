// Recognises task links from the sites Zanshin imports from, and gives every task an identity
// key so the same problem or lecture is never added twice. Pure.
//
//   codeforces.com/problemset/problem/580/A    cf:580A     -> Codeforces task (auto-completes on AC)
//   leetcode.com/problems/two-sum/             lc:two-sum
//   takeuforward.org/practice/dsa/upper-bound  tuf:upper-bound
//   geeksforgeeks.org/problems/...             gfg:...
//   youtube.com/watch?v=ID, youtu.be/ID        yt:ID       -> Lecture task
//   seek.onlinedegree.iitm.ac.in/courses/ns_x?id=37   seek:ns_x:37
//   anything else                              url:host/path
import { cleanUrl, videoIdFromUrl } from './urls.js';
import { parseProblem, problemKey } from './codeforces.js';

export const SEEK_ORIGIN = 'https://seek.onlinedegree.iitm.ac.in';

export function namespaceFromUrl(url) {
  const m = String(url || '').match(/\/courses\/(ns_[A-Za-z0-9_]+)/);
  return m ? m[1] : null;
}

const SMALL = new Set(['a', 'an', 'and', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'with']);

// "find-target-indices-after-sorting-array" -> "Find Target Indices After Sorting Array"
export function slugTitle(slug) {
  return String(slug || '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

const DSA_KINDS = new Set(['codeforces', 'leetcode', 'tuf', 'gfg']);

// Returns { kind, key, url, title, cfProblem? } or null for something that isn't a URL.
export function classifyLink(raw) {
  const s = String(raw || '').trim();
  const bare = s.match(/^(\d+)\s*([A-Za-z]\d?)$/); // "1352C2" on its own line means a Codeforces problem
  const url = bare ? `https://codeforces.com/problemset/problem/${bare[1]}/${bare[2].toUpperCase()}` : cleanUrl(s);
  if (!url) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m)\./, '');
  const path = u.pathname.replace(/\/+$/, '');

  if (host === 'codeforces.com' || host.endsWith('.codeforces.com')) {
    const p = parseProblem(url);
    if (p) return { kind: 'codeforces', key: `cf:${problemKey(p)}`, url, title: `CF ${problemKey(p)}`, cfProblem: problemKey(p) };
  }
  if (host === 'leetcode.com' || host === 'leetcode.cn') {
    const m = path.match(/^\/problems\/([a-z0-9-]+)/);
    if (m) return { kind: 'leetcode', key: `lc:${m[1]}`, url: `https://leetcode.com/problems/${m[1]}/`, title: slugTitle(m[1]) };
  }
  if (host === 'takeuforward.org') {
    const m = path.match(/^\/(?:practice\/dsa|plus\/dsa\/problems)\/([a-z0-9-]+)$/);
    if (m) {
      const slug = m[1].replace(/-+$/, '');
      return { kind: 'tuf', key: `tuf:${slug}`, url: `https://takeuforward.org/practice/dsa/${m[1]}`, title: slugTitle(slug) };
    }
  }
  if (host === 'geeksforgeeks.org') {
    const m = path.match(/^\/problems\/([a-z0-9-]+)/);
    if (m) return { kind: 'gfg', key: `gfg:${m[1]}`, url, title: slugTitle(m[1].replace(/\d+$/, '')) };
  }
  const vid = videoIdFromUrl(url);
  if (vid) return { kind: 'youtube', key: `yt:${vid}`, url: `https://www.youtube.com/watch?v=${vid}`, title: '' };
  const ns = namespaceFromUrl(url);
  const lesson = u.searchParams.get('id');
  if (url.startsWith(SEEK_ORIGIN) && ns && lesson) return { kind: 'seek', key: `seek:${ns}:${lesson}`, url, title: '' };
  const norm = `${host}${path}${u.search}`.toLowerCase();
  if (host === 'pwn.college' && path.split('/').filter(Boolean).length >= 2)
    return { kind: 'pwn', key: `url:${norm}`, url, title: slugTitle(path.split('/').filter(Boolean).pop()) };
  return { kind: 'other', key: `url:${norm}`, url, title: '' };
}

export const isTaskLink = (link) => !!link && link.kind !== 'other';

// A link (plus whatever title the page gave it) as a task input for importTasks().
export function linkToTask(link, { title = '', category = '', group = '' } = {}) {
  const fallbackCategory = DSA_KINDS.has(link.kind) ? 'DSA' : link.kind === 'pwn' ? 'Cyber' : 'IITM';
  const name = String(title || '').replace(/\s+/g, ' ').trim() || link.title || link.url.replace(/^https?:\/\/(www\.)?/, '');
  return {
    title: name.slice(0, 200),
    category: category || fallbackCategory,
    type: link.kind === 'codeforces' ? 'codeforces' : link.kind === 'youtube' ? 'video' : 'manual',
    url: link.url,
    cfProblem: link.cfProblem || '',
    group: String(group || '').trim().slice(0, 80),
    ref: link.key,
  };
}

// Pasted text, one task per line: "https://...", "Title | https://...", "Title - https://..."
// or a bare Codeforces code like "1352C2". Lines without a link are skipped.
export function parseLinkLines(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (/^\d+\s*[A-Za-z]\d?$/.test(line)) {
      out.push({ url: line, title: '' });
      continue;
    }
    const m = line.match(/(https?:\/\/\S+|(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S*)/i);
    if (!m) continue;
    const title = (line.slice(0, m.index) + ' ' + line.slice(m.index + m[0].length)).replace(/^[\s|:–-]+|[\s|:–-]+$/g, '').trim();
    out.push({ url: m[0].replace(/[),.;]+$/, ''), title });
  }
  return out;
}

// Identity keys for a task or import input.
export function taskRefs(task) {
  const refs = new Set();
  if (task?.ref) refs.add(String(task.ref));
  const link = task?.url ? classifyLink(task.url) : null;
  if (link) refs.add(link.key);
  if (task?.cfProblem) refs.add(`cf:${task.cfProblem}`);
  return [...refs];
}

// Everything Zanshin already has: tasks (done ones too) and every item waiting in a series.
export function existingRefs(tasks, series = []) {
  const refs = new Set((tasks || []).flatMap(taskRefs));
  for (const s of series || []) for (const item of s.items || []) for (const r of taskRefs(item)) refs.add(r);
  return refs;
}
