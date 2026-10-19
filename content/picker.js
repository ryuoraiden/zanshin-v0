// The "Add to Zanshin" picker shared by every import: Seek course pages, the TUF+ sheet, and
// "Add from this page" on any site. A source describes what can be added; the picker draws the
// list in a shadow root (so the host page's styles and Zanshin's never mix), marks anything
// already in Zanshin, and sends the picked tasks to the service worker. Nothing is added until
// you press Add.
//
// source = {
//   title, hint?, empty?            heading, a note under it, or a message instead of a list
//   units?: [{ id, label }], unit?  a select above the list (weeks, sheet steps, page sections)
//   prefix?: { label, value }       an extra text field passed to load/toTask (Seek's "MAD2")
//   categories?: true, category?    show a category select (page scan)
//   groupName(unit, ctx)            default group for the picked tasks ("MAD2 Week 3")
//   load(unit, ctx) -> items        [{ key, label, tags: [{ text, tone }], refs, selected, toTask(ctx) }]
//   quick?: [{ label, test(item) }] shortcut buttons; All and None are always there
//   series?: bool                   start with "feed a few at a time" ticked
//   message?(ctx)                   extra fields for the import message
// }
(() => {
  if (globalThis.ZanshinPicker) return;

  const CATEGORIES = ['IITM', 'DSA', 'NITC', 'Cyber'];
  let host = null;
  let shadow = null;
  let fabEl = null;
  let panel = null;
  let source = null;
  let state = null;
  let linksLib = null;

  const loadLinks = async () => (linksLib ||= await import(chrome.runtime.getURL('lib/links.js')));

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c != null && c !== false) node.append(c instanceof Node ? c : String(c));
    return node;
  }

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .fab { position: fixed; right: 20px; bottom: 20px; z-index: 2147483000; display: flex; align-items: center; gap: 8px;
      padding: 9px 15px 9px 12px; border: 0; border-radius: 999px; background: #e5533d; color: #fff; cursor: pointer;
      font: 600 13px/1 'Segoe UI', system-ui, sans-serif; box-shadow: 0 6px 22px rgba(0,0,0,.35); }
    .fab:hover { background: #f0634d; }
    .fab[hidden] { display: none; }
    .k { font-family: 'Yu Mincho', 'Noto Serif JP', serif; font-size: 16px; font-weight: 600; }
    .panel { position: fixed; right: 20px; bottom: 70px; z-index: 2147483000; width: 480px; max-width: calc(100vw - 40px);
      max-height: min(78vh, 720px); display: flex; flex-direction: column; background: #15181e; color: #e8eaef;
      border: 1px solid #2c313c; border-radius: 12px; box-shadow: 0 22px 60px rgba(0,0,0,.55);
      font: 13px/1.45 'Segoe UI', system-ui, sans-serif; }
    .panel[hidden] { display: none; }
    header { padding: 14px 16px 12px; border-bottom: 1px solid #262b35; }
    h2 { margin: 0; font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
    h2 .k { color: #e5533d; }
    .sub { color: #8d94a3; font-size: 12px; margin-top: 2px; overflow-wrap: anywhere; }
    .hint { color: #6d7484; font-size: 11.5px; margin-top: 6px; }
    .controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px; margin-top: 12px; }
    .controls .wide { grid-column: 1 / -1; }
    label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: #8d94a3; font-weight: 600; letter-spacing: .02em; }
    input[type=text], input[type=number], select { font: inherit; font-size: 13px; color: #e8eaef; background: #0d0f13;
      border: 1px solid #343a46; border-radius: 7px; padding: 6px 8px; width: 100%; }
    input:focus, select:focus { outline: none; border-color: #e5533d; }
    .quick { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
    .chip { font: inherit; font-size: 12px; color: #c9ced8; background: #1c2028; border: 1px solid #343a46; border-radius: 999px;
      padding: 3px 10px; cursor: pointer; }
    .chip:hover { border-color: #4a5160; }
    ul { list-style: none; margin: 0; padding: 4px 8px; overflow-y: auto; flex: 1; min-height: 60px; }
    li label.row { flex-direction: row; align-items: flex-start; gap: 10px; padding: 7px 8px; border-radius: 8px; cursor: pointer;
      color: #e8eaef; font-size: 13px; font-weight: 400; letter-spacing: 0; }
    li label.row:hover { background: #1c2028; }
    li.added label.row { cursor: default; opacity: .55; }
    input[type=checkbox] { accent-color: #e5533d; width: 15px; height: 15px; margin: 2px 0 0; flex-shrink: 0; }
    .title { flex: 1; overflow-wrap: anywhere; }
    .meta { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 3px; }
    .tag { font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 5px; background: #1c2028; color: #8d94a3; }
    .tag.lecture { color: #6f9dff; }
    .tag.graded, .tag.core { color: #e3a63c; }
    .tag.basic { color: #4cb782; }
    .tag.pro { color: #ff8a77; }
    .tag.due { color: #ff8a77; background: rgba(229,83,61,.14); }
    .tag.done { color: #4cb782; background: rgba(76,183,130,.14); }
    .tag.solved { color: #4cb782; }
    footer { padding: 10px 16px 12px; border-top: 1px solid #262b35; display: flex; flex-direction: column; gap: 8px; }
    label.series { flex-direction: row; display: flex; align-items: center; gap: 8px; color: #c9ced8; font-size: 12.5px;
      font-weight: 400; letter-spacing: 0; }
    .series input[type=number] { width: 56px; padding: 4px 6px; }
    .series .muted { color: #8d94a3; }
    .bar { display: flex; align-items: center; gap: 10px; }
    .status { flex: 1; font-size: 12px; color: #8d94a3; }
    .status.ok { color: #4cb782; }
    .status.err { color: #ff8a77; }
    button.primary { font: inherit; font-weight: 600; color: #fff; background: #e5533d; border: 0; border-radius: 7px; padding: 8px 14px; cursor: pointer; }
    button.primary:disabled { opacity: .45; cursor: not-allowed; }
    button.ghost { font: inherit; color: #c9ced8; background: transparent; border: 1px solid #343a46; border-radius: 7px; padding: 7px 12px; cursor: pointer; }
    .empty { padding: 18px 16px; color: #8d94a3; }
  `;

  function mount() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'zanshin-picker';
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    fabEl = el('button', { class: 'fab', type: 'button', hidden: true }, el('span', { class: 'k' }, '残'), el('span', {}, 'Add to Zanshin'));
    panel = el('section', { class: 'panel', hidden: true });
    shadow.append(style, fabEl, panel);
    document.documentElement.append(host);
    document.addEventListener('keydown', (e) => e.key === 'Escape' && !panel.hidden && close());
  }

  function fab(onClick) {
    mount();
    fabEl.onclick = onClick;
    fabEl.hidden = false;
  }

  function hideFab() {
    if (fabEl) fabEl.hidden = true;
  }

  function close() {
    if (panel) panel.hidden = true;
    source = null;
  }

  function open(src) {
    mount();
    const same = source && src.id && source.id === src.id;
    source = src;
    if (!same || !state)
      state = {
        unit: src.unit ?? src.units?.[0]?.id ?? '*',
        prefix: src.prefix?.value ?? '',
        group: null, // null = follow the default for the unit
        category: src.category || 'DSA',
        series: !!src.series,
        batch: 3,
        picked: null,
        status: '',
        statusKind: '',
      };
    panel.hidden = false;
    render();
  }

  const ctx = () => ({ prefix: state.prefix.trim(), group: groupValue(), category: state.category });
  const groupValue = () => (state.group ?? (source.groupName ? source.groupName(state.unit, { prefix: state.prefix.trim() }) : '')).trim();

  async function render() {
    if (!source) return;
    const src = source;
    const head = el(
      'header',
      {},
      el('h2', {}, el('span', { class: 'k' }, '残'), 'Add to Zanshin'),
      el('div', { class: 'sub' }, src.title || document.title),
      src.hint ? el('div', { class: 'hint' }, src.hint) : null,
    );
    if (src.empty) {
      panel.replaceChildren(head, el('div', { class: 'empty' }, src.empty), el('footer', {}, el('div', { class: 'bar' }, el('span', { class: 'status' }), el('button', { class: 'ghost', type: 'button', onclick: close }, 'Close'))));
      return;
    }
    panel.replaceChildren(head, el('div', { class: 'empty' }, 'Reading the page…'));

    const L = await loadLinks();
    let items;
    try {
      items = await src.load(state.unit, ctx());
    } catch (err) {
      panel.replaceChildren(head, el('div', { class: 'empty' }, `Couldn't read this page: ${err?.message || err}`));
      return;
    }
    if (source !== src) return; // closed or replaced while loading
    const { tasks = [], series = [] } = await chrome.storage.local.get(['tasks', 'series']);
    const have = L.existingRefs(tasks, series);
    items = items.map((i) => ({ ...i, added: (i.refs || []).some((r) => have.has(r)) }));
    if (!state.picked) state.picked = new Set(items.filter((i) => i.selected && !i.added).map((i) => i.key));
    const pick = (test) => {
      state.picked = new Set(items.filter((i) => !i.added && test(i)).map((i) => i.key));
      render();
    };

    // controls
    const controls = el('div', { class: 'controls' });
    if (src.units && src.units.length > 1) {
      controls.append(
        el(
          'label',
          { class: 'wide' },
          src.unitLabel || 'Section',
          el(
            'select',
            {
              onchange: (e) => {
                state.unit = e.target.value;
                state.picked = null;
                state.group = null;
                state.status = '';
                render();
              },
            },
            src.units.map((u) => el('option', { value: u.id, selected: u.id === state.unit }, u.label)),
          ),
        ),
      );
    }
    if (src.prefix) {
      const input = el('input', { type: 'text', value: state.prefix, maxlength: '20', spellcheck: 'false' });
      input.addEventListener('change', () => {
        state.prefix = input.value;
        render();
      });
      controls.append(el('label', {}, src.prefix.label || 'Prefix', input));
    }
    const groupInput = el('input', { type: 'text', value: groupValue(), maxlength: '80', spellcheck: 'false', placeholder: 'no group' });
    groupInput.addEventListener('input', () => {
      state.group = groupInput.value;
      seriesNote.textContent = seriesText();
    });
    controls.append(el('label', { class: src.prefix ? '' : 'wide' }, 'Group', groupInput));
    if (src.categories) {
      controls.append(
        el(
          'label',
          {},
          'Category',
          el(
            'select',
            { onchange: (e) => (state.category = e.target.value) },
            CATEGORIES.map((c) => el('option', { value: c, selected: c === state.category }, c)),
          ),
        ),
      );
    }

    const quick = el(
      'div',
      { class: 'quick' },
      (src.quick || []).map((q) => el('button', { class: 'chip', type: 'button', onclick: () => pick(q.test) }, q.label)),
      el('button', { class: 'chip', type: 'button', onclick: () => pick(() => true) }, 'All'),
      el('button', { class: 'chip', type: 'button', onclick: () => pick(() => false) }, 'None'),
    );

    // list
    const list = items.length
      ? el(
          'ul',
          {},
          items.map((i) => {
            const box = el('input', { type: 'checkbox', checked: state.picked.has(i.key) && !i.added, disabled: i.added });
            box.addEventListener('change', () => {
              if (box.checked) state.picked.add(i.key);
              else state.picked.delete(i.key);
              updateFooter();
            });
            return el(
              'li',
              { class: i.added ? 'added' : '' },
              el(
                'label',
                { class: 'row' },
                box,
                el(
                  'span',
                  { class: 'title' },
                  i.label,
                  el(
                    'span',
                    { class: 'meta' },
                    (i.tags || []).map((t) => el('span', { class: `tag ${t.tone || ''}` }, t.text)),
                    i.added ? el('span', { class: 'tag done' }, 'in Zanshin') : null,
                  ),
                ),
              ),
            );
          }),
        )
      : el('div', { class: 'empty' }, src.nothing || 'Nothing to add here.');

    // footer
    const seriesBox = el('input', { type: 'checkbox', checked: state.series });
    const batchInput = el('input', { type: 'number', min: '1', max: '10', value: String(state.batch) });
    const seriesNote = el('span', { class: 'muted' });
    const seriesText = () => (state.series ? `as "${groupValue() || 'Series'}"` : 'or add them all now');
    seriesNote.textContent = seriesText();
    seriesBox.addEventListener('change', () => {
      state.series = seriesBox.checked;
      seriesNote.textContent = seriesText();
      updateFooter();
    });
    batchInput.addEventListener('change', () => (state.batch = Math.min(10, Math.max(1, Number(batchInput.value) || 3))));
    const addBtn = el('button', { class: 'primary', type: 'button', onclick: add });
    const status = el('span', { class: `status ${state.statusKind}` }, state.status);
    function updateFooter() {
      const n = state.picked.size;
      addBtn.disabled = !n;
      addBtn.textContent = !n ? 'Add' : state.series ? `Add ${n} as a series` : `Add ${n} task${n > 1 ? 's' : ''}`;
    }
    updateFooter();

    async function add() {
      addBtn.disabled = true;
      const c = ctx();
      const chosen = items.filter((i) => state.picked.has(i.key) && !i.added);
      const tasksToAdd = chosen.map((i) => {
        const t = i.toTask(c);
        return { ...t, group: c.group, ...(src.categories ? { category: c.category } : {}) };
      });
      const msg = {
        type: 'import:tasks',
        tasks: tasksToAdd,
        series: state.series ? { title: c.group || src.title || 'Series', batch: state.batch } : null,
        ...(src.message ? src.message(c) : {}),
      };
      let r;
      try {
        r = await chrome.runtime.sendMessage(msg);
      } catch {
        r = { ok: false, error: 'Zanshin was reloaded. Reload this page and try again.' };
      }
      if (r?.ok) {
        const { added = 0, skipped = 0 } = r.data || {};
        state.status = state.series
          ? `Series "${msg.series.title}" made with ${added} task${added === 1 ? '' : 's'}, ${Math.min(added, state.batch)} in the queue now.`
          : `Added ${added} task${added === 1 ? '' : 's'}${skipped ? `, ${skipped} were already there` : ''}.`;
        state.statusKind = 'ok';
      } else {
        state.status = r?.error || 'Something went wrong.';
        state.statusKind = 'err';
      }
      state.picked = null;
      render();
    }

    panel.replaceChildren(
      el('header', {}, ...head.childNodes, controls, quick),
      list,
      el(
        'footer',
        {},
        el('label', { class: 'series' }, seriesBox, 'Feed', batchInput, 'at a time', seriesNote),
        el('div', { class: 'bar' }, status, el('button', { class: 'ghost', type: 'button', onclick: close }, 'Close'), addBtn),
      ),
    );
  }

  globalThis.ZanshinPicker = { fab, hideFab, open, close, isOpen: () => !!source, refresh: () => source && render(), sourceId: () => source?.id };
})();
