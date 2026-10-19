import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLink, linkToTask, parseLinkLines, slugTitle, taskRefs, existingRefs } from '../lib/links.js';

test('recognises problem and lecture links', () => {
  const cf = classifyLink('https://codeforces.com/contest/1352/problem/C2');
  assert.equal(cf.kind, 'codeforces');
  assert.equal(cf.key, 'cf:1352C2');
  assert.equal(classifyLink('1352c2').key, 'cf:1352C2', 'bare code');
  const lc = classifyLink('https://leetcode.com/problems/two-sum/description/');
  assert.deepEqual([lc.kind, lc.key, lc.title, lc.url], ['leetcode', 'lc:two-sum', 'Two Sum', 'https://leetcode.com/problems/two-sum/']);
  const tuf = classifyLink('https://takeuforward.org/practice/dsa/lower-bound-?ref=sheet');
  assert.deepEqual([tuf.kind, tuf.key, tuf.title], ['tuf', 'tuf:lower-bound', 'Lower Bound']);
  assert.equal(classifyLink('https://www.geeksforgeeks.org/problems/reverse-a-linked-list/1').key, 'gfg:reverse-a-linked-list');
  assert.equal(classifyLink('https://youtu.be/3fv1ejKqiUU').key, 'yt:3fv1ejKqiUU');
  assert.equal(classifyLink('https://seek.onlinedegree.iitm.ac.in/courses/ns_26t3_cs2006?id=53').key, 'seek:ns_26t3_cs2006:53');
  assert.equal(classifyLink('https://pwn.college/linux-luminarium/globbing').kind, 'pwn');
  assert.equal(classifyLink('https://example.com/blog').kind, 'other');
  assert.equal(classifyLink('not a link at all'), null);
});

test('links become the right kind of task', () => {
  const cf = linkToTask(classifyLink('https://codeforces.com/problemset/problem/580/A'), { title: 'Kefa and First Steps', group: 'CP-31 800' });
  assert.deepEqual(
    [cf.type, cf.cfProblem, cf.category, cf.title, cf.group, cf.ref],
    ['codeforces', '580A', 'DSA', 'Kefa and First Steps', 'CP-31 800', 'cf:580A'],
  );
  assert.equal(linkToTask(classifyLink('https://youtu.be/3fv1ejKqiUU'), { category: 'NITC' }).type, 'video');
  assert.equal(linkToTask(classifyLink('https://youtu.be/3fv1ejKqiUU'), { category: 'NITC' }).category, 'NITC');
  assert.equal(linkToTask(classifyLink('https://leetcode.com/problems/two-sum/')).title, 'Two Sum');
  assert.equal(linkToTask(classifyLink('https://pwn.college/linux-luminarium/globbing')).category, 'Cyber');
});

test('pasted lines', () => {
  const lines = parseLinkLines(`
    # today
    https://codeforces.com/problemset/problem/2000/B
    POTD | https://codeforces.com/contest/2001/problem/C.
    Two Sum - leetcode.com/problems/two-sum/
    1352C2
    just some words
  `);
  assert.deepEqual(lines, [
    { url: 'https://codeforces.com/problemset/problem/2000/B', title: '' },
    { url: 'https://codeforces.com/contest/2001/problem/C', title: 'POTD' },
    { url: 'leetcode.com/problems/two-sum/', title: 'Two Sum' },
    { url: '1352C2', title: '' },
  ]);
});

test('slug titles', () => {
  assert.equal(slugTitle('find-target-indices-after-sorting-array'), 'Find Target Indices After Sorting Array');
  assert.equal(slugTitle('search-x-in-a-sorted-array'), 'Search X in a Sorted Array');
});

test('the same problem is the same task whatever link it came from', () => {
  assert.deepEqual(taskRefs({ url: 'https://codeforces.com/contest/580/problem/A' }), ['cf:580A']);
  assert.deepEqual(taskRefs({ type: 'codeforces', cfProblem: '580A', url: '' }), ['cf:580A']);
  const refs = existingRefs(
    [{ url: 'https://leetcode.com/problems/two-sum/' }],
    [{ items: [{ url: 'https://codeforces.com/problemset/problem/580/A' }] }],
  );
  assert.ok(refs.has('lc:two-sum'));
  assert.ok(refs.has('cf:580A'), 'items waiting in a series count');
});
