// Task ordering. Pure.
const DAY = 86400000;
const SOON = 3 * DAY;

export function deadlineStatus(task, now) {
  if (!task.deadline) return 'none';
  if (task.deadline < now) return 'overdue';
  if (task.deadline - now <= SOON) return 'soon';
  return 'later';
}

// Pinned first, then hard deadlines within 3 days (overdue included), then everything else.
// Inside each group: earliest deadline first, undated last, then oldest first.
function rank(task, now) {
  if (task.pinned) return 0;
  if (task.hardDeadline && task.deadline && task.deadline - now <= SOON) return 1;
  return 2;
}

export function orderQueue(tasks, now) {
  return tasks
    .filter((t) => t.status !== 'done')
    .sort(
      (a, b) =>
        rank(a, now) - rank(b, now) ||
        (a.deadline || Infinity) - (b.deadline || Infinity) ||
        (a.createdAt || 0) - (b.createdAt || 0),
    );
}

export function upcomingDeadlines(tasks, now, days = 7) {
  return tasks
    .filter((t) => t.status !== 'done' && t.deadline && t.deadline <= now + days * DAY)
    .sort((a, b) => a.deadline - b.deadline);
}
