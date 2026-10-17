// Dev-only: seeds demo data for the preview harness when a page is opened with ?demo=<scenario>.
// Scenarios: idle, manual, video, recall, exit, setup, empty
import { dayKey } from '../lib/credit.js';

const demo = new URLSearchParams(location.search).get('demo');
if (demo) {
  const now = Date.now();
  const MIN = 60000;
  const DAY = 86400000;
  let n = 0;
  const task = (o) => ({
    id: `demo-${++n}`,
    category: 'IITM',
    type: 'manual',
    url: '',
    cfProblem: '',
    estimateMin: 0,
    deadline: null,
    hardDeadline: false,
    pinned: false,
    extraDomains: [],
    status: 'todo',
    createdAt: now - (30 - n) * MIN,
    doneAt: null,
    note: '',
    ...o,
  });
  const tasks =
    demo === 'empty'
      ? []
      : [
          task({ title: 'MLT Week 3, Lecture 2: PCA', type: 'video', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', estimateMin: 35, deadline: now + 2 * DAY, hardDeadline: true }),
          task({ title: 'SC BPT1 prep', estimateMin: 90, deadline: now + 6 * DAY, hardDeadline: true }),
          task({ title: 'Kefa and First Steps', category: 'DSA', type: 'codeforces', cfProblem: '580A', url: 'https://codeforces.com/problemset/problem/580/A', estimateMin: 45 }),
          task({ title: 'CO: pipeline hazards', category: 'NITC', estimateMin: 90, deadline: now + 5 * DAY }),
          task({ title: 'pwn.college: file globbing', category: 'Cyber', url: 'https://pwn.college/linux-luminarium/', estimateMin: 30 }),
          task({ title: 'MAD1 project: authentication', pinned: true, estimateMin: 120, deadline: now + 20 * DAY }),
          task({ title: 'IITM graded assignment W3', estimateMin: 60, deadline: now - 3 * 3600000, hardDeadline: true }),
          task({
            title: 'Maths 3: eigenvalues worksheet',
            category: 'NITC',
            status: 'done',
            doneAt: now - 3 * 3600000,
            note: 'Q1 to Q6 done. Q7 needs the trick with similar matrices, ask in class.',
          }),
        ];

  const sessions = [];
  const rec = (daysAgo, o) => {
    const start = now - daysAgo * DAY - 5 * 3600000;
    sessions.push({
      id: `ses-${sessions.length}`,
      taskId: null,
      category: 'IITM',
      type: 'manual',
      startedAt: start,
      endedAt: start + (o.creditedMs || 0),
      day: dayKey(start),
      outcome: 'completed',
      coverage: null,
      overrides: [],
      events: [],
      manual: false,
      note: '',
      ...o,
    });
  };
  if (demo !== 'empty' && demo !== 'setup') {
    const week = [190, 320, 95, 260, 310, 140];
    const cats = ['IITM', 'DSA', 'NITC', 'Cyber'];
    week.forEach((total, i) => {
      const daysAgo = 6 - i;
      rec(daysAgo, { title: 'Lecture block', category: cats[i % 4], creditedMs: Math.round(total * 0.5) * MIN });
      rec(daysAgo, { title: 'Problem block', category: cats[(i + 1) % 4], creditedMs: Math.round(total * 0.4) * MIN });
      rec(daysAgo, { title: 'Abandoned block', category: cats[(i + 2) % 4], outcome: i % 2 ? 'abandoned' : 'completed', creditedMs: Math.round(total * 0.1) * MIN });
    });
    rec(0, {
      title: 'Maths 3: eigenvalues worksheet',
      category: 'NITC',
      creditedMs: 52 * MIN,
      note: 'Q1 to Q6 done. Q7 needs the trick with similar matrices, ask in class.',
    });
    rec(0, {
      title: 'MLT Week 3, Lecture 1',
      type: 'video',
      creditedMs: 38 * MIN,
      coverage: 0.96,
      overrides: ['wikipedia.org'],
      note: 'PCA finds directions of max variance. Eigenvectors of the covariance matrix, eigenvalues give the variance captured. Centering the data first matters, otherwise the first component just points at the mean.',
    });
    rec(0, {
      title: 'TUF+ binary search, problem 4',
      category: 'DSA',
      outcome: 'abandoned',
      creditedMs: 12 * MIN,
      events: [{ t: now, kind: 'gap', minutes: 7 }],
    });
  }

  const baseSession = (t, o = {}) => ({
    id: 'ses-active',
    taskId: t.id,
    title: t.title,
    category: t.category,
    type: t.type,
    url: t.url,
    videoId: t.type === 'video' ? 'dQw4w9WgXcQ' : null,
    boundVideoId: null,
    cfProblem: t.cfProblem,
    startedAt: now - 23 * MIN,
    day: dayKey(now),
    phase: 'active',
    credit: { accum: 0, since: now - 23 * MIN },
    pauses: [],
    pauseNudged: false,
    exitRequestedAt: null,
    watched: [],
    duration: 0,
    lastPosition: 0,
    studyFocused: true,
    windowId: null,
    tabId: 2,
    overrides: [],
    events: [],
    manual: false,
    lastTamperAt: 0,
    ...o,
  });

  let active = null;
  if (demo === 'manual') active = baseSession(tasks[3]);
  if (demo === 'exit') active = baseSession(tasks[3], { exitRequestedAt: now - 20000 });
  if (demo === 'recall') active = baseSession(tasks[3], { phase: 'recall' });
  if (demo === 'video')
    active = baseSession(tasks[0], { windowId: 1, credit: { accum: 14 * MIN, since: null }, watched: [[0, 840]], duration: 2100, lastPosition: 840 });

  const data = {
    tasks,
    sessions,
    settings: { cfHandle: 'demo_handle', setupLocked: demo !== 'setup' },
    runtime: { active, rewardUntil: 0, rewardUsedDay: null, lastHeartbeat: now, graceUntil: 0, pending: null },
  };
  localStorage.setItem('zanshin-stub', JSON.stringify(data));
  const params = new URLSearchParams(location.search);
  params.delete('demo');
  const qs = params.toString();
  history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
}
