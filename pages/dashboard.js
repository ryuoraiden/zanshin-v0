import {
  readDb,
  onDbChange,
  send,
  h,
  btn,
  confirmBtn,
  chip,
  bar,
  deadlineBadge,
  sessionCard,
  updateSessionCard,
  toast,
  structureKey,
} from './common.js';
import { quotaStatus, daySummary, weekSummary } from '../lib/db.js';
import { orderQueue, upcomingDeadlines } from '../lib/queue.js';
import { fmtHM, fmtTime, fmtDate, dayLabel, toLocalInput, TYPE_LABEL, fmtDeadline } from '../lib/format.js';
import { CATEGORIES } from '../lib/settings.js';
import { normalizeDomain } from '../lib/urls.js';

const $ = (id) => document.getElementById(id);
let db = null;
let card = null;
let editingId = null;

$('opts').addEventListener('click', () => chrome.runtime.openOptionsPage());

// ---------------------------------------------------------------------------------------------
// Task form

const form = $('task-form');
const f = form.elements;
const HINTS = {
  video:
    'Opens in a locked fullscreen window. Completes once 90% of the video has actually played (skipping ahead does not count), then asks for a 150-character recall note.',
  codeforces:
    'Completes when Codeforces shows an accepted submission for this problem made after you press Start. Needs your handle in Options.',
  manual: 'You press Done and write one line about what you finished.',
};

function syncFormType() {
  const type = f.type.value;
  $('cf-field').classList.toggle('hidden', type !== 'codeforces');
  $('type-hint').textContent = HINTS[type];
  f.url.placeholder =
    type === 'video'
      ? 'https://www.youtube.com/watch?v=... (or the IITM portal page)'
      : type === 'codeforces'
        ? 'optional, or paste the problem URL'
        : 'optional, opens when you start';
}
f.type.addEventListener('change', syncFormType);

function resetForm() {
  form.reset();
  editingId = null;
  $('form-title').textContent = 'Add a task';
  $('submit').textContent = 'Add task';
  $('cancel-edit').classList.add('hidden');
  syncFormType();
}
$('cancel-edit').addEventListener('click', resetForm);

function editTask(t) {
  editingId = t.id;
  f.title.value = t.title;
  f.category.value = t.category;
  f.type.value = t.type;
  f.url.value = t.url || '';
  f.cfProblem.value = t.cfProblem || '';
  f.estimateMin.value = t.estimateMin || '';
  f.deadline.value = toLocalInput(t.deadline);
  f.hardDeadline.checked = !!t.hardDeadline;
  f.extraDomains.value = (t.extraDomains || []).join(', ');
  $('form-title').textContent = 'Edit task';
  $('submit').textContent = 'Save changes';
  $('cancel-edit').classList.remove('hidden');
  syncFormType();
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  f.title.focus();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const task = {
    title: f.title.value,
    category: f.category.value,
    type: f.type.value,
    url: f.url.value,
    cfProblem: f.cfProblem.value,
    estimateMin: f.estimateMin.value,
    deadline: f.deadline.value,
    hardDeadline: f.hardDeadline.checked,
    extraDomains: f.extraDomains.value,
  };
  const r = editingId ? await send('task:update', { id: editingId, task }) : await send('task:add', { task });
  if (r.ok) {
    toast(editingId ? 'Saved.' : 'Added to the queue.');
    resetForm();
  }
});

// ---------------------------------------------------------------------------------------------
// Rendering

function renderSetup() {
  $('setup').replaceChildren(
    db.settings.setupLocked
      ? ''
      : h(
          'div',
          { class: 'banner', style: { marginBottom: '16px' } },
          "Setup mode: settings apply instantly and cash-ins don't count. Set your numbers, then lock them in ",
          btn('Options', 'link', () => chrome.runtime.openOptionsPage()),
          '.',
        ),
  );
}

function stat(label, value, extra) {
  return h('div', { class: 'card stat' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value), extra);
}

function renderStats(now) {
  const q = quotaStatus(db, now);
  const today = daySummary(db, q.today, now);
  let reward;
  if (q.open) reward = stat('Reward window', 'Open', h('div', { class: 'small muted' }, `until ${fmtTime(q.rewardUntil)}`));
  else if (q.canCashIn)
    reward = stat('Reward window', 'Earned', btn(`Cash in ${db.settings.rewardMin} min`, 'ok sm', () => send('reward:cashIn')));
  else if (q.usedToday) reward = stat('Reward window', 'Used', h('div', { class: 'small muted' }, 'Back tomorrow.'));
  else
    reward = stat(
      'Reward window',
      'Locked',
      h('div', { class: 'small muted', 'data-live': 'to-go' }, `${Math.ceil((q.quotaMs - q.doneMs) / 60000)} min of focus to go`),
    );
  $('stats').replaceChildren(
    stat(
      'Focused today',
      h('span', {}, h('span', { 'data-live': 'focused' }, fmtHM(q.doneMs)), h('small', {}, ` / ${fmtHM(q.quotaMs)}`)),
      bar(q.quotaMs ? q.doneMs / q.quotaMs : 1, { class: `bar ${q.met ? 'ok' : ''}`, 'data-live': 'focused-bar' }),
    ),
    stat('Completed today', String(today.completed.length)),
    stat('Abandoned today', String(today.abandoned.length)),
    reward,
  );
}

function renderSession(now) {
  if (!db.runtime.active) {
    card = null;
    $('session').replaceChildren();
    return;
  }
  card = sessionCard(db);
  $('session').replaceChildren(card);
  updateSessionCard(card, db, now);
}

function renderQueue(now) {
  const queue = orderQueue(db.tasks, now);
  const active = db.runtime.active;
  $('queue-count').textContent = queue.length ? `${queue.length} open` : '';
  if (!queue.length) {
    $('queue').replaceChildren(h('li', { class: 'empty' }, 'Nothing queued. Add a task below.'));
    return;
  }
  $('queue').replaceChildren(
    ...queue.map((t) =>
      h(
        'li',
        { class: t.pinned ? 'pinned' : '' },
        h(
          'div',
          { class: 'row spread' },
          h(
            'div',
            { style: { minWidth: '0' } },
            h('div', { class: 'item-title' }, t.title),
            h(
              'div',
              { class: 'item-meta' },
              chip(t.category),
              h('span', { class: 'badge' }, TYPE_LABEL[t.type], t.cfProblem ? ` ${t.cfProblem}` : ''),
              deadlineBadge(t, now),
              t.estimateMin ? h('span', { class: 'faint small' }, `${t.estimateMin} min`) : null,
              t.url ? h('a', { href: t.url, target: '_blank', class: 'small faint', title: t.url }, normalizeDomain(t.url)) : null,
            ),
          ),
          h(
            'div',
            { class: 'task-actions' },
            btn('Start', 'primary sm', () => send('session:start', { taskId: t.id }), { disabled: !!active }),
            btn('Edit', 'ghost sm', () => editTask(t), { disabled: active?.taskId === t.id }),
            btn(t.pinned ? 'Unpin' : 'Pin', 'ghost sm', () => send('task:pin', { id: t.id })),
            active?.taskId === t.id ? null : confirmBtn('Delete', 'Sure?', 'ghost sm', () => send('task:delete', { id: t.id })),
          ),
        ),
      ),
    ),
  );
}

const OUTCOME = { completed: 'Done', abandoned: 'Abandoned', expired: 'Expired' };

function eventSummary(s) {
  const parts = [];
  if (s.manual) parts.push('marked done by hand');
  if (s.coverage != null) parts.push(`${Math.round(s.coverage * 100)}% watched`);
  if (s.overrides?.length) parts.push(`allowed ${s.overrides.join(', ')}`);
  const gaps = (s.events || []).filter((e) => e.kind === 'gap');
  if (gaps.length) parts.push(`${gaps.length} gap${gaps.length > 1 ? 's' : ''} (${gaps.reduce((a, e) => a + e.minutes, 0)} min)`);
  const tamper = (s.events || []).filter((e) => e.kind === 'tamper').length;
  if (tamper) parts.push(`opened extensions page ${tamper}x`);
  return parts.length ? h('div', { class: 'events' }, parts.join(' · ')) : null;
}

function renderRight(now) {
  const q = quotaStatus(db, now);
  const today = daySummary(db, q.today, now);
  const scale = Math.max(q.quotaMs, today.creditMs, 1);

  const cats = h(
    'section',
    { class: 'card' },
    h('h3', {}, 'Today by category'),
    CATEGORIES.map((c) =>
      h(
        'div',
        { class: 'cat-row' },
        chip(c),
        bar(today.byCategory[c] / scale, { 'data-cat': c }),
        h('span', { class: 'mono small', style: { textAlign: 'right' } }, fmtHM(today.byCategory[c])),
      ),
    ),
  );

  const sessions = h(
    'section',
    { class: 'card' },
    h('h3', {}, 'Sessions today'),
    today.sessions.length
      ? h(
          'ul',
          { class: 'list' },
          [...today.sessions].reverse().map((s) =>
            h(
              'li',
              {},
              h(
                'div',
                { class: 'row spread' },
                h('span', { class: 'item-title' }, s.title),
                h('span', { class: `badge ${s.outcome}` }, OUTCOME[s.outcome] || s.outcome),
              ),
              h(
                'div',
                { class: 'item-meta' },
                chip(s.category),
                h('span', { class: 'small muted' }, `${fmtTime(s.startedAt)} to ${fmtTime(s.endedAt)}, ${fmtHM(s.creditedMs)} credited`),
              ),
              eventSummary(s),
              s.note ? h('div', { class: 'note' }, s.note) : null,
            ),
          ),
        )
      : h('div', { class: 'empty' }, 'No finished sessions yet today.'),
  );

  const week = weekSummary(db, now);
  const weekMax = Math.max(q.quotaMs, ...week.map((d) => d.creditMs), 1);
  const weekCard = h(
    'section',
    { class: 'card' },
    h('h3', {}, 'Last 7 days'),
    h(
      'table',
      { class: 'week' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Day'), h('th', {}, 'Focused'), h('th', { class: 'num' }, ''), h('th', { class: 'num' }, 'Done'), h('th', { class: 'num' }, 'Quit'))),
      h(
        'tbody',
        {},
        week.map((d) =>
          h(
            'tr',
            { class: d.day === q.today ? 'today' : '' },
            h('td', {}, dayLabel(d.day)),
            h('td', {}, bar(d.creditMs / weekMax, { class: `bar ${d.creditMs >= q.quotaMs && q.quotaMs ? 'ok' : ''}` })),
            h('td', { class: 'num mono small' }, fmtHM(d.creditMs)),
            h('td', { class: 'num' }, String(d.completed.length)),
            h('td', { class: 'num' }, String(d.abandoned.length)),
          ),
        ),
      ),
    ),
  );

  const upcoming = upcomingDeadlines(db.tasks, now);
  const deadlines = h(
    'section',
    { class: 'card' },
    h('h3', {}, 'Deadlines, next 7 days'),
    upcoming.length
      ? h(
          'ul',
          { class: 'list' },
          upcoming.map((t) =>
            h(
              'li',
              { class: 'row spread' },
              h('span', { class: 'item-title' }, t.title),
              h('span', { class: 'row' }, chip(t.category), deadlineBadge(t, now)),
            ),
          ),
        )
      : h('div', { class: 'empty' }, 'Nothing due this week.'),
  );

  const done = db.tasks.filter((t) => t.status === 'done').sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const completed = h(
    'section',
    { class: 'card' },
    h(
      'details',
      {},
      h('summary', {}, `Completed tasks (${done.length})`),
      done.length
        ? h(
            'ul',
            { class: 'list', style: { marginTop: '10px' } },
            done.slice(0, 40).map((t) =>
              h(
                'li',
                {},
                h(
                  'div',
                  { class: 'row spread' },
                  h('span', { class: 'item-title' }, t.title),
                  btn('Reopen', 'ghost sm', () => send('task:reopen', { id: t.id })),
                ),
                h('div', { class: 'item-meta' }, chip(t.category), h('span', { class: 'small faint' }, t.doneAt ? fmtDate(t.doneAt) : '')),
                t.note ? h('div', { class: 'note' }, t.note) : null,
              ),
            ),
          )
        : h('div', { class: 'empty' }, 'None yet.'),
    ),
  );
  $('right').replaceChildren(cats, sessions, weekCard, deadlines, completed);
}

function render() {
  const now = Date.now();
  renderSetup();
  renderStats(now);
  renderSession(now);
  renderQueue(now);
  renderRight(now);
}

let lastKey = '';
async function refresh() {
  db = await readDb();
  const key = structureKey(db);
  if (key !== lastKey) {
    lastKey = key;
    render();
  } else updateSessionCard(card, db, Date.now());
}

// Live numbers tick every second without rebuilding anything clickable.
setInterval(() => {
  if (!db) return;
  const now = Date.now();
  updateSessionCard(card, db, now);
  if (!db.runtime.active) return;
  const q = quotaStatus(db, now);
  const focused = document.querySelector('[data-live="focused"]');
  if (focused) focused.textContent = fmtHM(q.doneMs);
  const fb = document.querySelector('[data-live="focused-bar"] > span');
  if (fb && q.quotaMs) fb.style.width = `${Math.min(100, Math.round((q.doneMs / q.quotaMs) * 100))}%`;
}, 1000);
// Deadline labels and the reward state drift with time, so do a full redraw now and then.
setInterval(() => db && render(), 60000);

onDbChange(refresh);
syncFormType();
refresh();
