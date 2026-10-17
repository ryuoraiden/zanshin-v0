import { normalizeDb } from '../lib/db.js';
import { addTask } from '../lib/tasks.js';

export const MIN = 60_000;
// A fixed local time: Sat 17 Oct 2026, 10:00
export const T0 = new Date(2026, 9, 17, 10, 0).getTime();

export function freshDb(settings = {}) {
  return normalizeDb({ settings: { cfHandle: 'tester', ...settings } }, T0);
}

let n = 0;
export function withTask(db, input) {
  const r = addTask(db, { title: 'Task', category: 'DSA', type: 'manual', ...input }, T0, `t${++n}`);
  if (!r.ok) throw new Error(r.error);
  return r.data.task;
}
