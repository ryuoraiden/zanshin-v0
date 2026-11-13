import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../lib/state.js';
import { liveCreditMs } from '../lib/credit.js';
import { freshDb, withTask, T0, MIN } from './helpers.js';

const long = 'x'.repeat(160);

function started(input = {}, settings = {}) {
  const db = freshDb(settings);
  const task = withTask(db, input);
  const r = S.startSession(db, task.id, T0, 's1');
  assert.equal(r.ok, true, r.error);
  return { db, task, s: db.runtime.active };
}

test('a task with a link opens on start, one without does not', () => {
  const manual = freshDb();
  const m = withTask(manual, { url: 'https://codeforces.com/problemset' });
  assert.deepEqual(S.startSession(manual, m.id, T0, 's').effects, [{ kind: 'openTask' }]);
  const lecture = freshDb();
  const v = withTask(lecture, { type: 'video', category: 'IITM', url: 'https://youtu.be/abcdefghijk' });
  assert.deepEqual(S.startSession(lecture, v.id, T0, 's').effects, [{ kind: 'openTask' }]);
  const bare = freshDb();
  assert.deepEqual(S.startSession(bare, withTask(bare, {}).id, T0, 's').effects, []);
});

test('start refuses a second session', () => {
  const { db, task } = started();
  assert.equal(db.runtime.active.phase, 'active');
  const again = S.startSession(db, task.id, T0, 's2');
  assert.equal(again.ok, false);
});

test('codeforces tasks need a handle', () => {
  const db = freshDb({ cfHandle: '' });
  const task = withTask(db, { type: 'codeforces', cfProblem: '580A' });
  assert.equal(S.startSession(db, task.id, T0, 's').ok, false);
});

test('manual: done -> recall -> note completes and returns to idle', () => {
  const { db, task } = started();
  const r1 = S.markDone(db, T0 + 10 * MIN);
  assert.deepEqual(r1.effects, [{ kind: 'openRecall' }]);
  assert.equal(db.runtime.active.phase, 'recall');
  const r2 = S.completeWithNote(db, 'binary search on the answer', T0 + 12 * MIN);
  assert.equal(r2.ok, true);
  assert.equal(db.runtime.active, null);
  assert.equal(db.tasks.find((t) => t.id === task.id).status, 'done');
  const rec = db.sessions.at(-1);
  assert.equal(rec.outcome, 'completed');
  assert.equal(rec.creditedMs, 12 * MIN);
  assert.ok(r2.effects.some((e) => e.kind === 'discord' && e.text.startsWith('Done:')));
});

test('a note can be empty or as short as you like', () => {
  for (const note of ['', '   ', 'ok']) {
    const { db, task } = started();
    S.markDone(db, T0 + MIN);
    assert.equal(S.completeWithNote(db, note, T0 + MIN).ok, true);
    assert.equal(db.runtime.active, null);
    assert.equal(db.tasks.find((t) => t.id === task.id).status, 'done');
    assert.equal(db.sessions.at(-1).note, note.trim());
  }
});

test('with notes off, Done finishes the task straight away', () => {
  const { db, task } = started({}, { recallNotes: false });
  const r = S.markDone(db, T0 + 10 * MIN);
  assert.equal(db.runtime.active, null);
  assert.ok(r.effects.every((e) => e.kind !== 'openRecall'));
  assert.ok(r.effects.some((e) => e.kind === 'sessionEnded'));
  assert.equal(db.tasks.find((t) => t.id === task.id).status, 'done');
  assert.equal(db.sessions.at(-1).outcome, 'completed');
  assert.equal(db.sessions.at(-1).creditedMs, 10 * MIN);
});

test('with notes off, a lecture finishes at the end of the video', () => {
  const { db } = started({ type: 'video', category: 'IITM', url: 'https://youtu.be/abcdefghijk' }, { recallNotes: false });
  S.videoProgress(db, { videoId: 'abcdefghijk', duration: 100, intervals: [[0, 95]], currentTime: 95, playedMs: 95000 }, T0);
  assert.ok(db.runtime.active, 'still playing the end of it');
  const r = S.videoProgress(db, { videoId: 'abcdefghijk', duration: 100, intervals: [[95, 100]], currentTime: 100, ended: true, playedMs: 5000 }, T0);
  assert.equal(db.runtime.active, null);
  assert.ok(r.effects.some((e) => e.kind === 'sessionEnded'), 'closes the study window');
  assert.equal(db.sessions.at(-1).creditedMs, 100000);
});

test('with notes off, a fresh AC finishes a Codeforces task', () => {
  const { db } = started({ type: 'codeforces', cfProblem: '580A' }, { recallNotes: false });
  const accepted = [{ verdict: 'OK', problem: { contestId: 580, index: 'A' }, creationTimeSeconds: Math.floor(T0 / 1000) + 60 }];
  const r = S.cfCheck(db, accepted, T0 + 2 * MIN);
  assert.equal(db.runtime.active, null);
  assert.ok(r.effects.some((e) => e.kind === 'notify' && e.message.includes('is done')));
  assert.ok(db.sessions.at(-1).events.some((e) => e.kind === 'accepted'));
});

test('a session waiting on the note page finishes if notes get turned off', () => {
  const { db } = started();
  S.markDone(db, T0 + MIN);
  db.settings.recallNotes = false;
  S.markDone(db, T0 + 2 * MIN);
  assert.equal(db.runtime.active, null);
});

// A started task whose link Zanshin opened in tab 7.
function withTab(input = {}, settings = {}) {
  const ctx = started({ url: 'https://leetcode.com/problems/two-sum', ...input }, settings);
  S.attachStudy(ctx.db, null, 7);
  return ctx;
}

test('closing the task tab finishes a manual task', () => {
  const { db, task } = withTab({}, { recallNotes: false });
  const r = S.taskTabClosed(db, 7, T0 + 10 * MIN);
  assert.equal(db.runtime.active, null);
  assert.equal(db.tasks.find((t) => t.id === task.id).status, 'done');
  const rec = db.sessions.at(-1);
  assert.equal(rec.outcome, 'completed');
  assert.equal(rec.creditedMs, 10 * MIN);
  assert.equal(rec.manual, false);
  assert.ok(rec.events.some((e) => e.kind === 'tab-closed'));
  assert.equal(r.effects.find((e) => e.kind === 'sessionEnded').tabId, null, 'no tab left to close');
  assert.ok(r.effects.some((e) => e.kind === 'notify' && e.message.includes('closed its tab')));
});

test('closing the task tab while paused finishes with the credit earned so far', () => {
  const { db } = withTab({}, { recallNotes: false });
  S.pause(db, T0 + 5 * MIN);
  S.taskTabClosed(db, 7, T0 + 20 * MIN);
  assert.equal(db.runtime.active, null);
  assert.equal(db.sessions.at(-1).creditedMs, 5 * MIN);
});

test('closing the task tab with notes on goes to the note page', () => {
  const { db } = withTab();
  const r = S.taskTabClosed(db, 7, T0 + MIN);
  assert.equal(db.runtime.active.phase, 'recall');
  assert.deepEqual(r.effects, [{ kind: 'openRecall' }]);
});

test('closing another tab, or the task tab during the note, changes nothing', () => {
  const { db } = withTab();
  assert.deepEqual(S.taskTabClosed(db, 8, T0 + MIN).effects, []);
  assert.equal(db.runtime.active.phase, 'active');
  assert.equal(db.runtime.active.tabId, 7);
  S.markDone(db, T0 + MIN);
  assert.deepEqual(S.taskTabClosed(db, 7, T0 + 2 * MIN).effects, []);
  assert.equal(db.runtime.active.phase, 'recall');
  assert.equal(db.runtime.active.tabId, null);
});

test('closing a Codeforces tab asks for a submission check and does not finish by hand', () => {
  const { db } = withTab(
    { type: 'codeforces', cfProblem: '580A', url: 'https://codeforces.com/problemset/problem/580/A' },
    { recallNotes: false },
  );
  const r = S.taskTabClosed(db, 7, T0 + MIN);
  assert.equal(r.data.checkCodeforces, true);
  assert.deepEqual(r.effects, []);
  assert.equal(db.runtime.active.phase, 'active');
  assert.equal(db.runtime.active.manual, false);
  assert.equal(db.runtime.active.tabId, null);
});

test('a lecture is never finished by its tab closing', () => {
  const { db } = started({ type: 'video', category: 'IITM', url: 'https://youtu.be/abcdefghijk' }, { recallNotes: false });
  S.attachStudy(db, 3, 7);
  assert.deepEqual(S.taskTabClosed(db, 7, T0 + MIN).effects, []);
  assert.equal(db.runtime.active.phase, 'active');
  assert.equal(db.runtime.active.tabId, 7);
});

test('a tab Chrome swapped for a new one is still the task tab', () => {
  const { db } = withTab({}, { recallNotes: false });
  S.replaceStudyTab(db, 1, 2);
  assert.equal(db.runtime.active.tabId, 7);
  S.replaceStudyTab(db, 7, 9);
  assert.equal(db.runtime.active.tabId, 9);
  S.taskTabClosed(db, 9, T0 + MIN);
  assert.equal(db.runtime.active, null);
});

test('pause stops credit, resume restarts it', () => {
  const { db } = started();
  S.pause(db, T0 + 10 * MIN);
  assert.equal(liveCreditMs(db.runtime.active, T0 + 14 * MIN), 10 * MIN);
  S.resume(db, T0 + 15 * MIN);
  S.markDone(db, T0 + 25 * MIN);
  S.completeWithNote(db, 'finished the worksheet', T0 + 25 * MIN);
  assert.equal(db.sessions.at(-1).creditedMs, 20 * MIN);
});

test('exit: locked at 59 s, available at 60 s', () => {
  const { db } = started();
  S.requestExit(db, T0);
  assert.equal(S.exitStatus(db.runtime.active, T0 + 59_000).state, 'waiting');
  assert.equal(S.confirmExit(db, T0 + 59_000).ok, false);
  const r = S.confirmExit(db, T0 + 60_000);
  assert.equal(r.ok, true);
  assert.equal(db.runtime.active, null);
  assert.equal(db.sessions.at(-1).outcome, 'abandoned');
});

test('exit request goes stale after 5 min unconfirmed', () => {
  const { db } = started();
  S.requestExit(db, T0);
  S.tick(db, T0 + 60_000);
  S.tick(db, T0 + 2 * MIN);
  S.tick(db, T0 + 3 * MIN);
  S.tick(db, T0 + 4 * MIN);
  S.tick(db, T0 + 5 * MIN);
  assert.equal(db.runtime.active.exitRequestedAt, null);
  assert.equal(S.confirmExit(db, T0 + 5 * MIN).ok, false);
});

test('cancel exit drops the request', () => {
  const { db } = started();
  S.requestExit(db, T0);
  S.cancelExit(db);
  assert.equal(S.exitStatus(db.runtime.active, T0 + 2 * MIN).state, 'none');
});

test('hard cap expires the session', () => {
  const { db } = started({}, { hardCapMin: 240 });
  for (let m = 1; m < 240; m++) S.tick(db, T0 + m * MIN);
  assert.ok(db.runtime.active);
  const r = S.tick(db, T0 + 240 * MIN);
  assert.equal(db.runtime.active, null);
  assert.equal(db.sessions.at(-1).outcome, 'expired');
  assert.ok(r.effects.some((e) => e.kind === 'notify'));
});

test('a heartbeat gap is logged and not credited', () => {
  const { db } = started();
  S.tick(db, T0 + 1 * MIN);
  const r = S.tick(db, T0 + 11 * MIN); // Chrome was closed for 10 minutes
  assert.ok(r.effects.some((e) => e.kind === 'discord' && e.text.startsWith('Gap:')));
  assert.ok(db.runtime.active.events.some((e) => e.kind === 'gap' && e.minutes === 10));
  assert.ok(db.runtime.graceUntil > T0 + 11 * MIN, 'restored tabs get a grace period');
  assert.equal(liveCreditMs(db.runtime.active, T0 + 12 * MIN), 2 * MIN);
});

test('every phase has a path back to idle', () => {
  for (const phase of ['active', 'paused', 'recall']) {
    const { db } = started();
    if (phase === 'paused') S.pause(db, T0 + MIN);
    if (phase === 'recall') S.markDone(db, T0 + MIN);
    S.requestExit(db, T0 + 2 * MIN);
    assert.equal(S.confirmExit(db, T0 + 3 * MIN).ok, true, phase);
    assert.equal(db.runtime.active, null, phase);
  }
});

test('video: dragging to the end does not complete', () => {
  const { db } = started({ type: 'video', category: 'IITM', url: 'https://www.youtube.com/watch?v=abcdefghijk' });
  const s = db.runtime.active;
  assert.equal(s.videoId, 'abcdefghijk');
  S.videoProgress(db, { videoId: 'abcdefghijk', duration: 600, intervals: [[0, 10]], currentTime: 10, playedMs: 10_000 }, T0 + MIN);
  S.videoProgress(db, { videoId: 'abcdefghijk', duration: 600, intervals: [[595, 600]], currentTime: 600, playedMs: 5_000 }, T0 + MIN);
  assert.equal(s.phase, 'active');
});

test('video: 90% played does not cut the lecture off; the end of the video finishes it', () => {
  const { db } = started({ type: 'video', category: 'IITM', url: 'https://youtu.be/abcdefghijk' });
  const s = db.runtime.active;
  for (let t = 0; t < 540; t += 5) {
    S.videoProgress(db, { videoId: 'abcdefghijk', duration: 600, intervals: [[t, t + 5]], currentTime: t + 5, playedMs: 2500 }, T0);
  }
  assert.equal(s.watchedEnough, true);
  assert.equal(s.phase, 'active', 'still playing the last 10%');
  const r = S.videoProgress(db, { videoId: 'abcdefghijk', duration: 600, intervals: [[540, 600]], currentTime: 600, ended: true, playedMs: 30000 }, T0);
  assert.deepEqual(r.effects, [{ kind: 'openRecall' }]);
  assert.equal(s.phase, 'recall');
  assert.equal(S.completeWithNote(db, long, T0 + MIN).ok, true);
  assert.equal(db.sessions.at(-1).coverage, 1);
  assert.equal(db.sessions.at(-1).manual, false);
});

test('video: reaching the end without 90% played does not finish it', () => {
  const { db } = started({ type: 'video', category: 'IITM', url: 'https://youtu.be/abcdefghijk' });
  S.videoProgress(db, { videoId: 'abcdefghijk', duration: 600, intervals: [[0, 60]], currentTime: 60, playedMs: 60000 }, T0);
  S.videoProgress(db, { videoId: 'abcdefghijk', duration: 600, intervals: [[590, 600]], currentTime: 600, ended: true, playedMs: 10000 }, T0);
  assert.equal(db.runtime.active.phase, 'active');
});

test('video: Done after 90% is not "by hand", Done before it is', () => {
  const a = started({ type: 'video', category: 'IITM', url: 'https://youtu.be/abcdefghijk' });
  S.videoProgress(a.db, { videoId: 'abcdefghijk', duration: 100, intervals: [[0, 92]], currentTime: 92, playedMs: 92000 }, T0);
  S.markDone(a.db, T0 + MIN);
  assert.equal(a.db.runtime.active.manual, false);
  const b = started({ type: 'video', category: 'IITM', url: 'https://youtu.be/abcdefghijk' });
  S.videoProgress(b.db, { videoId: 'abcdefghijk', duration: 100, intervals: [[0, 50]], currentTime: 50, playedMs: 50000 }, T0);
  S.markDone(b.db, T0 + MIN);
  assert.equal(b.db.runtime.active.manual, true);
});

test('video: other videos are ignored and unfocused playback earns no credit', () => {
  const { db } = started({ type: 'video', category: 'IITM', url: 'https://www.youtube.com/watch?v=abcdefghijk' });
  const s = db.runtime.active;
  S.videoProgress(db, { videoId: 'zzzzzzzzzzz', duration: 60, intervals: [[0, 60]], playedMs: 60_000 }, T0);
  assert.equal(s.watched.length, 0);
  S.setStudyFocus(db, false);
  S.videoProgress(db, { videoId: 'abcdefghijk', duration: 600, intervals: [[0, 5]], playedMs: 5000 }, T0);
  assert.equal(s.credit.accum, 0);
  S.setStudyFocus(db, true);
  S.videoProgress(db, { videoId: 'abcdefghijk', duration: 600, intervals: [[5, 10]], playedMs: 5000 }, T0);
  assert.equal(s.credit.accum, 5000);
});

test('portal pages bind to the first embedded video that reports', () => {
  const { db } = started({ type: 'video', category: 'IITM', url: 'https://seek.onlinedegree.iitm.ac.in/courses/x' });
  const s = db.runtime.active;
  assert.equal(s.videoId, null);
  S.videoProgress(db, { videoId: 'aaaaaaaaaaa', duration: 100, intervals: [[0, 5]] }, T0);
  S.videoProgress(db, { videoId: 'bbbbbbbbbbb', duration: 100, intervals: [[5, 99]] }, T0);
  assert.equal(s.boundVideoId, 'aaaaaaaaaaa');
  assert.equal(s.phase, 'active');
});

test('pausing on blur is requested only when the setting is on', () => {
  const { db } = started({ type: 'video', category: 'IITM', url: 'https://youtu.be/abcdefghijk' }, { pauseOnBlur: true });
  assert.deepEqual(S.setStudyFocus(db, false).effects, [{ kind: 'pauseVideo' }]);
  const b = started({ type: 'video', category: 'IITM', url: 'https://youtu.be/abcdefghijk' }, { pauseOnBlur: false });
  assert.deepEqual(S.setStudyFocus(b.db, false).effects, []);
});

test('marking a video done by hand is recorded', () => {
  const { db } = started({ type: 'video', category: 'IITM', url: 'https://youtu.be/abcdefghijk' });
  S.markDone(db, T0 + MIN);
  S.completeWithNote(db, long, T0 + 2 * MIN);
  const rec = db.sessions.at(-1);
  assert.equal(rec.manual, true);
  assert.ok(S.discordLine(rec).includes('marked done by hand'));
});

test('codeforces: an old AC never completes, a new one does', () => {
  const { db } = started({ type: 'codeforces', cfProblem: '580A' });
  const sec = Math.floor(T0 / 1000);
  const old = [{ verdict: 'OK', problem: { contestId: 580, index: 'A' }, creationTimeSeconds: sec - 86400 }];
  S.cfCheck(db, old, T0 + MIN);
  assert.equal(db.runtime.active.phase, 'active');
  const fresh = [...old, { verdict: 'OK', problem: { contestId: 580, index: 'A' }, creationTimeSeconds: sec + 600 }];
  const r = S.cfCheck(db, fresh, T0 + 11 * MIN);
  assert.equal(db.runtime.active.phase, 'recall');
  assert.ok(r.effects.some((e) => e.kind === 'openRecall'));
});

test('overrides are stored once and logged', () => {
  const { db } = started();
  S.allowDomain(db, 'https://www.stackoverflow.com/q/1', T0);
  S.allowDomain(db, 'stackoverflow.com', T0);
  assert.deepEqual(db.runtime.active.overrides, ['stackoverflow.com']);
  assert.equal(db.runtime.active.events.filter((e) => e.kind === 'override').length, 1);
});

test('tamper events are rate limited', () => {
  const { db } = started();
  assert.equal(S.tamper(db, T0).effects.length, 1);
  assert.equal(S.tamper(db, T0 + 30_000).effects.length, 0);
  assert.equal(S.tamper(db, T0 + 3 * MIN).effects.length, 1);
});
