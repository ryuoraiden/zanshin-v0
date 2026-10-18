// Helpers shared by the extension pages. Pages read storage directly and send every change to
// the service worker, which is the only writer.
import { loadDb } from '../lib/store.js';
import { liveCreditMs, coverage } from '../lib/credit.js';
import { exitStatus } from '../lib/state.js';
import { fmtClock, fmtTime, fmtDeadline, TYPE_LABEL } from '../lib/format.js';
import { deadlineStatus } from '../lib/queue.js';

export const readDb = () => loadDb(Date.now());

// Changes that need a rebuild. Playback reports and heartbeats write storage every few seconds;
// those only touch the live numbers, so rebuilding (and eating a click) isn't needed for them.
export function structureKey(db) {
  const a = db.runtime.active;
  return JSON.stringify([
    db.tasks,
    db.sessions.length,
    db.settings,
    db.runtime.rewardUntil,
    db.runtime.rewardUsedDay,
    db.runtime.pending,
    a && [a.id, a.phase, a.exitRequestedAt, a.overrides, a.pauses.length, a.events.length],
  ]);
}

export function onDbChange(cb) {
  chrome.storage.onChanged.addListener((_, area) => {
    if (area === 'local') cb();
  });
}

export async function send(type, payload = {}) {
  try {
    const r = (await chrome.runtime.sendMessage({ type, ...payload })) || { ok: false, error: 'No response.' };
    if (r.ok === false && r.error) toast(r.error, 'error');
    return r;
  } catch (err) {
    toast(String(err?.message || err), 'error');
    return { ok: false, error: String(err) };
  }
}

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

let toastTimer = null;
export function toast(message, kind = 'info') {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: `toast ${kind}`, role: 'status' }, message);
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3500);
}

export const chip = (category) => h('span', { class: 'chip', 'data-cat': category }, category);

export function bar(frac, attrs = {}) {
  const pct = `${Math.round(Math.min(1, Math.max(0, frac)) * 100)}%`;
  return h('div', { class: 'bar', ...attrs }, h('span', { style: { width: pct } }));
}

export function btn(label, cls, onClick, attrs = {}) {
  return h('button', { class: `btn ${cls || ''}`, type: 'button', onclick: onClick, ...attrs }, label);
}

// A button that needs a second click within 4 s. Used instead of confirm() dialogs.
export function confirmBtn(label, armedLabel, cls, onConfirm) {
  let armed = false;
  let timer = null;
  const b = btn(label, cls, () => {
    if (!armed) {
      armed = true;
      b.textContent = armedLabel;
      b.classList.add('armed');
      timer = setTimeout(() => {
        armed = false;
        b.textContent = label;
        b.classList.remove('armed');
      }, 4000);
      return;
    }
    clearTimeout(timer);
    onConfirm();
  });
  return b;
}

export function deadlineBadge(task, now) {
  if (!task.deadline) return null;
  const st = deadlineStatus(task, now);
  return h('span', { class: `badge ${st}`, title: new Date(task.deadline).toLocaleString() }, fmtDeadline(task.deadline, now), task.hardDeadline ? ' (hard)' : '');
}

// ---------------------------------------------------------------------------------------------
// Session card, shared by the popup and the dashboard. Structure is built once per state change;
// updateSessionCard() refreshes the ticking parts every second without rebuilding buttons.

export function sessionCard(db) {
  const s = db.runtime.active;
  const card = h('section', { class: 'card session', 'data-phase': s.phase });
  card.append(
    h(
      'div',
      { class: 'row spread' },
      h('div', { class: 'row' }, chip(s.category), h('span', { class: 'muted small' }, TYPE_LABEL[s.type])),
      h('span', { class: 'faint small' }, `started ${fmtTime(s.startedAt)}`),
    ),
    h('h2', { class: 'session-title' }, s.title),
    h('div', { class: 'clock', 'data-live': 'credit' }, '00:00'),
    h('div', { class: 'muted small', 'data-live': 'status' }),
  );
  if (s.type === 'video') {
    card.append(
      h(
        'div',
        { class: 'cov-wrap' },
        h('div', { class: 'bar ok' }, h('span', { 'data-live': 'cov-bar' })),
        h('div', { class: 'small muted', 'data-live': 'cov', style: { marginTop: '5px' } }),
      ),
    );
  }

  const actions = h('div', { class: 'actions' });
  if (s.phase === 'recall') {
    actions.append(btn('Write the note', 'primary', () => send('session:done')));
  } else {
    if (s.type === 'video' || s.url)
      actions.append(btn(s.type === 'video' ? 'Back to lecture' : 'Open task', 'ghost', () => send('session:focus')));
    if (s.type !== 'video')
      actions.append(
        s.phase === 'paused'
          ? btn('Resume', 'primary', () => send('session:resume'))
          : btn('Pause', 'ghost', () => send('session:pause')),
      );
    actions.append(
      s.type === 'manual' || s.watchedEnough
        ? btn('Done', 'primary', () => send('session:done'))
        : confirmBtn('Done by hand', 'Logged as by hand. Sure?', 'ghost', () => send('session:done')),
    );
  }
  card.append(actions);

  card.append(
    h(
      'div',
      { class: 'exit' },
      h(
        'div',
        { 'data-exit': 'none' },
        btn('Emergency exit', 'link', () => send('session:requestExit')),
        h('span', { class: 'faint' }, '  60 s wait, logged as abandoned'),
      ),
      h(
        'div',
        { 'data-exit': 'waiting', class: 'row spread' },
        h('span', { class: 'muted', 'data-live': 'exit-wait' }),
        btn('Cancel', 'ghost sm', () => send('session:cancelExit')),
      ),
      h(
        'div',
        { 'data-exit': 'ready', class: 'row spread' },
        btn('Abandon session', 'danger sm', () => send('session:confirmExit')),
        btn('Keep going', 'ghost sm', () => send('session:cancelExit')),
      ),
    ),
  );
  return card;
}

export function updateSessionCard(card, db, now) {
  const s = db.runtime.active;
  if (!card || !s) return;
  const set = (key, text) => {
    const el = card.querySelector(`[data-live="${key}"]`);
    if (el && el.textContent !== text) el.textContent = text;
  };
  set('credit', fmtClock(liveCreditMs(s, now)));
  let status = 'Running';
  if (s.phase === 'paused') {
    const p = s.pauses[s.pauses.length - 1];
    status = `Paused for ${fmtClock(now - (p?.start || now))}. Blocking stays on.`;
  } else if (s.phase === 'recall') status = 'Write your recall note to finish.';
  else if (s.type === 'video') status = s.studyFocused ? 'Credit counts while the lecture plays.' : 'Lecture window not focused, credit is paused.';
  else if (s.type === 'codeforces') status = `Waiting for an accepted ${s.cfProblem}. Checked every minute.`;
  set('status', status);
  if (s.type === 'video') {
    const c = coverage(s.watched, s.duration);
    const el = card.querySelector('[data-live="cov-bar"]');
    if (el) el.style.width = `${Math.round(c * 100)}%`;
    set(
      'cov',
      !s.duration
        ? 'Waiting for the video to start'
        : s.watchedEnough
          ? `${Math.round(c * 100)}% watched. It finishes when the video ends, or press Done.`
          : `${Math.round(c * 100)}% watched. Past 90%, it finishes at the end of the video.`,
    );
  }
  const st = exitStatus(s, now);
  const state = st.state === 'stale' ? 'none' : st.state;
  for (const el of card.querySelectorAll('[data-exit]')) el.classList.toggle('hidden', el.dataset.exit !== state);
  if (state === 'waiting') set('exit-wait', `Exit unlocks in ${Math.ceil(st.remainingMs / 1000)} s`);
}
