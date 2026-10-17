// Time credit, watched-interval coverage and day boundaries. Pure.

const JOIN_GAP = 0.75; // seconds; intervals closer than this are treated as continuous

export function mergeIntervals(list) {
  const sorted = (list || [])
    .filter((iv) => Array.isArray(iv) && Number.isFinite(iv[0]) && Number.isFinite(iv[1]) && iv[1] > iv[0])
    .map(([s, e]) => [s, e])
    .sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1] + JOIN_GAP) last[1] = Math.max(last[1], iv[1]);
    else out.push(iv);
  }
  return out;
}

export function addIntervals(existing, incoming, duration) {
  let merged = mergeIntervals([...(existing || []), ...(incoming || [])]);
  if (duration > 0) {
    merged = merged
      .map(([s, e]) => [Math.max(0, s), Math.min(duration, e)])
      .filter(([s, e]) => e > s);
  }
  return merged;
}

export function watchedSeconds(intervals) {
  return (intervals || []).reduce((sum, [s, e]) => sum + (e - s), 0);
}

export function coverage(intervals, duration) {
  if (!(duration > 0)) return 0;
  return Math.min(1, watchedSeconds(mergeIntervals(intervals)) / duration);
}

// Credited milliseconds for a live session: banked credit plus the running stretch.
export function liveCreditMs(session, now) {
  if (!session) return 0;
  const { accum = 0, since = null } = session.credit || {};
  return accum + (since != null ? Math.max(0, now - since) : 0);
}

// Day key in local time, where the day starts at `startMin` minutes past midnight (04:00 by default),
// so a session at 1 am still belongs to the evening before.
export function dayKey(ts, startMin = 240) {
  const d = new Date(ts - startMin * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// The n day keys ending today, oldest first.
export function lastDayKeys(now, n, startMin = 240) {
  const keys = [];
  for (let i = n - 1; i >= 0; i--) keys.push(dayKey(now - i * 86400000, startMin));
  return keys;
}
