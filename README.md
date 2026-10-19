# Zanshin 残心

A Chrome extension that holds you on one task until it's actually done. Finishing the task unlocks the next one. A timer running out doesn't.
In karate, zanshin is the awareness you keep after the technique lands. Here that is the last step of every session: a short written recall before the task counts as done.

v0: an agent-built tool, not the hand-written v1. See [PLAN.md](PLAN.md) for the full spec and roadmap.

## Install (2 minutes)

1. Open `chrome://extensions` and switch on **Developer mode** (top right).
2. **Load unpacked** and pick this folder (`D:\Projects\Zanshin`).
3. On the Zanshin card: **Details**, then switch on **Allow in Incognito**. Without this, incognito is a free escape.
4. Pin the 残 icon to the toolbar.
5. The Options page opens by itself. You start in **setup mode**: settings apply instantly and cash-ins don't count. Set your Codeforces handle and NITC course sites, run the checklist below, then press **Lock settings**.

After editing any file, hit the reload arrow on the Zanshin card in `chrome://extensions`.

## How it works

| Task type       | Completes when                                                                                                     | Credit counts                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Lecture (video) | At least 90% has actually played (skipping ahead and ads don't count) and the video reaches its end, or you press Done after 90%. Then a 150-char recall note | Real seconds while it plays and its window is focused |
| Codeforces      | An accepted submission for that problem, made after you pressed Start (checked every minute), then a one-line note | Wall time minus pauses                                |
| Manual          | You press Done and write what you finished                                                                         | Wall time minus pauses                                |

- **During any session** every site outside the task's allowlist goes to a blocked page. "Allow for this session" unlocks after 10 s and is logged. Tabs already open on blocked sites get swept too, except tabs playing audio. When the session ends they go back to their sites on their own; YouTube tabs come back paused.
- **Lectures** open in a fullscreen popup window with no tabs and no address bar. YouTube is stripped down to the player. F11 gets undone, new tabs get closed, focus bounces back, and the video pauses when you Alt+Tab. Other task types don't open anything on Start; press **Open task** when you want the link.
- **Reward sites** (Netflix, Instagram, Reddit, X, Shorts...) stay blocked until you've done your daily quota of focused minutes. Then you can cash in one reward window per day. The day runs 04:00 to 04:00.
- <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> opens the dashboard from anywhere, including a locked lecture.

### Ways out (on purpose)

- **Emergency exit**: request it, wait 60 s, confirm. Logged as abandoned.
- **Hard cap**: any session ends on its own after 4 h.
- **Disabling the extension** always removes all blocking. It shows up as a gap when it comes back.
- `chrome://extensions` is never blocked, only logged as tamper.
- If anything in the blocking code throws, all rules are removed (fails open).

## Adding tasks in bulk

Every import opens the same **残 Add to Zanshin** picker: tick what you want, check the group, press Add. Nothing is added until you press it. Anything already in Zanshin (done tasks and items waiting in a series included) shows as **in Zanshin** and is skipped, whichever link it was added with.

### Groups and series

- **Groups.** Every task can belong to a group ("MAD2 Week 3", "A2Z: Binary Search", "CP-31 1200"). In the dashboard queue a group is one collapsible block, sitting where its most urgent task would. Its header shows open and done counts, the nearest deadline and a **Start next** button. Click the header to collapse or expand it; Zanshin remembers which are collapsed. Imports name the group for you, and the add form has a Group field with your existing groups as suggestions.
- **Series.** Tick **Feed N at a time** in any picker (or the paste box) and the picked items become a series. The queue only ever holds N of them, and finishing or deleting one lets the next in, so a 32-problem step never buries your deadlines. Series tasks have no deadline, so graded work stays above them. The group header shows progress ("4 of 32 done, 25 waiting") with **− / +** for the batch size (1 to 10), **Pause** and **Stop**. Stopping keeps whatever is already in the queue.

### Seek (IITM BS)

On any course page at `seek.onlinedegree.iitm.ac.in`, click **Add to Zanshin** (bottom right) and pick a week. It defaults to the week whose graded work is due next.
- **Lectures and screencasts** link straight to YouTube, so the lecture lock and cinema mode work. They take the week's graded deadline as a soft deadline.
- **Graded work** links to its Seek page, with its real due date as a hard deadline.
- **Practice and activity questions** are listed but unticked.
- **The group** is the course prefix plus the week ("MAD2 Week 3"). The prefix is worked out from the course name and remembered once you change it.

Zanshin reads the outline Seek's own page loads; it never calls Seek's API or touches your login. If the panel says it's waiting, reload the Seek page.

### TUF+ sheets (A2Z and the other prep-hub sheets)

On a sheet page, click **Add to Zanshin** and pick a step. Each step shows your progress, for example "Binary Search (0/32)", and it starts on the first one you haven't finished. Zanshin opens that step's sections on the page (the same as clicking them) and lists its problems with their sub-step and Basic/Core/Pro tag. Problems you've solved on TUF are unticked. It's a series by default, grouped as "A2Z: Binary Search", and the tasks link to TUF's practice page. TUF problems don't finish themselves; press Done.

### Add from this page (any site)

Open any sheet, list or playlist, click the Zanshin icon, then **Add from this page**. Zanshin reads that tab, and only that tab, only when you click. It picks out:

| Link | Becomes |
|---|---|
| Codeforces problem | Codeforces task: finishes itself on an accepted submission |
| LeetCode, TUF+ practice, GFG problem | Manual task |
| YouTube video | Lecture task (locked fullscreen) |
| pwn.college module or challenge | Manual task in Cyber |

- **Sections:** links are grouped by the page's headings (CP-31's rating sections, say), and each section can be picked on its own or all at once.
- **Codeforces:** problems your handle has already solved come unticked, using your submissions.
- **YouTube playlists:** every loaded video, with its length as the time estimate. Long playlists load in chunks, so scroll to the end first.
- **LeetCode:** on any leetcode.com page, today's daily problem is listed first.
- **The page itself:** on a single problem or video page, that page is the item.

Links without a usable title get one from the link itself (LeetCode slugs, Codeforces codes) or from YouTube for videos. Pick a category in the panel; it applies to everything you add.

### Paste box (dashboard)

For anything else, like the Codeforces POTD someone drops on Discord: paste links one per line in **Paste links** on the dashboard. A title before the link is kept (`POTD | https://codeforces.com/contest/2001/problem/C`), and a bare Codeforces code (`2001C`) works too. Lines without a link are ignored. The same link rules as above apply, YouTube titles are fetched for you, and you can set a group, a category, or make it a series.

## Acceptance checklist (about 30 min)

Do these in setup mode, before locking settings.

1. Add a manual DSA task. Start it. reddit.com and wikipedia.org show the blocked page, codeforces.com loads.
2. On the wikipedia blocked page, "Allow for this session" stays disabled for 10 s, then works. The override shows on the dashboard.
3. Emergency exit: request, wait 60 s, confirm. Blocking is gone and the session shows as abandoned.
4. Start a session, open `chrome://serviceworker-internals`, find Zanshin and press **Stop**. Timer and blocking are still right afterwards.
5. Start a session, quit Chrome completely, reopen it. The session and its blocking come back.
6. Add a lecture task with a short YouTube video. Start it. Drag the slider to the end: it does **not** complete.
7. Same video, play it at 2x from the start: past 90% it keeps playing, and the recall note appears in the same window when the video ends. Saving it closes the window.
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
lib/                 pure logic, no chrome.* calls (state machine, rules, credit, queue, settings,
                     links, series, groups, seek)
content/youtube.js   playback coverage, cinema mode, in-page navigation checks, no autoplay in hidden tabs
content/picker.js    the shared "Add to Zanshin" panel (shadow root), used by every import
content/seek*.js     Seek course pages (capture runs in the page, the picker in a shadow root)
content/tuf.js       TUF+ sheet pages
content/scan.js      "Add from this page", injected only when you click it
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

Then open http://localhost:5178. Mock pages for the importers:
- Seek course: http://localhost:5178/courses/ns_26t3_cs2006
- TUF+ sheet (same structure as the live one): http://localhost:5178/tools/tuf-mock.html
- A CP-31-style sheet for "Add from this page": http://localhost:5178/tools/scan-mock.html
