// Display formatting shared by the pages. Pure.
const pad = (n) => String(n).padStart(2, '0');

export function fmtHM(ms) {
  const m = Math.floor(Math.max(0, ms) / 60000);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${pad(m % 60)}m` : `${m}m`;
}

export function fmtClock(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function fmtTime(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function fmtDeadline(ts, now) {
  if (!ts) return '';
  const diff = ts - now;
  const hours = Math.floor(Math.abs(diff) / 3600000);
  const days = Math.floor(hours / 24);
  if (diff < 0) return days >= 1 ? `overdue ${days}d` : `overdue ${Math.max(1, hours)}h`;
  if (hours < 1) return 'due within the hour';
  if (hours < 24) return `due in ${hours}h`;
  if (days < 7) return `due in ${Math.round(Math.abs(diff) / 86400000)}d`;
  return `due ${fmtDate(ts)}`;
}

// Timestamp -> value for <input type="datetime-local">
export function toLocalInput(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 'YYYY-MM-DD' -> 'Sat 17'
export function dayLabel(key) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${DAYS[date.getDay()]} ${d}`;
}

export const TYPE_LABEL = { video: 'Lecture', codeforces: 'Codeforces', manual: 'Manual' };
