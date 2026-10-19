// Turns a Seek (IITM BS portal) course outline into Zanshin tasks. Pure.
//
// The outline is the JSON Seek's own page loads from its course API. content/seek-capture.js
// keeps a copy when the page fetches it; Zanshin never calls the API or touches the login.
//   course.title       "Sep 2026 - MAD II"
//   course.namespace   "ns_26t3_cs2006"
//   course.outline[]   units: { id, title: "Week 2", children[] }
//   children[]         { id, type, title, video, video_type, workflow: { submission_due_date } }
// type "L" is a lesson (video_type "youtube" with a video id, or "none" for text), "A" an
// assignment and "X" a custom unit such as a programming assignment. Due dates are RFC 1123
// strings in GMT ("Sun, 18 Oct 2026 18:29:00 GMT" is 23:59 IST). Ungraded work carries the
// term-end date, so only graded units count as deadlines.
import { videoIdFromUrl } from './urls.js';

export const SEEK_ORIGIN = 'https://seek.onlinedegree.iitm.ac.in';

const ROMAN = { I: 1, II: 2, III: 3, IV: 4 };
const MINOR_WORDS = /^(and|of|the|for|in|to|using|with|a|an)$/i;

// "Sep 2026 - MAD II" -> "MAD2", "Sep 2026 - MLT" -> "MLT", "Sep 2026 - System Commands" -> "SC".
export function coursePrefix(title) {
  let name = String(title || '')
    .replace(/^[A-Za-z]{3,9}\s+\d{4}\s*[-:–]\s*/, '')
    .trim();
  let suffix = '';
  const m = name.match(/\s+(IV|III|II|I|\d)$/);
  if (m) {
    suffix = String(ROMAN[m[1]] ?? m[1]);
    name = name.slice(0, m.index);
  }
  if (!name) return 'IITM';
  if (/\s/.test(name) && name.length > 6) {
    name = name
      .split(/[\s,]+/)
      .filter((w) => /^[A-Za-z]/.test(w) && !MINOR_WORDS.test(w))
      .map((w) => w[0].toUpperCase())
      .join('');
  }
  return name.replace(/\s+/g, '') + suffix;
}

export function namespaceFromUrl(url) {
  const m = String(url || '').match(/\/courses\/(ns_[A-Za-z0-9_]+)/);
  return m ? m[1] : null;
}

export function lessonUrl(namespace, id) {
  return `${SEEK_ORIGIN}/courses/${namespace}?id=${id}`;
}

export function weekNumber(unitTitle) {
  const m = String(unitTitle || '').match(/\bweek\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

// "2.1 - Introduction to X" -> "L2.1: Introduction to X"
// "Screencast 2.1 - JavaScript - Basic Calculator" -> "Screencast 2.1: JavaScript - Basic Calculator"
// "Week 2 - Graded Assignment 2" -> "Graded Assignment 2", "AQ2.1: Activity Questions 1 - Not Graded" -> "AQ2.1: Activity Questions 1"
export function lessonLabel(title, week) {
  let t = String(title || '')
    .trim()
    .replace(/\s*[-–:]\s*not graded\s*$/i, '');
  if (week != null) t = t.replace(new RegExp(`^week\\s*${week}\\s*[-–:]\\s*`, 'i'), '');
  const lecture = t.match(/^(\d+\.\d+)\s*[-–:]\s*(.+)$/);
  if (lecture) return `L${lecture[1]}: ${lecture[2]}`;
  const named = t.match(/^(screencast|tutorial)\s+(\d+(?:\.\d+)?)\s*[-–:]\s*(.+)$/i);
  if (named) return `${cap(named[1])} ${named[2]}: ${named[3]}`;
  return t;
}

export function dueDate(child) {
  const t = Date.parse(child?.workflow?.submission_due_date || '');
  return Number.isFinite(t) ? t : null;
}

function isGradedUnit(child) {
  return (child.type === 'A' || child.type === 'X') && !/not graded/i.test(child.title || '') && dueDate(child) != null;
}

// Flattens the outline into importable items. Graded work keeps its own due date as a hard
// deadline. Everything else in that week gets the week's earliest graded due date as a soft one,
// so the queue orders weeks correctly.
export function outlineItems(course) {
  const items = [];
  for (const unit of course?.outline || []) {
    const week = weekNumber(unit.title);
    const kids = Array.isArray(unit.children) ? unit.children : [];
    const dues = kids.filter(isGradedUnit).map(dueDate);
    const weekDue = dues.length ? Math.min(...dues) : null;
    for (const ch of kids) {
      const videoId = ch.type === 'L' && ch.video_type === 'youtube' && /^[\w-]{6,}$/.test(ch.video || '') ? ch.video : null;
      const kind = videoId ? 'lecture' : ch.type === 'A' || ch.type === 'X' ? 'assignment' : 'reading';
      const graded = isGradedUnit(ch);
      items.push({
        unitId: unit.id,
        unitTitle: String(unit.title || ''),
        week,
        id: ch.id,
        kind,
        title: String(ch.title || ''),
        label: lessonLabel(ch.title, week),
        videoId,
        graded,
        due: graded ? dueDate(ch) : weekDue,
        // Lectures and graded work are what you plan around; practice and activity questions are opt-in.
        selected: kind === 'lecture' || graded,
      });
    }
  }
  return items;
}

export function outlineUnits(items) {
  const seen = new Map();
  for (const it of items) if (!seen.has(it.unitId)) seen.set(it.unitId, { unitId: it.unitId, title: it.unitTitle, week: it.week });
  return [...seen.values()];
}

// The week with the nearest graded deadline still ahead, else the last week, else the first unit.
export function defaultUnit(items, now) {
  const upcoming = items.filter((it) => it.graded && it.due >= now).sort((a, b) => a.due - b.due)[0];
  if (upcoming) return upcoming.unitId;
  const weeks = items.filter((it) => it.week != null);
  if (weeks.length) return weeks.reduce((a, b) => (b.week > a.week ? b : a)).unitId;
  return items[0]?.unitId ?? null;
}

export function itemToTask(item, { prefix, namespace }) {
  const where = item.week != null ? `Week ${item.week}` : item.unitTitle;
  return {
    title: `${prefix} ${where} ${item.label}`.replace(/\s+/g, ' ').trim().slice(0, 200),
    category: 'IITM',
    type: item.kind === 'lecture' ? 'video' : 'manual',
    url: item.videoId ? `https://www.youtube.com/watch?v=${item.videoId}` : lessonUrl(namespace, item.id),
    deadline: item.due,
    hardDeadline: !!item.graded,
    ref: `seek:${namespace}:${item.id}`,
  };
}

// Identity keys for an existing task or an import input, used to skip duplicates. A task added
// by hand with a Seek lesson link or the lecture's YouTube link counts as the same lesson.
export function taskRefs(task) {
  const refs = [];
  if (task?.ref) refs.push(String(task.ref));
  const url = String(task?.url || '');
  const ns = namespaceFromUrl(url);
  if (ns && url.startsWith(SEEK_ORIGIN)) {
    try {
      const id = new URL(url).searchParams.get('id');
      if (id) refs.push(`seek:${ns}:${id}`);
    } catch {}
  }
  const vid = videoIdFromUrl(url);
  if (vid) refs.push(`yt:${vid}`);
  return refs;
}

export function itemRefs(item, namespace) {
  return [`seek:${namespace}:${item.id}`, item.videoId ? `yt:${item.videoId}` : null].filter(Boolean);
}

export function existingRefs(tasks) {
  return new Set((tasks || []).flatMap(taskRefs));
}
