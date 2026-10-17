// Shape of everything in storage, plus read-side summaries the pages and worker share. Pure.
import { normalizeSettings, applyPending, dayStartMinutes, CATEGORIES } from './settings.js';
import { dayKey, liveCreditMs, lastDayKeys } from './credit.js';

export const SESSION_HISTORY_LIMIT = 3000;

export function emptyRuntime() {
  return {
    active: null, // the running session, see state.js
    rewardUntil: 0, // reward domains unblocked until this timestamp
    rewardUsedDay: null, // day key of the last counted cash-in
    lastHeartbeat: null,
    graceUntil: 0, // after a browser restart, restored tabs aren't closed by the lecture lock
    pending: null, // deferred settings, see settings.js
  };
}

export function normalizeDb(raw = {}, now = Date.now()) {
  const db = {
    tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
    sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
    settings: normalizeSettings(raw.settings || {}),
    runtime: { ...emptyRuntime(), ...(raw.runtime || {}) },
  };
  const r = applyPending(db.settings, db.runtime.pending, todayKey(db, now));
  db.settings = r.settings;
  db.runtime.pending = r.pending;
  return db;
}

export function todayKey(db, now) {
  return dayKey(now, dayStartMinutes(db.settings));
}

export function isRewardOpen(db, now) {
  return db.runtime.rewardUntil > now;
}

export function dayCreditMs(db, day, now) {
  let ms = 0;
  for (const s of db.sessions) if (s.day === day) ms += s.creditedMs || 0;
  const a = db.runtime.active;
  if (a && a.day === day) ms += liveCreditMs(a, now);
  return ms;
}

export function quotaStatus(db, now) {
  const today = todayKey(db, now);
  const doneMs = dayCreditMs(db, today, now);
  const quotaMs = db.settings.quotaMin * 60000;
  const met = doneMs >= quotaMs;
  const open = isRewardOpen(db, now);
  const usedToday = db.settings.setupLocked && db.runtime.rewardUsedDay === today;
  return { today, doneMs, quotaMs, met, open, usedToday, canCashIn: met && !open && !usedToday, rewardUntil: db.runtime.rewardUntil };
}

export function cashIn(db, now) {
  const q = quotaStatus(db, now);
  if (q.open) return { ok: false, error: 'The reward window is already open.', effects: [] };
  if (!q.met)
    return { ok: false, error: `Quota not met yet (${Math.floor(q.doneMs / 60000)} of ${db.settings.quotaMin} min).`, effects: [] };
  if (q.usedToday) return { ok: false, error: 'Already cashed in today.', effects: [] };
  db.runtime.rewardUntil = now + db.settings.rewardMin * 60000;
  if (db.settings.setupLocked) db.runtime.rewardUsedDay = q.today;
  return { ok: true, effects: [{ kind: 'rewardAlarm', when: db.runtime.rewardUntil }] };
}

export function daySummary(db, day, now) {
  const sessions = db.sessions.filter((s) => s.day === day);
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  for (const s of sessions) byCategory[s.category] = (byCategory[s.category] || 0) + (s.creditedMs || 0);
  const a = db.runtime.active;
  if (a && a.day === day) byCategory[a.category] = (byCategory[a.category] || 0) + liveCreditMs(a, now);
  return {
    day,
    creditMs: Object.values(byCategory).reduce((x, y) => x + y, 0),
    byCategory,
    sessions,
    completed: sessions.filter((s) => s.outcome === 'completed'),
    abandoned: sessions.filter((s) => s.outcome === 'abandoned' || s.outcome === 'expired'),
  };
}

export function weekSummary(db, now, days = 7) {
  return lastDayKeys(now, days, dayStartMinutes(db.settings)).map((day) => daySummary(db, day, now));
}
