import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeries, feedSeries, updateSeries, removeSeries, seriesProgress } from '../lib/series.js';
import { queueBlocks, groupNames } from '../lib/groups.js';
import { deleteTask, addTask } from '../lib/tasks.js';
import { startSession, markDone, completeWithNote } from '../lib/state.js';
import { freshDb, T0, MIN } from './helpers.js';

const problems = (n) =>
  Array.from({ length: n }, (_, i) => ({
    title: `Problem ${i + 1}`,
    category: 'DSA',
    type: 'manual',
    url: `https://leetcode.com/problems/p-${i + 1}/`,
  }));

let n = 0;
const id = () => `x${++n}`;
const open = (db, sid) => db.tasks.filter((t) => t.seriesId === sid && t.status !== 'done');

test('a series feeds only its batch into the queue', () => {
  const db = freshDb();
  const r = createSeries(db, { title: 'A2Z: Binary Search', batch: 3, items: problems(10) }, T0, id);
  assert.equal(r.ok, true);
  const sid = r.data.series;
  assert.equal(open(db, sid).length, 3);
  assert.deepEqual(open(db, sid).map((t) => t.title), ['Problem 1', 'Problem 2', 'Problem 3']);
  assert.ok(open(db, sid).every((t) => t.group === 'A2Z: Binary Search'));
  assert.deepEqual(seriesProgress(db, db.series[0]), { total: 10, done: 0, open: 3, left: 7 });
});

test('finishing or deleting a task lets the next one in', () => {
  const db = freshDb();
  const sid = createSeries(db, { title: 'CP-31 1200', batch: 2, items: problems(5) }, T0, id).data.series;
  const first = open(db, sid)[0];
  startSession(db, first.id, T0, 's');
  markDone(db, T0 + MIN);
  completeWithNote(db, 'binary search on answer', T0 + 2 * MIN);
  feedSeries(db, T0 + 2 * MIN, id);
  assert.deepEqual(open(db, sid).map((t) => t.title), ['Problem 2', 'Problem 3']);
  deleteTask(db, open(db, sid)[0].id);
  feedSeries(db, T0, id);
  assert.deepEqual(open(db, sid).map((t) => t.title), ['Problem 3', 'Problem 4']);
  assert.equal(seriesProgress(db, db.series[0]).done, 1);
});

test('duplicates are skipped, at creation and at feed time', () => {
  const db = freshDb();
  addTask(db, { title: 'p1 by hand', url: 'https://leetcode.com/problems/p-1/' }, T0, 'hand1');
  const r = createSeries(db, { title: 'S', batch: 1, items: problems(4) }, T0, id);
  assert.equal(r.data.added, 3);
  assert.equal(r.data.skipped, 1);
  addTask(db, { title: 'p3 by hand', url: 'https://leetcode.com/problems/p-3/' }, T0, 'hand3');
  const sid = r.data.series;
  deleteTask(db, open(db, sid)[0].id);
  feedSeries(db, T0, id);
  assert.deepEqual(open(db, sid).map((t) => t.title), ['Problem 4'], 'p-3 was added by hand meanwhile');
  assert.equal(createSeries(db, { title: 'again', items: problems(4) }, T0, id).ok, false);
});

test('pause, batch size, rename and remove', () => {
  const db = freshDb();
  const sid = createSeries(db, { title: 'S', batch: 1, items: problems(6) }, T0, id).data.series;
  updateSeries(db, sid, { batch: 4 }, T0, id);
  assert.equal(open(db, sid).length, 4);
  updateSeries(db, sid, { paused: true }, T0, id);
  deleteTask(db, open(db, sid)[0].id);
  feedSeries(db, T0, id);
  assert.equal(open(db, sid).length, 3, 'paused series does not refill');
  updateSeries(db, sid, { title: 'Renamed' }, T0, id);
  assert.ok(open(db, sid).every((t) => t.group === 'Renamed'));
  removeSeries(db, sid);
  assert.equal(db.series.length, 0);
  assert.equal(open(db, sid).length, 3, 'queued tasks stay');
});

test('queue blocks: groups sit where their most urgent task is', () => {
  const db = freshDb();
  const DAY = 86400000;
  addTask(db, { title: 'loose late', deadline: T0 + 5 * DAY }, T0, 'a');
  addTask(db, { title: 'w3 lecture', group: 'MAD2 Week 3', deadline: T0 + 6 * DAY }, T0, 'b');
  addTask(db, { title: 'w3 graded', group: 'MAD2 Week 3', deadline: T0 + DAY, hardDeadline: true }, T0, 'c');
  addTask(db, { title: 'loose undated' }, T0, 'd');
  createSeries(db, { title: 'A2Z: Arrays', batch: 2, items: problems(3) }, T0, id);
  const blocks = queueBlocks(db, T0);
  assert.deepEqual(
    blocks.map((b) => (b.kind === 'group' ? `[${b.name}: ${b.tasks.map((t) => t.title).join(', ')}]` : b.task.title)),
    ['[MAD2 Week 3: w3 graded, w3 lecture]', 'loose late', 'loose undated', '[A2Z: Arrays: Problem 1, Problem 2]'],
  );
  const w3 = blocks[0];
  assert.equal(w3.nextDeadline, T0 + DAY);
  assert.equal(w3.hard, true);
  assert.equal(blocks[3].progress.total, 3);
  assert.deepEqual(groupNames(db.tasks), ['A2Z: Arrays', 'MAD2 Week 3']);
});

test('a paused series with nothing queued still has a block', () => {
  const db = freshDb();
  const sid = createSeries(db, { title: 'S', batch: 1, items: problems(2) }, T0, id).data.series;
  updateSeries(db, sid, { paused: true }, T0, id);
  deleteTask(db, open(db, sid)[0].id);
  const block = queueBlocks(db, T0).find((b) => b.name === 'S');
  assert.ok(block);
  assert.equal(block.tasks.length, 0);
  assert.equal(block.series.paused, true);
});
