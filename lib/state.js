// The session state machine. Pure: every function takes the db object, mutates it, and returns
// { ok, error?, effects, data? }. The service worker carries out the effects (open windows,
// post to Discord, ...). Nothing here touches chrome.* so it all runs under `node --test`.
//
//   idle --start--> active --condition met--> recall --note saved--> completed
//                     |-- pause / resume (wall-time tasks; enforcement stays on)
//                     |-- request exit --> waiting 60 s --confirm--> abandoned
//                     |       (cancel, or 5 min unconfirmed, drops the request)
//                     '-- hard cap --> expired
import { liveCreditMs, addIntervals, coverage, dayKey } from './credit.js';
import { dayStartMinutes } from './settings.js';
import { videoIdFromUrl, normalizeDomain } from './urls.js';
import { parseProblem, solvedAfter } from './codeforces.js';

export const EXIT_WAIT_MS = 60_000;
export const EXIT_WINDOW_MS = 5 * 60_000;
export const GAP_MS = 3 * 60_000;
export const GRACE_MS = 30_000;
export const PAUSE_NUDGE_MS = 15 * 60_000;
export const COVERAGE_TARGET = 0.9;
export const NOTE_MIN = { video: 150, codeforces: 20, manual: 20 };
const MAX_EVENTS = 200;

const ok = (effects = [], data) => ({ ok: true, effects, data });
const fail = (error) => ({ ok: false, error, effects: [] });

export function logEvent(s, kind, now, detail = {}) {
  s.events.push({ t: now, kind, ...detail });
  if (s.events.length > MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS);
}

function closeOpenPause(s, now) {
  const last = s.pauses[s.pauses.length - 1];
  if (last && last.end == null) last.end = now;
}

function enterRecall(s, now) {
  if (s.phase === 'paused') closeOpenPause(s, now);
  if (s.credit.since == null) s.credit.since = now; // writing the note counts as study time
  s.phase = 'recall';
}

export function isVideoLock(s) {
  return !!s && s.type === 'video' && (s.phase === 'active' || s.phase === 'recall');
}

export function startSession(db, taskId, now, id) {
  if (db.runtime.active) return fail('A session is already running.');
  const task = db.tasks.find((t) => t.id === taskId);
  if (!task) return fail('Task not found.');
  if (task.status === 'done') return fail('That task is already done. Reopen it first.');
  if (task.type === 'codeforces') {
    if (!db.settings.cfHandle) return fail('Set your Codeforces handle in Options first.');
    if (!parseProblem(task.cfProblem || task.url)) return fail('This task has no valid Codeforces problem.');
  }
  if (task.type === 'video' && !task.url) return fail('Video tasks need a URL.');
  db.runtime.active = {
    id,
    taskId: task.id,
    title: task.title,
    category: task.category,
    type: task.type,
    url: task.url || '',
    videoId: task.type === 'video' ? videoIdFromUrl(task.url) : null,
    boundVideoId: null, // for portal pages: the first embedded video that reports becomes the lecture
    cfProblem: task.cfProblem || '',
    startedAt: now,
    day: dayKey(now, dayStartMinutes(db.settings)),
    phase: 'active',
    // video credit comes from playback reports, everything else is wall time
    credit: { accum: 0, since: task.type === 'video' ? null : now },
    pauses: [],
    pauseNudged: false,
    exitRequestedAt: null,
    watched: [],
    watchedEnough: false, // 90% actually played: the lecture now finishes at its end or on Done
    duration: 0,
    lastPosition: 0,
    studyFocused: true,
    windowId: null,
    tabId: null,
    overrides: [],
    events: [],
    manual: false,
    lastTamperAt: 0,
  };
  db.runtime.lastHeartbeat = now;
  // Lectures open straight into the locked study window. Other tasks wait for "Open task", so
  // starting a manual or Codeforces session doesn't throw a tab at you.
  return ok(task.type === 'video' ? [{ kind: 'openTask' }] : []);
}

export function pause(db, now) {
  const s = db.runtime.active;
  if (!s) return fail('No session running.');
  if (s.type === 'video') return fail('Pause the video instead. Credit only counts while it plays.');
  if (s.phase !== 'active') return fail('The session is not running.');
  s.credit.accum += Math.max(0, now - s.credit.since);
  s.credit.since = null;
  s.phase = 'paused';
  s.pauses.push({ start: now, end: null });
  s.pauseNudged = false;
  return ok();
}

export function resume(db, now) {
  const s = db.runtime.active;
  if (!s || s.phase !== 'paused') return fail('The session is not paused.');
  closeOpenPause(s, now);
  s.credit.since = now;
  s.phase = 'active';
  return ok();
}

// "Done" button. For manual tasks this is the normal path. For video and Codeforces tasks it
// bypasses auto-detection, which is allowed but recorded on the session.
export function markDone(db, now) {
  const s = db.runtime.active;
  if (!s) return fail('No session running.');
  if (s.phase === 'recall') return ok([{ kind: 'openRecall' }]);
  // A lecture past 90% that you stop before the very end (outro, credits) isn't "by hand".
  if (s.type !== 'manual' && !(s.type === 'video' && s.watchedEnough)) {
    s.manual = true;
    logEvent(s, 'manual-done', now);
  }
  enterRecall(s, now);
  return ok([{ kind: 'openRecall' }]);
}

export function completeWithNote(db, note, now) {
  const s = db.runtime.active;
  if (!s) return fail('No session running.');
  if (s.phase !== 'recall') return fail('Finish the task first.');
  const text = String(note || '').trim();
  const min = NOTE_MIN[s.type] ?? 20;
  if (text.length < min) return fail(`Write at least ${min} characters.`);
  const task = db.tasks.find((t) => t.id === s.taskId);
  if (task) {
    task.status = 'done';
    task.doneAt = now;
    task.note = text;
  }
  return finish(db, 'completed', now, { note: text });
}

export function discordLine(rec) {
  const min = Math.round((rec.creditedMs || 0) / 60000);
  if (rec.outcome === 'completed')
    return `Done: ${rec.title} (${rec.category}, ${min} min${rec.manual ? ', marked done by hand' : ''})`;
  if (rec.outcome === 'abandoned') return `Abandoned: ${rec.title} after ${min} min`;
  if (rec.outcome === 'expired') return `Expired: ${rec.title} hit the hard cap after ${min} min of credit`;
  return '';
}

export function finish(db, outcome, now, extra = {}) {
  const s = db.runtime.active;
  if (!s) return fail('No session running.');
  if (s.phase === 'paused') closeOpenPause(s, now);
  const record = {
    id: s.id,
    taskId: s.taskId,
    title: s.title,
    category: s.category,
    type: s.type,
    startedAt: s.startedAt,
    endedAt: now,
    day: s.day,
    outcome,
    creditedMs: Math.round(liveCreditMs(s, now)),
    coverage: s.type === 'video' ? Math.round(coverage(s.watched, s.duration) * 100) / 100 : null,
    overrides: s.overrides,
    events: s.events,
    manual: !!s.manual,
    note: extra.note || '',
  };
  db.sessions.push(record);
  db.runtime.active = null;
  const effects = [{ kind: 'sessionEnded', session: record, windowId: s.windowId, tabId: s.tabId }];
  const line = discordLine(record);
  if (line) effects.push({ kind: 'discord', text: line });
  return ok(effects, { session: record });
}

export function exitStatus(s, now) {
  if (!s || !s.exitRequestedAt) return { state: 'none', remainingMs: 0 };
  const elapsed = now - s.exitRequestedAt;
  if (elapsed >= EXIT_WINDOW_MS) return { state: 'stale', remainingMs: 0 };
  if (elapsed < EXIT_WAIT_MS) return { state: 'waiting', remainingMs: EXIT_WAIT_MS - elapsed };
  return { state: 'ready', remainingMs: 0, closesInMs: EXIT_WINDOW_MS - elapsed };
}

export function requestExit(db, now) {
  const s = db.runtime.active;
  if (!s) return fail('No session running.');
  const st = exitStatus(s, now).state;
  if (st === 'waiting' || st === 'ready') return ok();
  s.exitRequestedAt = now;
  logEvent(s, 'exit-requested', now);
  return ok();
}

export function cancelExit(db) {
  const s = db.runtime.active;
  if (!s) return fail('No session running.');
  s.exitRequestedAt = null;
  return ok();
}

export function confirmExit(db, now) {
  const s = db.runtime.active;
  if (!s) return fail('No session running.');
  if (exitStatus(s, now).state !== 'ready') return fail('The exit unlocks 60 seconds after you request it.');
  return finish(db, 'abandoned', now);
}

// Runs every minute (and whenever the worker wakes): gap detection, hard cap, stale exit
// requests, pause nudges, heartbeat.
export function tick(db, now) {
  const rt = db.runtime;
  const effects = [];
  const last = rt.lastHeartbeat;
  if (last && now - last > GAP_MS) rt.graceUntil = now + GRACE_MS;
  const s = rt.active;
  if (s) {
    const gapStart = Math.max(last || s.startedAt, s.startedAt);
    if (now - gapStart > GAP_MS) {
      // Chrome was closed, asleep, or Zanshin was disabled. None of that time counts.
      if (s.credit.since != null) {
        s.credit.accum += Math.max(0, gapStart - s.credit.since);
        s.credit.since = now;
      }
      const minutes = Math.round((now - gapStart) / 60000);
      logEvent(s, 'gap', now, { minutes });
      effects.push({ kind: 'discord', text: `Gap: Zanshin was off for ${minutes} min during ${s.title}` });
    }
    if (now - s.startedAt >= db.settings.hardCapMin * 60000) {
      const title = s.title;
      const r = finish(db, 'expired', now);
      rt.lastHeartbeat = now;
      effects.push(...r.effects, {
        kind: 'notify',
        title: 'Session expired',
        message: `${title} hit the ${db.settings.hardCapMin} min cap. Blocking is off.`,
      });
      return ok(effects);
    }
    if (exitStatus(s, now).state === 'stale') s.exitRequestedAt = null;
    if (s.phase === 'paused' && !s.pauseNudged) {
      const p = s.pauses[s.pauses.length - 1];
      if (p && now - p.start >= PAUSE_NUDGE_MS) {
        s.pauseNudged = true;
        effects.push({ kind: 'notify', title: 'Still paused', message: `${s.title} has been paused for 15 min.` });
      }
    }
  }
  rt.lastHeartbeat = now;
  return ok(effects);
}

// Playback report from the YouTube content script. Coverage only grows from video that actually
// played (the content script drops seeks), so dragging to the end does nothing.
export function videoProgress(db, msg, now) {
  const s = db.runtime.active;
  if (!s || s.type !== 'video' || s.phase !== 'active') return ok();
  const vid = msg.videoId || null;
  if (!vid) return ok();
  const want = s.videoId || s.boundVideoId;
  if (want && vid !== want) return ok();
  if (!want) s.boundVideoId = vid;
  const dur = Number(msg.duration);
  if (Number.isFinite(dur) && dur > 0) s.duration = dur;
  const incoming = (Array.isArray(msg.intervals) ? msg.intervals : [])
    .filter((iv) => Array.isArray(iv) && iv.length === 2 && iv.every(Number.isFinite) && iv[1] > iv[0] && iv[1] - iv[0] <= 300)
    .slice(0, 500);
  s.watched = addIntervals(s.watched, incoming, s.duration);
  if (Number.isFinite(msg.currentTime)) s.lastPosition = msg.currentTime;
  const played = Math.min(Math.max(0, Number(msg.playedMs) || 0), 120000);
  if (s.studyFocused) s.credit.accum += played;
  // 90% actually played makes the lecture count; it doesn't cut it off. The recall note comes
  // when the video ends (or you press Done), so the last stretch isn't lost.
  if (!s.watchedEnough && s.duration > 0 && coverage(s.watched, s.duration) >= COVERAGE_TARGET) {
    s.watchedEnough = true;
    logEvent(s, 'watched', now);
  }
  const atEnd = msg.ended === true || (s.duration > 0 && Number(msg.currentTime) >= s.duration - 1);
  if (s.watchedEnough && atEnd) {
    enterRecall(s, now);
    return ok([{ kind: 'openRecall' }]);
  }
  return ok();
}

export function setStudyFocus(db, focused) {
  const s = db.runtime.active;
  if (!isVideoLock(s) || s.studyFocused === focused) return ok();
  s.studyFocused = focused;
  return ok(!focused && db.settings.pauseOnBlur ? [{ kind: 'pauseVideo' }] : []);
}

export function attachStudy(db, windowId, tabId) {
  const s = db.runtime.active;
  if (!s) return ok();
  s.windowId = windowId ?? null;
  s.tabId = tabId ?? null;
  s.studyFocused = true;
  return ok();
}

export function allowDomain(db, domain, now) {
  const s = db.runtime.active;
  if (!s) return fail('No session running.');
  const d = normalizeDomain(domain);
  if (!d) return fail("That domain doesn't look right.");
  if (!s.overrides.includes(d)) {
    s.overrides.push(d);
    logEvent(s, 'override', now, { domain: d });
  }
  return ok();
}

export function cfCheck(db, submissions, now) {
  const s = db.runtime.active;
  if (!s || s.type !== 'codeforces' || s.phase === 'recall') return ok();
  const p = parseProblem(s.cfProblem || s.url);
  if (!solvedAfter(submissions, p, Math.floor(s.startedAt / 1000))) return ok();
  enterRecall(s, now);
  logEvent(s, 'accepted', now);
  return ok([
    { kind: 'openRecall' },
    { kind: 'notify', title: 'Accepted', message: `${s.title}: write the one-line note to finish.` },
  ]);
}

export function tamper(db, now) {
  const s = db.runtime.active;
  if (!s || now - (s.lastTamperAt || 0) < 120000) return ok();
  s.lastTamperAt = now;
  logEvent(s, 'tamper', now);
  return ok([{ kind: 'discord', text: `Tamper: opened chrome://extensions during ${s.title}` }]);
}
