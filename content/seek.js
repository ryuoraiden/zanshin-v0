// "Add to Zanshin" on Seek course pages. Gets the course outline from content/seek-capture.js,
// lets you pick a week and the lessons you want, and sends them to the service worker as tasks.
// The parsing lives in lib/seek.js (tested); this file is only the button and the picker, drawn
// in a shadow root so Seek's styles and Zanshin's can't touch each other.
(() => {
  if (window.__zanshinSeek) return;
  window.__zanshinSeek = true;

  const TAG = 'zanshin-seek';
  let outline = null;
  let lib = null;
  let host = null;
  let shadow = null;
  let open = false;
  let state = { ns: null };

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
    if (open) render();
  });
  window.postMessage({ source: TAG, kind: 'request' }, location.origin);

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
    .k { font-family: 'Yu Mincho', 'Noto Serif JP', serif; font-size: 16px; font-weight: 600; }
    .panel { position: fixed; right: 20px; bottom: 70px; z-index: 2147483000; width: 460px; max-width: calc(100vw - 40px);
      max-height: min(74vh, 680px); display: flex; flex-direction: column; background: #15181e; color: #e8eaef;
      border: 1px solid #2c313c; border-radius: 12px; box-shadow: 0 22px 60px rgba(0,0,0,.55);
      font: 13px/1.45 'Segoe UI', system-ui, sans-serif; }
    .panel[hidden] { display: none; }
    header { padding: 14px 16px 12px; border-bottom: 1px solid #262b35; }
    h2 { margin: 0; font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
    h2 .k { color: #e5533d; }
    .sub { color: #8d94a3; font-size: 12px; margin-top: 2px; }
    .controls { display: grid; grid-template-columns: 110px 1fr; gap: 10px; margin-top: 12px; }
    label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: #8d94a3; font-weight: 600; letter-spacing: .02em; }
    input[type=text], select { font: inherit; font-size: 13px; color: #e8eaef; background: #0d0f13; border: 1px solid #343a46;
      border-radius: 7px; padding: 6px 8px; width: 100%; }
    input[type=text]:focus, select:focus { outline: none; border-color: #e5533d; }
    .quick { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
    .chip { font: inherit; font-size: 12px; color: #c9ced8; background: #1c2028; border: 1px solid #343a46; border-radius: 999px;
      padding: 3px 10px; cursor: pointer; }
    .chip:hover { border-color: #4a5160; }
    ul { list-style: none; margin: 0; padding: 4px 8px; overflow-y: auto; flex: 1; }
    li label.row { flex-direction: row; align-items: flex-start; gap: 10px; padding: 7px 8px; border-radius: 8px; cursor: pointer;
      color: #e8eaef; font-size: 13px; font-weight: 400; letter-spacing: 0; }
    li label.row:hover { background: #1c2028; }
    li.added label.row { cursor: default; opacity: .55; }
    input[type=checkbox] { accent-color: #e5533d; width: 15px; height: 15px; margin: 2px 0 0; flex-shrink: 0; }
    .title { flex: 1; overflow-wrap: anywhere; }
    .meta { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 3px; }
    .tag { font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 5px; background: #1c2028; color: #8d94a3; }
    .tag.lecture { color: #6f9dff; }
    .tag.assignment { color: #e3a63c; }
    .tag.due { color: #ff8a77; background: rgba(229,83,61,.14); }
    .tag.done { color: #4cb782; background: rgba(76,183,130,.14); }
    footer { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-top: 1px solid #262b35; }
    .status { flex: 1; font-size: 12px; color: #8d94a3; }
    .status.ok { color: #4cb782; }
    .status.err { color: #ff8a77; }
    button.primary { font: inherit; font-weight: 600; color: #fff; background: #e5533d; border: 0; border-radius: 7px; padding: 8px 14px; cursor: pointer; }
    button.primary:disabled { opacity: .45; cursor: not-allowed; }
    button.ghost { font: inherit; color: #c9ced8; background: transparent; border: 1px solid #343a46; border-radius: 7px; padding: 7px 12px; cursor: pointer; }
    .empty { padding: 18px 16px; color: #8d94a3; }
  `;

  function mount() {
    host = document.createElement('div');
    host.id = 'zanshin-seek';
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    shadow.append(
      style,
      el('button', { class: 'fab', type: 'button', onclick: toggle, title: 'Add lessons from this course to Zanshin' }, el('span', { class: 'k' }, '残'), 'Add to Zanshin'),
      el('section', { class: 'panel', hidden: true }),
    );
    document.documentElement.append(host);
    document.addEventListener('keydown', (e) => e.key === 'Escape' && open && toggle());
  }

  function toggle() {
    open = !open;
    shadow.querySelector('.panel').hidden = !open;
    if (open) render();
  }

  function syncButton() {
    const show = !!currentNs() && runtimeOk();
    if (show && !host) mount();
    if (!host) return;
    host.style.display = show ? '' : 'none';
    if (!show && open) toggle();
  }

  const fmtDue = (ts) =>
    new Date(ts).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

  async function render() {
    const panel = shadow.querySelector('.panel');
    const ns = currentNs();
    const head = (sub) =>
      el('header', {}, el('h2', {}, el('span', { class: 'k' }, '残'), 'Add to Zanshin'), el('div', { class: 'sub' }, sub));
    if (!outline || outline.course?.namespace !== ns) {
      panel.replaceChildren(
        head('Waiting for Seek to load this course.'),
        el('div', { class: 'empty' }, "If this doesn't change in a few seconds, reload the page so Zanshin can read the course outline."),
      );
      return;
    }

    const K = await loadLib();
    const items = K.outlineItems(outline.course);
    const { tasks = [], seekPrefixes = {} } = await chrome.storage.local.get(['tasks', 'seekPrefixes']);
    const refs = K.existingRefs(tasks);
    if (state.ns !== ns)
      state = {
        ns,
        unitId: K.defaultUnit(items, Date.now()),
        prefix: seekPrefixes[ns] || K.coursePrefix(outline.course.title),
        picked: null,
        status: '',
        statusKind: '',
      };

    const unitItems = items
      .filter((i) => i.unitId === state.unitId)
      .map((i) => ({ ...i, added: K.itemRefs(i, ns).some((r) => refs.has(r)) }));
    if (!state.picked) state.picked = new Set(unitItems.filter((i) => i.selected && !i.added).map((i) => i.id));
    const pick = (fn) => {
      state.picked = new Set(unitItems.filter((i) => !i.added && fn(i)).map((i) => i.id));
      render();
    };

    const weekSelect = el(
      'select',
      {
        onchange: (e) => {
          state.unitId = Number(e.target.value);
          state.picked = null;
          state.status = '';
          render();
        },
      },
      K.outlineUnits(items).map((u) => el('option', { value: String(u.unitId), selected: u.unitId === state.unitId }, u.title)),
    );
    const prefixInput = el('input', { type: 'text', value: state.prefix, maxlength: '20', spellcheck: 'false' });
    prefixInput.addEventListener('input', () => (state.prefix = prefixInput.value));

    const soon = Date.now() + 2 * 86400000;
    const list = unitItems.length
      ? el(
          'ul',
          {},
          unitItems.map((i) => {
            const box = el('input', { type: 'checkbox', checked: state.picked.has(i.id) && !i.added, disabled: i.added });
            box.addEventListener('change', () => {
              if (box.checked) state.picked.add(i.id);
              else state.picked.delete(i.id);
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
                    el('span', { class: `tag ${i.kind}` }, i.kind === 'lecture' ? 'Lecture' : i.kind === 'assignment' ? (i.graded ? 'Graded' : 'Practice') : 'Reading'),
                    i.graded && i.due ? el('span', { class: `tag ${i.due < soon ? 'due' : ''}` }, `due ${fmtDue(i.due)}`) : null,
                    i.added ? el('span', { class: 'tag done' }, 'in Zanshin') : null,
                  ),
                ),
              ),
            );
          }),
        )
      : el('div', { class: 'empty' }, 'Nothing in this unit.');

    const addBtn = el('button', { class: 'primary', type: 'button', onclick: add });
    const status = el('span', { class: `status ${state.statusKind}` }, state.status);
    function updateFooter() {
      const n = state.picked.size;
      addBtn.textContent = n ? `Add ${n} task${n > 1 ? 's' : ''}` : 'Add tasks';
      addBtn.disabled = !n;
    }
    updateFooter();

    async function add() {
      addBtn.disabled = true;
      const prefix = state.prefix.trim() || K.coursePrefix(outline.course.title);
      const chosen = unitItems.filter((i) => state.picked.has(i.id) && !i.added).map((i) => K.itemToTask(i, { prefix, namespace: ns }));
      let r;
      try {
        r = await chrome.runtime.sendMessage({ type: 'seek:import', namespace: ns, prefix, tasks: chosen });
      } catch (err) {
        r = { ok: false, error: 'Zanshin was reloaded. Reload this page and try again.' };
      }
      if (r?.ok) {
        const { added, skipped } = r.data;
        state.status = `Added ${added} task${added === 1 ? '' : 's'}${skipped ? `, ${skipped} were already there` : ''}.`;
        state.statusKind = 'ok';
      } else {
        state.status = r?.error || 'Something went wrong.';
        state.statusKind = 'err';
      }
      state.picked = null;
      render();
    }

    panel.replaceChildren(
      el(
        'header',
        {},
        el('h2', {}, el('span', { class: 'k' }, '残'), 'Add to Zanshin'),
        el('div', { class: 'sub' }, outline.course.title),
        el('div', { class: 'controls' }, el('label', {}, 'Prefix', prefixInput), el('label', {}, 'Week', weekSelect)),
        el(
          'div',
          { class: 'quick' },
          el('button', { class: 'chip', type: 'button', onclick: () => pick((i) => i.kind === 'lecture') }, 'Lectures'),
          el('button', { class: 'chip', type: 'button', onclick: () => pick((i) => i.graded) }, 'Graded'),
          el('button', { class: 'chip', type: 'button', onclick: () => pick((i) => i.kind === 'lecture' || i.graded) }, 'Both'),
          el('button', { class: 'chip', type: 'button', onclick: () => pick(() => true) }, 'All'),
          el('button', { class: 'chip', type: 'button', onclick: () => pick(() => false) }, 'None'),
        ),
      ),
      list,
      el('footer', {}, status, el('button', { class: 'ghost', type: 'button', onclick: toggle }, 'Close'), addBtn),
    );
  }

  setInterval(syncButton, 1000);
  syncButton();
})();
