// Zanshin YouTube content script. Runs on watch pages and embeds (so lectures embedded in the IITM
// portal work too). It only reports playback for the tab Zanshin is locking. Everywhere else it
// just checks in-page navigations against the blocking rules, because YouTube is a single-page
// app and those navigations never reach the network rules (that's how Shorts would slip through).
//
// Coverage is built from timeupdate steps that look like normal playback. A seek breaks the
// chain, so skipping ahead adds nothing. Ads are ignored.
(() => {
  if (window.__zanshinLoaded) return;
  window.__zanshinLoaded = true;

  const isTop = window === window.top;

  // A YouTube page that loads in a background tab (for example one Zanshin just put back after a
  // session) doesn't get to play until you've looked at it once. Chrome already holds back
  // brand-new background tabs, but not a tab that navigates while hidden. Media events don't
  // bubble, so this listens in the capture phase.
  let holdUntilSeen = document.visibilityState === 'hidden';
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') holdUntilSeen = false;
  });
  document.addEventListener(
    'play',
    (e) => {
      if (holdUntilSeen && e.target instanceof HTMLMediaElement) e.target.pause();
    },
    true,
  );

  const REPORT_MS = 5000;
  const REHELLO_MS = 60000; // a safety net; the first hello normally settles it

  let target = false;
  let videoId = null;
  let resumeAt = 0;
  let resumed = true;
  let cinema = false;
  let video = null;
  let lastT = null;
  let lastPerf = 0;
  let seeking = false;
  let pending = [];
  let playedMs = 0;
  let durationSent = false;
  let lastHello = 0;

  function runtimeOk() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  function sendMsg(msg) {
    if (!runtimeOk()) return Promise.resolve(null);
    try {
      return chrome.runtime.sendMessage(msg).catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  }

  function currentVideoId() {
    try {
      const u = new URL(location.href);
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(?:embed|live)\/([\w-]{6,})/);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  }

  const isWatch = () => location.pathname === '/watch';
  const adShowing = () => !!document.querySelector('#movie_player.ad-showing, .html5-video-player.ad-showing');
  const findVideo = () => document.querySelector('#movie_player video') || document.querySelector('video.html5-main-video');

  // ---- handshake with the service worker ----------------------------------------------------

  async function hello() {
    lastHello = Date.now();
    const id = currentVideoId();
    if (!id) return setTarget(false);
    const r = await sendMsg({ type: 'video:hello', videoId: id, isWatch: isWatch() });
    if (r && r.target) {
      if (!target || videoId !== id) {
        resumeAt = r.resumeAt || 0;
        resumed = false;
      }
      videoId = id;
      setTarget(true, !!r.cinema);
    } else {
      videoId = id;
      setTarget(false);
    }
  }

  function setTarget(on, wantCinema = false) {
    if (target && !on) flush();
    target = on;
    lastT = null;
    applyCinema(on && wantCinema && isTop);
  }

  // ---- playback tracking ---------------------------------------------------------------------

  function attach(v) {
    if (video === v) return;
    video = v;
    lastT = null;
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('seeking', (e) => {
      if (e.target !== video) return;
      seeking = true;
      lastT = null;
    });
    v.addEventListener('seeked', (e) => {
      if (e.target !== video) return;
      seeking = false;
      lastT = null;
    });
    v.addEventListener('pause', (e) => e.target === video && flush());
    v.addEventListener('ended', (e) => e.target === video && flush(true));
    v.addEventListener('loadedmetadata', tryResume);
  }

  function onTime(e) {
    const v = e.target;
    if (v !== video) return;
    if (!target || seeking || v.paused || adShowing()) {
      lastT = null;
      return;
    }
    const t = v.currentTime;
    const now = performance.now();
    if (lastT != null) {
      const d = t - lastT;
      // timeupdate fires ~4 times a second; anything bigger than a few seconds is a jump.
      if (d > 0 && d <= 3 * Math.max(1, v.playbackRate || 1)) {
        const last = pending[pending.length - 1];
        if (last && Math.abs(last[1] - lastT) < 0.001) last[1] = t;
        else pending.push([lastT, t]);
        playedMs += Math.min(now - lastPerf, 3000);
      }
    }
    lastT = t;
    lastPerf = now;
  }

  // `ended` tells the worker the lecture reached its real end, which is what finishes it.
  function flush(ended = false) {
    if (!target || !video) return;
    const ad = adShowing();
    const dur = ad ? NaN : video.duration;
    if (!ended && !pending.length && playedMs < 1 && durationSent) return;
    const msg = {
      type: 'video:progress',
      videoId,
      intervals: pending,
      playedMs: Math.round(playedMs),
      currentTime: ad ? undefined : video.currentTime,
      duration: Number.isFinite(dur) && dur > 0 ? dur : undefined,
      ended: ended && !ad,
    };
    if (msg.duration) durationSent = true;
    pending = [];
    playedMs = 0;
    sendMsg(msg);
  }

  function tryResume() {
    if (!target || resumed || !video || adShowing() || video.readyState < 1) return;
    resumed = true;
    const dur = Number.isFinite(video.duration) ? video.duration : Infinity;
    if (resumeAt > 5 && video.currentTime + 5 < resumeAt && resumeAt < dur - 5) video.currentTime = resumeAt - 2;
  }

  // ---- lecture cinema: the player fills the window, the rabbit holes are hidden ----------------

  const CINEMA_CSS = `
    html.zanshin-cinema, html.zanshin-cinema body { overflow: hidden !important; background: #000 !important; }
    html.zanshin-cinema #masthead-container, html.zanshin-cinema #secondary, html.zanshin-cinema #below,
    html.zanshin-cinema #comments, html.zanshin-cinema #related, html.zanshin-cinema #chat,
    html.zanshin-cinema tp-yt-app-drawer, html.zanshin-cinema ytd-mini-guide-renderer,
    html.zanshin-cinema ytd-popup-container, html.zanshin-cinema #guide { display: none !important; }
    html.zanshin-cinema .ytp-ce-element, html.zanshin-cinema .ytp-endscreen-content,
    html.zanshin-cinema .ytp-autonav-endscreen-countdown-overlay, html.zanshin-cinema .ytp-suggested-action,
    html.zanshin-cinema .ytp-pause-overlay, html.zanshin-cinema .ytp-videowall-still,
    html.zanshin-cinema .ytp-cards-teaser, html.zanshin-cinema .ytp-cards-button,
    html.zanshin-cinema .iv-branding, html.zanshin-cinema .ytp-chrome-top-buttons { display: none !important; }
    html.zanshin-cinema #movie_player {
      position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important;
      z-index: 9000 !important; background: #000 !important;
    }
    html.zanshin-cinema #movie_player .html5-video-container,
    html.zanshin-cinema #movie_player video.html5-main-video {
      width: 100vw !important; height: 100vh !important; left: 0 !important; top: 0 !important;
      object-fit: contain !important;
    }
    html.zanshin-cinema #movie_player .ytp-chrome-bottom { width: calc(100vw - 24px) !important; left: 12px !important; }
    html.zanshin-cinema #movie_player .ytp-progress-bar-container,
    html.zanshin-cinema #movie_player .ytp-chapters-container { width: 100% !important; }
  `;

  function applyCinema(on) {
    if (on === cinema) return;
    cinema = on;
    const root = document.documentElement;
    if (on) {
      if (!document.getElementById('zanshin-cinema-style')) {
        const style = document.createElement('style');
        style.id = 'zanshin-cinema-style';
        style.textContent = CINEMA_CSS;
        root.append(style);
      }
      root.classList.add('zanshin-cinema');
      showHint();
    } else {
      root.classList.remove('zanshin-cinema');
    }
    window.dispatchEvent(new Event('resize'));
  }

  function showHint() {
    const el = document.createElement('div');
    el.textContent = 'Zanshin: lecture locked. Alt+Shift+Z opens the controls.';
    Object.assign(el.style, {
      position: 'fixed',
      top: '18px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '2147483647',
      background: 'rgba(13,15,19,0.9)',
      color: '#e8eaef',
      font: '13px/1.4 "Segoe UI", system-ui, sans-serif',
      padding: '8px 14px',
      borderRadius: '8px',
      border: '1px solid #343a46',
      pointerEvents: 'none',
      transition: 'opacity .6s',
    });
    document.documentElement.append(el);
    setTimeout(() => (el.style.opacity = '0'), 5000);
    setTimeout(() => el.remove(), 6000);
  }

  function disableAutoplay() {
    const toggle = document.querySelector('.ytp-autonav-toggle-button[aria-checked="true"]');
    if (toggle) toggle.click();
  }

  // ---- wiring ---------------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'video:pause' && video && !video.paused) video.pause();
  });

  if (isTop) {
    document.addEventListener('yt-navigate-finish', () => {
      sendMsg({ type: 'nav:check', url: location.href });
      durationSent = false;
      hello();
    });
  }

  setInterval(() => {
    if (!runtimeOk()) return;
    const v = findVideo();
    if (v) attach(v);
    if (target) {
      tryResume();
      if (cinema) disableAutoplay();
    } else if (v && Date.now() - lastHello > REHELLO_MS) hello();
  }, 1000);

  setInterval(() => target && flush(), REPORT_MS);

  hello();
})();
