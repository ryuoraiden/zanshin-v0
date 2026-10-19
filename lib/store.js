// chrome.storage.local wrapper. Storage is the only source of truth; the worker keeps no state
// that matters in memory. Only the worker writes; pages read and send messages.
import { normalizeDb, SESSION_HISTORY_LIMIT } from './db.js';

export const KEYS = ['tasks', 'sessions', 'settings', 'runtime', 'series'];

export async function loadDb(now = Date.now()) {
  return normalizeDb(await chrome.storage.local.get(KEYS), now);
}

export async function saveDb(db, { sessions = false } = {}) {
  const data = { tasks: db.tasks, settings: db.settings, runtime: db.runtime, series: db.series, schema: 1 };
  if (sessions) data.sessions = db.sessions.slice(-SESSION_HISTORY_LIMIT);
  await chrome.storage.local.set(data);
}
