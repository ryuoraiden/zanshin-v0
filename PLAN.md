# Zanshin 残心

A Chrome extension that holds you on one task until it is actually done. Finishing the task unlocks the next one. A timer running out doesn't.

In karate, zanshin is the awareness you keep after the technique lands. Here that is the last step of every session: a short written recall before the task counts as done.

## Ground rules

- **Completion unlocks, not the clock.** Every task type has a real completion condition.
- **Friction and a record, not a prison.** Every lock has a logged way out. If anything breaks, Zanshin fails open (all blocking removed), never closed.
- **No passive tracking.** Web Activity Time Tracker and ActivityWatch already do that. Zanshin only tracks sessions, and later reads ActivityWatch's local API instead of rebuilding tracking.
- **Features are earned by usage.** v0 is frozen until 20 real sessions are logged.

## Releases

| Version | When | Who writes it | Gate |
|---|---|---|---|
| v0 | Sat Oct 17, 2.5 h hard box | Claude Code, tool mode. You don't need to read it | none |
| v0.2 | After SC BPT1 (Oct 23), one sitting of 2 h max | Claude Code | 20 real sessions + review, at most 3 roadmap items |
| v1 | December | You, from a blank folder. Claude guides and reviews only (SkyScore mode) | v0 in daily use. v0's tests are v1's acceptance spec |

v0 stays local (git, no remote, not on the resume). v1 is the public repo `ryuoraiden/zanshin` and the one you claim. Its README says plainly that v0 was an agent-built prototype and v1 is hand-written.

---

## v0 spec

### Stack and layout

Manifest V3, plain JavaScript (ES modules), HTML, CSS. No frameworks, no npm installs, no build step. Load unpacked.

Pure logic lives in `lib/` with no `chrome.*` calls, so it runs under `node --test` (Node's built-in runner). `package.json` contains only `{"type": "module"}`.

```
Zanshin/
  manifest.json
  background.js          service worker: wires chrome events to lib/, keeps nothing important in memory
  lib/
    state.js             session state machine (pure)
    credit.js            time credit, watched-interval merging and coverage (pure)
    rules.js             builds declarativeNetRequest rules from state (pure)
    queue.js             task ordering (pure)
    codeforces.js        submission matching (pure) + fetch wrapper
    store.js             chrome.storage.local wrapper, schema version
  content/youtube.js     video tracking, cinema CSS, Shorts catch
  pages/
    popup.html/.js       current session, start next task, pause, request/confirm exit
    dashboard.html/.js   task list (add/edit/delete/pin), today, last 7 days
    blocked.html/.js     shown instead of off-task sites
    recall.html/.js      completion note screen
    options.html/.js     settings and first-run setup
  styles.css             one dark theme shared by every page
  tests/*.test.js
  IDEAS.md               parking lot. Ideas go here, not into code
```

### Data model (chrome.storage.local)

- **Task**: `id, title, category (IITM | DSA | NITC | Cyber), type (video | codeforces | manual), url, cfProblem ("580A"), estimateMin, deadline, hardDeadline, pinned, extraDomains[], status (todo | done), createdAt, doneAt, note`
- **Session**: `id, taskId, startedAt, endedAt, outcome (completed | abandoned | expired), creditedSec, watchedIntervals [[start, end], ...], lastPosition, pauses[], overrides[], events[]` (events = blocked hits, tamper, gaps)
- **Settings**: `cfHandle, quotaMin (300), rewardMin (90), rewardDomains[], categoryDomains{}, alwaysAllowed[], discordWebhook, pauseOnBlur (true), hardCapMin (240), dayStartsAt ("04:00"), setupLocked`
- **Runtime**: `activeSession | null, exitRequestedAt, rewardWindowUntil, rewardUsedOn, lastHeartbeat, pendingSettings`

Storage is the only source of truth. The service worker recomputes everything when it wakes. No `setInterval` in the worker; anything periodic uses `chrome.alarms`.

### Task types and completion

| Type | Completes when | Credit counts |
|---|---|---|
| video | Watched coverage reaches 90% of the duration, measured as merged intervals of video that actually played (dragging to the end does nothing). Then the recall note | Real seconds while the video plays and the study window is focused. 2× speed is allowed, but credit is wall time, so it doesn't count double |
| codeforces | `user.status` shows verdict `OK` for that problem with `creationTimeSeconds` after the session started (an old AC never auto-completes). Then a one-line note | Wall time minus pauses. Window focus is ignored because you code in Cursor |
| manual | You press Done and write what you finished (min 20 chars) | Wall time minus pauses |

- Video recall prompt: "What would you tell a friend about this lecture?", min 150 chars.
- Codeforces note prompt: "Key idea, or what tripped you up." Over time this becomes a personal problem log.
- Notes are stored on the task and shown on the dashboard.
- Codeforces polling: an alarm every 60 s while a codeforces session is active, `https://codeforces.com/api/user.status?handle=H&from=1&count=20`. Failures are retried silently and never block anything.

### Session lifecycle

```
idle --start--> active --condition met--> recall --note saved--> completed
                  |
                  |-- pause / resume (credit only, enforcement stays on)
                  |
                  |-- request exit --> exitPending (60 s) --confirm--> abandoned
                  |                       '-- cancel, or 5 min unconfirmed --> active
                  |
                  '-- hard cap (4 h) --> expired
```

- One active session at a time.
- The exit request is stored state, not UI state. Closing the popup doesn't reset the countdown, and Confirm works from the popup or the dashboard once 60 s have passed.
- A pause over 15 min sends a notification. Nothing auto-abandons.
- A heartbeat alarm writes `lastHeartbeat` every minute. On wake, a gap over 3 min during an active session is logged as a gap event (Chrome closed or Zanshin disabled) and is not credited.

### Enforcement

**Every session: allowlist via `declarativeNetRequest` dynamic rules.**

- A low-priority rule redirects every `main_frame` request to `pages/blocked.html#<original url>`.
- Higher-priority allow rules cover the task URL's domain, the category's domains, the task's extra domains, `alwaysAllowed` (`accounts.google.com`, so logins keep working) and domains allowed during this session.
- `blocked.html` shows the task and credited time, plus an "Allow this domain for this session" button that becomes clickable after 10 s. Each override is logged on the session.
- One `syncRules()` rebuilds the rules from stored state on worker start, browser start and every state change. If building or applying rules throws, remove every Zanshin rule (fail open) and log it.
- Local `file://` PDFs are untouched, so NITC notes open fine.

Default category domains (editable in options):

| Category | Allowed |
|---|---|
| IITM | seek.onlinedegree.iitm.ac.in, discourse.onlinedegree.iitm.ac.in (a video task's own domain is always added) |
| DSA | codeforces.com, leetcode.com, takeuforward.org, cppreference.com. No AI chat sites, matching your AI-free CP rule |
| NITC | fill in your course sites at setup |
| Cyber | pwn.college, picoctf.org, tryhackme.com |

**Video tasks also get the lecture lock.**

- The URL opens in a new window from `chrome.windows.create({ type: "popup", state: "fullscreen" })`. Popup windows have no tab strip and no editable address bar.
- The content script strips the YouTube watch page down to the player filling the window: sidebar, comments, end-screen cards and autoplay-next are hidden or disabled. On `*/embed/*` frames inside the IITM portal it only tracks.
- If the window leaves fullscreen (F11), Zanshin re-applies it. If another Chrome window takes focus, it refocuses the study window. Both are debounced (500 ms) and capped at 5 re-applies per minute so Zanshin never fights Chrome in a loop. Past the cap it logs and backs off for that minute.
- New tabs or windows opened during a video session are closed.
- When the study window loses focus to another app (Alt+Tab), the video pauses (`pauseOnBlur`, on by default). No half-listening while doing something else.
- After a browser restart, Zanshin recreates the study window and seeks to `lastPosition`.
- At 90% coverage the study tab navigates to `recall.html`. Saving the note completes the task, removes the rules and closes the window.

**Logged, never blocked:** opening `chrome://extensions` mid-session counts as tamper (posted to Discord if a webhook is set). Blocking it would turn a bug into a trap. Incognito is a hole unless "Allow in Incognito" is switched on for Zanshin.

### Quota gate (the Netflix fix)

- `rewardDomains` (default: netflix.com, primevideo.com, hotstar.com, instagram.com, reddit.com, x.com, youtube.com/shorts) stay blocked all day, in or out of a session, through a separate rule set.
- YouTube Shorts are mostly reached by in-page navigation, which `declarativeNetRequest` never sees. The content script watches YouTube's own navigation events and sends `/shorts/` to the blocked page.
- When today's credited minutes reach `quotaMin` (default 300), a "Cash in" button appears. It unblocks reward domains for `rewardMin` (default 90, about two episodes of The Mentalist), once per day.
- The day runs 04:00 to 04:00, so late-night sessions count toward the day you're still living in.
- **Setup mode:** until you press "Lock settings" at the end of first-run setup, every setting applies immediately and cash-ins don't count. After that, loosening changes (lower quota, longer reward, removing a reward domain) wait until the next day. Tightening applies immediately. No lowering the bar at 9 pm.

### Popup and dashboard

- **Popup:** the active session (task, credited time, coverage % for video, pause, request or confirm exit), or the top of the queue with Start. Quota bar underneath.
- **Dashboard:** the task list. Queue order is pinned first, then hard deadlines within 3 days, then deadline ascending, then undated tasks by creation time. Today: credited minutes per category, completed tasks with notes, abandoned sessions, overrides used. Last 7 days: a small table with CSS bars. Deadlines in the next 7 days.

### Discord (optional)

With a webhook URL set, Zanshin posts one plain line on completion ("Done: MLT W3 L2, 38 min"), on abandonment ("Abandoned: CO pipelining after 12 min"), and on tamper and gap events. Post failures are ignored.

### Safety guarantees

- Disabling Zanshin in `chrome://extensions` ends all blocking, always.
- Any exception in the enforcement path removes all rules.
- The 4 h hard cap ends any session.
- The emergency exit depends on neither the network nor content scripts.
- Tests prove every state has a path back to idle.

### Permissions

`storage`, `alarms`, `tabs`, `declarativeNetRequest`, `notifications`, host access `<all_urls>`. The broad host access is what lets the redirect show the blocked page and lets the content script run inside IITM portal frames. Fine for a personal unpacked extension. Revisit if v1 goes to the Web Store.

### Tests (`node --test`)

- State transitions, including every path back to idle
- Exit timing: not at 59 s, yes at 60 s, expires unconfirmed at 5 min
- Hard cap
- Credit with pauses and heartbeat gaps
- Interval merging, including the drag-to-end case
- Codeforces matching: old AC ignored, wrong problem ignored, new AC matches
- Rule builder: allowlist, overrides, reward window, no session means no allowlist rules
- 04:00 day boundary, settings loosening deferred to the next day
- Queue order

### Build order

Each milestone is usable on its own. If the time box ends partway, whatever is done ships.

- **M1, core:** storage, dashboard task CRUD, manual sessions, allowlist + blocked page + overrides, credit with pause, Done with note, emergency exit, hard cap, fail-open sync, quota gate with setup mode and cash-in, tests.
- **M2, lecture lock:** video type, fullscreen popup window, cinema CSS, coverage, pause on blur, recall screen, restart restore, Shorts catch.
- **M3:** Codeforces type, 7-day view, Discord webhook, heartbeat gap detection.

### Acceptance checklist (you, about 30 min)

1. Manual DSA task: reddit.com shows the blocked page, codeforces.com loads.
2. "Allow for this session" stays disabled for 10 s, then works, and the override shows on the dashboard.
3. Request exit, wait 60 s, confirm: blocking is gone and the session shows as abandoned.
4. Stop the service worker from `chrome://extensions` mid-session: timer and blocking are still correct afterwards.
5. Quit and reopen Chrome mid-session: the session and its blocking come back.
6. Video task: drag the slider to the end. It does not complete.
7. Same video at 2×: completes at 90%, recall appears, the note saves, the window closes.
8. F11 during a lecture: fullscreen comes back. Alt+Tab to another app: the video pauses.
9. Codeforces task on a problem you already solved: no instant completion. A fresh AC completes within about a minute.
10. In setup mode with quota 1 min and reward 1 min: netflix.com blocked, do a 1-min session, cash in, netflix.com opens, then blocks again after a minute. Set the real numbers and press Lock settings.
11. Disable Zanshin mid-session: everything unblocks. Re-enable: the gap is logged.

---

## Usage rules

- No feature work until 20 real sessions are logged. A bug that stops you using it gets one fix sitting per day, 30 min max. Everything else goes in `IDEAS.md`.
- Every study block from Sunday to Tuesday runs as a Zanshin session.
- **20-session review** (expected around Tue Oct 20), 20 minutes with the dashboard: abandon rate, overrides used and why, which escape hatches you reached for, which features never fired. Pick at most 3 roadmap items for v0.2.
- Outside the extension, for these four days: sign out of (or uninstall) the Netflix Windows app and sign out of Netflix in Edge, so Chrome and its quota gate are the only way in. Switch on "Allow in Incognito" for Zanshin.

## Roadmap candidates

Ranked by how much each would help you.

1. **ActivityWatch bridge.** During a session, read the active window and AFK state from aw-server (`http://localhost:5600/api/0/`). Off-task apps (Netflix app, games, Discord) get logged and stop credit, and AFK time stops counting on wall-time tasks. This closes the biggest hole any Chrome extension has. Spike it first (15 min) to confirm the service worker can reach aw-server.
2. **NITC quiz gate.** NotebookLM generates questions grounded in your own NITC notes and PDFs, which is the hard part. Zanshin hands you a fixed prompt that makes NotebookLM answer in JSON, you paste it in, and passing the quiz becomes the completion condition. NotebookLM has no API for personal accounts, so paste-in is the honest integration. Include written-answer questions for Maths 3 and CO, self-marked against the key.
3. **Mission checklists.** One task with several conditions, e.g. "MLT Week 3" = coverage on L1 to L5 + GA submitted.
4. **LeetCode auto-complete** through the public GraphQL `recentAcSubmissionList`. Unofficial and can break, so manual Done stays as the fallback.
5. **Belt ranks.** Kyu to dan, earned from completed sessions weighted by type, with abandonments costing progress. Promotions post to your Discord channel. Fits the name and your karate.
6. **Recall grading** with the Gemini API (you already have keys from TMG): grade the recall note against the lecture transcript.
7. **Queue scoring.** Deadline proximity × hard/soft × estimate, so mandatory-and-due-tomorrow always outranks a fun Codeforces problem.
8. **Weekly boss.** The most overdue hard-deadline task gets a pinned slot and double belt progress.

Skip unless a stable signal turns up: TUF+ and pwn.college auto-detection. Reverse-engineering private APIs for a personal tracker isn't worth the time. Friend leaderboards need a backend, so not before v1.

## v1 (December): the build you claim

- New folder, public repo `ryuoraiden/zanshin`. You write every line. Claude explains, reviews and critiques, the same mode as SkyScore.
- Start by porting v0's `tests/` and making them pass one module at a time, so you begin from a working spec instead of a blank page.
- Plain JS again. If you want MAD2's Vue on the dashboard, that means adding Vite, because the MV3 content security policy blocks Vue's in-browser template compiler.
- Bring across only the v0.2 features that survived real use.

## Fill in at first run

Codeforces handle, NITC course domains, quota and reward numbers, Discord webhook (optional).
