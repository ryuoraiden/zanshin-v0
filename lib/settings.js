// Settings defaults, validation and the "loosening waits until tomorrow" rule. Pure.
import { normalizeEntries } from './urls.js';

export const CATEGORIES = ['IITM', 'DSA', 'NITC', 'Cyber'];
export const TYPES = ['video', 'codeforces', 'manual'];

export const DEFAULT_SETTINGS = {
  cfHandle: '',
  quotaMin: 300,
  rewardMin: 90,
  rewardDomains: [
    'netflix.com',
    'primevideo.com',
    'hotstar.com',
    'instagram.com',
    'reddit.com',
    'x.com',
    'youtube.com/shorts',
  ],
  categoryDomains: {
    IITM: ['seek.onlinedegree.iitm.ac.in', 'discourse.onlinedegree.iitm.ac.in'],
    DSA: ['codeforces.com', 'leetcode.com', 'takeuforward.org', 'cppreference.com'],
    NITC: [],
    Cyber: ['pwn.college', 'picoctf.org', 'tryhackme.com'],
  },
  alwaysAllowed: ['accounts.google.com', 'accounts.youtube.com', 'localhost', '127.0.0.1'],
  discordWebhook: '',
  pauseOnBlur: true,
  hardCapMin: 240,
  dayStartsAt: '04:00',
  setupLocked: false,
};

function clampInt(v, lo, hi, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

export function normalizeSettings(input = {}) {
  const d = DEFAULT_SETTINGS;
  const s = { ...d, ...input };
  const cat = {};
  for (const c of CATEGORIES) {
    const given = input.categoryDomains?.[c];
    cat[c] = normalizeEntries(given === undefined ? d.categoryDomains[c] : given);
  }
  const webhook = String(s.discordWebhook || '').trim();
  return {
    cfHandle: String(s.cfHandle || '').trim(),
    quotaMin: clampInt(s.quotaMin, 0, 1440, d.quotaMin),
    rewardMin: clampInt(s.rewardMin, 0, 600, d.rewardMin),
    rewardDomains: normalizeEntries(s.rewardDomains),
    categoryDomains: cat,
    alwaysAllowed: normalizeEntries(s.alwaysAllowed),
    discordWebhook: /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\//.test(webhook) ? webhook : '',
    pauseOnBlur: s.pauseOnBlur !== false,
    hardCapMin: clampInt(s.hardCapMin, 30, 720, d.hardCapMin),
    dayStartsAt: /^([01]\d|2[0-3]):[0-5]\d$/.test(s.dayStartsAt) ? s.dayStartsAt : d.dayStartsAt,
    setupLocked: s.setupLocked === true,
  };
}

export function dayStartMinutes(settings) {
  const [h, m] = String(settings?.dayStartsAt || '04:00').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 240;
}

// Applies a settings form submission. Before setup is locked everything applies now.
// After that, changes that make the reward easier to get wait until the next day:
// lower quota, longer reward window, removing a reward domain. Tightening applies now.
// Returns { settings, pending, deferred } where pending = { proposedDay, values } or null.
export function proposeSettings(current, proposed, { today }) {
  const next = normalizeSettings({ ...current, ...proposed, setupLocked: current.setupLocked });
  if (!current.setupLocked) return { settings: next, pending: null, deferred: [] };

  const applied = { ...next };
  const values = {};
  if (next.quotaMin < current.quotaMin) {
    applied.quotaMin = current.quotaMin;
    values.quotaMin = next.quotaMin;
  }
  if (next.rewardMin > current.rewardMin) {
    applied.rewardMin = current.rewardMin;
    values.rewardMin = next.rewardMin;
  }
  const removed = current.rewardDomains.filter((d) => !next.rewardDomains.includes(d));
  if (removed.length) {
    applied.rewardDomains = [...current.rewardDomains, ...next.rewardDomains.filter((d) => !current.rewardDomains.includes(d))];
    values.rewardDomains = next.rewardDomains;
  }
  const deferred = Object.keys(values);
  return {
    settings: applied,
    pending: deferred.length ? { proposedDay: today, values } : null,
    deferred,
  };
}

// Moves pending loosening changes into effect once the day has rolled over.
export function applyPending(settings, pending, today) {
  if (!pending || !pending.values || !(today > pending.proposedDay)) return { settings, pending: pending || null };
  return { settings: normalizeSettings({ ...settings, ...pending.values }), pending: null };
}
