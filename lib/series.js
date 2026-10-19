// Series: a long ordered list (an A2Z step, a CP-31 rating band, a playlist) that feeds the
// queue a few tasks at a time instead of dumping 30 problems on top of your deadlines.
// Finishing or deleting one of its tasks lets the next one in. Pure.
//
//   series = { id, title, batch, items: [task input...], next, paused, createdAt }
// Fed tasks carry seriesId and group = series title, so they show up as one queue group.
import { addTask } from './tasks.js';
import { existingRefs, taskRefs } from './links.js';

export const MAX_BATCH = 10;
const MAX_ITEMS = 1000;
const clampBatch = (n) => Math.min(MAX_BATCH, Math.max(1, Math.round(Number(n)) || 3));

export function createSeries(db, { title, batch, items }, now, makeId) {
  const refs = existingRefs(db.tasks, db.series);
  const fresh = [];
  for (const input of Array.isArray(items) ? items.slice(0, MAX_ITEMS) : []) {
    const keys = taskRefs(input);
    if (keys.some((k) => refs.has(k))) continue;
    keys.forEach((k) => refs.add(k));
    fresh.push(input);
  }
  if (!fresh.length) return { ok: false, error: 'Everything you picked is already in Zanshin.', effects: [] };
  const series = {
    id: makeId(),
    title: String(title || '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Series',
    batch: clampBatch(batch),
    items: fresh,
    next: 0,
    paused: false,
    createdAt: now,
  };
  db.series.push(series);
  feedSeries(db, now, makeId);
  return { ok: true, effects: [], data: { added: fresh.length, skipped: (items?.length || 0) - fresh.length, series: series.id } };
}

// Tops every running series up to its batch size. Called after every change, so finishing a
// task, deleting one or raising the batch all let the next items in.
export function feedSeries(db, now, makeId) {
  let fed = 0;
  const refs = existingRefs(db.tasks);
  for (const s of db.series) {
    if (s.paused) continue;
    let open = db.tasks.filter((t) => t.seriesId === s.id && t.status !== 'done').length;
    while (open < s.batch && s.next < s.items.length) {
      const input = s.items[s.next++];
      if (taskRefs(input).some((k) => refs.has(k))) continue; // added by hand since the series was made
      const r = addTask(db, { ...input, group: s.title, seriesId: s.id }, now, makeId());
      if (!r.ok) continue;
      taskRefs(r.data.task).forEach((k) => refs.add(k));
      open++;
      fed++;
    }
  }
  return fed;
}

export function seriesProgress(db, s) {
  const mine = db.tasks.filter((t) => t.seriesId === s.id);
  const done = mine.filter((t) => t.status === 'done').length;
  return { total: s.items.length, done, open: mine.length - done, left: s.items.length - s.next };
}

export function updateSeries(db, id, patch, now, makeId) {
  const s = db.series.find((x) => x.id === id);
  if (!s) return { ok: false, error: 'Series not found.', effects: [] };
  if (patch.batch != null) s.batch = clampBatch(patch.batch);
  if (patch.paused != null) s.paused = !!patch.paused;
  if (patch.title != null) {
    const title = String(patch.title).replace(/\s+/g, ' ').trim().slice(0, 80);
    if (title) {
      for (const t of db.tasks) if (t.seriesId === s.id) t.group = title;
      s.title = title;
    }
  }
  feedSeries(db, now, makeId);
  return { ok: true, effects: [] };
}

// Stops the series. Tasks it already put in the queue stay there as a normal group.
export function removeSeries(db, id) {
  const before = db.series.length;
  db.series = db.series.filter((s) => s.id !== id);
  return before === db.series.length ? { ok: false, error: 'Series not found.', effects: [] } : { ok: true, effects: [] };
}
