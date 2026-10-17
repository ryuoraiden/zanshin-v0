// Zanshin service worker. Wires chrome events to the pure modules in lib/ and carries out the
// effects they return. Nothing important lives in memory: every handler loads state from
// storage, and anything periodic runs on chrome.alarms (no setInterval here).
//
// Safety rule: if anything in the blocking path throws, all rules are removed (fail open).
import { loadDb, saveDb } from './lib/store.js';
import * as S from './lib/state.js';
import * as T from './lib/tasks.js';
import { cashIn, todayKey } from './lib/db.js';
import { buildRules, checkUrl, blockedUrl } from './lib/rules.js';
import { fetchRecent } from './lib/codeforces.js';
import { proposeSettings } from './lib/settings.js';
import { isExemptUrl } from './lib/urls.js';
import { liveCreditMs } from './lib/credit.js';

const EXT_BASE = chrome.runtime.getURL('');
const BLOCKED = chrome.runtime.getURL('pages/blocked.html');
const pageUrl = (p) => chrome.runtime.getURL(`pages/${p}`);
const uid = () => crypto.randomUUID();
const log = (...a) => console.warn('[zanshin]', ...a);

// ---------------------------------------------------------------------------------------------
// Serialized state access. Every write goes through mutate(), one at a time.

let chain = Promise.resolve();
function exclusive(fn) {
  const run = chain.then(fn);
  chain = run.catch(() => {});
  return run;
}

function mutate(fn) {
  return exclusive(async () => {
    const now = Date.now();
    const db = await loadDb(now);
    const before = db.sessions.length;
    const result = (await fn(db, now)) || { ok: true, effects: [] };
    await saveDb(db, { sessions: db.sessions.length !== before });
    let changed = false;
    for (const effect of result.effects || []) {
      try {
        changed = (await runEffect(effect, db, now)) || changed;
      } catch (err) {
        log('effect failed', effect.kind, err);
      }
    }
    if (changed) await saveDb(db);
    await syncRules(db, now);
    await updateBadge(db, now);
    return { ok: result.ok !== false, error: result.error, data: result.data };
  });
}

// ---------------------------------------------------------------------------------------------
// Blocking rules

let lastRulesSig = null; // null after every worker start, so the first sync always applies

async function syncRules(db, now) {
  try {
    const rules = buildRules(db, now, BLOCKED);
    const sig = JSON.stringify(rules);
    if (sig === lastRulesSig) return;
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map((r) => r.id),
      addRules: rules,
    });
    lastRulesSig = sig;
  } catch (err) {
    log('rules failed, removing all blocking', err);
    lastRulesSig = null;
    try {
      const existing = await chrome.declarativeNetRequest.getDynamicRules();
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existing.map((r) => r.id) });
    } catch {}
    if (db.runtime.active) {
      S.logEvent(db.runtime.active, 'rules-failed', now, { error: String(err?.message || err) });
      await saveDb(db).catch(() => {});
    }
    return;
  }
  await sweepTabs(db, now).catch((err) => log('tab sweep failed', err));
}

// Rules only catch new page loads. Tabs that were already open on a now-blocked site get sent
// to the blocked page, which puts them back by itself once they're allowed again.
// Audible tabs are spared from session blocks so music keeps playing; reward blocks still apply.
async function sweepTabs(db, now) {
  const study = db.runtime.active?.tabId;
  for (const tab of await chrome.tabs.query({})) {
    const url = tab.url || '';
    if (!/^https?:/.test(url) || tab.id === study) continue;
    const reason = checkUrl(db, url, now);
    if (!reason || (reason === 'session' && tab.audible)) continue;
    chrome.tabs.update(tab.id, { url: blockedUrl(BLOCKED, reason, url) }).catch(() => {});
  }
}

async function updateBadge(db, now) {
  const s = db.runtime.active;
  let text = '';
  if (s) text = s.phase === 'recall' ? 'note' : s.phase === 'paused' ? '||' : `${Math.floor(liveCreditMs(s, now) / 60000)}m`;
  try {
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color: s?.phase === 'paused' ? '#5c6370' : '#c8432f' });
  } catch {}
}

// ---------------------------------------------------------------------------------------------
// Effects

async function runEffect(e, db) {
  const s = db.runtime.active;
  switch (e.kind) {
    case 'openTask': {
      if (!s) return false;
      if (s.type === 'video') {
        const win = await openStudyWindow(s.url);
        S.attachStudy(db, win.id, win.tabs?.[0]?.id);
      } else if (s.url) {
        const tab = await openInNormalWindow(s.url);
        S.attachStudy(db, null, tab?.id);
      }
      return true;
    }
    case 'openRecall':
      await openRecall(db);
      return false;
    case 'restoreStudy':
      return restoreStudy(db);
    case 'sessionEnded':
      if (e.session.type === 'video' && e.windowId != null) {
        await chrome.windows.remove(e.windowId).catch(() => {});
        await openDashboard();
      }
      return false;
    case 'discord':
      await postDiscord(db.settings.discordWebhook, e.text);
      return false;
    case 'notify':
      notify(e.title, e.message);
      return false;
    case 'pauseVideo':
      if (s?.tabId != null) await chrome.tabs.sendMessage(s.tabId, { type: 'video:pause' }).catch(() => {});
      return false;
    case 'rewardAlarm':
      await chrome.alarms.create('reward-end', { when: e.when + 1000 });
      return false;
  }
  return false;
}

async function openStudyWindow(url) {
  try {
    return await chrome.windows.create({ url, type: 'popup', state: 'fullscreen', focused: true });
  } catch {
    const win = await chrome.windows.create({ url, type: 'popup', focused: true });
    await chrome.windows.update(win.id, { state: 'fullscreen' }).catch(() => {});
    return win;
  }
}

async function restoreStudy(db) {
  const s = db.runtime.active;
  if (!S.isVideoLock(s) || !canEnforce('restore')) return false;
  const url = s.phase === 'recall' ? pageUrl('recall.html') : s.url;
  const win = await openStudyWindow(url);
  S.attachStudy(db, win.id, win.tabs?.[0]?.id);
  return true;
}

async function openRecall(db) {
  const s = db.runtime.active;
  if (!s) return;
  const url = pageUrl('recall.html');
  if (s.type === 'video' && s.tabId != null) {
    try {
      await chrome.tabs.update(s.tabId, { url });
      return;
    } catch {}
  }
  const existing = await findTab(url);
  if (existing) await focusTab(existing);
  else await openInNormalWindow(url);
}

async function findTab(prefix) {
  const tabs = await chrome.tabs.query({});
  return tabs.find((t) => (t.url || t.pendingUrl || '').startsWith(prefix));
}

async function focusTab(tab) {
  await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
  await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
}

async function openInNormalWindow(url) {
  const wins = (await chrome.windows.getAll({ windowTypes: ['normal'] })).filter((w) => !w.incognito);
  const target = wins.find((w) => w.focused) || wins[0];
  if (target) {
    const tab = await chrome.tabs.create({ windowId: target.id, url, active: true });
    await chrome.windows.update(target.id, { focused: true }).catch(() => {});
    return tab;
  }
  const win = await chrome.windows.create({ url, type: 'normal', focused: true });
  return win.tabs?.[0];
}

async function openDashboard() {
  const url = pageUrl('dashboard.html');
  const existing = await findTab(url);
  if (existing) await focusTab(existing);
  else await openInNormalWindow(url);
}

async function focusSession() {
  const db = await loadDb();
  const s = db.runtime.active;
  if (!s) return { ok: false, error: 'No session running.' };
  if (s.type === 'video' && s.windowId != null) {
    const study = s.tabId != null ? await chrome.tabs.get(s.tabId).catch(() => null) : null;
    if (study && (study.url || '').startsWith(BLOCKED) && s.phase === 'active')
      await chrome.tabs.update(study.id, { url: s.url }).catch(() => {});
    await chrome.windows.update(s.windowId, { focused: true }).catch(() => {});
    return { ok: true };
  }
  const tab = s.tabId != null ? await chrome.tabs.get(s.tabId).catch(() => null) : null;
  if (tab) {
    if ((tab.url || '').startsWith(BLOCKED) && s.url) await chrome.tabs.update(tab.id, { url: s.url }).catch(() => {});
    await focusTab(tab);
  } else if (s.url) {
    const opened = await openInNormalWindow(s.url);
    await mutate((db2) => S.attachStudy(db2, null, opened?.id));
  }
  return { ok: true };
}

async function postDiscord(url, content) {
  if (!url) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
      signal: ctrl.signal,
    });
  } catch (err) {
    log('discord post failed', err?.message);
  } finally {
    clearTimeout(timer);
  }
}

function notify(title, message) {
  try {
    chrome.notifications
      .create({ type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'), title, message, priority: 1 })
      .catch(() => {});
  } catch {}
}

// ---------------------------------------------------------------------------------------------
// Lecture lock enforcement. Every action is debounced and capped at 5 per minute per kind, so
// Zanshin can never get into a fight with Chrome. chrome:// pages and Zanshin's own pages are
// never closed or bounced, so the dashboard and chrome://extensions always stay reachable.

const enforceLog = {};
function canEnforce(kind, now = Date.now()) {
  const list = (enforceLog[kind] ||= []);
  while (list.length && now - list[0] > 60000) list.shift();
  if (list.length >= 5) return false;
  list.push(now);
  return true;
}

function lockOf(db) {
  const s = db.runtime.active;
  return S.isVideoLock(s) && s.windowId != null ? s : null;
}

let bounceTimer = null;
function scheduleBounce() {
  clearTimeout(bounceTimer);
  bounceTimer = setTimeout(() => bounceToStudy().catch(() => {}), 500);
}

async function bounceToStudy() {
  const s = lockOf(await loadDb());
  if (!s) return;
  const win = await chrome.windows.getLastFocused({ populate: true }).catch(() => null);
  if (!win || !win.focused || win.id === s.windowId) return;
  const tab = win.tabs?.find((t) => t.active);
  if (tab && isExemptUrl(tab.url || tab.pendingUrl, EXT_BASE)) return;
  if (!canEnforce('focus')) return;
  await chrome.windows.update(s.windowId, { focused: true }).catch(() => {});
}

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  const s = lockOf(await loadDb());
  if (!s) return;
  const focused = windowId === s.windowId;
  if (s.studyFocused !== focused) mutate((db) => S.setStudyFocus(db, focused));
  if (!focused && windowId !== chrome.windows.WINDOW_ID_NONE) scheduleBounce();
});

let fullscreenTimer = null;
chrome.windows.onBoundsChanged.addListener((win) => {
  clearTimeout(fullscreenTimer);
  fullscreenTimer = setTimeout(async () => {
    const s = lockOf(await loadDb());
    if (!s || win.id !== s.windowId) return;
    const cur = await chrome.windows.get(win.id).catch(() => null);
    if (!cur || cur.state === 'fullscreen' || !canEnforce('fullscreen')) return;
    await chrome.windows.update(win.id, { state: 'fullscreen' }).catch(() => {});
  }, 500);
});

chrome.windows.onRemoved.addListener((windowId) => {
  mutate(async (db) => {
    const s = lockOf(db);
    if (!s || s.windowId !== windowId) return { ok: true, effects: [] };
    // If no Chrome windows are left, Chrome is quitting. Let it; the session resumes on next launch.
    const others = await chrome.windows.getAll();
    return { ok: true, effects: others.length ? [{ kind: 'restoreStudy' }] : [] };
  });
});

chrome.tabs.onCreated.addListener((tab) => {
  exclusive(async () => {
    const now = Date.now();
    const db = await loadDb(now);
    const s = lockOf(db);
    if (!s || tab.id === s.tabId || tab.windowId === s.windowId) return;
    // Browser just restored its tabs (the heartbeat check covers events that beat the first tick).
    const stale = db.runtime.lastHeartbeat && now - db.runtime.lastHeartbeat > S.GAP_MS;
    if (stale || now < (db.runtime.graceUntil || 0)) return;
    if (isExemptUrl(tab.pendingUrl || tab.url, EXT_BASE)) return;
    if (!canEnforce('closeTab')) return;
    await chrome.tabs.remove(tab.id).catch(() => {});
  });
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const s = lockOf(await loadDb());
  if (!s || tabId === s.tabId) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab && !isExemptUrl(tab.url || tab.pendingUrl, EXT_BASE)) scheduleBounce();
});

// Opening chrome://extensions mid-session is logged, never blocked: blocking it would turn a bug
// into a trap.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (!info.url) return;
  if (info.url.startsWith('chrome://extensions')) mutate((db, now) => S.tamper(db, now));
  // A tab outside the study window navigated away from an exempt page (e.g. an override on the
  // blocked page): check whether focus needs to go back to the lecture.
  else if (!isExemptUrl(info.url, EXT_BASE)) {
    const s = lockOf(await loadDb());
    if (s && tabId !== s.tabId) scheduleBounce();
  }
});

// ---------------------------------------------------------------------------------------------
// Content script handlers

// Runs inside the lock: a freshly opened study window says hello before the start mutation has
// stored its tab id, and must wait for it.
const videoHello = (msg, sender) => exclusive(() => videoHelloUnlocked(msg, sender));

async function videoHelloUnlocked(msg, sender) {
  const db = await loadDb();
  const s = db.runtime.active;
  const tabId = sender.tab?.id;
  if (!s || s.type !== 'video' || s.phase !== 'active' || tabId == null || tabId !== s.tabId || !msg.videoId)
    return { target: false };
  const want = s.videoId || s.boundVideoId;
  if (want && msg.videoId !== want) {
    // Wandered to a different video inside the study window: go back to the lecture.
    if (sender.frameId === 0 && msg.isWatch && canEnforce('nav')) chrome.tabs.update(tabId, { url: s.url }).catch(() => {});
    return { target: false };
  }
  return { target: true, resumeAt: s.lastPosition || 0, cinema: sender.frameId === 0 && !!msg.isWatch };
}

function videoProgress(msg, sender) {
  return mutate((db, now) => {
    const s = db.runtime.active;
    if (!s || sender.tab?.id !== s.tabId) return { ok: true, effects: [] };
    return S.videoProgress(db, msg, now);
  });
}

// In-page navigations (YouTube is a single-page app) never hit the network rules.
async function navCheck(msg, sender) {
  const now = Date.now();
  const db = await loadDb(now);
  const reason = checkUrl(db, msg.url, now);
  if (reason && sender.tab?.id != null && sender.frameId === 0)
    await chrome.tabs.update(sender.tab.id, { url: blockedUrl(BLOCKED, reason, msg.url) }).catch(() => {});
  return { ok: true, blocked: !!reason };
}

// ---------------------------------------------------------------------------------------------
// Messages

const CONTENT_MESSAGES = new Set(['video:hello', 'video:progress', 'nav:check']);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true;
});

async function handle(msg, sender) {
  const type = msg?.type;
  const fromExtensionPage = (sender.url || '').startsWith(EXT_BASE);
  if (!fromExtensionPage && !CONTENT_MESSAGES.has(type)) return { ok: false, error: 'Not allowed.' };
  switch (type) {
    case 'task:add':
      return mutate((db, now) => T.addTask(db, msg.task, now, uid()));
    case 'task:update':
      return mutate((db) => T.updateTask(db, msg.id, msg.task));
    case 'task:delete':
      return mutate((db) => T.deleteTask(db, msg.id));
    case 'task:pin':
      return mutate((db) => T.togglePin(db, msg.id));
    case 'task:reopen':
      return mutate((db) => T.reopenTask(db, msg.id));
    case 'session:start':
      return mutate((db, now) => S.startSession(db, msg.taskId, now, uid()));
    case 'session:pause':
      return mutate((db, now) => S.pause(db, now));
    case 'session:resume':
      return mutate((db, now) => S.resume(db, now));
    case 'session:done':
      return mutate((db, now) => S.markDone(db, now));
    case 'session:note':
      return mutate((db, now) => S.completeWithNote(db, msg.note, now));
    case 'session:requestExit':
      return mutate((db, now) => S.requestExit(db, now));
    case 'session:cancelExit':
      return mutate((db) => S.cancelExit(db));
    case 'session:confirmExit':
      return mutate((db, now) => S.confirmExit(db, now));
    case 'session:allowDomain':
      return mutate((db, now) => S.allowDomain(db, msg.domain, now));
    case 'session:focus':
      return focusSession();
    case 'reward:cashIn':
      return mutate((db, now) => cashIn(db, now));
    case 'settings:save':
      return mutate((db, now) => {
        const r = proposeSettings(db.settings, msg.settings || {}, { today: todayKey(db, now) });
        db.settings = r.settings;
        db.runtime.pending = r.pending;
        return { ok: true, effects: [], data: { deferred: r.deferred } };
      });
    case 'settings:lock':
      return mutate((db) => {
        db.settings.setupLocked = true;
        return { ok: true, effects: [] };
      });
    case 'discord:test': {
      const db = await loadDb();
      if (!db.settings.discordWebhook) return { ok: false, error: 'Save a valid Discord webhook URL first.' };
      await postDiscord(db.settings.discordWebhook, 'Zanshin is connected.');
      return { ok: true };
    }
    case 'controls:open':
      await openDashboard();
      return { ok: true };
    case 'video:hello':
      return videoHello(msg, sender);
    case 'video:progress':
      return videoProgress(msg, sender);
    case 'nav:check':
      return navCheck(msg, sender);
    default:
      return { ok: false, error: `Unknown message: ${type}` };
  }
}

// ---------------------------------------------------------------------------------------------
// Heartbeat, Codeforces polling, startup

async function wake() {
  // Codeforces is polled outside the lock so a slow API never stalls the buttons.
  let submissions = null;
  const peek = await loadDb();
  const cf = peek.runtime.active;
  if (cf?.type === 'codeforces' && cf.phase !== 'recall' && peek.settings.cfHandle) {
    try {
      submissions = await fetchRecent(peek.settings.cfHandle);
    } catch (err) {
      log('codeforces poll failed', err?.message);
    }
  }
  return mutate(async (db, now) => {
    const r = S.tick(db, now);
    if (submissions) r.effects.push(...S.cfCheck(db, submissions, now).effects);
    const s = db.runtime.active;
    if (S.isVideoLock(s)) {
      const exists = s.windowId != null && (await chrome.windows.get(s.windowId).then(() => true, () => false));
      if (!exists) r.effects.push({ kind: 'restoreStudy' });
    }
    return r;
  });
}

async function ensureAlarm() {
  if (!(await chrome.alarms.get('tick'))) await chrome.alarms.create('tick', { periodInMinutes: 1 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'tick' || alarm.name === 'reward-end') wake();
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await ensureAlarm();
  if (reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-controls') openDashboard();
});

ensureAlarm();
wake();
