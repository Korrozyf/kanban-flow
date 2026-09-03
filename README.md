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
- **Update notification**: the extension compares its version with the latest
  GitHub release, shows a dot on the toolbar icon and on the ⚙ Settings button,
  and offers an assisted update in the settings page.
- **Independent Build and Run periods**, chosen on the dashboard and loaded only after
  **Apply**:
  - **Last weeks** (default) always loads the current week and the four previous weeks,
    independently of the configured start date.
  - **Complete** loads the first weeks from the week containing the start date, capped
    at **52 weeks**. If the cap excludes newer weeks, the exact loaded range and the
    truncation are announced. With no start date, it falls back to Last weeks.
  - Each mode remembers its own choice. After loading, the last week is selected.
  - A **Reference week** selector updates KPI cards, trends and ticket lists locally,
    with no new JIRA request. Its trend compares it to the immediately preceding loaded
    week; the first loaded week has no comparison.
  - Complete charts are horizontally scrollable and keyboard-focusable.
- **Delivered throughput** for every loaded week (Monday → Sunday). The true
  **current (incomplete) week**, when loaded, is shown in yellow; the selected
  historical week has a separate outlined encoding.
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
  A selected historical reference keeps completed-week colors and receives a distinct
  outline/label; its cards name the selected date rather than claiming it is current.
  If the current week is outside a truncated Complete range, no warm mark is shown.
- **Accessibility**: every text/background pair in both pages meets the **WCAG AA**
  contrast ratio (4.5:1 normal text, 3:1 large text and non-text indicators), checked
  against the rendered pages in a real browser. No information is ever carried by
  color alone — thresholds combine a colored dot with a tooltip and a legend, links
  are underlined, and the update indicator has a screen-reader label. Keyboard focus
  is always visible; charts have names and full text alternatives; dynamic results
  are announced; form controls have programmatic labels; and reduced-motion settings
  are respected.
- **Story points (per-team option)**: if the *"Track story points"* option is enabled
  for a build team, the dashboard adds a **card** "Delivered story points" for the
  selected reference week, a **weekly chart** below the throughput, and a **"Story
  points" column** in the completed tickets list (before lead / cycle time). The
  corresponding JIRA field is auto-detected, or can be forced in settings.
- **Chart layout (build)**: the throughput chart spans the full width; lead time and
  cycle time sit side by side below it.
- **List of tickets completed in the selected reference week**: the *Cycle (d)* column
  has a **colored dot + tooltip** — green ≤ 2 days, amber 2–4 days, red > 4 days.
- **Weekly flow signals**: number of tickets **added to board** (entering a board
  status **from any other status**) and tickets **moved back to backlog**, counted
  during the **"additions / removals" counting window** (default Monday 12:00 → end of
  Friday, **configurable**), with a ⚠ alert when there are any. The current week is
  highlighted (yellow row) and a summary shows whether there were additions / removals
  and how many.
- **Issue types counted (per team, both modes)**: restrict every query to the types you
  track. A *Load types from JIRA* button lists the project's real type names as
  checkboxes, so there is no typo, casing or language problem. Empty = all types.
- **Configurable counting windows** (global setting): day and hours of the "committed"
  window and the "additions / removals" window. Labels shown in the dashboard follow
  the chosen values automatically.
- **Trends = selected reference week compared to its previous loaded week**
  (top-of-page cards, both build and run). For the true current week, Run comparisons
  retain the same-elapsed-time basis.
- **Export / import of settings** as JSON (API token excluded by default) so you don't
  have to re-enter everything after a reinstall — see "Updating the extension".
- **Export the dashboard as an image** (PNG or JPG): `🖼 Export image` button in the top
  bar. The capture covers the **entire metrics page** (not just the visible area),
  with a header showing team / mode / period / generation date. Ticket lists stay
  **collapsed by default** to avoid disclosing ticket-level data; explicitly tick
  *Include ticket lists* when that content belongs in the image. ×2 resolution
  (readable in a meeting or report). The file is saved
  to the browser's download folder as `kanban-flow_<team>_<date>_<time>.png|jpg`.
- **Lead time** per week and **cycle time** per week (lines, median or average).
- **Trends** (up / stable / down) for each metric, color-coded: green = improvement,
  red = degradation, blue = stable.
- **Per-team configurable statuses**: you define precisely which JIRA statuses mark the
  *start of work* (cycle time) and the *end* (throughput / lead / cycle).
- Collapsible list of tickets completed **in the selected reference week** + the JQL
  used (calculation transparency).
- 100% local: credentials and token stored in the browser, no third-party server, no
  telemetry — see [Security and data handling](#security-and-data-handling).

## Metric definitions

> **Full reference:** [`docs/METRICS.md`](docs/METRICS.md) details, indicator by
> indicator, the **exact JQL queries** sent to JIRA, the **fields** retrieved, the
> **step-by-step calculation**, and **which of your settings changes what**. The tables
> below are the summary.

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
- **Trend** = comparison of the selected reference week to its immediately preceding
  loaded week; below the "stable" threshold (10% by default), it is considered stable.

## Run mode (support / run Kanban)

For a project configured in **Run mode**, the analysis is not delivery flow but the
management of a support ticket flow. Relevant tickets are identified by one or more
**labels** (configurable per team). Weeks run **Monday 00:00 to Sunday 23:59**; in
charts the true current week uses warm tones. As in build mode, the top-of-page
**cards** show their figure in normal text color. Their badge and border identify the
selected reference week without presenting a historical selection as current. Metrics:

| Metric | Calculation |
|------------|--------|
| **Open tickets** | The weekly chart counts tickets by **creation week**. The KPI and two lists are a stock reconstructed at the selected week's cut-off: "**open tickets on the board**" (non-backlog status) and "**unplanned open tickets (backlog)**". The cut-off is the end of a past week or now for the current week. Tickets created before the loaded range are included when still open at that cut-off. |
| **Closed tickets** *(mirrors the open-tickets stat)* | Number and list of tickets whose **closing date** falls in the selected week (entry into a closing status, or resolution date). For a past week the full week is used; for the current week, only elapsed time is used and the comparison uses the same elapsed duration in the previous week. |
| **Tickets created per day** | Chart of creations per day in the selected week compared with its previous loaded week. Working days (Mon→Fri) are always shown; weekend days appear only when non-zero. |
| **Created tickets** | Number created in the selected week. For the current week, the comparison uses the same elapsed duration; past weeks compare complete weeks. |
| **Average resolution time** | Average `created → closed` delay for closures in the selected week. For the current week, the comparison uses the same elapsed duration; shorter is better. |
| **Unassigned** | List of open tickets with no assignee at the selected cut-off. |
| **Highest priority** | Snapshot at the selected cut-off, sorted by priority then creation date, with first-comment and resolution delays. |

- "Highest" priorities are configurable per team (e.g. `Highest, Blocker`).
- **Closing statuses** (e.g. `Done, Closed, Resolved`) are configurable per team: a
  ticket in one of them is excluded from the metrics, like a resolved ticket.
- The **closing date** is read from the **changelog** (last entry into a closing
  status); failing that, the resolution date; as a last resort, "now", flagged with a
  `~` in the "Closed on" column. This is what makes it possible to correctly date a
  ticket closed without a resolution (e.g. `Cancelled`).
- The **run "Backlog" statuses** distinguish unplanned open tickets from those taken
  on the board. Historical status, backlog membership, assignee and priority are
  reconstructed from complete changelogs. If JIRA cannot supply a complete history,
  the dashboard says **unavailable** rather than silently substituting today's value;
  affected tickets are excluded from reconstructed historical stocks.
- Trends compare the **selected reference week** to the **previous loaded week**. For
  the current incomplete week, created/closed/resolution comparisons use the same
  elapsed duration in the previous week. The Run "Open tickets" card compares stocks
  reconstructed at each week's cut-off.
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
- **Open tickets (top card, run)** — stock of unresolved tickets at the selected
  cut-off, compared with the reconstructed stock at the previous loaded cut-off.
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

## Update notification

The extension is installed manually, so the browser cannot update it on its own.
To avoid silently running an old version, Kanban Flow checks the latest release
published on GitHub:

- **When**: at browser startup, at install/update, and when the dashboard or the
  settings page is opened. The answer is cached for **6 hours** (the anonymous
  GitHub API allows 60 requests per hour and per IP), and ↻ *Check for updates*
  forces a fresh check.
- **Where**: `GET https://api.github.com/repos/Korrozyf/kanban-flow/releases/latest`,
  a public endpoint called with `credentials: "omit"` and **no** authentication
  header. Nothing about you or your JIRA site is sent.
- **What you see** when a newer version exists: an amber dot on the extension
  icon (with the version in the icon tooltip), an amber dot on the ⚙ Settings
  button of the dashboard (with the version in its tooltip), and section
  **5. Updates** of the settings page.
- **If GitHub is unreachable**: the last known answer is kept, the error is shown
  in the settings page, and no update is ever claimed on a failed check.

### Assisted update

Neither Chrome nor Firefox lets an extension install a package by itself, so
**⬇ Update now** does the parts that can be automated and spells out the rest:

1. it downloads the asset matching your browser (`.zip` on Chrome/Edge, `.xpi`
   on Firefox) from the release;
2. it reveals the four manual steps (export your settings, unzip over the
   existing folder, reload the extension, check the version);
3. **open it** opens `chrome://extensions` (or `about:debugging` on Firefox).

For a fully silent auto-update, the extension has to be distributed through the
stores — see [docs/PUBLICATION.md](docs/PUBLICATION.md).

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

## Security and data handling

The extension holds a credential that is equivalent to your JIRA password, so here is
exactly what it does with it. Everything below is verifiable in the source — there is
no build step and no minified code except the vendored `html2canvas`.

**Where the token lives.** In `storage.local`, i.e. the browser profile of the machine
where you installed the extension. It is **not** encrypted (no browser API offers
that to an extension) and it is readable by anyone with access to your unlocked user
session, exactly like a password saved in the browser. It is never copied anywhere
else: no file, no clipboard, no log.

**Where it is sent.** Only to your own JIRA site, in the `Authorization: Basic` header,
over HTTPS. The site URL is **checked against an allow-list** before any request is
built: `https://` + a host under `atlassian.net`. A URL that is `http://`, points at
another domain, or uses a `javascript:`/`data:` scheme is refused with an explicit
message. This is a deliberate safety net: a typo, a link pasted from a phishing
e-mail, or a tampered settings file cannot make the extension send your token to a
host you did not intend.

**What leaves the browser.** Nothing but those JIRA calls. No analytics, no telemetry,
no error reporting, no third-party script, no remote font: the charts are homegrown SVG
and `html2canvas` is vendored locally (byte-identical to the upstream 1.4.1 release).
The image export is produced in-page and saved through a `Blob` + `download` link.

**The one other host contacted.** `https://api.github.com/` — only to read the
latest published release (public endpoint, `credentials: "omit"`, no
authentication header, no query string). Release payloads are treated as
untrusted: the tag must be a plain dotted version, and a download URL is only
kept when it is served by `https://github.com`. Nothing is uploaded and no
identifier is sent, but GitHub does see your IP address when the check runs; if
that matters to you, the check is a single function in `lib/update.js` and can be
removed by deleting `https://api.github.com/*` from `manifest.json`.

**Permissions.** `storage`, `https://*.atlassian.net/*` and
`https://api.github.com/*`. Nothing else — no `tabs`,
no `<all_urls>`, no `downloads`, no content script injected into your pages. The
extension only runs on its own two pages, and requests use `credentials: "omit"` so
your JIRA session cookies are never involved.

**Untrusted content.** Ticket summaries, statuses, priorities and assignee names come
from JIRA and are treated as untrusted: they are HTML-escaped before being inserted in
the tables, as are ticket keys and links. Extension pages also run under an explicit
`script-src 'self'` policy, so no inline or remote script can execute.

**Exports.** The settings export excludes the API token unless you tick the box. The
image export never contains the JIRA URL, e-mail or token. By default, ticket lists
remain collapsed, so the image contains the metrics, charts and list headings/counts
but not ticket-level rows. The separate *Include ticket lists* checkbox deliberately
opens every list for the capture; use it only when all recipients may see those ticket
keys, summaries, assignees, statuses and dates. `.gitignore` blocks settings exports
from being committed by accident.

**Recommended practice.** Use a token dedicated to this extension with an expiry date,
so you can revoke it without affecting anything else; the token inherits your account's
permissions, so prefer an account that only needs read access to the relevant projects.
When reporting a bug, never paste your token.

## Configuration

1. Open ⚙ **Settings** (button in the dashboard).
2. **JIRA Cloud connection**:
   - Site URL: `https://your-domain.atlassian.net`
   - Atlassian email (the one for the account that created the token)
   - API token: the one obtained in the **"Getting a JIRA Cloud API token"** section
     above (<https://id.atlassian.com/manage-profile/security/api-tokens>)
   - Click **Test connection**.
3. **Metric settings**: start date (first week of the Complete period), aggregation (median/average), stability
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
  points field detection), `GET /rest/api/3/issue/{key}/comment` (first comment,
  Run mode) and `GET /rest/api/3/project/{key}` (issue type list, settings page).
  **Basic** authentication (email + API token).
- Cross-origin requests to `*.atlassian.net` work thanks to the extension's
  `host_permissions` (a clean CORS workaround, impossible for a plain web page).
- Homegrown SVG charts, **no third-party network calls**.
- Image export: `html2canvas` 1.4.1 (MIT) **vendored** in `lib/html2canvas.min.js` —
  rasterization is 100% local, no data leaves the browser. Before capture,
  `lib/export-image.js` copies the computed styles of `<svg>` elements into inline
  attributes (our bars get their color from CSS classes, but html2canvas serializes
  each SVG without the stylesheet), then restores the original state. Collapsed
  `<details>` are opened temporarily only when *Include ticket lists* is selected.
  The download uses a `Blob` + a `download` link: **no additional permission** is
  required.
- Requested permissions: `storage` + hosts `https://*.atlassian.net/*` and
  `https://api.github.com/*` (update check only).

## Structure

```
jira-kanban-dashboard/
├── manifest.json
├── background.js          # opens/refocuses the dashboard tab + update badge
├── dashboard.html/.css/.js
├── options.html/.css/.js  # settings (connection, preferences, teams)
├── lib/
│   ├── store.js           # config in chrome.storage.local + JSON export/import
│   ├── jira.js            # JIRA Cloud REST client (https://*.atlassian.net allow-list)
│   ├── metrics.js         # build engine (throughput/lead/cycle/signals/story points)
│   │                     # + run engine (open/closed/created/resolution), Mon→Sun weeks
│   ├── charts.js          # SVG charts
│   ├── update.js          # latest GitHub release check (cached, no credentials)
│   ├── export-image.js    # captures the page as PNG/JPG (inlines SVG styles)
│   └── html2canvas.min.js # html2canvas 1.4.1 (MIT), vendored — local rasterization
├── icons/
├── tools/
│   └── build.sh           # builds dist/*.zip (Chrome) and dist/*.xpi (Firefox)
├── docs/                  # shipped inside the packages (except updates.json)
│   ├── INSTALLATION.md    # user guide: install, configure, update
│   ├── METRICS.md         # queries + calculations behind every indicator
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
