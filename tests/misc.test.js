import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeIntervals, coverage, dayKey, addIntervals } from '../lib/credit.js';
import { parseProblem, solvedAfter } from '../lib/codeforces.js';
import { normalizeSettings, proposeSettings, applyPending } from '../lib/settings.js';
import { orderQueue, deadlineStatus } from '../lib/queue.js';
import { buildTask, updateTask, deleteTask, parseDeadline } from '../lib/tasks.js';
import { quotaStatus, cashIn, normalizeDb } from '../lib/db.js';
import { startSession } from '../lib/state.js';
import { normalizeDomain, videoIdFromUrl, isExemptUrl } from '../lib/urls.js';
import { freshDb, withTask, T0, MIN } from './helpers.js';

const DAY = 86400000;

test('intervals merge and coverage counts each second once', () => {
  assert.deepEqual(mergeIntervals([[10, 20], [0, 5], [5.2, 9], [15, 30]]), [[0, 9], [10, 30]]);
  const merged = addIntervals([[0, 50]], [[0, 50], [40, 70]], 60);
  assert.deepEqual(merged, [[0, 60]]);
  assert.equal(coverage([[0, 30], [0, 30]], 60), 0.5);
  assert.equal(coverage([[0, 30]], 0), 0);
});

test('the day starts at 04:00', () => {
  assert.equal(dayKey(new Date(2026, 9, 18, 1, 30).getTime()), '2026-10-17');
  assert.equal(dayKey(new Date(2026, 9, 18, 3, 59).getTime()), '2026-10-17');
  assert.equal(dayKey(new Date(2026, 9, 18, 4, 0).getTime()), '2026-10-18');
  assert.equal(dayKey(new Date(2026, 9, 18, 0, 30).getTime(), 0), '2026-10-18');
});

test('codeforces problem parsing', () => {
  assert.deepEqual(parseProblem('580A'), { contestId: 580, index: 'A' });
  assert.deepEqual(parseProblem('1352 c2'), { contestId: 1352, index: 'C2' });
  assert.deepEqual(parseProblem('https://codeforces.com/problemset/problem/580/A'), { contestId: 580, index: 'A' });
  assert.deepEqual(parseProblem('https://codeforces.com/contest/1352/problem/C2'), { contestId: 1352, index: 'C2' });
  assert.equal(parseProblem('hello'), null);
  const p = { contestId: 580, index: 'A' };
  const subs = [
    { verdict: 'WRONG_ANSWER', problem: { contestId: 580, index: 'A' }, creationTimeSeconds: 200 },
    { verdict: 'OK', problem: { contestId: 580, index: 'B' }, creationTimeSeconds: 200 },
  ];
  assert.equal(solvedAfter(subs, p, 100), false, 'wrong verdict or wrong problem');
  subs.push({ verdict: 'OK', problem: { contestId: 580, index: 'a' }, creationTimeSeconds: 200 });
  assert.equal(solvedAfter(subs, p, 100), true);
  assert.equal(solvedAfter(subs, p, 201), false);
});

test('settings are clamped and webhooks validated', () => {
  const s = normalizeSettings({ quotaMin: -5, hardCapMin: 99999, discordWebhook: 'https://evil.example/x' });
  assert.equal(s.quotaMin, 0);
  assert.equal(s.hardCapMin, 720);
  assert.equal(s.discordWebhook, '');
  assert.equal(normalizeSettings({ discordWebhook: 'https://discord.com/api/webhooks/1/abc' }).discordWebhook, 'https://discord.com/api/webhooks/1/abc');
});

test('setup mode applies everything immediately', () => {
  const cur = normalizeSettings({});
  const r = proposeSettings(cur, { quotaMin: 1, rewardMin: 1 }, { today: '2026-10-17' });
  assert.equal(r.settings.quotaMin, 1);
  assert.equal(r.pending, null);
});

test('after locking, loosening waits for tomorrow and tightening applies now', () => {
  const cur = normalizeSettings({ setupLocked: true });
  const r = proposeSettings(
    cur,
    { quotaMin: 120, rewardMin: 30, rewardDomains: ['netflix.com', 'twitch.tv'] },
    { today: '2026-10-17' },
  );
  assert.equal(r.settings.quotaMin, 300, 'lower quota deferred');
  assert.equal(r.settings.rewardMin, 30, 'shorter reward applies');
  assert.ok(r.settings.rewardDomains.includes('twitch.tv'), 'added domain applies');
  assert.ok(r.settings.rewardDomains.includes('reddit.com'), 'removed domain still blocked today');
  assert.deepEqual(r.deferred.sort(), ['quotaMin', 'rewardDomains']);
  assert.equal(r.settings.setupLocked, true);
  const same = applyPending(r.settings, r.pending, '2026-10-17');
  assert.equal(same.settings.quotaMin, 300);
  const next = applyPending(r.settings, r.pending, '2026-10-18');
  assert.equal(next.settings.quotaMin, 120);
  assert.ok(!next.settings.rewardDomains.includes('reddit.com'));
  assert.equal(next.pending, null);
});

test('locking cannot be undone through the settings form', () => {
  const cur = normalizeSettings({ setupLocked: true });
  assert.equal(proposeSettings(cur, { setupLocked: false }, { today: 'x' }).settings.setupLocked, true);
});

test('quota gate: cash in once per day after setup is locked', () => {
  const db = freshDb({ quotaMin: 30, rewardMin: 90, setupLocked: true });
  assert.equal(cashIn(db, T0).ok, false, 'quota not met');
  db.sessions.push({ day: '2026-10-17', creditedMs: 31 * MIN, category: 'DSA', outcome: 'completed' });
  assert.equal(quotaStatus(db, T0).canCashIn, true);
  assert.equal(cashIn(db, T0).ok, true);
  assert.equal(db.runtime.rewardUntil, T0 + 90 * MIN);
  assert.equal(cashIn(db, T0 + 100 * MIN).ok, false, 'once per day');
  assert.equal(quotaStatus(db, T0 + DAY).usedToday, false, 'next day resets');
});

test('setup mode cash-ins do not use up the day', () => {
  const db = freshDb({ quotaMin: 0, rewardMin: 1 });
  assert.equal(cashIn(db, T0).ok, true);
  assert.equal(cashIn(db, T0 + 2 * MIN).ok, true);
});

test('pending settings apply on load once the day rolls over', () => {
  const raw = {
    settings: { setupLocked: true, quotaMin: 300 },
    runtime: { pending: { proposedDay: '2026-10-17', values: { quotaMin: 200 } } },
  };
  assert.equal(normalizeDb(raw, T0).settings.quotaMin, 300);
  assert.equal(normalizeDb(raw, T0 + DAY).settings.quotaMin, 200);
});

test('queue order: pinned, urgent hard deadlines, then by deadline', () => {
  const now = T0;
  const tasks = [
    { id: 'a', status: 'todo', createdAt: 1, deadline: now + 5 * DAY },
    { id: 'b', status: 'todo', createdAt: 2, deadline: null },
    { id: 'c', status: 'todo', createdAt: 3, deadline: now + 2 * DAY, hardDeadline: true },
    { id: 'd', status: 'todo', createdAt: 4, deadline: null, pinned: true },
    { id: 'e', status: 'done', createdAt: 5 },
    { id: 'f', status: 'todo', createdAt: 6, deadline: now + 1 * DAY },
    { id: 'g', status: 'todo', createdAt: 7, deadline: now - DAY, hardDeadline: true },
  ];
  assert.deepEqual(orderQueue(tasks, now).map((t) => t.id), ['d', 'g', 'c', 'f', 'a', 'b']);
  assert.equal(deadlineStatus(tasks[6], now), 'overdue');
  assert.equal(deadlineStatus(tasks[2], now), 'soon');
});

test('task validation', () => {
  assert.ok(buildTask({ title: '' }).error);
  assert.ok(buildTask({ title: 'L1', type: 'video' }).error, 'video needs a url');
  assert.ok(buildTask({ title: 'x', url: 'javascript:alert(1)' }).error);
  const cf = buildTask({ title: 'Kefa', type: 'codeforces', cfProblem: '580a' }).task;
  assert.equal(cf.cfProblem, '580A');
  assert.equal(cf.url, 'https://codeforces.com/problemset/problem/580/A');
  const fromUrl = buildTask({ title: 'C2', type: 'codeforces', url: 'codeforces.com/contest/1352/problem/C2' }).task;
  assert.equal(fromUrl.cfProblem, '1352C2');
  assert.equal(parseDeadline('2026-10-23'), new Date(2026, 9, 23, 23, 59).getTime());
  assert.equal(parseDeadline('2026-10-23T18:30'), new Date(2026, 9, 23, 18, 30).getTime());
});

test('the running task cannot be edited or deleted', () => {
  const db = freshDb();
  const task = withTask(db, {});
  startSession(db, task.id, T0, 's');
  assert.equal(updateTask(db, task.id, { title: 'new' }).ok, false);
  assert.equal(deleteTask(db, task.id).ok, false);
});

test('url helpers', () => {
  assert.equal(normalizeDomain('https://www.YouTube.com/watch?v=1'), 'youtube.com');
  assert.equal(normalizeDomain('pwn.college'), 'pwn.college');
  assert.equal(videoIdFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x'), 'dQw4w9WgXcQ');
  assert.equal(videoIdFromUrl('https://youtu.be/dQw4w9WgXcQ?t=3'), 'dQw4w9WgXcQ');
  assert.equal(videoIdFromUrl('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(videoIdFromUrl('https://example.com/watch?v=1'), null);
  const ext = 'chrome-extension://abc/';
  assert.equal(isExemptUrl('chrome-extension://abc/pages/dashboard.html', ext), true);
  assert.equal(isExemptUrl('chrome://extensions/', ext), true);
  assert.equal(isExemptUrl('chrome://newtab/', ext), false);
  assert.equal(isExemptUrl('https://reddit.com', ext), false);
});
