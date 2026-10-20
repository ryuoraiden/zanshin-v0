// The dashboard queue as blocks: ungrouped tasks on their own, grouped tasks folded into one
// collapsible block that sits where its most urgent task would. Pure.
import { orderQueue } from './queue.js';
import { seriesProgress } from './series.js';

const groupOf = (t) => (t.group || '').trim();

export function queueBlocks(db, now) {
  const blocks = [];
  const byName = new Map();
  for (const task of orderQueue(db.tasks, now)) {
    const name = groupOf(task);
    if (!name) {
      blocks.push({ kind: 'task', task });
      continue;
    }
    let block = byName.get(name);
    if (!block) {
      block = { kind: 'group', name, tasks: [] };
      byName.set(name, block);
      blocks.push(block);
    }
    block.tasks.push(task);
  }
  // A paused or finished-for-now series still gets a block, so its controls stay reachable.
  for (const s of db.series || []) {
    if (!byName.has(s.title)) {
      const block = { kind: 'group', name: s.title, tasks: [] };
      byName.set(s.title, block);
      blocks.push(block);
    }
  }
  for (const block of byName.values()) {
    const all = db.tasks.filter((t) => groupOf(t) === block.name);
    block.done = all.filter((t) => t.status === 'done').length;
    block.total = all.length;
    const deadlines = block.tasks.map((t) => t.deadline).filter(Boolean);
    block.nextDeadline = deadlines.length ? Math.min(...deadlines) : null;
    block.hard = block.tasks.some((t) => t.hardDeadline && t.deadline === block.nextDeadline);
    const series = (db.series || []).find((s) => s.title === block.name);
    if (series) {
      block.series = series;
      block.progress = seriesProgress(db, series);
    }
  }
  return blocks;
}

// Renames a group everywhere: its open and done tasks, and the series if it is one (the series
// keeps feeding under the new name). Renaming onto another plain group merges the two. An
// empty name ungroups the tasks, which a series can't do.
export function renameGroup(db, from, to) {
  const oldName = String(from || '').trim();
  const newName = String(to || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!oldName) return { ok: false, error: 'Which group?', effects: [] };
  if (newName === oldName) return { ok: true, effects: [] };
  const series = (db.series || []).find((s) => s.title === oldName);
  if (series && !newName) return { ok: false, error: 'A series needs a name. Use Stop first if you want its tasks ungrouped.', effects: [] };
  if (series && (db.series || []).some((s) => s !== series && s.title === newName))
    return { ok: false, error: 'Another series already uses that name.', effects: [] };
  let renamed = 0;
  for (const t of db.tasks)
    if (groupOf(t) === oldName) {
      t.group = newName;
      renamed++;
    }
  if (series) series.title = newName;
  if (!renamed && !series) return { ok: false, error: 'Group not found.', effects: [] };
  return { ok: true, effects: [], data: { renamed } };
}

// Names already in use, for the group field's suggestions.
export function groupNames(tasks) {
  return [...new Set(tasks.filter((t) => t.status !== 'done').map(groupOf).filter(Boolean))].sort();
}
