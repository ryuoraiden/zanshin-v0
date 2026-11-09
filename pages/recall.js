import { readDb, onDbChange, send, h, btn, chip } from './common.js';
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
  const draftKey = `zanshin-draft:${s.id}`;
  const p = PROMPTS[s.type] || PROMPTS.manual;
  const area = h('textarea', { placeholder: p.ph, maxlength: '4000' });
  area.value = sessionStorage.getItem(draftKey) || '';
  const save = btn('Finish', 'primary', submit);
  async function submit() {
    if (save.disabled) return;
    save.disabled = true;
    const r = await send('session:note', { note: area.value });
    if (r.ok) {
      sessionStorage.removeItem(draftKey);
      finished = r.data?.session || null;
      show('done');
    } else save.disabled = false;
  }
  area.addEventListener('input', () => sessionStorage.setItem(draftKey, area.value));
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
  });
  setTimeout(() => area.focus(), 50);
  return [
    h('img', { class: 'mark', src: '../icons/brand.png', alt: '残心' }),
    h('div', { class: 'row' }, chip(s.category), h('span', { class: 'badge' }, TYPE_LABEL[s.type]), s.manual ? h('span', { class: 'badge' }, 'done by hand') : null),
    h('h1', {}, s.title),
    h('div', { class: 'prompt' }, p.q),
    area,
    h('div', { class: 'row spread foot' }, h('span', { class: 'faint small' }, 'Optional. Leave it empty to skip.'), h('div', { class: 'row' }, h('span', { class: 'faint small' }, 'Ctrl+Enter'), save)),
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
    h('img', { class: 'mark', src: '../icons/brand.png', alt: '残心' }),
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
      h('img', { class: 'mark', src: '../icons/brand.png', alt: '残心' }),
      h('h1', {}, 'Nothing to write right now'),
      h('p', { class: 'muted' }, 'The recall note appears here when a task is finished.'),
      btn('Open dashboard', 'ghost', () => send('controls:open')),
    );
}

onDbChange(() => show());
show();
