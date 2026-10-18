// Dev-only message handler for the preview harness. Mirrors background.js using the same reducers,
// minus the browser side effects (which are only logged).
import { normalizeDb, cashIn, todayKey } from '../lib/db.js';
import * as S from '../lib/state.js';
import * as T from '../lib/tasks.js';
import { proposeSettings } from '../lib/settings.js';

async function mutate(fn) {
  const now = Date.now();
  const db = normalizeDb(await chrome.storage.local.get(['tasks', 'sessions', 'settings', 'runtime']), now);
  const r = (await fn(db, now)) || { ok: true, effects: [] };
  for (const e of r.effects || []) {
    if (e.kind === 'openTask' && db.runtime.active) S.attachStudy(db, db.runtime.active.type === 'video' ? 1 : null, 2);
    console.log('[stub effect]', e.kind, e);
  }
  await chrome.storage.local.set({ tasks: db.tasks, sessions: db.sessions, settings: db.settings, runtime: db.runtime });
  return { ok: r.ok !== false, error: r.error, data: r.data };
}

const uid = () => crypto.randomUUID();

export async function handle(msg) {
  switch (msg.type) {
    case 'task:add':
      return mutate((db, now) => T.addTask(db, msg.task, now, uid()));
    case 'task:update':
      return mutate((db) => T.updateTask(db, msg.id, msg.task));
    case 'task:delete':
      return mutate((db) => T.deleteTask(db, msg.id));
    case 'task:pin':
      return mutate((db) => T.togglePin(db, msg.id));
    case 'task:reopen':
      return mutate((db) => T.reopenTask(db, msg.id));
    case 'session:start':
      return mutate((db, now) => S.startSession(db, msg.taskId, now, uid()));
    case 'session:pause':
      return mutate((db, now) => S.pause(db, now));
    case 'session:resume':
      return mutate((db, now) => S.resume(db, now));
    case 'session:done':
      return mutate((db, now) => S.markDone(db, now));
    case 'session:note':
      return mutate((db, now) => S.completeWithNote(db, msg.note, now));
    case 'session:requestExit':
      return mutate((db, now) => S.requestExit(db, now));
    case 'session:cancelExit':
      return mutate((db) => S.cancelExit(db));
    case 'session:confirmExit':
      return mutate((db, now) => S.confirmExit(db, now));
    case 'session:allowDomain':
      return mutate((db, now) => S.allowDomain(db, msg.domain, now));
    case 'reward:cashIn':
      return mutate((db, now) => cashIn(db, now));
    case 'settings:save':
      return mutate((db, now) => {
        const r = proposeSettings(db.settings, msg.settings || {}, { today: todayKey(db, now) });
        db.settings = r.settings;
        db.runtime.pending = r.pending;
        return { ok: true, effects: [], data: { deferred: r.deferred } };
      });
    case 'settings:lock':
      return mutate((db) => {
        db.settings.setupLocked = true;
        return { ok: true, effects: [] };
      });
    case 'seek:import': {
      const r = await mutate((db, now) => T.importTasks(db, msg.tasks, now, uid));
      const { seekPrefixes = {} } = await chrome.storage.local.get('seekPrefixes');
      seekPrefixes[msg.namespace] = msg.prefix;
      await chrome.storage.local.set({ seekPrefixes });
      return r;
    }
    default:
      return { ok: true };
  }
}
