// "Add to Zanshin" on Seek course pages. Gets the course outline from content/seek-capture.js and
// hands a week of it to the shared picker (content/picker.js). Parsing lives in lib/seek.js.
// Each week's tasks land in one group, "MAD2 Week 3".
(() => {
  if (window.__zanshinSeek) return;
  window.__zanshinSeek = true;

  const TAG = 'zanshin-seek';
  let outline = null;
  let lib = null;

  const runtimeOk = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };
  const currentNs = () => (location.pathname.match(/\/courses\/(ns_[A-Za-z0-9_]+)/) || [])[1] || null;
  const loadLib = async () => (lib ||= await import(chrome.runtime.getURL('lib/seek.js')));

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== TAG || e.data.kind !== 'outline') return;
    outline = e.data.body;
    if (ZanshinPicker.sourceId()?.startsWith('seek:')) openPicker();
  });
  window.postMessage({ source: TAG, kind: 'request' }, location.origin);

  const fmtDue = (ts) =>
    new Date(ts).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

  async function openPicker() {
    const ns = currentNs();
    if (!outline || outline.course?.namespace !== ns) {
      ZanshinPicker.open({
        id: `seek-wait:${ns}`,
        title: 'Seek course',
        empty: "Waiting for Seek to load this course. If this doesn't change in a few seconds, reload the page so Zanshin can read the outline.",
      });
      return;
    }
    const K = await loadLib();
    const items = K.outlineItems(outline.course);
    const { seekPrefixes = {} } = await chrome.storage.local.get('seekPrefixes');
    const soon = Date.now() + 2 * 86400000;
    const unitOf = (unit) => items.find((i) => String(i.unitId) === unit) || { week: null, unitTitle: '' };
    ZanshinPicker.open({
      id: `seek:${ns}`,
      title: outline.course.title,
      unitLabel: 'Week',
      units: K.outlineUnits(items).map((u) => ({ id: String(u.unitId), label: u.title })),
      unit: String(K.defaultUnit(items, Date.now())),
      prefix: { label: 'Prefix', value: seekPrefixes[ns] || K.coursePrefix(outline.course.title) },
      groupName: (unit, c) => K.unitGroup(unitOf(unit), c.prefix || K.coursePrefix(outline.course.title)),
      load: async (unit) =>
        items
          .filter((i) => String(i.unitId) === unit)
          .map((i) => ({
            key: String(i.id),
            label: i.label,
            kind: i.kind,
            graded: i.graded,
            selected: i.selected,
            refs: K.itemRefs(i, ns),
            tags: [
              {
                text: i.kind === 'lecture' ? 'Lecture' : i.kind === 'assignment' ? (i.graded ? 'Graded' : 'Practice') : 'Reading',
                tone: i.kind === 'lecture' ? 'lecture' : i.graded ? 'graded' : '',
              },
              i.graded && i.due ? { text: `due ${fmtDue(i.due)}`, tone: i.due < soon ? 'due' : '' } : null,
            ].filter(Boolean),
            toTask: (c) => K.itemToTask(i, { prefix: c.prefix || K.coursePrefix(outline.course.title), namespace: ns, group: c.group }),
          })),
      quick: [
        { label: 'Lectures', test: (i) => i.kind === 'lecture' },
        { label: 'Graded', test: (i) => i.graded },
        { label: 'Both', test: (i) => i.kind === 'lecture' || i.graded },
      ],
      message: (c) => ({ seekPrefix: { namespace: ns, prefix: c.prefix } }),
    });
  }

  function sync() {
    if (currentNs() && runtimeOk()) ZanshinPicker.fab(openPicker);
    else {
      ZanshinPicker.hideFab();
      if (ZanshinPicker.sourceId()?.startsWith('seek')) ZanshinPicker.close();
    }
  }
  setInterval(sync, 1000);
  sync();
})();
