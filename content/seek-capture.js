// Runs inside Seek's own page (MAIN world, before Seek's scripts). Seek loads each course's
// outline from its API; this keeps a copy of that response as the page receives it and hands it
// to Zanshin's other content script (content/seek.js) through postMessage. It makes no requests
// of its own and never reads Seek's login.
(() => {
  if (window.__zanshinSeekCapture) return;
  window.__zanshinSeekCapture = true;

  const TAG = 'zanshin-seek';
  const isOutline = (url) => /\/api\/v2\/user\/course\/\?namespace=/.test(String(url || ''));
  let latest = null;

  const share = () => latest && window.postMessage({ source: TAG, kind: 'outline', body: latest }, location.origin);
  const keep = (body) => {
    if (body && body.course && Array.isArray(body.course.outline)) {
      latest = body;
      share();
    }
  };

  const originalFetch = window.fetch;
  window.fetch = function (input) {
    const result = originalFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : input && input.url;
      // Attached before Seek's own handlers, so the clone happens before Seek reads the body.
      if (isOutline(url))
        result
          .then((res) => res.clone().json())
          .then(keep)
          .catch(() => {});
    } catch {}
    return result;
  };

  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__zanshinUrl = url;
    return open.apply(this, arguments);
  };
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    if (isOutline(this.__zanshinUrl))
      this.addEventListener('load', () => {
        try {
          keep(typeof this.response === 'string' ? JSON.parse(this.response) : this.response);
        } catch {}
      });
    return send.apply(this, arguments);
  };

  // content/seek.js asks for the latest copy when it starts, in case Seek loaded it first.
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.source === TAG && e.data.kind === 'request') share();
  });
})();
