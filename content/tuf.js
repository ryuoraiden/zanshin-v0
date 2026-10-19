// "Add to Zanshin" on TUF+ sheets (Striver's A2Z and the other prep-hub sheets). The picker lists
// the sheet's steps with your progress; choosing one opens that step's sections on the page (the
// same as clicking them) and reads its problems, with your solved ones unticked.
//
// Page structure, checked on the live sheet: each step and sub-step is a <section> whose header
// is button[data-tree-anchor][aria-expanded] reading "Binary Search 0/32". Problems are
// tr[data-sheet-row-key="practice-N"] rows with a "Mark <title> complete" button (data-state
// checked/unchecked) and an "Open on takeUforward" link to /practice/dsa/<slug>.
(() => {
  if (window.__zanshinTuf) return;
  window.__zanshinTuf = true;

  let links = null;
  const loadLinks = async () => (links ||= await import(chrome.runtime.getURL('lib/links.js')));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const runtimeOk = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };

  const headerOf = (section) => {
    const b = section.firstElementChild;
    return b && b.matches('button[data-tree-anchor]') ? b : null;
  };
  function nameOf(section) {
    const text = (headerOf(section)?.innerText || '').replace(/\s+/g, ' ').trim();
    const m = text.match(/^(.*?)\s*(\d+)\s*\/\s*(\d+)$/);
    return m ? { name: m[1].trim(), done: +m[2], total: +m[3] } : { name: text, done: 0, total: 0 };
  }
  const topSteps = () =>
    [...document.querySelectorAll('section')].filter((s) => headerOf(s) && !s.parentElement?.closest('section'));

  function sheetName() {
    const h1 = (document.querySelector('h1')?.innerText || document.title).trim();
    if (/a2z/i.test(h1)) return 'A2Z';
    return h1.replace(/\s*[|–-].*$/, '').replace(/^striver'?s\s+/i, '').split(/\s+/).slice(0, 3).join(' ');
  }

  // Opens a step and every section inside it, a few rounds at a time, until nothing is collapsed.
  async function expand(section) {
    for (let round = 0; round < 8; round++) {
      const closed = [...section.querySelectorAll('button[data-tree-anchor][aria-expanded="false"]')];
      if (!closed.length) break;
      closed.forEach((b) => b.click());
      await sleep(350);
    }
    await sleep(250);
  }

  function readRows(step, L) {
    const items = [];
    for (const tr of step.querySelectorAll('tr[data-sheet-row-key^="practice-"]')) {
      const mark = tr.querySelector('button[aria-label^="Mark"]');
      const title = (mark?.getAttribute('aria-label') || '')
        .replace(/^Mark\s+/, '')
        .replace(/\s+complete$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
      const anchor = [...tr.querySelectorAll('a[href]')].find((a) => /\/practice\/dsa\//.test(a.getAttribute('href') || ''));
      const link = anchor ? L.classifyLink(anchor.href) : null;
      if (!link || !title) continue;
      const solved = mark?.dataset.state === 'checked' || mark?.getAttribute('aria-checked') === 'true';
      // The difficulty is its own little tag element; the row's text runs the title into it
      // ("Search X in sorted arrayBasic"), so look for the element, not a word in the text.
      const LEVEL = /^(Basic|Easy|Core|Medium|Pro|Hard)$/;
      const level = [...tr.querySelectorAll('span, div, p, small')].map((e) => e.textContent.trim()).find((t) => LEVEL.test(t)) || '';
      const sub = tr.closest('section');
      const subName = sub && sub !== step ? nameOf(sub).name : '';
      items.push({
        key: link.key,
        label: title,
        solved,
        selected: !solved,
        refs: [link.key],
        tags: [
          subName ? { text: subName } : null,
          level ? { text: level, tone: level.toLowerCase() } : null,
          solved ? { text: 'solved on TUF', tone: 'solved' } : null,
        ].filter(Boolean),
        toTask: (c) => L.linkToTask(link, { title, category: 'DSA', group: c.group }),
      });
    }
    return items;
  }

  async function openPicker() {
    const L = await loadLinks();
    const steps = topSteps();
    if (!steps.length) return ZanshinPicker.open({ id: 'tuf-empty', title: 'TUF+', empty: "This doesn't look like a sheet page." });
    const sheet = sheetName();
    const units = steps.map((s, i) => {
      const n = nameOf(s);
      return { id: String(i), label: n.total ? `${n.name} (${n.done}/${n.total})` : n.name, name: n.name, open: n.done < n.total };
    });
    ZanshinPicker.open({
      id: `tuf:${location.pathname}`,
      title: (document.querySelector('h1')?.innerText || document.title).trim(),
      hint: 'Picking a step opens its sections on the page so Zanshin can read the problems.',
      unitLabel: 'Step',
      units,
      unit: (units.find((u) => u.open) || units[0]).id,
      groupName: (unit) => `${sheet}: ${units.find((u) => u.id === unit)?.name || ''}`,
      series: true,
      load: async (unit) => {
        const step = topSteps()[Number(unit)];
        if (!step) return [];
        await expand(step);
        return readRows(step, L);
      },
      quick: [{ label: 'Unsolved', test: (i) => !i.solved }],
      nothing: 'No problems found in this step.',
    });
  }

  function sync() {
    if (runtimeOk() && topSteps().length) ZanshinPicker.fab(openPicker);
    else ZanshinPicker.hideFab();
  }
  setInterval(sync, 1500);
  sync();
})();
