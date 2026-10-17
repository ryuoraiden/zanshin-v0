import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRules, checkUrl, sessionAllowList, pathRegex } from '../lib/rules.js';
import { startSession, allowDomain } from '../lib/state.js';
import { freshDb, withTask, T0 } from './helpers.js';

const BASE = 'chrome-extension://abc/pages/blocked.html';

test('no session: only reward blocks', () => {
  const db = freshDb();
  const rules = buildRules(db, T0, BASE);
  assert.ok(rules.every((r) => r.priority === 3));
  const domains = rules.find((r) => r.id === 10);
  assert.ok(domains.condition.requestDomains.includes('netflix.com'));
  assert.equal(domains.action.redirect.regexSubstitution, `${BASE}?r=reward#\\0`);
  assert.ok(rules.some((r) => r.condition.regexFilter.includes('shorts')));
});

test('reward window open and no session: no rules at all', () => {
  const db = freshDb();
  db.runtime.rewardUntil = T0 + 1000;
  assert.deepEqual(buildRules(db, T0, BASE), []);
  assert.ok(buildRules(db, T0 + 1000, BASE).length > 0, 'window closes on time');
});

test('session: catch-all plus allowlist with task, category, always-allowed and overrides', () => {
  const db = freshDb();
  const task = withTask(db, { category: 'DSA', url: 'https://www.geeksforgeeks.org/x', extraDomains: 'cp-algorithms.com' });
  startSession(db, task.id, T0, 's');
  allowDomain(db, 'stackoverflow.com', T0);
  const allow = sessionAllowList(db);
  for (const d of ['geeksforgeeks.org', 'codeforces.com', 'cp-algorithms.com', 'accounts.google.com', 'localhost', 'stackoverflow.com'])
    assert.ok(allow.includes(d), d);
  const rules = buildRules(db, T0, BASE);
  const ids = rules.map((r) => r.id);
  assert.ok(ids.includes(1) && ids.includes(2));
  assert.equal(new Set(ids).size, ids.length, 'rule ids are unique');
});

test('codeforces sessions always allow codeforces.com', () => {
  const db = freshDb();
  db.settings.categoryDomains.Cyber = [];
  const task = withTask(db, { category: 'Cyber', type: 'codeforces', cfProblem: '1A' });
  startSession(db, task.id, T0, 's');
  assert.ok(sessionAllowList(db).includes('codeforces.com'));
});

test('shorts regex matches shorts pages only', () => {
  const re = new RegExp(pathRegex({ domain: 'youtube.com', path: '/shorts' }));
  assert.ok(re.test('https://www.youtube.com/shorts/abc'));
  assert.ok(re.test('https://m.youtube.com/shorts'));
  assert.ok(re.test('https://youtube.com/shorts?feature=x'));
  assert.ok(!re.test('https://www.youtube.com/shortsfoo'));
  assert.ok(!re.test('https://www.youtube.com/watch?v=abc'));
  assert.ok(!re.test('https://notyoutube.com/shorts/abc'));
});

test('checkUrl mirrors the rules', () => {
  const db = freshDb();
  assert.equal(checkUrl(db, 'https://www.reddit.com/r/all', T0), 'reward');
  assert.equal(checkUrl(db, 'https://www.youtube.com/shorts/abc', T0), 'reward');
  assert.equal(checkUrl(db, 'https://www.youtube.com/watch?v=abc', T0), null);
  const task = withTask(db, { category: 'DSA' });
  startSession(db, task.id, T0, 's');
  assert.equal(checkUrl(db, 'https://codeforces.com/problemset', T0), null);
  assert.equal(checkUrl(db, 'https://www.youtube.com/watch?v=abc', T0), 'session');
  assert.equal(checkUrl(db, 'chrome://extensions', T0), null);
  db.runtime.rewardUntil = T0 + 1;
  db.runtime.active = null;
  assert.equal(checkUrl(db, 'https://www.reddit.com/', T0), null);
});
