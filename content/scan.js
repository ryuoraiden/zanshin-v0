// "Add from this page" (popup button). Injected into the current tab only when you click it.
// Walks the page for links Zanshin understands (Codeforces, LeetCode, TUF+, GFG, YouTube,
// pwn.college), groups them under the nearest heading, and opens the shared picker.
//   YouTube playlist pages: every loaded video with its length (as the time estimate).
//   leetcode.com: today's daily problem first.
//   The page itself when it's a problem or a video ("This page").
//   Codeforces problems your handle already solved come unticked.
(async () => {
  const L = await import(chrome.runtime.getURL('lib/links.js'));
  const found = new Map(); // key -> { link, title, section, estimateMin }
  const sections = [];

  function add(link, title, section, extra = {}) {
    if (!L.isTaskLink(link) || link.kind === 'seek') return;
    const clean = String(title || '').replace(/\s+/g, ' ').trim();
    const existing = found.get(link.key);
    if (existing) {
      // The same video often appears twice (thumbnail, then title); keep the better title.
      if (!existing.title && clean) existing.title = clean;
      return;
    }
    if (!sections.includes(section)) sections.push(section);
    found.set(link.key, { link, title: clean, section, ...extra });
  }

  const GENERIC = /^(solve|solve it|link|practice|problem|here|open|watch|video|leetcode|codeforces|gfg|tuf|article|editorial|\d+)$/i;
  function anchorTitle(a) {
    const t = (a.getAttribute('title') || a.innerText || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 140 || GENERIC.test(t) || /^https?:\/\//.test(t)) return '';
    return t;
  }

  const pageTitle = document.title.replace(/\s*[-|–]\s*(YouTube|LeetCode|Codeforces|takeUforward)\s*$/i, '').trim() || location.hostname;
  const toMinutes = (s) => {
    const parts = String(s || '').trim().split(':').map(Number);
    if (!parts.length || parts.some((n) => !Number.isFinite(n))) return 0;
    return Math.round(parts.reduce((acc, n) => acc * 60 + n, 0) / 60);
  };

  // The page itself.
  const self = L.classifyLink(location.href);
  if (L.isTaskLink(self) && self.kind !== 'seek') add(self, self.kind === 'youtube' ? pageTitle : '', 'This page');

  // LeetCode: today's daily problem.
  if (/(^|\.)leetcode\.com$/.test(location.hostname)) {
    try {
      const res = await fetch('/graphql/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'query { activeDailyCodingChallengeQuestion { date link question { title titleSlug difficulty questionFrontendId } } }' }),
      }).then((r) => r.json());
      const d = res?.data?.activeDailyCodingChallengeQuestion;
      if (d?.question) add(L.classifyLink(`https://leetcode.com${d.link}`), `LeetCode daily ${d.date}: ${d.question.questionFrontendId}. ${d.question.title}`, "Today's daily");
    } catch {}
  }

  const isPlaylist = /(^|\.)youtube\.com$/.test(location.hostname) && location.pathname === '/playlist';
  if (isPlaylist) {
    const heading = (document.querySelector('h1')?.innerText || pageTitle).trim();
    for (const row of document.querySelectorAll('ytd-playlist-video-renderer')) {
      const a = row.querySelector('a#video-title');
      if (!a) continue;
      const time = row.querySelector('ytd-thumbnail-overlay-time-status-renderer')?.innerText;
      add(L.classifyLink(a.href), a.getAttribute('title') || a.innerText, heading, { estimateMin: toMinutes(time) });
    }
  }

  // Everything else: walk the page in order, tracking the latest heading.
  let heading = pageTitle;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.id === 'zanshin-picker') continue;
    if (/^H[1-4]$/.test(node.tagName) || node.getAttribute('role') === 'heading') {
      const text = (node.innerText || '').replace(/\s+/g, ' ').trim();
      if (text && text.length <= 80) heading = text;
      continue;
    }
    if (node.tagName === 'A' && node.href) add(L.classifyLink(node.href), anchorTitle(node), heading);
  }

  const items = [...found.values()];
  if (!items.length) {
    ZanshinPicker.open({
      id: `scan:${location.href}`,
      title: pageTitle,
      empty: 'No problem or lecture links found here. Zanshin looks for Codeforces, LeetCode, TUF+, GFG, YouTube and pwn.college links.',
    });
    return;
  }

  const untitledVideos = items.filter((i) => i.link.kind === 'youtube' && !i.title).map((i) => i.link.url);
  if (untitledVideos.length) {
    try {
      const r = await chrome.runtime.sendMessage({ type: 'yt:titles', urls: untitledVideos });
      for (const i of items) if (!i.title && r?.data?.titles?.[i.link.url]) i.title = r.data.titles[i.link.url];
    } catch {}
  }

  let solved = new Set();
  if (items.some((i) => i.link.kind === 'codeforces')) {
    try {
      const r = await chrome.runtime.sendMessage({ type: 'cf:solved' });
      if (r?.ok) solved = new Set(r.data.keys.map((k) => `cf:${k}`));
    } catch {}
  }

  const kinds = new Set(items.map((i) => i.link.kind));
  const allVideos = [...kinds].every((k) => k === 'youtube');
  const units = sections.length > 1 ? [{ id: '*', label: `Everything (${items.length})` }, ...sections.map((s) => ({ id: s, label: `${s} (${items.filter((i) => i.section === s).length})` }))] : [];
  const KIND_LABEL = { codeforces: 'Codeforces', leetcode: 'LeetCode', tuf: 'TUF+', gfg: 'GFG', youtube: 'Video', pwn: 'pwn.college' };

  ZanshinPicker.open({
    id: `scan:${location.href}`,
    title: pageTitle,
    hint: isPlaylist ? 'YouTube loads long playlists in chunks. Scroll to the end first if some videos are missing.' : '',
    unitLabel: 'Section',
    units,
    unit: units.length ? (sections.includes("Today's daily") ? "Today's daily" : '*') : '*',
    categories: true,
    category: allVideos ? 'NITC' : [...kinds].every((k) => k === 'pwn') ? 'Cyber' : 'DSA',
    series: items.length > 8,
    // One problem, the page itself or LeetCode's daily stay ungrouped; lists get the section or page name.
    groupName: (unit) =>
      (items.length === 1 || unit === 'This page' || unit === "Today's daily" ? '' : unit === '*' ? pageTitle : unit).slice(0, 80),
    load: async (unit) =>
      items
        .filter((i) => unit === '*' || i.section === unit)
        .map((i) => {
          const isSolved = solved.has(i.link.key);
          return {
            key: i.link.key,
            label: i.title || i.link.title || i.link.url,
            solved: isSolved,
            selected: !isSolved,
            refs: [i.link.key],
            tags: [
              { text: KIND_LABEL[i.link.kind] || i.link.kind, tone: i.link.kind === 'youtube' ? 'lecture' : '' },
              i.estimateMin ? { text: `${i.estimateMin} min` } : null,
              isSolved ? { text: 'solved on Codeforces', tone: 'solved' } : null,
              units.length && unit === '*' && i.section !== pageTitle ? { text: i.section } : null,
            ].filter(Boolean),
            toTask: (c) => ({ ...L.linkToTask(i.link, { title: i.title, category: c.category, group: c.group }), estimateMin: i.estimateMin || 0 }),
          };
        }),
    quick: solved.size ? [{ label: 'Unsolved', test: (i) => !i.solved }] : [],
  });
})();
