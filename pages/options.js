import { readDb, onDbChange, send, h, confirmBtn, toast } from './common.js';
import { CATEGORIES } from '../lib/settings.js';

const $ = (id) => document.getElementById(id);
const form = $('settings');
const f = form.elements;
const lines = (v) => (v || []).join('\n');
const LABEL = { quotaMin: 'lower quota', rewardMin: 'longer reward window', rewardDomains: 'removed reward sites' };

$('dash').addEventListener('click', () => send('controls:open'));
$('shortcuts').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));

// The form shows what you asked for, including changes still waiting for tomorrow.
function fillForm(db) {
  const s = { ...db.settings, ...(db.runtime.pending?.values || {}) };
  f.quotaMin.value = s.quotaMin;
  f.rewardMin.value = s.rewardMin;
  f.rewardDomains.value = lines(s.rewardDomains);
  f.dayStartsAt.value = s.dayStartsAt;
  for (const c of CATEGORIES) f[`cat-${c}`].value = lines(s.categoryDomains[c]);
  f.alwaysAllowed.value = lines(s.alwaysAllowed);
  f.pauseOnBlur.checked = s.pauseOnBlur;
  f.hardCapMin.value = s.hardCapMin;
  f.cfHandle.value = s.cfHandle;
  f.discordWebhook.value = s.discordWebhook;
}

function renderLockState(db) {
  const pending = db.runtime.pending;
  const el = $('lock-state');
  if (!db.settings.setupLocked) {
    el.replaceChildren(
      h(
        'div',
        { class: 'banner' },
        h('strong', {}, 'Setup mode. '),
        "Every change applies instantly and cash-ins don't count, so you can test the quota with tiny numbers. ",
        'When the real numbers are in, lock them. After that, anything that makes the reward easier waits until the next day.',
        h(
          'div',
          { style: { marginTop: '10px' } },
          confirmBtn('Lock settings', 'This is one-way. Lock?', 'primary sm', async () => {
            const r = await send('settings:lock');
            if (r.ok) toast('Locked. Loosening changes now wait a day.');
          }),
        ),
      ),
    );
    return;
  }
  el.replaceChildren(
    h(
      'div',
      { class: 'banner calm' },
      'Settings are locked. Lowering the quota, lengthening the reward window or removing a reward site takes effect tomorrow. Everything else applies now.',
      pending
        ? h(
            'div',
            { style: { marginTop: '6px', color: 'var(--warn)' } },
            `Waiting for tomorrow: ${Object.keys(pending.values)
              .map((k) => LABEL[k] || k)
              .join(', ')}.`,
          )
        : null,
    ),
  );
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const categoryDomains = Object.fromEntries(CATEGORIES.map((c) => [c, f[`cat-${c}`].value.split('\n')]));
  const settings = {
    quotaMin: f.quotaMin.value,
    rewardMin: f.rewardMin.value,
    rewardDomains: f.rewardDomains.value.split('\n'),
    dayStartsAt: f.dayStartsAt.value,
    categoryDomains,
    alwaysAllowed: f.alwaysAllowed.value.split('\n'),
    pauseOnBlur: f.pauseOnBlur.checked,
    hardCapMin: f.hardCapMin.value,
    cfHandle: f.cfHandle.value,
    discordWebhook: f.discordWebhook.value,
  };
  if (settings.discordWebhook.trim() && !/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\//.test(settings.discordWebhook.trim()))
    toast("That doesn't look like a Discord webhook URL, so it wasn't saved.", 'error');
  const r = await send('settings:save', { settings });
  if (!r.ok) return;
  const deferred = r.data?.deferred || [];
  const db = await readDb();
  fillForm(db);
  $('save-note').textContent = deferred.length
    ? `Saved. Waiting until tomorrow: ${deferred.map((k) => LABEL[k] || k).join(', ')}.`
    : 'Saved.';
  toast('Saved.');
});

$('discord-test').addEventListener('click', async () => {
  const r = await send('discord:test');
  if (r.ok) toast('Test message sent.');
});

$('export').addEventListener('click', async () => {
  const data = await chrome.storage.local.get(null);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `zanshin-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
});

const db = await readDb();
fillForm(db);
renderLockState(db);
onDbChange(async () => renderLockState(await readDb()));
