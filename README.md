# Zanshin 残心

A Chrome extension that holds you on one task until it's actually done. Finishing the task unlocks the next one. A timer running out doesn't.

v0: an agent-built tool, not the hand-written v1. See [PLAN.md](PLAN.md) for the full spec and roadmap.

## Install (2 minutes)

1. Open `chrome://extensions` and switch on **Developer mode** (top right).
2. **Load unpacked** and pick this folder (`D:\Projects\Zanshin`).
3. On the Zanshin card: **Details**, then switch on **Allow in Incognito**. Without this, incognito is a free escape.
4. Pin the ensō icon to the toolbar.
5. The Options page opens by itself. You start in **setup mode**: settings apply instantly and cash-ins don't count. Set your Codeforces handle and NITC course sites, run the checklist below, then press **Lock settings**.

After editing any file, hit the reload arrow on the Zanshin card in `chrome://extensions`.

## How it works

| Task type | Completes when | Credit counts |
|---|---|---|
| Lecture (video) | 90% of the video has actually played (skipping ahead and ads don't count), then a 150-char recall note | Real seconds while it plays and its window is focused |
| Codeforces | An accepted submission for that problem, made after you pressed Start (checked every minute), then a one-line note | Wall time minus pauses |
| Manual | You press Done and write what you finished | Wall time minus pauses |

- **During any session** every site outside the task's allowlist goes to a blocked page. "Allow for this session" unlocks after 10 s and is logged. Tabs already open on blocked sites get swept too, except tabs playing audio.
- **Lectures** open in a fullscreen popup window with no tabs and no address bar. YouTube is stripped down to the player. F11 gets undone, new tabs get closed, focus bounces back, and the video pauses when you Alt+Tab.
- **Reward sites** (Netflix, Instagram, Reddit, X, Shorts...) stay blocked until you've done your daily quota of focused minutes. Then you can cash in one reward window per day. The day runs 04:00 to 04:00.
- <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> opens the dashboard from anywhere, including a locked lecture.

### Ways out (on purpose)

- **Emergency exit**: request it, wait 60 s, confirm. Logged as abandoned.
- **Hard cap**: any session ends on its own after 4 h.
- **Disabling the extension** always removes all blocking. It shows up as a gap when it comes back.
- `chrome://extensions` is never blocked, only logged as tamper.
- If anything in the blocking code throws, all rules are removed (fails open).

## Acceptance checklist (about 30 min)

Do these in setup mode, before locking settings.

1. Add a manual DSA task. Start it. reddit.com and wikipedia.org show the blocked page, codeforces.com loads.
2. On the wikipedia blocked page, "Allow for this session" stays disabled for 10 s, then works. The override shows on the dashboard.
3. Emergency exit: request, wait 60 s, confirm. Blocking is gone and the session shows as abandoned.
4. Start a session, open `chrome://serviceworker-internals`, find Zanshin and press **Stop**. Timer and blocking are still right afterwards.
5. Start a session, quit Chrome completely, reopen it. The session and its blocking come back.
6. Add a lecture task with a short YouTube video. Start it. Drag the slider to the end: it does **not** complete.
7. Same video, play it at 2x from the start: it completes at 90%, the recall note appears in the same window, saving it closes the window.
8. During a lecture: F11 comes back to fullscreen. Ctrl+T gets closed. Alt+Tab to another app pauses the video. <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> opens the dashboard.
9. Codeforces task on a problem you already solved: no instant completion. A fresh AC completes within about a minute.
10. Options: quota 1 min, reward 1 min, save. netflix.com is blocked. Do a 1-minute session, cash in, netflix.com opens, then blocks again a minute later. Set the real numbers (300 and 90) and press **Lock settings**.
11. Disable Zanshin mid-session: everything unblocks. Re-enable: the gap is logged on the session.

If a check fails, note which one and what happened. Fixing it is the only dev work allowed before 20 real sessions.

## Rules for using it

- No new features until 20 real sessions are logged. Ideas go in [IDEAS.md](IDEAS.md).
- A bug that stops you using it: one fix sitting per day, 30 min max.
- Outside the extension: sign out of the Netflix Windows app and of Netflix in Edge, so Chrome (and the quota) is the only way in.

## Development

Plain JavaScript, no build step, no dependencies.

```
background.js        service worker: chrome events -> lib/ reducers -> effects
lib/                 pure logic, no chrome.* calls (state machine, rules, credit, queue, settings)
content/youtube.js   playback coverage, cinema mode, in-page navigation checks
pages/               popup, dashboard, blocked, recall, options
tests/               node --test, covers lib/
tools/               icon generator and a dev-only preview harness
```

```bash
npm test
```

The preview harness renders the pages in a normal tab against a fake `chrome.*` API with demo data:

```bash
node tools/preview-server.mjs
```

Then open http://localhost:5178.
