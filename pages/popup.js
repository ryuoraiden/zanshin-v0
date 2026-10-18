import { readDb, onDbChange, send, h, btn, chip, deadlineBadge, sessionCard, updateSessionCard, bar, structureKey } from './common.js';
import { quotaStatus } from '../lib/db.js';
import { orderQueue } from '../lib/queue.js';
import { fmtTime, TYPE_LABEL } from '../lib/format.js';

const $ = (id) => document.getElementById(id);
let db = null;
let card = null;

$('dash').addEventListener('click', () => {
  send('controls:open');
  window.close();
});
$('opts').addEventListener('click', () => chrome.runtime.openOptionsPage());

function renderQuota(now) {
  const q = quotaStatus(db, now);
  const doneMin = Math.floor(q.doneMs / 60000);
  const el = $('quota');
  el.replaceChildren(
    h(
      'div',
      { class: 'row spread small' },
      h('span', { class: 'muted' }, 'Today'),
      h('span', { class: 'mono', 'data-live': 'quota' }, `${doneMin} / ${db.settings.quotaMin} min`),
    ),
    bar(q.quotaMs ? q.doneMs / q.quotaMs : 1, { class: `bar ${q.met ? 'ok' : ''}` }),
  );
  if (q.open) el.append(h('div', { class: 'small muted', style: { marginTop: '6px' } }, `Reward window open until ${fmtTime(q.rewardUntil)}.`));
  else if (q.canCashIn)
    el.append(
      h(
        'div',
        { class: 'row spread', style: { marginTop: '8px' } },
        h('span', { class: 'small' }, 'Quota met.'),
        btn(`Cash in ${db.settings.rewardMin} min`, 'ok sm', () => send('reward:cashIn')),
      ),
    );
  else if (q.usedToday) el.append(h('div', { class: 'small faint', style: { marginTop: '6px' } }, "Today's reward window is used."));
}

function renderNext(now) {
  const queue = orderQueue(db.tasks, now).slice(0, 4);
  if (!queue.length)
    return h(
      'section',
      { class: 'card' },
      h('div', { class: 'empty' }, 'No tasks queued.'),
      btn('Add tasks in the dashboard', 'primary', () => {
        send('controls:open');
        window.close();
      }),
    );
  return h(
    'section',
    { class: 'card next' },
    h('h3', {}, 'Next up'),
    h(
      'ul',
      { class: 'list' },
      queue.map((t) =>
        h(
          'li',
          {},
          h(
            'div',
            { class: 'row spread' },
            h(
              'div',
              {},
              h('div', { class: 'item-title' }, t.pinned ? '• ' : '', t.title),
              h(
                'div',
                { class: 'item-meta' },
                chip(t.category),
                h('span', { class: 'badge' }, TYPE_LABEL[t.type]),
                deadlineBadge(t, now),
                t.estimateMin ? h('span', { class: 'faint small' }, `${t.estimateMin} min`) : null,
              ),
            ),
            btn('Start', 'primary sm', () => send('session:start', { taskId: t.id })),
          ),
        ),
      ),
    ),
  );
}

function render() {
  const now = Date.now();
  renderQuota(now);
  const main = $('main');
  if (db.runtime.active) {
    card = sessionCard(db);
    main.replaceChildren(card);
    updateSessionCard(card, db, now);
  } else {
    card = null;
    main.replaceChildren(renderNext(now));
  }
  $('footer').replaceChildren(
    db.settings.setupLocked
      ? h('div', { class: 'small faint' }, h('kbd', {}, 'Alt'), '+', h('kbd', {}, 'Shift'), '+', h('kbd', {}, 'Z'), ' opens controls, even during a lecture.')
      : h('div', { class: 'banner' }, 'Setup mode: settings apply instantly. ', btn('Finish setup', 'link', () => chrome.runtime.openOptionsPage())),
  );
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

onDbChange(refresh);
setInterval(() => {
  if (!db) return;
  const now = Date.now();
  updateSessionCard(card, db, now);
  if (db.runtime.active) {
    const q = quotaStatus(db, now);
    const el = document.querySelector('[data-live="quota"]');
    if (el) el.textContent = `${Math.floor(q.doneMs / 60000)} / ${db.settings.quotaMin} min`;
  }
}, 1000);
refresh();
