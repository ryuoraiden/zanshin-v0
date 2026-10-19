import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as K from '../lib/seek.js';
import { importTasks } from '../lib/tasks.js';
import { freshDb, withTask, T0 } from './helpers.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/seek-course.json', import.meta.url), 'utf8'));
const NS = 'ns_26t3_cs2006';
const DUE_W2 = Date.parse('Sun, 18 Oct 2026 18:29:00 GMT');
const items = K.outlineItems(fixture.course);
const byId = (id) => items.find((i) => i.id === id);

test('course prefixes', () => {
  assert.equal(K.coursePrefix('Sep 2026 - MAD II'), 'MAD2');
  assert.equal(K.coursePrefix('Sep 2026 - MLT'), 'MLT');
  assert.equal(K.coursePrefix('Jan 2027 - Modern Application Development I'), 'MAD1');
  assert.equal(K.coursePrefix('Sep 2026 - System Commands'), 'SC');
  assert.equal(K.coursePrefix('Sep 2026 - Tools in Data Science'), 'TDS');
  assert.equal(K.coursePrefix(''), 'IITM');
});

test('lesson labels', () => {
  assert.equal(K.lessonLabel('2.1 - Introduction to JavaScript Collections', 2), 'L2.1: Introduction to JavaScript Collections');
  assert.equal(K.lessonLabel('Screencast 2.1 - JavaScript - Basic Calculator', 2), 'Screencast 2.1: JavaScript - Basic Calculator');
  assert.equal(K.lessonLabel('Week 2 - Graded Assignment 2', 2), 'Graded Assignment 2');
  assert.equal(K.lessonLabel('AQ2.1: Activity Questions 1 - Not Graded', 2), 'AQ2.1: Activity Questions 1');
  assert.equal(K.lessonLabel('Practice Assignment 2 - Not Graded', 2), 'Practice Assignment 2');
});

test('outline items: kinds, deadlines and defaults', () => {
  assert.equal(byId(2).kind, 'reading');
  assert.equal(byId(2).selected, false);
  assert.equal(byId(37).kind, 'lecture');
  assert.equal(byId(37).videoId, '3fv1ejKqiUU');
  assert.equal(byId(37).selected, true);
  assert.equal(byId(37).due, DUE_W2, 'lectures get the week deadline');
  assert.equal(byId(37).graded, false);
  assert.equal(byId(53).graded, true);
  assert.equal(byId(53).due, DUE_W2);
  assert.equal(byId(51).graded, true, 'programming assignments (type X) count');
  assert.equal(byId(39).graded, false, 'not graded ignores the term-end date');
  assert.equal(byId(39).due, DUE_W2);
  assert.equal(byId(39).selected, false);
  assert.equal(byId(52).selected, false);
  assert.equal(byId(2).due, null, 'units without graded work have no deadline');
});

test('default unit is the week with the nearest graded deadline ahead', () => {
  assert.equal(K.defaultUnit(items, Date.parse('2026-10-12T00:00:00Z')), 36);
  assert.equal(K.defaultUnit(items, Date.parse('2026-10-19T00:00:00Z')), 55);
  assert.equal(K.defaultUnit(items, Date.parse('2027-01-01T00:00:00Z')), 55, 'after the term, the last week');
  assert.deepEqual(
    K.outlineUnits(items).map((u) => u.title),
    ['Course Introduction', 'Week 1', 'Week 2', 'Week 3'],
  );
});

test('items become tasks', () => {
  const lecture = K.itemToTask(byId(37), { prefix: 'MAD2', namespace: NS });
  assert.deepEqual(lecture, {
    title: 'MAD2 Week 2 L2.1: Introduction to JavaScript Collections',
    category: 'IITM',
    type: 'video',
    url: 'https://www.youtube.com/watch?v=3fv1ejKqiUU',
    deadline: DUE_W2,
    hardDeadline: false,
    group: 'MAD2 Week 2',
    ref: `seek:${NS}:37`,
  });
  const ga = K.itemToTask(byId(53), { prefix: 'MAD2', namespace: NS });
  assert.equal(ga.type, 'manual');
  assert.equal(ga.url, `https://seek.onlinedegree.iitm.ac.in/courses/${NS}?id=53`);
  assert.equal(ga.hardDeadline, true);
  assert.equal(K.itemToTask(byId(2), { prefix: 'MAD2', namespace: NS }).title, 'MAD2 Course Introduction About the Course');
});

test('tasks added by hand are recognised by their Seek or YouTube link', () => {
  const refs = K.existingRefs([
    { url: `https://seek.onlinedegree.iitm.ac.in/courses/${NS}?id=40&type=video&tab=courses&unitId=36` },
    { url: 'https://youtu.be/PyT03AgZYpU' },
    { url: '', ref: `seek:${NS}:53` },
  ]);
  const added = (id) => K.itemRefs(byId(id), NS).some((r) => refs.has(r));
  assert.equal(added(40), true, 'Seek lesson link');
  assert.equal(added(38), true, 'YouTube link');
  assert.equal(added(53), true, 'import ref');
  assert.equal(added(37), false);
  assert.equal(K.namespaceFromUrl(`https://seek.onlinedegree.iitm.ac.in/courses/${NS}?id=2`), NS);
});

test('importing adds new tasks once and never re-adds finished ones', () => {
  const db = freshDb();
  const done = withTask(db, { title: 'old', type: 'video', category: 'IITM', url: 'https://www.youtube.com/watch?v=3fv1ejKqiUU' });
  done.status = 'done';
  let n = 0;
  const id = () => `imp${++n}`;
  const inputs = items.filter((i) => i.unitId === 36 && i.selected).map((i) => K.itemToTask(i, { prefix: 'MAD2', namespace: NS }));
  const first = importTasks(db, inputs, T0, id);
  assert.equal(first.data.added, inputs.length - 1, 'the finished lecture is skipped');
  assert.equal(first.data.skipped, 1);
  const again = importTasks(db, inputs, T0, id);
  assert.equal(again.data.added, 0);
  assert.equal(again.data.skipped, inputs.length);
  const ga = db.tasks.find((t) => t.ref === `seek:${NS}:53`);
  assert.equal(ga.hardDeadline, true);
  assert.equal(ga.deadline, DUE_W2);
});
