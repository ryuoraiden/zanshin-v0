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

// Names already in use, for the group field's suggestions.
export function groupNames(tasks) {
  return [...new Set(tasks.filter((t) => t.status !== 'done').map(groupOf).filter(Boolean))].sort();
}
