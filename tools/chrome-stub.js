// Dev-only fake of the chrome.* APIs the pages use. Storage is backed by localStorage and
// messages are handled by tools/stub-handlers.mjs using the real reducers from lib/.
(() => {
  const KEY = 'zanshin-stub';
  const listeners = [];
  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '{}');
    } catch {
      return {};
    }
  };
  const fire = (changes) => setTimeout(() => listeners.forEach((fn) => fn(changes, 'local')), 0);

  const local = {
    async get(keys) {
      const d = load();
      if (keys == null) return d;
      const out = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) if (k in d) out[k] = d[k];
      return out;
    },
    async set(obj) {
      const d = load();
      const changes = {};
      for (const [k, v] of Object.entries(obj)) {
        changes[k] = { oldValue: d[k], newValue: v };
        d[k] = v;
      }
      localStorage.setItem(KEY, JSON.stringify(d));
      fire(changes);
    },
  };
  window.addEventListener('storage', (e) => e.key === KEY && fire({}));

  window.chrome = {
    runtime: {
      id: 'stub',
      getURL: (p) => `${location.origin}/${String(p).replace(/^\//, '')}`,
      async sendMessage(msg) {
        const m = await import('/tools/stub-handlers.mjs');
        const r = await m.handle(msg);
        console.log('[stub message]', msg.type, r);
        return r;
      },
      openOptionsPage() {
        location.href = '/pages/options.html';
      },
      onMessage: { addListener() {} },
    },
    storage: { local, onChanged: { addListener: (fn) => listeners.push(fn) } },
    tabs: {
      async getCurrent() {
        return { id: 1 };
      },
      async create({ url }) {
        console.log('[stub] would open', url);
      },
      async remove() {
        console.log('[stub] would close this tab');
      },
    },
  };
})();
