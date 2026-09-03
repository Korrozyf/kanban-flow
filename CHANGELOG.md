# Changelog — Kanban Flow

Semantic versioning: `MAJOR.MINOR.PATCH`.

- **MAJOR**: breaking compatibility change (existing config must be redone).
- **MINOR**: new feature or change in calculation rule.
- **PATCH**: bug fix, no rule or screen change.

## 1.28.0

### Update notification and assisted update
The extension is installed manually, so the browser never updates it. It now tells
you when a newer release exists instead of letting you run an old version silently.

- **Version check** against the latest GitHub release
  (`GET https://api.github.com/repos/Korrozyf/kanban-flow/releases/latest`). Runs at
  browser startup, at install/update, and when the dashboard or the settings page is
  opened. The result is cached for 6 hours because the anonymous GitHub API is rate
  limited to 60 requests per hour and per IP.
- **Dot on the extension icon** (amber badge) plus the new version in the icon
  tooltip.
- **Dot on the ⚙ Settings button** of the dashboard, with the version in its tooltip
  and a screen-reader-only "Update available" label: the information is never carried
  by colour alone.
- **New settings section "5. Updates"**: installed version, ↻ *Check for updates*
  (forces a fresh check), and **⬇ Update now**. Neither Chrome nor Firefox allows an
  extension to install a package by itself, so *Update now* downloads the asset
  matching the browser (`.zip` on Chrome/Edge, `.xpi` on Firefox) and reveals the
  remaining manual steps, including a button that opens `chrome://extensions` /
  `about:debugging`.
- **Failure handling**: on a network error or a GitHub rate limit, the last known
  version is kept, the error is displayed in the settings page, and no update is ever
  claimed.

### Security
- The GitHub call carries **no credentials** (`credentials: "omit"`, no
  `Authorization` header, no query string) and nothing about the user or their JIRA
  site is sent.
- Release payloads are treated as untrusted input: the tag must match a plain dotted
  version, and a download URL is kept only when served by `https://github.com`
  (rejects `http://`, other domains, and look-alikes such as `github.com.evil.com`).
- New host permission `https://api.github.com/*` — the only addition, and it is
  limited to the public releases endpoint.

### Files
- New `lib/update.js` (checker + cache), `background.js` extended with the badge and
  a `jkd-update-check` message handler.
- README: new "Update notification" section, security section and permission list
  updated. `docs/INSTALLATION.md`: new update section.

## 1.27.0

### Security review (hardening)
Full read-through of the add-on looking for secret exposure. No leak was found — the
API token was never logged, never sent anywhere but JIRA, and never included in the
image export or in the settings export unless explicitly requested. Three hardening
measures were added anyway.

- **JIRA site URL allow-list**: the URL is now validated **before** any request is
  built. Only `https://` addresses on an `atlassian.net` host are accepted; `http://`
  (token in clear text), any other domain (token exfiltration) and `javascript:` /
  `data:` schemes are refused with an explicit message. This matches what the manifest
  declares in `host_permissions`, so no working setup is affected — but a typo, a link
  pasted from a phishing e-mail or a tampered settings file can no longer point the
  extension, and your credentials, at another host.
- **HTML escaping of ticket keys and links** in every table. Summaries, statuses,
  priorities and assignee names were already escaped; keys and `href` values were
  interpolated raw. JIRA keys cannot realistically contain markup, but the value is
  built from the configured site URL, so it is now escaped too.
- **Explicit content security policy** for extension pages
  (`script-src 'self'; object-src 'self'`). This is already the Manifest V3 default;
  stating it makes the intent auditable and immune to a default change.

Verified: `lib/html2canvas.min.js` is **byte-identical** to the upstream html2canvas
1.4.1 release (sha256 `e87e5507…eab8cb`); the Git history contains no token or key;
requested permissions remain `storage` + `https://*.atlassian.net/*` with no content
script; requests keep `credentials: "omit"`, so JIRA session cookies are never used.

### Documentation
- New README section **Security and data handling**: where the token is stored (and
  that `storage.local` is not encrypted), where it is sent, what leaves the browser
  (nothing but JIRA calls — no telemetry, no third-party script), permissions,
  handling of untrusted JIRA content, what the exports do and do not contain, and
  recommended token practice.
- README: `GET /rest/api/3/project/{key}` added to the list of endpoints used (issue
  type loading on the settings page); **Issue types counted** added to the feature list
  (it was only documented in the configuration walkthrough).
- `docs/INSTALLATION.md`: the URL allow-list is mentioned where the URL is entered, and
  the security section is linked from the setup step.

## 1.26.3

### Packaging
- **The `docs/` folder is now shipped inside the distributed packages** (`.zip` and
  `.xpi`). A user who only has the archive can read the full documentation offline:
  `docs/INSTALLATION.md`, `docs/METRICS.md` and `docs/PUBLICATION.md`. The links from
  `README.md` to `docs/*.md` now resolve inside the unpacked folder, not only on GitHub.
- `docs/updates.json` stays out of the package: it is a maintainer template (Firefox
  self-hosted update manifest), not user documentation.
- No code, screen or calculation rule changed.

## 1.26.2

### Documentation
- **New `docs/METRICS.md`: full reference of the queries and calculations behind every
  indicator**, in build and in run. For each indicator: the exact JQL sent to JIRA
  (with both-sided bounds and the optional issue-type / additional-JQL clauses), the
  fields retrieved, the step-by-step calculation, the comparison base used by the
  trend badge, and the settings that change the result.
  Also documented: the seven REST endpoints used and when each is called, the window
  built from the start date (including the "window entirely in the past" case), the
  reconstruction of ticket dates from the changelog, the re-anchoring of the
  configurable counting windows week by week, the "same elapsed duration" comparison
  bases, the colour thresholds, and a settings-to-indicator cross-reference table.
- `README.md`: the "Metric definitions" section now points to that reference, and the
  file tree lists it.
- `docs/INSTALLATION.md`: link to the reference from the first-time setup section.

## 1.26.1

### Fixed
- **The current-week color code was applied to the last week of the window even when
  that week was not the current week** (regression introduced with the 5-week window
  in 1.26.0). With a start date placed far enough in the past, the 5th week was
  painted yellow / amber in the charts, carried the amber card borders and the
  "current" badge, and highlighted its row in the flow signals table — while it was
  merely the reference week of a window entirely in the past.
  Every current-week marker is now conditioned on the window actually reaching today
  (`hasCurrentWeek`), in **build** and in **run**:
  - charts (throughput, story points, lead, cycle, run flow, creations per day)
    receive `currentIndex = -1` and therefore keep the completed-week colors;
  - card borders, badges, the caption highlight and the highlighted row of the flow
    signals table are neutralised through a single `body.no-current-week` switch;
  - the chart legends dedicated to the current week are hidden;
  - the remaining static labels that still said "current week" (lead / cycle notes,
    creations-per-day title and legend) now state the reference week's date.
  No calculation rule changed: only the rendering of a window with no current week.

## 1.26.0

### Changed
- **"Macrocycle start date" renamed "Start date"**, and its meaning changed. The
  analysis window is no longer "the current week plus up to 3 previous weeks bounded
  by that date": it is now the week containing the start date **plus the 4 weeks that
  follow** (5 weeks in total), **stopping at the current week** when it falls inside
  that period.
  - Window reaching today: the last week displayed is the current (incomplete) week,
    exactly as before (badges, amber highlight, "same elapsed duration" comparisons).
  - Window entirely in the past: the 5 weeks are displayed, **no week is flagged
    "current"**, and the **last week of the window** becomes the reference week for
    the key figures and the trends. Card badges, captions and the completed-tickets
    list are relabelled with that week's date, the "current week" legend entry is
    hidden, and an information banner states it explicitly.
  - Empty start date: window of 5 weeks ending on the current week (previously 4).
  - Display rules, colours and calculation rules are unchanged.
- Configuration key `macrocycleStart` renamed **`startDate`**. Existing settings and
  configuration files exported by an earlier version are **migrated automatically**
  (the legacy key is still read on load and on import), so nothing has to be re-entered.

### Added
- **Issue types counted** — new per-team setting, available in **both** Build and Run
  modes. Leave it empty to count every issue type (previous behaviour), or restrict
  the analysis to the types you care about.
  - Button **"Load types from JIRA"**: reads the real issue types of the project
    (`GET /rest/api/3/project/{key}`) and shows them as checkboxes. Picking them from
    that list removes any typo, casing or language problem.
  - The text field stays editable (comma-separated) as a fallback when JIRA is not
    reachable, and stays the single source of truth for what is saved.
  - The restriction is applied as an `issuetype IN (...)` clause on **every** query of
    both modes: delivered throughput, board snapshot (committed throughput), flow
    signals (additions / moves back to backlog) and run tickets.
  - Included in the settings export / import.

### Unchanged (verified)
- Weeks still run Monday 00:00 to Sunday 23:59, with strictly exclusive weekly
  buckets (the counting-exclusivity harness passes unchanged).
- Trends still compare the reference week to the previous one; "same elapsed
  duration" comparison bases are unchanged (a past reference week simply compares
  full week to full week).
- Story points, image export, ticket lists, colour code and thresholds untouched.

## 1.25.0

### Changed
- **The whole project is now in English.** Every user-facing string, every code
  comment and all the documentation were translated from French to English:
  - **User interface**: `dashboard.html` / `dashboard.js` (cards, charts, legends,
    table headers, ticket lists, tooltips, trend badges, status and error messages,
    exported-image header) and `options.html` / `options.js` (labels, hints,
    placeholders, weekday selects, test/save/export/import messages).
  - **Code**: comments and user-visible strings of `lib/metrics.js`, `lib/jira.js`,
    `lib/store.js`, `lib/charts.js`, `lib/export-image.js`, `background.js`, plus the
    comments of `dashboard.css` / `options.css`.
  - **Documentation and tooling**: `README.md`, `CHANGELOG.md`, `docs/INSTALLATION.md`,
    `docs/PUBLICATION.md`, `docs/updates.json`, `THIRD-PARTY.md`, `.gitignore`,
    `tools/build.sh`, `.github/workflows/release.yml`.
  - Date formatting switched from the `fr-FR` locale to `en-GB`; `<html lang>` is now
    `en` on both pages.
- **Terminology: "Scrum Master" is replaced by "Kanban facilitator"** everywhere
  (extension name and description, dashboard subtitle, documentation). This is a Kanban
  tool, so it uses Kanban vocabulary.
- **Firefox add-on id** changed from `kanban-flow@scrum-master.local` to
  `kanban-flow@kanban-flow.local` for consistency. Firefox therefore treats it as a
  distinct add-on: an existing temporary or self-hosted installation must be reinstalled
  once (settings are unaffected, and can be exported/imported anyway).

### Added
- **README and `docs/INSTALLATION.md` now state how the project is built**: Kanban Flow
  is maintained by a Kanban facilitator who is not a professional developer, with the
  help of an AI coding agent, and reviewed against real team needs. Readers know what to
  expect from the code.

### Unchanged (verified)
- **No behaviour change.** Every calculation rule, threshold, weekly window and JQL
  query is untouched. Verified by tokenising each JavaScript file before and after the
  translation: the two token streams are **identical** (same identifiers, same object
  keys, same numbers, same operators) — only string contents and comments differ.
- **No structural change** to `dashboard.html` / `options.html`: the DOM skeleton (tags,
  `id`, `class`, `data-*`, `<option value>`, `<template>` content) is byte-for-byte
  identical, so all JavaScript selectors still resolve.
- **Settings format unchanged**: config keys, storage key and export/import format are
  the same, so a settings file exported from an earlier version imports as-is.
- Configured JIRA status, priority and label values are user data and were **not**
  translated. Only the *examples* in the placeholders were adapted.

## 1.24.2

### Added
- **GitHub publication preparation.** The repository is now self-contained and
  shareable:
  - `LICENSE` (MIT) + mention of embedded html2canvas 1.4.1 (MIT).
  - `.gitignore`: excludes `dist/`, archives, and especially **settings exports**
    (`*kanban-flow-config*.json`, `config-*.json`) to prevent any API token from being
    committed by accident.
  - `tools/build.sh`: builds `dist/kanban-flow-<version>.zip` (Chrome) and `.xpi`
    (Firefox) from the version read in `manifest.json`, after a syntax check of all
    shipped JS files. Replaces the manual `jira-kanban-dashboard_vX.Y.zip` archiving.
  - `.github/workflows/release.yml`: on a `vX.Y.Z` tag, checks that the tag matches
    the manifest version, builds both packages, and creates the **GitHub release**
    with notes extracted from the matching section of this file.
  - `docs/INSTALLATION.md`: user guide (installing on Chrome and Firefox, creating the
    API token, backing up/restoring settings, updating, getting notified of new
    versions, troubleshooting).
  - `docs/PUBLICATION.md`: the maintainer's release cycle and the three real
    auto-update scenarios (GitHub only; self-hosted AMO-signed Firefox; unlisted
    Chrome Web Store).
  - `docs/updates.json`: Firefox update manifest template.
- **README**: Installation section rewritten around Releases, added package building,
  the `tools/`/`docs/`/`.github/` tree, the license, and bug-reporting guidelines.

### Unchanged
- No change in behavior, calculation rules, or extension screens: only repository and
  documentation files were added.

## 1.24.1

### Fixed
- **Exclusivity of counts around daylight-saving time changes.** Audited all metrics
  to guarantee that a ticket counted in one week (or day) cannot be counted elsewhere
  for the same metric. One defect found: splits that used a fixed 24-hour step instead
  of calendar days.
  - **"Creations per day" chart** (run mode): a daylight-saving-time week is 167 h or
    169 h. In March, the 8th boundary landed 1 hour *after* the following Monday → a
    ticket created that Monday between 00:00 and 01:00 was counted **both** in Sunday
    of week N and in Monday of week N+1. In October, conversely, the last hour of
    Sunday (23:00 → 24:00) was counted **nowhere**. Day boundaries are now computed in
    calendar days and capped at the actual end of the week.
  - **Number of elapsed days** in the current week: same fix (could show one day too
    many or too few during the daylight-saving-time week).
  - **Configurable windows** (committed throughput, additions to board / moves back to
    backlog): boundaries were fixed offsets from Monday 00:00; they drifted by 1 hour
    if the window was configured on a Sunday. Boundaries are now calendar-based.
  - **"Same elapsed duration" comparison bases** (closed, created, average resolution
    time): the window applied to the previous week is now capped at the end of that
    week, so it can never bleed into the current week.
- New internal utilities `weekInstant()` / `addDays()` in `lib/metrics.js`
  (calendar-day date arithmetic).

### Unchanged (verified, exclusivity already correct)
- Weekly bucketing via `weekIndexOf()`: `[Monday 00:00, next Monday 00:00[`
  intervals, contiguous, with no gap or overlap. A ticket completed on Monday at
  exactly 00:00 is counted in the week that starts, never the one that ends.
- Build: delivered throughput, story points, lead time, cycle time (single bucket by
  end date); additions to board / moves back to backlog (single bucket by transition
  date).
- Run: open tickets (creation date), closed tickets (closing date), list and average
  resolution time of tickets closed during the week.

### Reading note (deliberately non-exclusive counts)
Three metrics are **not** partitions by design — this is intentional and documented
in the README:
- **Committed throughput**: a snapshot of the board at the Monday window. A ticket
  that stays on the board for several weeks is counted every week (it's a stock, not
  a flow).
- **Open tickets (top card)**: current stock, compared to the stock from the end of
  the previous week.
- **Additions to board / moves back to backlog**: these count *transitions*, not
  tickets. A round trip in the same week counts on both sides (an intended churn
  signal).

## 1.24.0

### Added
- **Export the dashboard as an image**: `🖼 Export image` button + format selector
  (**PNG** or **JPG**) in the top bar, active as soon as a team is displayed.
  - The capture covers **the entire metrics page**, including the off-screen part
    (cards, charts, tables, JQL note) — not just the visible area.
  - **Collapsed ticket lists are opened** for the duration of the capture then
    collapsed again: nothing is cut off in the image.
  - A **header** specific to the image is added: team, mode (build / run), analyzed
    period, and generation date and time.
  - **×2** resolution (crisp image in a meeting or report); opaque background in JPG.
    File name: `kanban-flow_<team>_<YYYY-MM-DD>_<HHhMM>.png|jpg`.
  - Works for **both modes** (build and run); only the displayed view is captured.
- `lib/export-image.js`: export module (preparation, rasterization, download).
- `lib/html2canvas.min.js`: html2canvas 1.4.1 (MIT) **vendored**, 100% local
  rasterization — no data leaves the browser, **no additional permission** (the file
  is produced via a `Blob` and a `download` link).

### Technical details
- Our SVG charts get their colors from CSS classes; html2canvas serializes each
  `<svg>` **without** the stylesheet. Computed styles (`fill`, `stroke`, `font-*`,
  `text-anchor`, …) are therefore copied inline onto the DOM before capture, then
  removed — otherwise bars would come out black.
- The page state is restored in a `finally` block: inline styles removed, `<details>`
  collapsed again, export header hidden, button re-enabled, even on failure.

## 1.23.1

### Changed
- **Documentation brought up to date** (no behavior change): the README still
  described several rules predating 1.11.
  - **Committed throughput**: "committed" window configurable (the README still
    advertised "Ready Monday 0h–12h" hard-coded).
  - **Additions to board / moves back to backlog**: entry from *any* status, within
    the configurable "additions / removals" window (the README still described
    "Backlog → Ready, Monday 12:00 → Friday midnight").
  - **Trends**: current week vs previous week (the README still advertised "only on
    completed weeks, 2 minimum").
  - **Run mode**: closing date is read from the **changelog** (the README claimed the
    opposite); added the **run "Backlog" statuses**.
  - Added missing items: configurable windows, export/import, story points in the
    settings procedure, `/priority`, `/field`, `/comment` endpoints, `CHANGELOG.md` in
    the file tree.
- **Settings page**: the two contextual hints for board and backlog statuses no
  longer mention hard-coded windows but now point to the windows defined in section 2.

## 1.23.0

### Added
- **Build — story points tracking (per-team option)**: new checkbox *"Track story
  points for this team"* in Build mode settings. When enabled:
  - **top-of-page card** "Delivered story points" (current week, same formatting and
    trend logic as other metrics);
  - **"Delivered story points per week" chart**, placed below throughput, same
    formatting (full width, current week in yellow);
  - **"Story points" column** in the completed tickets list, inserted **before** the
    lead / cycle time columns.
- **JIRA story points field** (global, optional setting): left empty, the field is
  **auto-detected** by its name ("Story Points", "Story point estimate"…) via
  `GET /rest/api/3/field`. It can be forced (e.g. `customfield_10016`) if your site
  uses an unusual name.
- The option and the field are included in settings **export / import**.

### Notes
- Delivered story points = **sum** of the points of tickets **completed during the
  week** (same weekly bucketing as delivered throughput, no carry-over between
  weeks).
- **Unestimated** tickets are counted in the throughput but show `–` in the column
  and are not included in the sum; the card's note shows the number of estimated
  tickets.
- If the option is enabled but the field cannot be found, the card explicitly says
  so and the rest of the dashboard works normally.

## 1.22.1

### Changed
- **Run — top-of-page cards**: the 4 key figures (open, closed, created tickets,
  average resolution time) now adopt the **same style as build mode cards**: figure
  in normal text color instead of yellow. Since yellow is a warning color, it is
  reserved for alerts and the categorical coding of charts; current-week status is
  still conveyed by the "current" badge and the card's amber border (redundant
  encoding, consistent with accessibility recommendations).
- The CSS rule `#buildView .card-current .metric` becomes global
  (`.card-current .metric`): both modes now share a single treatment.
- Run view subtitle reworded (it still mentioned figures "in yellow").

## 1.22.0

### Added
- **Run mode — configurable "Backlog" statuses**: new field *Run "Backlog" statuses
  (unplanned tickets)* in Run mode project settings. Any unlisted status is
  considered **on the board** (to be worked on).
- **Run mode — new "Unplanned open tickets (backlog)" list**, placed below the
  board's open ticket list, with the same composition, the same sort order (priority
  descending then creation ascending), and the same formatting (age dots + legend).

### Changed
- The run's **"Open tickets"** list becomes **"Open tickets on the board"** and
  **excludes** tickets whose status is one of the run's backlog statuses.
- The **"Open tickets"** KPI card is unchanged: it counts **all** open run tickets
  (board + backlog).

## 1.21.0

### Build — metric presentation and cycle time
- **Top-of-page card figures** are no longer yellow: yellow is a warning color,
  unsuited to neutral data. They switch to normal text color (maximum contrast);
  current-week status is still conveyed by the "current" badge and the card border
  (redundant encoding).
- The **Throughput per week** chart now spans the **full width** of the page.
- The **Lead time** and **Cycle time** charts are placed **side by side** on the
  following row.
- In the list of tickets completed this week, the **Cycle (d)** column gets
  **colored dots + tooltips** (same colors as run mode): green ≤ 2 days, amber 2–4
  days, red > 4 days. Legend added below the list.

## 1.20.0

### Run
- **New metric (4th card): "Average resolution time"** = average
  `created → closed` for tickets **closed during the current week**.
- Same **visual encoding** as the lists' duration columns: colored dot (green ≤ 1 d,
  amber ≤ 2 d, red > 2 d) + tooltip, normal-contrast text, and a threshold legend
  below the card.
- **Trend** compared to the previous week's average over the **same elapsed
  duration** (consistent with the "closed" and "created" cards).
  Shorter = better (`higherIsBetter = false`).

## 1.19.0

### Run
- **Highest-priority tickets list**: sorted by **priority descending** then
  **creation date ascending** (previously: creation date descending only).
- The **"Created → 1st comment"** and **"Created → resolved"** columns now use the
  **colored dots + tooltips** from the age counters (green ≤ 1 d, amber ≤ 2 d, red
  > 2 d), with a legend below the list.
- **List of tickets closed this week**: new **"Created → closed"** column (total
  duration, same color code and legend).

## 1.18.1

### Fixed
- **Run — readability of age counters**: removed the colored background
  (light green/orange/red) from the "Age since created" and "Since last activity"
  columns, inherited from a light theme and out of line with the dark dashboard.
  The threshold is now indicated by a **colored dot** in front of the value, with a
  **text tooltip** ("More than 2 days"…) and a **legend** below the list. Text stays
  in the table's normal color to guarantee contrast; only the critical threshold
  gets bold emphasis. Redundant encoding (shape + color + text), consistent with
  accessibility recommendations: information is never conveyed by color alone.

## 1.18.0

### Changed (Run mode)
- **Open tickets list**: two new counters — **age since created** and **since last
  activity** (`updated` field) — colored **green** (0–1 day), **orange** (1–2 days),
  **red** (> 2 days).
- **"Creations variance / 24h" card replaced** by **"Created tickets"**: number of
  tickets created during the current week, compared to the previous week's creations
  over the **same elapsed duration** (`createdThisWeek` / `createdPrevSameElapsed`).
  The rolling 24-hour variance is removed.
- **Cards removed**: "Unassigned (open)" and "Max priority" (the information stays in
  the lists).
- **List order**: highest priority, then unassigned, then open, then closed.
- **Closed tickets list** restricted to tickets **closed during the current week**
  (previously: all closed tickets in the window).
- **Open tickets list**: all unresolved tickets regardless of creation date
  (unchanged, now guaranteed by the JQL).
- `buildRunJql` also retrieves tickets **resolved during the window**
  (`resolutiondate >= … AND < …`), to avoid missing a ticket closed this week but
  created before the window.

## 1.17.0

### Changed
- **Run — tickets created per day**: Saturday and Sunday are only shown on the chart
  if they have at least one creation (current or previous week). Monday-to-Friday
  are always shown, even at zero.
- **Run — "Closed tickets" card**: the trend no longer compares the current week to
  the **entire previous week** but to the **same elapsed duration** of the previous
  week (new `closedPrevSameElapsed` field). Example: at 14:00 on Tuesday, it compares
  to closures from Monday 00:00 to Tuesday 14:00 of the previous week. The card's
  note shows both values (same period and full week).

## 1.16.0

### Changed
- **Run**: the "Creations variance" chart is replaced by **"Tickets created per
  day"** (Monday → Sunday), current week compared to the previous week. The
  variance KPI card (and its standard deviation) is kept.
- **Run**: the **open tickets** list is sorted by **priority descending** then by
  **ascending** creation date (oldest first). The **closed tickets** list is sorted
  by priority descending then by **descending** closing date. Priority order is read
  from JIRA (`/rest/api/3/priority`), with a fallback order if the call fails.
- **Build**: the **Committed throughput** card is now shown **before** delivered
  throughput.
- **Build**: the detail list now only shows tickets **completed in the current
  week**.
- **Build + Run**: all charts are now the **same size** (no more 2-column panel).
- **Build + Run**: all ticket lists are now **collapsible** (`<details>`), collapsed
  by default.

## 1.15.0

### Changed
- **Build — top-of-page trends**: the comparison is now between the **current
  week** and the **previous week** (previously: the last two completed weeks).
  Applies to delivered throughput, committed throughput, lead time, and cycle time.
- **Run — "Open tickets" card**: the value remains the total number of currently
  open run tickets; the trend compares this stock to the number of tickets still
  open **at the end of the previous week**.
- **Run — "Closed tickets" card**: the value becomes the number of tickets
  **closed during the current week**, compared to the previous week.
- **Run — charts**: "open per week" and "closed per week" are merged into a
  **single grouped bar chart**.
- A single previous week is now enough to display a trend.

### Fixed
- **Run — creations variance**: the current week's rolling 24-hour windows are now
  capped at the present instant (unelapsed hours were counting 0 creations and
  skewing the variance). The comparison is made against the **same elapsed
  duration** of the previous week, and the metric is flagged as not meaningful until
  at least 24 hours have elapsed. The standard deviation (in tickets) is shown
  alongside the variance (in tickets²).

## 1.14.1

### Fixed
- **Run mode — "Closed on" column**: the date of entry into the closing status is
  now read from the ticket's changelog, for **all** configured closing statuses
  (Done, Cancelled, …). Previously, a ticket without a `resolutiondate` (typically
  "Cancelled") displayed its status in parentheses instead of a date, and was
  counted as closed "now".
- Consequence: the weekly "closed tickets" series now places these tickets in the
  **correct week**.
- An approximated date (a ticket closed by status with no trace in the changelog) is
  flagged with a `~` suffix.

## 1.14.0

- **Run mode — removed carry-over between weeks.** "Open tickets per week" and
  "Closed tickets per week" were **cumulative** (backlog / total closed at the end
  of each week), which re-counted tickets from previous weeks.
  - **Open tickets per week** = tickets whose **creation date** falls in the week,
    regardless of status.
  - **Closed tickets per week** = tickets whose **closing date** falls in the week.
  - Week bounds `[Monday 00:00, next Monday 00:00[`, exclusive: a ticket can only be
    counted in a single week.
- Dashboard labels adjusted ("created during the week" / "closed during the week").
- Audit of Build mode: throughput, lead time, cycle time, committed, additions to
  board, and moves back to backlog were already strictly weekly — no fix needed.

## 1.13.0

- **New** — Build mode counting windows are now **configurable** (⚙ Settings →
  "2. Metric settings" → *Counting windows*). **Global** setting, applied to all
  build teams:
  - **committed** window: day + start time + end time (default: Monday 00:00 →
    12:00);
  - **additions to board / moves back to backlog** window: day + start time and day
    + end time, end bound **excluded** (default: Monday 12:00 → Saturday 00:00,
    i.e. end of Friday).
- Dashboard labels (committed card, flow signals table headers, legend, weekly
  summary) automatically adapt to the configured windows.
- Windows are included in settings export/import; any missing or invalid value
  falls back to the historical behavior.
- No reconfiguration needed: default values exactly reproduce the previous rules.

## 1.12.1

- Relabeling: "Ready statuses" becomes **"Board statuses (work the team has
  committed to)"**, "Added to Ready" becomes **"Added to board"**. Config keys
  unchanged (`readyStatuses` / `backlogStatuses`): no reconfiguration needed.
- Contextual hints added below the two status fields, recalling the windows used.
- Calculation rules **unchanged**: committed = on the board Monday 0h→12h;
  additions to board and moves back to backlog = Monday 12:00 → end of Friday.

## 1.12.0

- **New** — Export / import of settings (⚙ Settings → "4. Settings backup"
  section): simplifies extension updates and sharing settings between colleagues.
  - Export to a `kanban-flow-config_YYYY-MM-DD.json` file (connection, settings,
    teams, statuses, labels, priorities).
  - The **API token is not exported by default** (explicit checkbox); on import, a
    file without a token never removes the one already saved.
  - File validation on import (`app`, `formatVersion`), status normalization
    (`trim`), regeneration of missing ids, confirmation before overwrite, then
    automatic save.
- **Documentation** — "Updating the extension without re-entering anything" section
  in the README (update procedure, token handling, sharing with a colleague).

## 1.11.0

- **Fix** — "Added to Ready": the rule required a `Backlog → Ready` transition,
  which always yielded 0. Now any entry into the *Ready* status from another status
  is counted, within the `[Monday 12:00, Saturday 00:00[` window.
- **Fix** — "Moved back to backlog": added the missing time filter (same
  `[Monday 12:00, Saturday 00:00[` window).
- **Robustness** — status name comparison via `trim()` + lowercase; status names
  are also *trimmed* before injection into the JQL.
- **JQL queries** — bounded on both sides (`AFTER … BEFORE …`) in `buildJql`,
  `buildChurnJql`, and `buildRunJql` via the new `windowEnd` parameter. No impact on
  the figures (the window always ends on the current week), but queries are more
  explicit and lighter.
- **Documentation** — step-by-step procedure to create a JIRA Cloud API token;
  "Flow signals" table labels aligned with the actual rules.

## 1.10.0

- Run mode: **closed tickets** statistics alongside open tickets (card, weekly
  chart, list with closing date).

## 1.9.0

- Run mode: taking configured **closing statuses** into account (tickets closed by
  status leave the open stats).

## 1.8.0

- New **Run mode** per project (run labels, max priorities, closing statuses): open
  tickets, rolling 24-hour creations variance, unassigned, highest priorities with
  delays.

## 1.7.0

- Chart pass: the current week is now systematically distinguished (cards, bars,
  lines, table) using warm tones.

## 1.6.0

- "Added to Ready" recalibrated to the `Monday 12:00 → Friday midnight` window.

## 1.5.0

- Committed throughput measured on the `Monday 0h → 12h` window; committed and
  delivered merged into a grouped bar chart.

## 1.4.0

- Committed throughput = Monday snapshot; additions/removals definitions refined.

## 1.3.0

- Committed throughput, flow signals (additions to Ready, moves back to backlog),
  current week in yellow.

## 1.2.0

- Lead time and cycle time bounded to the macrocycle start date.

## 1.1.0

- "Macrocycle start date" setting, handling of future / current-week cases, trends
  on completed weeks.

## 1.0.0

- Initial version: throughput, lead time, cycle time, and trends per team.
