// Builds the declarativeNetRequest rules from stored state. Pure.
//
// priority 3  reward domains (always blocked unless the reward window is open)
// priority 2  session allowlist (allow)
// priority 1  session catch-all (every other page goes to blocked.html)
//
// checkUrl() mirrors the same logic for in-page navigations (YouTube Shorts) that DNR never sees.
import { normalizeDomain, parseEntry, hostMatches } from './urls.js';

export const RULE_ID = { CATCH_ALL: 1, ALLOW: 2, REWARD_DOMAINS: 10, REWARD_PATH_BASE: 11 };
export const PRIORITY = { CATCH_ALL: 1, ALLOW: 2, REWARD: 3 };
const ANY = '^https?://.*$';

export function sessionAllowList(db) {
  const s = db.runtime.active;
  if (!s) return [];
  const task = db.tasks.find((t) => t.id === s.taskId);
  const list = [
    normalizeDomain(s.url),
    ...(db.settings.categoryDomains[s.category] || []),
    ...(task?.extraDomains || []),
    ...db.settings.alwaysAllowed,
    ...(s.overrides || []),
  ];
  if (s.type === 'codeforces') list.push('codeforces.com');
  const out = [];
  for (const item of list) {
    const e = parseEntry(item);
    if (e && !out.includes(e.domain)) out.push(e.domain);
  }
  return out;
}

export function rewardTargets(settings) {
  const domains = [];
  const paths = [];
  for (const item of settings.rewardDomains) {
    const e = parseEntry(item);
    if (!e) continue;
    if (e.path) paths.push(e);
    else if (!domains.includes(e.domain)) domains.push(e.domain);
  }
  return { domains, paths };
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// youtube.com/shorts matches /shorts, /shorts/x and /shorts?x on any subdomain, not /shortsfoo.
export function pathRegex({ domain, path }) {
  return `^https?://([^/?#]*\\.)?${esc(domain)}${esc(path)}([/?].*)?$`;
}

export function blockedUrl(base, reason, url) {
  return `${base}?r=${reason}#${url}`;
}

function redirect(base, reason) {
  return { type: 'redirect', redirect: { regexSubstitution: `${base}?r=${reason}#\\0` } };
}

export function buildRules(db, now, blockedBase) {
  const rules = [];
  if (db.runtime.active) {
    rules.push({
      id: RULE_ID.CATCH_ALL,
      priority: PRIORITY.CATCH_ALL,
      action: redirect(blockedBase, 'session'),
      condition: { regexFilter: ANY, resourceTypes: ['main_frame'] },
    });
    const allow = sessionAllowList(db);
    if (allow.length)
      rules.push({
        id: RULE_ID.ALLOW,
        priority: PRIORITY.ALLOW,
        action: { type: 'allow' },
        condition: { requestDomains: allow, resourceTypes: ['main_frame'] },
      });
  }
  if (!(db.runtime.rewardUntil > now)) {
    const { domains, paths } = rewardTargets(db.settings);
    if (domains.length)
      rules.push({
        id: RULE_ID.REWARD_DOMAINS,
        priority: PRIORITY.REWARD,
        action: redirect(blockedBase, 'reward'),
        condition: { regexFilter: ANY, requestDomains: domains, resourceTypes: ['main_frame'] },
      });
    paths.forEach((p, i) =>
      rules.push({
        id: RULE_ID.REWARD_PATH_BASE + i,
        priority: PRIORITY.REWARD,
        action: redirect(blockedBase, 'reward'),
        condition: { regexFilter: pathRegex(p), resourceTypes: ['main_frame'] },
      }),
    );
  }
  return rules;
}

// 'reward' | 'session' | null for a URL, using the same precedence as the rules above.
export function checkUrl(db, url, now) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname;
  if (!(db.runtime.rewardUntil > now)) {
    const { domains, paths } = rewardTargets(db.settings);
    if (domains.some((d) => hostMatches(host, d))) return 'reward';
    if (paths.some((p) => new RegExp(pathRegex(p)).test(url))) return 'reward';
  }
  if (db.runtime.active && !sessionAllowList(db).some((d) => hostMatches(host, d))) return 'session';
  return null;
}
