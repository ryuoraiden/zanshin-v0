import { readDb, onDbChange, send, h, btn, chip } from './common.js';
import { NOTE_MIN } from '../lib/state.js';
import { orderQueue } from '../lib/queue.js';
import { fmtHM, TYPE_LABEL } from '../lib/format.js';

const root = document.getElementById('root');
const PROMPTS = {
  video: {
    q: 'What would you tell a friend about this lecture?',
    ph: 'The main idea in your own words, how it connects to the last lecture, one thing that still feels shaky...',
  },
  codeforces: { q: 'Key idea, or what tripped you up.', ph: 'Binary search on the answer. Tried greedy first and it failed on...' },
  manual: { q: 'What did you finish?', ph: 'Solved Q1 to Q4 of the worksheet, Q5 still open.' },
};

let view = null; // 'form' | 'done' | 'none'
let finished = null;

async function closeTab() {
  const tab = await chrome.tabs.getCurrent();
  if (tab) chrome.tabs.remove(tab.id);
}

function formView(s) {
  const min = NOTE_MIN[s.type] ?? 20;
  const draftKey = `zanshin-draft:${s.id}`;
  const p = PROMPTS[s.type] || PROMPTS.manual;
  const area = h('textarea', { placeholder: p.ph, maxlength: '4000' });
  area.value = sessionStorage.getItem(draftKey) || '';
  const count = h('span', { class: 'count small' });
  const save = btn('Save and finish', 'primary', submit);
  function sync() {
    const n = area.value.trim().length;
    count.textContent = `${n} / ${min}`;
    count.classList.toggle('short', n < min);
    save.disabled = n < min;
    sessionStorage.setItem(draftKey, area.value);
  }
  async function submit() {
    if (save.disabled) return;
    save.disabled = true;
    const r = await send('session:note', { note: area.value });
    if (r.ok) {
      sessionStorage.removeItem(draftKey);
      finished = r.data?.session || null;
      show('done');
    } else sync();
  }
  area.addEventListener('input', sync);
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
  });
  sync();
  setTimeout(() => area.focus(), 50);
  return [
    h('div', { class: 'mark' }, '残心'),
    h('div', { class: 'row' }, chip(s.category), h('span', { class: 'badge' }, TYPE_LABEL[s.type]), s.manual ? h('span', { class: 'badge' }, 'done by hand') : null),
    h('h1', {}, s.title),
    h('div', { class: 'prompt' }, p.q),
    area,
    h('div', { class: 'row spread foot' }, count, h('div', { class: 'row' }, h('span', { class: 'faint small' }, 'Ctrl+Enter'), save)),
  ];
}

function nextUp(db) {
  const queue = orderQueue(db.tasks, Date.now()).slice(0, 3);
  if (!queue.length) return h('div', { class: 'empty' }, 'Queue is empty.');
  return h(
    'ul',
    { class: 'list' },
    queue.map((t) =>
      h(
        'li',
        { class: 'row spread' },
        h('span', { class: 'row' }, chip(t.category), h('span', { class: 'item-title' }, t.title)),
        btn('Start', 'primary sm', async () => {
          const r = await send('session:start', { taskId: t.id });
          if (r.ok) closeTab();
        }),
      ),
    ),
  );
}

function doneView(db) {
  return [
    h('div', { class: 'mark' }, '残心'),
    h('h1', {}, finished ? `Done: ${finished.title}` : 'Done'),
    finished ? h('p', { class: 'muted' }, `${fmtHM(finished.creditedMs)} credited.`) : null,
    h('section', { class: 'card next' }, h('h3', {}, 'Next up'), nextUp(db)),
    h('div', { class: 'row', style: { marginTop: '14px' } }, btn('Open dashboard', 'ghost', () => send('controls:open')), btn('Close tab', 'ghost', closeTab)),
  ];
}

async function show(want) {
  const db = await readDb();
  const s = db.runtime.active;
  if (!want) want = s && s.phase === 'recall' ? 'form' : finished ? 'done' : 'none';
  // Rebuilding the form would wipe what you're typing, so only rebuild on a real view change.
  if (want === view) return;
  view = want;
  if (want === 'form') root.replaceChildren(...formView(s));
  else if (want === 'done') root.replaceChildren(...doneView(db));
  else
    root.replaceChildren(
      h('div', { class: 'mark' }, '残心'),
      h('h1', {}, 'Nothing to write right now'),
      h('p', { class: 'muted' }, 'The recall note appears here when a task is finished.'),
      btn('Open dashboard', 'ghost', () => send('controls:open')),
    );
}

onDbChange(() => show());
show();
