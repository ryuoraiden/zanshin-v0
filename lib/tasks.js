// Task validation and CRUD. Pure: functions mutate the db object passed in.
import { CATEGORIES, TYPES } from './settings.js';
import { cleanUrl, normalizeEntries } from './urls.js';
import { parseProblem, problemKey } from './codeforces.js';
import { existingRefs, taskRefs } from './seek.js';

const fail = (error) => ({ ok: false, error, effects: [] });
const ok = (data) => ({ ok: true, effects: [], data });

// '' -> null, 'YYYY-MM-DD' -> 23:59 that day, 'YYYY-MM-DDTHH:MM' -> that time (local), numbers pass through.
export function parseDeadline(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 23, 59).getTime();
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
  return null;
}

// Validates a task form (or a patch merged over an existing task). Returns { task } or { error }.
export function buildTask(input, base = {}) {
  const src = { ...base, ...input };
  const title = String(src.title || '').trim().slice(0, 200);
  if (!title) return { error: 'Give the task a title.' };
  const category = CATEGORIES.includes(src.category) ? src.category : 'IITM';
  const type = TYPES.includes(src.type) ? src.type : 'manual';
  let url = cleanUrl(src.url);
  if (url === null) return { error: "That URL doesn't look right." };
  let cfProblem = '';
  if (type === 'video' && !url) return { error: 'Video tasks need the lecture URL.' };
  if (type === 'codeforces') {
    const p = parseProblem(src.cfProblem) || parseProblem(url);
    if (!p) return { error: 'Codeforces tasks need a problem like 580A, or a problem URL.' };
    cfProblem = problemKey(p);
    if (!url) url = `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`;
  }
  const est = Math.round(Number(src.estimateMin));
  return {
    task: {
      title,
      category,
      type,
      url,
      cfProblem,
      estimateMin: Number.isFinite(est) ? Math.min(600, Math.max(0, est)) : 0,
      deadline: parseDeadline(src.deadline),
      hardDeadline: !!src.hardDeadline,
      pinned: !!src.pinned,
      extraDomains: normalizeEntries(src.extraDomains),
      // Where an imported task came from (e.g. "seek:ns_26t3_cs2006:37"), for spotting duplicates.
      ref: typeof src.ref === 'string' ? src.ref.slice(0, 120) : '',
    },
  };
}

function isActiveTask(db, id) {
  return db.runtime.active && db.runtime.active.taskId === id;
}

export function addTask(db, input, now, id) {
  const r = buildTask(input);
  if (r.error) return fail(r.error);
  const task = { ...r.task, id, status: 'todo', createdAt: now, doneAt: null, note: '' };
  db.tasks.push(task);
  return ok({ task });
}

// Adds a batch of tasks (from the Seek import), skipping anything already in Zanshin, done
// tasks included, so a re-import never brings back a finished lecture.
export function importTasks(db, inputs, now, makeId) {
  const refs = existingRefs(db.tasks);
  let added = 0;
  let skipped = 0;
  const errors = [];
  for (const input of (Array.isArray(inputs) ? inputs : []).slice(0, 200)) {
    const keys = taskRefs(input);
    if (keys.some((k) => refs.has(k))) {
      skipped++;
      continue;
    }
    const r = addTask(db, input, now, makeId());
    if (!r.ok) {
      errors.push(r.error);
      continue;
    }
    added++;
    for (const k of keys) refs.add(k);
  }
  return { ok: true, effects: [], data: { added, skipped, errors } };
}

export function updateTask(db, id, patch) {
  const t = db.tasks.find((x) => x.id === id);
  if (!t) return fail('Task not found.');
  if (isActiveTask(db, id)) return fail('This task has a running session. Finish or exit it first.');
  const r = buildTask(patch, t);
  if (r.error) return fail(r.error);
  Object.assign(t, r.task);
  return ok({ task: t });
}

export function deleteTask(db, id) {
  if (isActiveTask(db, id)) return fail('This task has a running session. Finish or exit it first.');
  const before = db.tasks.length;
  db.tasks = db.tasks.filter((t) => t.id !== id);
  return before === db.tasks.length ? fail('Task not found.') : ok();
}

export function togglePin(db, id) {
  const t = db.tasks.find((x) => x.id === id);
  if (!t) return fail('Task not found.');
  t.pinned = !t.pinned;
  return ok();
}

export function reopenTask(db, id) {
  const t = db.tasks.find((x) => x.id === id);
  if (!t) return fail('Task not found.');
  t.status = 'todo';
  t.doneAt = null;
  return ok();
}
