import { readDb, onDbChange, send, h, btn, bar } from './common.js';
import { checkUrl } from '../lib/rules.js';
import { quotaStatus } from '../lib/db.js';
import { normalizeDomain } from '../lib/urls.js';
import { liveCreditMs } from '../lib/credit.js';
import { fmtHM, fmtTime } from '../lib/format.js';

const original = location.hash.slice(1);
const host = normalizeDomain(original) || 'This site';
const root = document.getElementById('root');
document.title = `${host} is blocked`;

const OVERRIDE_WAIT = 10;
let shownReason = null;

// Puts the tab back once the page is allowed again (session ended, reward cashed in).
// The guard stops a reload loop if the rules and this check ever disagree.
function restore() {
  const key = `zanshin-restore:${original}`;
  const last = Number(sessionStorage.getItem(key) || 0);
  if (Date.now() - last < 5000) return false;
  sessionStorage.setItem(key, String(Date.now()));
  location.replace(original);
  return true;
}

function enso() {
  return h('img', { class: 'enso', src: '../icons/icon128.png', alt: '' });
}

function sessionView(db, now) {
  const s = db.runtime.active;
  const allow = btn(`Allow ${host} for this session (${OVERRIDE_WAIT})`, 'ghost', async () => {
    const r = await send('session:allowDomain', { domain: original });
    if (r.ok) restore();
  });
  allow.disabled = true;
  let left = OVERRIDE_WAIT;
  const timer = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      clearInterval(timer);
      allow.disabled = false;
      allow.textContent = `Allow ${host} for this session`;
    } else allow.textContent = `Allow ${host} for this session (${left})`;
  }, 1000);

  return [
    enso(),
    h('h1', {}, 'Not part of this session'),
    h('p', { class: 'lead' }, h('strong', {}, host), " isn't on the list for ", h('strong', {}, s.title), '.'),
    h('div', { class: 'small muted' }, `${fmtHM(liveCreditMs(s, now))} credited so far, started ${fmtTime(s.startedAt)}.`),
    h('div', { class: 'actions' }, btn('Back to the task', 'primary', () => send('session:focus')), allow),
    h('div', { class: 'small faint' }, 'Overrides are logged on the session and show up on the dashboard.'),
  ];
}

function rewardView(db, now) {
  const q = quotaStatus(db, now);
  const doneMin = Math.floor(q.doneMs / 60000);
  let foot;
  if (q.canCashIn)
    foot = h(
      'div',
      { class: 'actions' },
      btn(`Cash in ${db.settings.rewardMin} min`, 'ok', async () => {
        const r = await send('reward:cashIn');
        if (r.ok) restore();
      }),
    );
  else if (q.usedToday) foot = h('p', { class: 'muted' }, "Today's reward window is used up. It resets at the start of tomorrow.");
  else foot = h('p', { class: 'muted' }, `${Math.ceil((q.quotaMs - q.doneMs) / 60000)} more minutes of focused work and it opens.`);
  return [
    enso(),
    h('h1', {}, "Locked until you've earned it"),
    h('p', { class: 'lead' }, h('strong', {}, host), " opens after today's quota."),
    h(
      'div',
      { class: 'meter' },
      h('div', { class: 'row spread' }, h('span', { class: 'muted' }, 'Focused today'), h('span', { class: 'mono' }, `${doneMin} / ${db.settings.quotaMin} min`)),
      bar(q.quotaMs ? q.doneMs / q.quotaMs : 1, { class: `bar ${q.met ? 'ok' : ''}` }),
    ),
    foot,
    h('div', { class: 'actions' }, btn('Open Zanshin', 'ghost', () => send('controls:open'))),
  ];
}

async function render() {
  const db = await readDb();
  const now = Date.now();
  const reason = original ? checkUrl(db, original, now) : null;
  if (!reason) {
    if (original && restore()) return;
    shownReason = null;
    root.replaceChildren(
      enso(),
      h('h1', {}, 'Allowed again'),
      h('p', { class: 'lead' }, 'This page is no longer blocked.'),
      original ? h('div', { class: 'actions' }, btn(`Open ${host}`, 'primary', () => location.replace(original))) : null,
    );
    return;
  }
  // Rebuild only when the reason changes, so the override countdown isn't reset by unrelated writes.
  if (reason === shownReason) return;
  shownReason = reason;
  root.replaceChildren(...(reason === 'session' ? sessionView(db, now) : rewardView(db, now)));
}

onDbChange(render);
render();
