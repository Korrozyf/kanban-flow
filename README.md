# Kanban Flow — Kanban facilitator dashboard (JIRA Cloud)

Browser extension (Chrome + Firefox) that connects to **JIRA Cloud** and displays,
team by team, the Kanban flow metrics useful for a Kanban facilitator: **throughput**,
**lead time**, **cycle time**, and their **trends**.

## About this project

Kanban Flow is built and maintained by a Kanban facilitator, not a professional
software developer. The code is written with the help of an AI coding agent, then
reviewed and tested by the maintainer against real team needs. Expect pragmatic,
purpose-built code rather than production-grade engineering: read it, question it, and
open an issue if something looks wrong.

## Features

- **Two Kanban types per team**: each project is configured in **Build** mode
  (flow: committed / delivered throughput, lead & cycle time, added to board / moved
  back to backlog) or **Run** mode (support: open, closed, created tickets, average
  resolution time, unassigned / highest-priority lists). See the "Run mode" section
  below.
- **Team / project selection** via a dropdown menu (multi-team).
- **Start date** configurable (build and run): the analysis window is the week
  containing that date **plus the 4 weeks that follow** (5 weeks in total), stopping
  at the **current week** when it falls inside that period.
  - Window reaching today → the last week displayed is the current (incomplete) week.
  - Window entirely in the past → the 5 weeks are displayed, none is flagged
    "current", and the **last week of the window** is the reference week for the
    key figures and the trends (a banner says so explicitly).
  - Future date → error message, no display.
  - Date = current week → no comparison (no previous week).
  - Empty date → the last 5 weeks up to today.
- **Delivered throughput** for the current week (Monday → Sunday) plus previous weeks
  (bars). The **current (incomplete) week** is shown in **yellow** to clearly
  distinguish it from completed weeks.
- **Committed throughput**: number of tickets present in a **board status during the
  "committed" counting window** (default Monday 00:00→12:00, **configurable**) — this
  is a snapshot on that window, not a count of transitions. It is shown **on the same
  chart as delivered throughput** (grouped bars: committed in purple, delivered in
  blue) + card + trend.
- **Current-week color code**: in the **charts** (bars, lines) and the flow signals
  table, current-week data uses **warm** tones — delivered in **yellow**, committed in
  **amber**, dashed yellow lines — while **completed weeks** stay **blue / purple**. On
  the top-of-page **cards** (**build and run**), the figure stays in the normal text
  color (yellow is reserved for alerts): current-week status is conveyed by the
  "current" badge and the card border.
  The warm encoding is applied **only to a week that really is the current week**.
  When the window is entirely in the past, **no** week is painted with it: the
  reference week (last week of the window) keeps the completed-week colors, its
  badges show the week date instead of "current", the current-week chart legends
  disappear, and every label states the week date rather than "current week".
- **Story points (per-team option)**: if the *"Track story points"* option is enabled
  for a build team, the dashboard adds a **card** "Delivered story points" (current
  week), a **weekly chart** below the throughput, and a **"Story points" column** in
  the completed tickets list (before lead / cycle time). The corresponding JIRA field
  is auto-detected, or can be forced in settings.
- **Chart layout (build)**: the throughput chart spans the full width; lead time and
  cycle time sit side by side below it.
- **List of tickets completed this week**: the *Cycle (d)* column has a **colored dot +
  tooltip** — green ≤ 2 days, amber 2–4 days, red > 4 days.
- **Weekly flow signals**: number of tickets **added to board** (entering a board
  status **from any other status**) and tickets **moved back to backlog**, counted
  during the **"additions / removals" counting window** (default Monday 12:00 → end of
  Friday, **configurable**), with a ⚠ alert when there are any. The current week is
  highlighted (yellow row) and a summary shows whether there were additions / removals
  and how many.
- **Configurable counting windows** (global setting): day and hours of the "committed"
  window and the "additions / removals" window. Labels shown in the dashboard follow
  the chosen values automatically.
- **Trends = current week compared to previous week** (top-of-page cards, both build
  and run).
- **Export / import of settings** as JSON (API token excluded by default) so you don't
  have to re-enter everything after a reinstall — see "Updating the extension".
- **Export the dashboard as an image** (PNG or JPG): `🖼 Export image` button in the top
  bar. The capture covers the **entire metrics page** (not just the visible area),
  with ticket lists **expanded**, and a header showing team / mode / period /
  generation date. ×2 resolution (readable in a meeting or report). The file is saved
  to the browser's download folder as `kanban-flow_<team>_<date>_<time>.png|jpg`.
- **Lead time** per week and **cycle time** per week (lines, median or average).
- **Trends** (up / stable / down) for each metric, color-coded: green = improvement,
  red = degradation, blue = stable.
- **Per-team configurable statuses**: you define precisely which JIRA statuses mark the
  *start of work* (cycle time) and the *end* (throughput / lead / cycle).
- Collapsible list of tickets completed **in the current week** + the JQL used
  (calculation transparency).
- 100% local: credentials and token stored in the browser, no third-party server.

## Metric definitions

For each ticket completed in the analyzed window:

| Metric | Calculation |
|--------------|--------|
| **Delivered throughput** | Number of tickets entering a "Done" status during the week (Mon→Sun). |
| **Committed throughput** | Number of tickets **in a board status during the "committed" counting window** (default Monday 00:00→12:00, configurable) — a snapshot reconstructed from history (the ticket counts if it was on the board at any point during that window), not a count of transitions. Shown on the same chart as delivered. |
| **Added to board** | Number of tickets **placed in a board status** (from any other status) during the **"additions / removals" counting window** (default Monday 12:00 → end of Friday, configurable) of the same week (scope added mid-week). |
| **Moved back to backlog** | Number of tickets **placed in a "Backlog" / "To do" status** (from any other status) during the same **"additions / removals" counting window** (default Monday 12:00 → end of Friday, configurable). |
| **Delivered story points** | Sum of story points of tickets **completed during the week** (per-team option to enable). Unestimated tickets excluded from the sum. |
| **Lead time**  | `end date − creation date` (days). |
| **Cycle time** | `end date − 1st entry into an "In progress" status` (days). |

- **End date** = last transition into one of your "Done" statuses.
- **Start date** = first transition into one of your "In progress" statuses
  (if none, cycle time is approximated on the creation date — flagged with `*`).
- **Bounded to the start date**: if the creation date (lead time) or the first entry
  into "in progress" (cycle time) is **earlier than the configured start date**, that
  start date is used instead. Time elapsed before the start date is therefore never
  counted.
- Weekly aggregation is the **median** by default (more robust to outliers),
  configurable to average.
- **Trend** = comparison of the current week to the previous week; below the
  "stable" threshold (10% by default), the trend is considered stable.

## Run mode (support / run Kanban)

For a project configured in **Run mode**, the analysis is not delivery flow but the
management of a support ticket flow. Relevant tickets are identified by one or more
**labels** (configurable per team). Weeks run **Monday 00:00 to Sunday 23:59**; in
charts the current week uses warm tones. As in build mode, the top-of-page **cards**
show their figure in normal text color, with the "current" badge and card border
marking the current week. Metrics:

| Metric | Calculation |
|------------|--------|
| **Open tickets** | Number of tickets whose **creation date** falls in the week under consideration (regardless of status) + two **lists**: "**open tickets on the board**" (non-backlog status) and "**unplanned open tickets (backlog)**" (status listed in the *run "Backlog" statuses*). Both lists share the same structure: JIRA link, priority, assignee, **age since created** and **since last activity** — flagged with a **colored dot** (green 0–1 d, amber 1–2 d, red > 2 d) with a tooltip. A **resolved** ticket or one in a configured **closing status** appears in neither list. The **KPI card** counts all open tickets (board + backlog). |
| **Closed tickets** *(mirrors the open-tickets stat)* | Number of tickets whose **closing date** (date of entry into the closing status read from the changelog, or resolution date) falls in the week under consideration + a **list** of tickets **closed during the current week** (JIRA link, creation date, closing date, and **created → closed** duration with the same color code). Shown **on the same chart** as open tickets (grouped bars). The top-of-page card counts closures **for the current week**, compared to the previous week's closures **over the same elapsed duration** (e.g. Tuesday 14:00 → from Monday 00:00 to Tuesday 14:00 of the previous week). |
| **Tickets created per day** | Chart of creations **per day of the week**: current week compared to the previous week. Working days (Mon→Fri) are always shown; **Saturday and Sunday appear only if they have at least one creation** (current or previous week). |
| **Created tickets** | Number of tickets **created during the current week**, compared to the previous week's creations over the **same elapsed duration** (e.g. Tuesday 14:00 → from Monday 00:00 to Tuesday 14:00 of the previous week). The note also shows the full previous week's total. |
| **Average resolution time** | Average of the `created → closed` delay for tickets **closed during the current week**. Colored dot using the same thresholds as the lists (green ≤ 1 d, amber ≤ 2 d, red > 2 d); trend compared to the previous week's average over the **same elapsed duration** (shorter = better). |
| **Unassigned** | **List** (current snapshot) of open tickets **with no assignee**, with a link to their JIRA page. |
| **Highest priority** | **List** (snapshot) of tickets whose priority is among the configured "highest" values, sorted by **priority descending then creation ascending**, with **creation date**, **created → first comment delay**, and **created → resolved delay**. Both delays use the same color code as the age counters (green dot ≤ 1 d, amber ≤ 2 d, red > 2 d). |

- "Highest" priorities are configurable per team (e.g. `Highest, Blocker`).
- **Closing statuses** (e.g. `Done, Closed, Resolved`) are configurable per team: a
  ticket in one of them is excluded from the metrics, like a resolved ticket.
- The **closing date** is read from the **changelog** (last entry into a closing
  status); failing that, the resolution date; as a last resort, "now", flagged with a
  `~` in the "Closed on" column. This is what makes it possible to correctly date a
  ticket closed without a resolution (e.g. `Cancelled`).
- The **run "Backlog" statuses** are also configurable: they distinguish **unplanned**
  open tickets from those **taken on the board**.
- Trends compare the **current week** to the **previous week** (top-of-page cards, both
  build and run). The run's "Open tickets" card compares the **current stock** to the
  stock still open **at the end of the previous week**.
- **No carry-over between weeks**: each weekly metric only counts items whose reference
  event (creation, closing, transition, ticket end) falls within the
  `[Monday 00:00, next Monday 00:00[` bounds of the relevant week.
- The first comment is read via `GET /rest/api/3/issue/{key}/comment` (sorted by date).

### Exclusivity of counts

General rule: **a ticket counted in one week (or day) cannot be counted elsewhere for
the same metric.** Each item is attached to **exactly one** week, the one containing
its *reference event*:

| Metric | Reference event |
| --- | --- |
| Delivered throughput, story points, lead time, cycle time | ticket **end** date |
| Additions to board, moves back to backlog | status **transition** date |
| Open tickets (per week, run) | **creation** date |
| Closed tickets, average resolution time (run) | **closing** date |
| Creations per day (run) | **creation** date, attached to a single day |

Bounds are **half-open**: `[Monday 00:00, next Monday 00:00[`. A ticket completed on
Monday at exactly 00:00 belongs to the week that **starts**, never the one that ends.
Weeks are contiguous: no gap, no overlap. Day splits and configurable windows are
computed in **calendar days**, not 24-hour slices: weeks with a daylight-saving time
change (167 h or 169 h) therefore cause neither double counting nor a lost hour.

Three metrics are **deliberately not** exclusive, because they measure a **stock** or
**transitions**, not a ticket flow:

- **Committed throughput** — a snapshot of the board at the Monday window. A ticket
  that stays on the board for three weeks is counted in all three weeks: that's the
  question being asked ("how many tickets were committed this Monday?").
- **Open tickets (top card, run)** — current stock of unresolved tickets, compared to
  the stock still open at the end of the previous week.
- **Additions to board / moves back to backlog** — these count *transitions*. A ticket
  that goes back and forth in the same week is counted on both sides: that's the churn
  signal being sought.

In addition, the **"same elapsed duration" comparison bases** (closed, created, average
resolution time) apply to the previous week truncated to the same elapsed duration, and
are not weekly metrics but reference points.

## Installation

Ready-to-install packages are published in the repository's
**[Releases](../../releases)**: `kanban-flow-<version>.zip` for Chrome/Edge,
`kanban-flow-<version>.xpi` for Firefox. Step-by-step user guide:
**[docs/INSTALLATION.md](docs/INSTALLATION.md)**.

### Chrome / Edge / Chromium
1. Unzip the `.zip` into a folder you keep (or clone the repository).
2. `chrome://extensions/`
3. Enable **Developer mode** (top right).
4. **Load unpacked** → select this folder.
5. Click the 📊 icon to open the dashboard.

### Firefox (121+)
1. `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** → select the folder's `manifest.json` file (or the
   `.xpi`).
3. Click the 📊 icon.

> Temporary loading = wiped on Firefox restart. For a permanent installation **with
> automatic updates**, the extension must be signed by Mozilla (AMO, free) — procedure
> in [docs/PUBLICATION.md](docs/PUBLICATION.md).

### Building the packages yourself

```bash
./tools/build.sh      # → dist/kanban-flow-<version>.zip and .xpi
```

The version is read from `manifest.json`. Pushing a `vX.Y.Z` tag triggers the GitHub
Actions workflow that builds the packages and creates the release with notes from
`CHANGELOG.md` (see [docs/PUBLICATION.md](docs/PUBLICATION.md)).

## Updating the extension without re-entering anything

Settings (JIRA connection, teams, statuses) are stored **in the browser** via
`chrome.storage.local`. They are lost if the extension is removed and reinstalled —
and always on a **temporary Firefox add-on**, wiped on every restart. Hence the
export/import feature.

### Update procedure
1. ⚙ Settings → section **4. Settings backup** → **⬇ Export settings** → a
   `kanban-flow-config_YYYY-MM-DD.json` file is downloaded.
2. Install the new version (Chrome: *Reload* is enough if it's the same folder, and
   settings are preserved; temporary Firefox: reload the add-on).
3. ⚙ Settings → **⬆ Import settings** → select the file. Settings are applied **and
   saved** immediately.

### About the API token
- It is **not** exported by default (it's a secret equivalent to a password). Check
  "Include the API token in the export" if you want a self-contained file — in that
  case, treat the file like a password.
- On import, a file **without** a token never removes the one already saved: you only
  have to re-enter it if the extension was actually freshly reinstalled.

### Sharing settings with a colleague
Export **without** the token and send the file: your colleague imports it, adds their
own email and their own API token, and starts with the same teams, statuses, and
settings. The file format is validated on import (`app`, `formatVersion`), statuses are
cleaned up, and a foreign or corrupted file is rejected with a clear message.

## Getting a JIRA Cloud API token

The extension authenticates to JIRA Cloud using **Basic Auth**: your Atlassian email +
an **API token**. The token replaces the password (account passwords are not accepted
by the JIRA Cloud REST API) and never goes through a third-party server: it is stored
only in the browser.

Steps (~1 minute):

1. Log in to your Atlassian account, then open the token management page:
   **<https://id.atlassian.com/manage-profile/security/api-tokens>**
   (or: avatar top right of JIRA → **Manage account** → **Security** tab → **Create
   and manage API tokens**).
2. Click **Create API token**.
3. Give it a clear **label** (e.g. `Kanban Flow – Kanban facilitator dashboard`). If a
   type choice is offered, pick a **classic** token (no *scopes*); optionally set an
   expiration date.
4. Click **Create**, then **Copy**: the token is shown **only once**. Keep it handy
   long enough to paste it into the extension.
5. Also note:
   - your JIRA **site URL**: `https://your-domain.atlassian.net`;
   - the **email** of the Atlassian account associated with the token.

> Security: treat this token like a password. You can **revoke** it at any time from
> the same page if needed. The token's permissions are those of your account: you need
> read access to your teams' projects.

## Configuration

1. Open ⚙ **Settings** (button in the dashboard).
2. **JIRA Cloud connection**:
   - Site URL: `https://your-domain.atlassian.net`
   - Atlassian email (the one for the account that created the token)
   - API token: the one obtained in the **"Getting a JIRA Cloud API token"** section
     above (<https://id.atlassian.com/manage-profile/security/api-tokens>)
   - Click **Test connection**.
3. **Metric settings**: start date (first week of the 5-week window), aggregation (median/average), stability
   threshold, **JIRA story points field** (optional, empty = auto-detect), and **Build
   mode counting windows** ("committed" window and "additions / removals" window: day +
   hours).
4. **Teams / Projects**: for each of your teams, enter the name, the JIRA project key,
   and the **exact statuses** of your workflow (comma-separated, case-insensitive):
   - **Kanban type**: **Build** or **Run**;
   - **Issue types counted** (both modes): leave empty to count every type, or click
     **"Load types from JIRA"** to tick the real issue types of the project. Picking
     them from that list removes any typo, casing or language problem; the text field
     remains editable as a fallback when JIRA is unreachable.
   - In **Build** mode: "In progress" (start of cycle time) and "Done" (delivered
     throughput / lead / cycle); "Board statuses" (committed throughput / additions to
     board) and "Backlog" (moves back to backlog). Board / Backlog statuses are
     optional: without them, committed throughput and flow signals are not shown.
     Check the box **"Track story points for this team"** to enable the card, chart,
     and story points column.
   - In **Run** mode: the **labels** identifying run tickets, the **"highest"
     priority/priorities** (e.g. `Highest, Blocker`), the **closing statuses** (e.g.
     `Done, Closed`) to exclude closed tickets from the stats, and the **run "Backlog"
     statuses** (unplanned open tickets).
5. **Save**, then go back to the dashboard and choose a team.
6. **Settings backup**: export it to a JSON file (see "Updating the extension without
   re-entering anything") — do this as soon as settings are finalized, and before every
   update.

## Technical details

- Manifest V3, compatible with Chrome and Firefox (`background.service_worker` /
  `background.scripts`).
- JIRA API: modern endpoint `POST /rest/api/3/search/jql` (`nextPageToken` pagination),
  + `/rest/api/3/issue/{key}/changelog` as a fallback if the changelog is truncated,
  `GET /rest/api/3/priority` (site priority order), `GET /rest/api/3/field` (story
  points field detection), and `GET /rest/api/3/issue/{key}/comment` (first comment,
  Run mode). **Basic** authentication (email + API token).
- Cross-origin requests to `*.atlassian.net` work thanks to the extension's
  `host_permissions` (a clean CORS workaround, impossible for a plain web page).
- Homegrown SVG charts, **no third-party network calls**.
- Image export: `html2canvas` 1.4.1 (MIT) **vendored** in `lib/html2canvas.min.js` —
  rasterization is 100% local, no data leaves the browser. Before capture,
  `lib/export-image.js` copies the computed styles of `<svg>` elements into inline
  attributes (our bars get their color from CSS classes, but html2canvas serializes
  each SVG without the stylesheet), then restores the original state; collapsed
  `<details>` are opened for the duration of the capture. The download uses a `Blob` +
  a `download` link: **no additional permission** is required.
- Requested permissions: `storage` only + host `https://*.atlassian.net/*`.

## Structure

```
jira-kanban-dashboard/
├── manifest.json
├── background.js          # opens/refocuses the dashboard tab
├── dashboard.html/.css/.js
├── options.html/.css/.js  # settings (connection, preferences, teams)
├── lib/
│   ├── store.js           # config in chrome.storage.local + JSON export/import
│   ├── jira.js            # JIRA Cloud REST client
│   ├── metrics.js         # build engine (throughput/lead/cycle/signals/story points)
│   │                     # + run engine (open/closed/created/resolution), Mon→Sun weeks
│   ├── charts.js          # SVG charts
│   ├── export-image.js    # captures the page as PNG/JPG (inlines SVG styles)
│   └── html2canvas.min.js # html2canvas 1.4.1 (MIT), vendored — local rasterization
├── icons/
├── tools/
│   └── build.sh           # builds dist/*.zip (Chrome) and dist/*.xpi (Firefox)
├── docs/
│   ├── INSTALLATION.md    # user guide: install, configure, update
│   ├── PUBLICATION.md     # maintainer guide: releases + auto-update options
│   └── updates.json       # Firefox self-hosted update manifest template
├── .github/workflows/
│   └── release.yml        # build + GitHub release on vX.Y.Z tag
├── CHANGELOG.md           # version log (semver)
├── LICENSE                # MIT
├── THIRD-PARTY.md         # embedded third-party libraries
└── README.md
```

## License

[MIT](LICENSE). Embedded third-party libraries: see
[THIRD-PARTY.md](THIRD-PARTY.md) (html2canvas 1.4.1, MIT, © Niklas von Hertzen).

## Contributing / reporting an issue

Open an **Issue** on the repository, specifying the browser, the extension version
(visible in `chrome://extensions`), and the exact error message.
**Never paste your JIRA API token** into an issue or a shared settings export.
