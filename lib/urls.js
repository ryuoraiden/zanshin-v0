// URL and domain helpers. Pure, no chrome.* calls.

// "https://www.YouTube.com/watch?v=x" -> "youtube.com". Returns '' for junk.
export function normalizeDomain(input) {
  if (!input) return '';
  let s = String(input).trim().toLowerCase();
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = 'http://' + s;
  try {
    let host = new URL(s).hostname;
    if (host.startsWith('www.')) host = host.slice(4);
    return host.replace(/\.$/, '');
  } catch {
    return '';
  }
}

// "youtube.com/shorts" -> { domain: "youtube.com", path: "/shorts" }. Path is '' for bare domains.
export function parseEntry(entry) {
  const raw = String(entry || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '');
  if (!raw) return null;
  const slash = raw.indexOf('/');
  const domain = normalizeDomain(slash === -1 ? raw : raw.slice(0, slash));
  if (!domain) return null;
  let path = slash === -1 ? '' : raw.slice(slash).replace(/\/+$/, '');
  return { domain, path };
}

// Normalizes a user-typed list of domains (or domain/path entries), dropping junk and duplicates.
export function normalizeEntries(list) {
  const items = Array.isArray(list) ? list : String(list || '').split(/[\s,]+/);
  const out = [];
  for (const item of items) {
    const e = parseEntry(item);
    if (!e) continue;
    const key = e.domain + e.path;
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

export function hostMatches(host, domain) {
  if (!host || !domain) return false;
  host = host.toLowerCase();
  if (host.startsWith('www.')) host = host.slice(4);
  return host === domain || host.endsWith('.' + domain);
}

export function videoIdFromUrl(url) {
  if (!url) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
  if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null;
  if (u.pathname === '/watch') return u.searchParams.get('v');
  const m = u.pathname.match(/^\/(?:embed|live|shorts)\/([\w-]{6,})/);
  return m ? m[1] : null;
}

// Pages the lecture lock never closes or bounces away from: Zanshin's own pages,
// chrome:// pages (so chrome://extensions always stays reachable) and devtools.
// The new tab page is not exempt, otherwise Ctrl+T would be a free escape.
export function isExemptUrl(url, extensionBase) {
  if (!url) return false;
  if (extensionBase && url.startsWith(extensionBase)) return true;
  if (/^chrome:\/\/(newtab|new-tab-page)/.test(url)) return false;
  if (url.startsWith('chrome-search://')) return false;
  return url.startsWith('chrome://') || url.startsWith('devtools://') || url.startsWith('chrome-untrusted://');
}

// Adds https:// to bare URLs and rejects anything that isn't http(s).
export function cleanUrl(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
}
