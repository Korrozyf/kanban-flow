# Metrics reference — queries and calculations

This document describes **exactly** what Kanban Flow asks JIRA and **exactly** how each
figure on the dashboard is computed, including how your own settings change the result.
It is the reference companion to the summary tables in the
[README](../README.md#metric-definitions).

Everything described here is implemented in [`lib/metrics.js`](../lib/metrics.js)
(computation) and [`lib/jira.js`](../lib/jira.js) (REST calls). No metric is computed
server side: the extension downloads the tickets and does the arithmetic locally.

- [1. Conventions](#1-conventions)
- [2. Settings and what they drive](#2-settings-and-what-they-drive)
- [3. JIRA API calls](#3-jira-api-calls)
- [4. JQL queries](#4-jql-queries)
- [5. Status-time analysis](#5-status-time-analysis)
- [6. Build mode — indicator by indicator](#6-build-mode--indicator-by-indicator)
- [7. Run mode — indicator by indicator](#7-run-mode--indicator-by-indicator)
- [8. Shared computations](#8-shared-computations)
- [9. Quick reference table](#9-quick-reference-table)
- [10. Markdown data export](#10-markdown-data-export)

---

## 1. Conventions

**Time zone.** Everything is computed in the **browser's local time**. JIRA returns
timestamps with an offset; they are parsed into local `Date` objects.

**Weeks.** A week runs from **Monday 00:00:00.000 to the next Monday 00:00:00.000
(exclusive)**. Bounds are half-open `[start, end[`, so a ticket dated Monday 00:00 on
the dot belongs to the week that *starts*, never to the one that ends.

**Analysis window.** Build and Run each remember an independent dashboard choice:

- **Last weeks** (`recent`, default) always loads exactly five weeks: the current week
  and the four previous weeks. It does not use the configured start date.
- **Since start date** (`complete` internally) loads from the Monday of the shared
  start date through the current week, but is capped at the **first 52 weeks**
  (`COMPLETE_WINDOW_WEEKS = 52`). Its Start date control is located in both Build and
  Run Analysis period sections and is synchronised between them. The range stays
  anchored at its start; if more history exists, recent weeks are excluded and the
  dashboard announces the exact range and truncation.
- Since start date without a valid start date falls back to Last weeks and announces why.
- The current week is marked only if it is actually present in the loaded range.

**Week's KPIs.** After each load, the final loaded week is selected. The user may
then choose any loaded week without another JIRA request. `selectedIndex` drives KPI
cards, trends and lists; `currentWeekIndex` separately identifies the true ongoing
week. A selected historical week never receives the current-week wording or colours.

**Daylight saving.** Week and day boundaries are computed in **calendar days**, never in
fixed 24-hour slices. A week can be 167 h or 169 h long; using a fixed step would either
double count an hour or lose one (helpers `addDays()` and `weekInstant()`).

**Status matching.** Project issue types, workflow-category statuses and status-time
chart statuses in Settings use JIRA-backed checkboxes; Lead/Cycle start statuses are
dropdowns. Choices are retrieved from the configured JIRA project and selected issue
types. Project types load automatically when a project key is entered or changed.
Workflow statuses load for the selected project-scope issue types, and the Lead/Cycle
start-status dropdowns contain only statuses common to their own selected issue types.
Saving performs any pending retrieval and shows each validation error on its own
highlighted line. These calls require saved JIRA connection details, a valid project key
and sufficient JIRA permissions.

---

## 2. Settings and what they drive

### Settings and dashboard analysis controls

| Setting | Key | Used by |
| --- | --- | --- |
| Start date | `startDate` | Shared Build/Run value, edited in either dashboard Analysis period section (not in Settings). Anchors Since start date in both modes and remains the lower bound for legacy all-statuses duration calculations (see §6.5). |
| Dashboard period | `buildPeriodMode`, `runPeriodMode` | Independent `recent` / `complete` choices (shown as Last weeks / Since start date), saved when **Apply** is pressed. |
| Cycle Time weekly aggregation | `aggregate` | `median` (default) or `average` for weekly Cycle Time values. The Lead Time overview uses arithmetic means. |
| "Stable" threshold (%) | `stableThresholdPct` | A week-over-week variation whose absolute value is ≤ this threshold is reported as *stable* instead of up/down. Default 10. |
| JIRA story points field | `storyPointsField` | Forces the custom field id. Empty ⇒ auto-detection by field name. |
| Committed — day / Start time / End time | `engageDay`, `engageStart`, `engageEnd` | Window in which a ticket must be in a configured Waiting or Work in progress status to count as *committed*. Workflow end is excluded. Start inclusive, end exclusive. Default Monday 00:00 → Monday 12:00. |
| Additions / removals — day / start & end | `churnStartDay`, `churnStartTime`, `churnEndDay`, `churnEndTime` | Window in which board additions and moves back to backlog are counted. Default Monday 12:00 → Saturday 00:00 (i.e. end of Friday). |

Counting windows are stored as an **offset from Monday 00:00** of each week and
re-anchored week by week, so they follow the week, not a fixed timestamp.

### Per-team settings (section 3)

| Setting | Key | Mode | Used by |
| --- | --- | --- | --- |
| JIRA project key | `key` | both | `project = "<key>"` in every query. |
| Kanban type | `mode` | both | Selects the build or run engine. |
| Additional JQL | `extraJql` | both | Appended to the team's shared metric queries before deterministic ordering. A trailing top-level `ORDER BY` is ignored; all filter clauses (including Atlassian account IDs) are preserved. It is intentionally omitted from the dedicated Epic Lead Time queries (§6.5). |
| Issue types counted | `issueTypes` | both | Appended as `AND issuetype IN (…)` to the team's shared metric queries. Empty ⇒ all types. The dedicated Epic Lead Time queries (§6.5) use Epic directly and bypass this setting. |
| Lead Time issue types / start / fallback | `leadTimeIssueTypes`, `leadTimeStartStatus`, `leadTimeFallbackEnabled` | build | Project-specific type selection and common start status. Empty type list means all project types. The fallback is enabled by default and sums common non-Done status time from creation when the start is not reached. Empty start preserves legacy creation-to-close behavior. |
| Cycle Time issue types / start | `cycleTimeIssueTypes`, `cycleTimeStartStatus` | build | Independent project-specific type selection and common start status. Empty type list means all project types; empty start measures from issue creation. |
| Legacy duration status filters | `leadTimeStatuses`, `cycleTimeStatuses` | build | Retained only for v1.37 import compatibility; new settings use a start status and JIRA Done categories. |
| Backlog (outside the board) | `backlogStatuses` | both | Build moves-back-to-backlog signal; Run splits open tickets into *on the board* vs *unplanned*. |
| Waiting (on the board, no active work) | `waitingStatuses` | both | Combined into the derived board-status set and eligible for Build committed throughput. |
| Work in progress (on the board, active work) | `inProgressStatuses` | both | Combined into board statuses and eligible for Build committed throughput. It does not determine Lead Time or Cycle Time starts. |
| Workflow end (on the board, complete) | `doneStatuses` | both | Combined into board statuses, but excluded from Build committed throughput; Run closure detection; Build compatibility fallback when JIRA's Done-category catalog is unavailable. |
| Derived board statuses | `readyStatuses` | both | Union of Waiting, Work in progress, and Workflow end; used by Build additions-to-board and distinct status-time chart treatment. |
| Kanban flow statuses (ordered) | `statusTimeFlow.build`, `statusTimeFlow.run` | respective mode | Ordered statuses shown in status-time charts. Workflow end statuses are omitted automatically. |
| Track story points | `trackStoryPoints` | build | Enables the story points card, chart and column. |
| Run ticket labels | `runLabels` | run | `labels IN (…)` in the run query. Empty ⇒ the whole project. |
| "Highest" priorities | `maxPriorities` | run | Membership of the highest-priority list. |

The four workflow categories are configured **once per team and shared by Build and Run**.
`readyStatuses` is derived from the three on-board groups; it is not an independent
setting. Build closing dates continue to use JIRA's green Done category when its status
catalog is available, with `doneStatuses` as a compatibility fallback.

---

## 3. JIRA API calls

All calls are authenticated with **HTTP Basic** (Atlassian e-mail + API token) against
your site's REST API v3.

| Endpoint | Method | When | Why |
| --- | --- | --- | --- |
| `/rest/api/3/myself` | GET | *Test connection* button | Credential check. |
| `/rest/api/3/search/jql` | POST | Every analysis | Ticket search, paginated with `nextPageToken`, 100 issues per page (up to 100 pages), `expand: "changelog"`. Run sends separate weekly and monthly candidate searches; overlapping issue keys share one full-changelog fetch. If the optional monthly search fails or reaches the page cap, weekly Run results still render and the monthly chart is marked unavailable. |
| `/rest/api/3/issue/{key}/changelog` | GET | Fallback | Only when the changelog embedded in the search result is **truncated** (`total > histories.length`). Paginated. |
| `/rest/api/3/priority` | GET | Run analysis | Real priority order of your site, used to sort ticket lists. Falls back to a built-in order if unavailable. |
| `/rest/api/3/issue/{key}/comment?maxResults=1&orderBy=created` | GET | Run analysis | Date of the **first comment**, one call per highest-priority ticket. |
| `/rest/api/3/field` | GET | Build analysis | Story points field detection, only when the option is on and no field id is configured. |
| `/rest/api/3/project/{key}` | GET | Settings page | Automatically loads a project's real issue type names when the project key is entered or an issue-type setting is used. |
| `/rest/api/3/project/{key}/statuses` | GET | Settings page and Build analysis | Settings loads statuses grouped by issue type for workflow setup and Lead/Cycle choices. Workflow checkboxes use statuses available to the selected project-scope types; Lead/Cycle start choices intersect their own selected types. Build uses the JIRA Done category as the authoritative end boundary. |

**Fields requested** in the search:

- build: `created`, `resolutiondate`, `summary`, `labels`, `status`, `issuetype` (+ the story
  points custom field when the option is on);
- run: `created`, `updated`, `resolutiondate`, `resolution`, `summary`, `labels`,
  `status`, `assignee`, `priority` (used by both weekly and monthly searches);
- board snapshot and flow-signal queries: the default four fields — only the changelog
  matters there;
- status-time query: `created`, `summary`, `labels`, `status` and a complete changelog.
  It is an additional candidate query only; the extension reconstructs and clips the
  actual intervals locally.

**Story points field detection.** `GET /rest/api/3/field` is scanned for an exact name
match among `story points`, `story point estimate`, a French-localized field name,
and `story point`, then for a loose `/story\s*point/i` match. If nothing is found,
the metric is disabled and the card says so; the rest of the dashboard is unaffected.

---

## 4. JQL queries

Dates are injected as `YYYY-MM-DD`. In JQL a date without a time means **00:00**, so
`BEFORE "<Monday following the last week>"` means *up to Sunday 23:59*. JQL is a
candidate pre-filter: date predicates are not uniformly two-sided, and exact half-open
event windows are enforced during local bucketing. Some branches intentionally have no
historical bound to recover current stock or fallback closures (see §4.4–§4.5). The
`resolution IS EMPTY` Run branch and the open-Epic query are current-stock queries and
intentionally have no historical lower bound.

Notation below: `W0` = Monday 00:00 of the first week of the window, `Wn` = Monday 00:00
of the week following the last week of the window, `TYPES` = `AND issuetype IN (…)` when
issue types are configured, `EXTRA` = `AND (<additional JQL>)` when set. Project keys
are validated against JIRA's letter-first, letters/digits/underscore format before a JQL
query is built, so malformed or imported keys cannot escape the selected project scope.
Run uses separate weekly and monthly JIRA searches. The weekly search (§4.4) starts its
resolution and closing-transition candidate branches at `W0` but includes unresolved
tickets without a historical lower bound; it is not widened back to `M0`. The monthly
search (§4.5) independently uses `M0` / `M1` for creation and resolution candidates, plus
its status-transition and current-Done fallback branches.

### 4.1 Build — delivered tickets (`buildJql`)

With "Done" statuses configured:

```jql
project = "KEY"
  AND status CHANGED TO ("Done", "Closed") AFTER "W0" BEFORE "Wn"
  TYPES EXTRA
ORDER BY updated DESC
```

Without them, a degraded fallback is used:

```jql
project = "KEY"
  AND statusCategory = Done
  AND resolutiondate >= "W0" AND resolutiondate < "Wn"
  TYPES EXTRA
ORDER BY updated DESC
```

Feeds: delivered throughput, delivered story points, weekly cycle-time values, and
completed tickets in the selected team scope. The Epic-only Lead Time overview uses the
dedicated project/type queries documented in §6.5; it intentionally bypasses this query's
project-level Issue types counted and Additional JQL clauses.

### 4.2 Build — board snapshot (`buildReadySnapshotJql`)

Returns `null` (query skipped, indicator hidden) when no Waiting or Work in progress status is configured.

```jql
project = "KEY"
  AND status WAS IN ("Waiting status", "Work in progress status") DURING ("W0", "Wn")
  TYPES EXTRA
ORDER BY updated DESC
```

The status list contains **only** the team's Waiting and Work in progress statuses;
Workflow end is never a committed status. `TYPES` is the selected **Issue types counted**
filter, and `EXTRA` is the team's Additional JQL. `WAS IN … DURING` deliberately also
returns tickets that entered an eligible status **before** the analysis period and are
still there; weekly windows are then checked independently by replaying each changelog.
Feeds: committed throughput.

### 4.3 Build — flow signals (`buildChurnJql`)

Returns `null` when neither board nor backlog statuses are configured.

```jql
project = "KEY"
  AND (   status CHANGED TO ("Ready")   AFTER "W0" BEFORE "Wn"
       OR status CHANGED TO ("Backlog") AFTER "W0" BEFORE "Wn" )
  TYPES EXTRA
ORDER BY updated DESC
```

Feeds: added to board, moved back to backlog. The JQL is only a **pre-filter**: the
actual counting re-reads each ticket's changelog to apply the counting window.

### 4.4 Run — weekly support tickets (`buildRunJql`)

```jql
project = "KEY"
  AND labels IN ("run", "support")
  AND created < "Wn"
  AND (   resolution IS EMPTY
       OR resolutiondate >= "W0"
       OR status CHANGED TO ("Done", "Closed") AFTER "W0" )
  TYPES EXTRA
ORDER BY created ASC
```

This query keeps unresolved tickets for stock reconstruction and resolved / closed
candidates since the first displayed week. `created < Wn` excludes tickets that do not
exist by the final selected-week cut-off. The `resolutiondate >= W0` and closing-status
transition (`AFTER W0`) branches are candidate prefilters with no JQL upper event-date
bound; exact weekly counts are filtered locally against each selected week's half-open
bounds. The `resolution IS EMPTY` branch has no historical lower bound, because tickets
created before the displayed range may still contribute to an open-ticket snapshot. The
monthly search is independent (§4.5); its earlier start does not widen this weekly query.

### 4.5 Run — monthly opened / closed (`buildRunMonthlyJql`)

The monthly chart issues a separate candidate query, independent of the weekly period
control. `M0` is January 1 of the previous calendar year; `M1` is the first day of the
month after the current month. Creation and resolution-date branches use these bounds;
the full candidate search is not date-bounded because of the fallback branch below.

```jql
project = "KEY"
  AND (   (created >= "M0" AND created < "M1")
       OR (resolutiondate >= "M0" AND resolutiondate < "M1")
       OR status CHANGED TO ("Done", "Closed") AFTER "day before M0" BEFORE "day after M1"
       OR (resolution IS EMPTY AND status IN ("Done", "Closed")) )
  AND labels IN ("run", "support")
  TYPES EXTRA
ORDER BY created ASC
```

The creation and resolution-date branches are bounded to `[M0, M1)`. The status-change
branch is widened by one calendar day on each side as a candidate pre-filter so
exact-midnight closures are not lost to JQL's `AFTER` / `BEFORE` semantics; local month
buckets enforce the precise half-open bounds. The final branch,
`(resolution IS EMPTY AND status IN (<configured closing statuses>))`, is intentionally
unbounded by date: it retrieves tickets currently in a closing status with no resolution,
so a ticket with no usable closing transition can use the Run fallback `closedAt = now`.
When no closing statuses are configured, both status-dependent branches are omitted.

The query uses the configured project, Run labels, selected **Issue types counted**, and
**Additional JQL**; unlike the Epic queries, it does not bypass the shared team scope.
Overlapping weekly and monthly result sets are deduplicated before any full changelog is
fetched. Monthly candidates with incomplete changelogs are reported in the chart note;
created counts remain based on JIRA's creation date, while a closing count may be affected
if its closing transition cannot be reconstructed.

Because that fallback can include old tickets, a large candidate set—especially a broad
scope with many currently Done tickets whose resolution is empty—may reach JIRA's
100-page safety cap. If this separate query fails or reaches the cap, the weekly Run
analysis continues. The monthly panel and Markdown export state that the comparison is
unavailable instead of showing misleading zero counts; retry with a narrower project,
issue-type selection or Additional JQL if the candidate population is too large.

The exact weekly and monthly JQL are both displayed at the bottom of the dashboard, so
you can paste each into JIRA and check its candidate population.

---

## 5. Status-time analysis

This analysis is available in Build and Run and is independent of **Week's KPIs**: it
uses the entire loaded analysis window. Its ordered flow is configured per team and per
mode in `statusTimeFlow.build` or `statusTimeFlow.run`. Names are matched after trim +
lowercase; the configured spelling and order are kept for the charts.

The extension runs a candidate query using `status WAS IN (...) DURING ("W0", "Wn")`,
then obtains complete changelogs. The query only narrows the population. For each
returned ticket, it replays every status transition, constructs known status intervals,
and intersects them with the half-open analysis range `[W0, min(Wn, now)[`.

- A ticket can contribute several intervals to the same status; its duration is the sum
  of those intervals. The average is then the sum divided by the number of tickets with
  a known interval in that status. The same calculation is performed separately for
  every loaded week after intervals are clipped to that week's half-open bounds.
- The chart compares the average over the whole observed analysis period with the
  average in the selected week. The current week ends at `now`, so future time is never
  included. A configured status with no observed interval remains visible with an
  unavailable selected-week value rather than a misleading zero.
- An entry into a configured closing status ends a flow interval naturally because that
  status is not in the configured flow. If the ticket is reopened into a flow status,
  a new interval starts. Closing statuses entered in the flow configuration are omitted.
- If the first changelog event gives no previous status, time before the first known
  status is not guessed. The dashboard reports partial tickets. Tickets whose complete
  changelog cannot be loaded are excluded and reported.
- Existing Board statuses use a grey category marker and an explicit `(Board)` label.
  Each displayed bar whose own average is **strictly above two days** receives a red
  dashed outline: independently for the observed-period bar and the selected-week bar.
  The status label receives an explicit `⚠` when either bar is marked. This also
  applies to Board statuses.

The comparison chart and its SVG description provide both averages, status name, and
whether a Board-category marker or threshold alert applies. Long configured flows are
horizontally scrollable and keyboard focusable.

---

## 6. Build mode — indicator by indicator

### 6.0 Ticket dates (shared preprocessing)

For each ticket returned by §4.1, `computeIssueDates()` derives:

- **End date** = date of the **last** transition **into** one of your "Done" statuses,
  read from the changelog. If the changelog has none, `resolutiondate` is used. A ticket
  with no end date is skipped entirely.
- **Start date** = date of the **first** transition into one of your "In progress"
  statuses. If there is none, the creation date is used instead and the ticket is
  flagged `*` in the list (cycle time then equals lead time).
- **Creation date** = JIRA `created`.
- **Clamping**: in Complete, creation/start dates earlier than the configured start
  date are pulled forward to it. In Last weeks, the clamp is the earlier of a valid
  configured start and the first loaded week, so a future/recent start date cannot
  create negative durations for weeks that Last weeks deliberately includes.

The ticket is then attached to the week containing its **end date**
(`weekIndexOf(doneDate)`); tickets ending outside the window are ignored.

### 6.1 Delivered throughput

> Number of tickets whose **end date** falls in the week.

```
throughput[w] = count( tickets | end date ∈ [week w start, week w end[ )
```

Settings involved: project key, "Done" statuses, issue types, additional JQL and loaded
period. Trend: selected week vs previous loaded week, higher is better.

### 6.2 Committed throughput

> Number of tickets in a configured **Waiting or Work in progress status** during that
> week's Committed counting window. **Workflow end statuses are excluded.**

The candidate query (§4.2) scopes issues to the configured JIRA project, the selected
**Issue types counted**, and **Additional JQL**. It asks JIRA only for issues whose status
history includes a configured Waiting or Work in progress status; Workflow end statuses
are not part of the committed candidate set. For each week `w`, the configured Committed
**day**, **start time**, and **end time** are re-anchored to that week:

```
start = week w Monday 00:00 + configured Committed day/start time
end   = week w Monday 00:00 + configured Committed day/end time
committed[w] += 1 if status ∈ (Waiting ∪ Work in progress) at any instant of [start, end)
```

Eligibility inside the window is evaluated by **replaying the complete changelog**. The
status at `start` is reconstructed (`statusAtTime()`); if it is not Waiting or Work in
progress, transitions inside the window are scanned for an entry into either group
(`wasReadyDuring()`). The issue must already exist before the exclusive `end` boundary;
no status is inferred for instants before its JIRA creation date. A transition exactly at
`start` is included, and one exactly at `end` is excluded. Tickets with incomplete
changelogs are excluded from this reconstructed count and reported as unavailable
candidates. Selected issue types are also checked locally before counting.

This is a **stock**, not a flow: an issue that remains in Waiting or Work in progress
across multiple weekly windows can count once in each such week. A ticket in Workflow end
or Backlog never counts as Committed, even though Workflow end remains part of the broader
board-status set and Backlog remains a separate workflow category.

Settings involved: JIRA project key, Additional JQL, Issue types counted, Waiting and Work
in progress statuses, and the Committed counting window (day/start/end). If neither
Waiting nor Work in progress is configured, the query is skipped and the indicator is
hidden.

### 6.3 Added to board / Moved back to backlog

> Number of **status transitions** into a board (resp. backlog) status, inside the
> additions/removals window of the week.

For every transition of every ticket returned by §4.3:

```
w = week containing the transition date            (skip if outside the window)
slot = [week w start + churn start offset, week w start + churn end offset[
skip if the transition is outside slot

added[w]        += 1  if  to ∈ board statuses    and from ∉ board statuses
backToBacklog[w]+= 1  if  to ∈ backlog statuses  and from ∉ backlog statuses
```

Notes:

- the origin status is irrelevant beyond "not already in the same family": a ticket
  entering the board from *anywhere* counts;
- these are **transitions**, so a ticket that goes onto the board and back to the backlog
  in the same week is counted on both sides — that is exactly the churn signal wanted;
- default slot is Monday 12:00 → Saturday 00:00, i.e. everything added after the weekly
  commitment point.

### 6.4 Delivered story points

Only when **Track story points** is enabled for the team.

```
storyPoints[w] = Σ ticket.<story points field>   over the tickets counted in throughput[w]
storyPointsCounts[w] = number of those tickets that carry a numeric value
```

The value is read from the custom field resolved in §3. A missing, empty or
non-numeric value is skipped: the ticket still counts in the throughput but contributes
0 to the sum, and shows `–` in the list. Same weekly bucketing as the throughput (end
date), so the two series describe the same population.

### 6.5 Lead time and cycle time

Each Build team has independent Lead Time and Cycle Time settings. The issue-type list is
resolved against the project's Issue Type Scheme. After the user selects types, the
status loader reads `/rest/api/3/project/{key}/statuses`, preserves the issue-type →
status relationship, and offers only statuses common to every selected type. An empty
type list means all issue types returned for the project.

The two metrics store separate start statuses:

```
leadStart  = first entry into the configured Lead start status
cycleStart = first entry into the configured Cycle start status
```

The start transition is included. The duration is the sum of every reconstructed interval
from that start through the closing boundary, excluding every interval whose status has
JIRA `statusCategory.key == "done"`; the closing transition itself is excluded. Time in
statuses before the start is never counted in the normal calculation. If work is reopened,
later non-Done intervals are counted again until the next/final Done boundary. When no Cycle
start is selected (and no legacy Cycle status filter is active), Cycle Time instead uses
elapsed time from issue creation to the closing boundary; this does not consult the shared
Work in progress category.

The closing boundary is the last transition into a status in the project's green Done
category. When the status catalog is unavailable, the saved `doneStatuses` names are a
compatibility fallback. Resolution date is only a final date fallback when no Done
transition is available.

A ticket whose issue type does not match a metric is excluded from that metric. For Lead
Time, the per-team fallback is enabled by default: when a selected ticket never reaches
the configured Lead start status, the calculation sums only the statuses common to all
selected Lead issue-type workflows, excluding Done-category statuses, from creation to
the final Done entry. This deliberately includes time before the configured start. The
fallback can be disabled in Settings. Cycle Time has no such fallback. If the fallback
is disabled, or the common non-Done status history cannot be reconstructed, the value is
Unavailable rather than assigned a zero. Neither case removes the ticket from delivered
throughput. Cycle Time values are collected by closing week and use the configured weekly
aggregation. Its start is independent of Workflow status setup: the selected
`cycleTimeStartStatus` is included; when none is selected (and no legacy status filter is
active), the duration starts at issue creation. Changing Work in progress statuses does
not change the Cycle Time result.

```
cycleWeekly[w] = median(eligible Cycle values of week w)     ← or average
```

The median is the default for Cycle Time because a single very old ticket would otherwise
dominate the average. A week with no eligible Cycle ticket has no value (the chart shows a
gap, the card shows `–`). Cycle trends use `higherIsBetter = false`. Settings load issue
types from the current team's JIRA project, then load common statuses for the selected
types. Start-status selections are validated against those JIRA choices before saving.

The **Epic Lead Time overview** is presented as three period-based indicators instead
of a weekly chart: latest Epic closure, arithmetic mean Lead Time for Epics closed in the
observed period, and growing Lead Time for currently open Epics. The average is
independent of the configurable median/average setting used for weekly Cycle Time.

Closed Epics are queried with `buildLeadEpicJql`:

```jql
project = "KEY"
  AND status CHANGED TO ("Done", "Closed") AFTER "W0" BEFORE "Wn"
  AND issuetype = "Epic"
ORDER BY updated DESC
```

When no Done status names are available, the query falls back to `statusCategory = Done`
and a bounded `resolutiondate` range. The open-Epic query uses `buildLeadEpicOpenJql`:

```jql
project = "KEY"
  AND statusCategory != Done
  AND issuetype = "Epic"
ORDER BY updated DESC
```

These dedicated queries are scoped to the selected JIRA project and the Epic issue type.
They deliberately omit the project-level **Issue types counted** and **Additional JQL**
filters, which may otherwise remove every Epic. The team's separate **Lead Time issue
types** selection is still enforced locally, along with its configured start status,
status filter, and fallback. The Epic query is only a Lead Time data source: its tickets
do not add to delivered/committed throughput, story points, Cycle Time, or the completed-
tickets table. The open-Epic query is separate from delivery. Incomplete histories or an
unavailable configured start are excluded from the mean and counted as unavailable. The
dashboard and Markdown overview report the number of values included and fallback usage.
The completed-tickets list still shows per-ticket Lead/Cycle values under the normal
project-wide query scope; excluded and unavailable values remain explicitly distinguished.
Cycle dots apply only to actual durations: green ≤ 2 days, amber 2–4 days, red > 4 days.

---

## 7. Run mode — indicator by indicator

### 7.0 Ticket normalisation (shared preprocessing)

For every ticket returned by §4.4:

- **Closing date** (`closedAt`), in order of preference:
  1. date of the **last transition into one of the closing statuses**, read from the
     changelog — this is what allows a `Cancelled` ticket with no resolution to be dated
     correctly;
  2. `resolutiondate`;
  3. *now*, as a last resort, flagged with `~` in the "Closed on" column.
- **Open** = not resolved **and** not in a closing status.
- **Unplanned** = open **and** in one of the run "Backlog" statuses.
- For each loaded week, the cut-off is its exclusive end for a past week, or `now` for
  the true current week. Status, backlog membership, assignee and priority are rewound
  from the changelog at that cut-off. If a complete value cannot be reconstructed, it
  is marked unavailable and never replaced silently with today's value.
- **Age since created** uses the cut-off. JIRA's current `updated` field cannot be
  rewound reliably, so **since last activity** is unavailable for historical cut-offs.

Priority ordering uses the site's own priority list (`GET /rest/api/3/priority`, highest
first); unknown or missing priorities sort last.

### 7.1 Open tickets

Two distinct things share the name:

**Weekly series** (bar chart) — a **creation-based** count, exclusive between weeks:

```
opened[w] = count( tickets | creation date ∈ week w )
```

**KPI card** — stock at the selected week's cut-off:

```
openNow = count( tickets open at cut-off ) = board list + unplanned list
```

It is compared with the reconstructed stock at the previous loaded week's cut-off.
Tickets created before `W0` remain eligible, so historical stock is not understated.

Trend: fewer is better.

**Lists.** Open tickets are split in two by the run "Backlog" statuses: *open tickets on
the board* and *unplanned open tickets (backlog)*. Both are sorted by **priority
descending, then creation date ascending** (oldest first), and show the two age counters
with a coloured dot: green ≤ 1 day, amber 1–2 days, red > 2 days.

### 7.2 Closed tickets

```
closed[w]       = count( tickets | closing date ∈ week w )
closedThisWeek  = closed[reference week]
```

For a past selected week, complete weeks are compared. For the true current week, the
previous week is truncated to the **same elapsed duration**, so a partial week is never
compared to a full one:

```
elapsed  = min(reference week end, now) − reference week start
prevCut  = min(previous week start + elapsed, previous week end)
closedPrevSameElapsed = count( tickets | closing date ∈ [previous week start, prevCut[ )
```

The full previous week total is still shown in the card note. Trend: more is better.

**List**: tickets closed **within the reference week only**, sorted by priority
descending then closing date descending, with the `created → closed` duration and the
same colour code.

### 7.3 Created tickets

```
createdThisWeek       = count( creation date ∈ [reference week start, reference week start + elapsed[ )
createdPrevSameElapsed= count( creation date ∈ [previous week start, prevCut[ )
```

The equal-elapsed-duration principle applies only to the true current week; historical
weeks compare complete weeks. Trend: **fewer is better** (more creations = more load).

### 7.4 Monthly opened vs closed

The monthly chart is independent of the Last weeks / Since start date selector. It shows
January through the current local-calendar month of the current year, with four series:
created and closed in the current year, and created and closed in the same months of the
previous year. **Opened** means the JIRA creation date falls in that month; **closed**
uses the canonical Run `closedAt` from §7.0. Each ticket is counted at most once per
month per flow series, using half-open calendar-month bounds.

Completed months compare the full month with its full same-name month last year. The
current month is partial and is compared with the same elapsed duration of the matching
month last year:

```
currentCut = now
elapsed = currentCut − currentMonthStart
previousCut = min(previousMonthStart + elapsed, previousMonthEnd)
```

Thus a short prior-year month is capped at its exclusive end; the comparison never spills
into the following month. The chart uses the same Run scope—project key, Run labels,
selected Issue types counted and Additional JQL—as the weekly statistics, but through the
independent monthly candidate search in §4.5; it does not widen the weekly search. Its
date-bounded branches span `M0`
(January 1 of the previous year) to `M1` (the first day of the next month); the closing-
status pre-filter is widened by a calendar day on each side, and the currently-Done/no-
resolution fallback remains intentionally unbounded. The current month's displayed values
are bounded at `now`; future dates are not counted.

### 7.5 Creations per day

For the reference week and the previous week, creations are split across the 7 calendar
days:

```
boundaries = Monday 00:00, +1 day, … +7 days      (calendar days, not 24 h slices)
createdPerDay[d] = count( creation date ∈ [boundary d, boundary d+1[ )
```

Each ticket lands in exactly one day of exactly one week. `elapsedDays` marks how many
days of the reference week have started, so the chart does not compare a day that has
not happened yet. Monday→Friday are always displayed; **Saturday and Sunday only appear
if at least one of the two weeks has a creation on them**.

### 7.6 Average resolution time

```
population = tickets closed within the reference week      (= the closed list)
avgResolutionHours = mean( closing date − creation date )   over that population
```

Comparison base: the same mean over the tickets closed in the previous week **within
the same elapsed duration** (`[previous week start, prevCut[`). Trend: shorter is
better. The card carries a coloured dot with the list thresholds (≤ 1 day, ≤ 2 days,
> 2 days).

### 7.7 Unassigned tickets

Snapshot at the selected cut-off: open tickets with no reconstructed assignee, sorted
by ascending creation date. A genuinely unassigned value is distinct from an assignee
history that is unavailable.

### 7.8 Highest-priority tickets

Snapshot at the selected cut-off: tickets whose reconstructed priority is one of the
team's configured "highest" values, sorted by priority descending then creation
ascending. For each of them:

```
hoursToFirstComment = first comment date − creation date     (one API call per ticket)
hoursToResolution   = resolution date    − creation date     ("unresolved" if none)
```

Negative durations (data anomalies) are discarded. Both delays use the age colour code.

---

## 8. Shared computations

### 8.1 Trend badges

Weekly KPI trend badges compare the **reference week to the previous week** (`computeTrend`): Lead Time is an observed-period summary and has no weekly trend.

```
pct = (last − previous) / |previous| × 100
|pct| ≤ stable threshold      → "stable"
pct > 0                       → up
pct < 0                       → down
"good" = up when higher is better, down otherwise
```

Special cases: fewer than two comparable values ⇒ no trend (`na`); a previous value of
exactly 0 ⇒ direction only, no percentage. Which side is "good":

| Indicator | Higher is better |
| --- | --- |
| Delivered throughput, committed throughput, delivered story points | yes |
| Cycle time | no |
| Open tickets (run), created tickets (run), average resolution time | no |
| Closed tickets (run) | yes |

For the true current week, three Run indicators (closed, created, average resolution
time) compare against the previous week truncated to the same elapsed duration. A
historical reference compares complete weeks.

### 8.2 Colour thresholds

| Where | Green | Amber | Red |
| --- | --- | --- | --- |
| Run age and duration counters, average resolution time | ≤ 1 day | 1–2 days | > 2 days |
| Build cycle time column | ≤ 2 days | 2–4 days | > 4 days |

Colour is never the only carrier of the information: each value also has a tooltip
spelling out the bracket.

### 8.3 Exclusivity of counts

Each weekly indicator attaches a ticket to **exactly one** week, and each monthly flow
series attaches it to **exactly one** calendar month, according to its creation or
canonical closing date. The year-over-year bar is a separate comparison series; it does
not carry a ticket between months within either year. The full rationale, including the
three deliberately non-exclusive weekly indicators, is in the README section
[Exclusivity of counts](../README.md#exclusivity-of-counts).

---

## 9. Quick reference table

| Indicator | Mode | Query | Reference event | Key settings |
| --- | --- | --- | --- | --- |
| Delivered throughput | build | §4.1 | end date | "Done" statuses |
| Committed throughput | build | §4.2 | Waiting / Work in progress presence during the configured window | project, Additional JQL, selected issue types, Waiting/WIP statuses, committed window |
| Added to board | build | §4.3 | transition date | board statuses, additions window |
| Moved back to backlog | build | §4.3 | transition date | backlog statuses, additions window |
| Delivered story points | build | §4.1 | end date | track story points, story points field |
| Epic Lead Time overview | build | §6.5 | Epic closures in observed period / current open Epics | Project + Epic query; Lead types, start status, fallback, Done category; ignores project Issue types counted and Additional JQL |
| Cycle time | build | §4.1 | end date | Cycle types, configured start status, Done category, weekly aggregation |
| Open tickets (series) | run | §4.4 | creation date | run labels |
| Open tickets (card & lists) | run | §4.4 | stock at selected cut-off | closing statuses, run "Backlog" statuses |
| Closed tickets | run | §4.4 | closing date | closing statuses |
| Created tickets | run | §4.4 | creation date | run labels |
| Monthly opened / closed | run | §4.5 | creation / closing date, calendar month | run labels; project, issue types and Additional JQL |
| Creations per day | run | §4.4 | creation date | run labels |
| Average resolution time | run | §4.4 | closing date | closing statuses |
| Unassigned | run | §4.4 | stock at selected cut-off | run labels |
| Highest priority | run | §4.4 + comments | stock at selected cut-off | "highest" priorities |

All team-scoped rows additionally depend on: project key, Run labels where applicable,
Issue types counted and Additional JQL. Weekly rows also use the selected period and
reference week; weekly trend wording uses the "stable" threshold. The monthly Run chart
always uses the current calendar year and same months last year, independent of the
weekly period selector.

---

## 10. Markdown data export

The dashboard can build a local, mode-specific Markdown file from the data already
loaded in the browser. It sends no extra request to JIRA and does not send data to an
AI service.

- **Markdown: Summary** (default) contains metadata, the selected **Week's KPIs**,
  the Lead Time overview, weekly trends and series, selected-week daily Run creations,
  the status-time averages for the observed period and selected week, the Run monthly
  opened/closed comparison, plus concise interpretation notes. It contains no individual
  ticket row; the latest Lead Time is
  reported without a ticket key in this level.
- **Markdown: Analysis-ready (ticket lists)** adds only the ticket fields visible in
  the dashboard: key, summary, labels and the relevant status, priority, assignee,
  date and duration fields. It includes the Build completed list or the Run
  highest-priority, unassigned, board, backlog and closed lists.
- Historical Run values that cannot be reconstructed remain explicitly
  `Unavailable`. Full JIRA issue descriptions, the JIRA URL, e-mail and API token are
  never exported.
- **Download Markdown** writes a `.md` file; **Copy Markdown** copies the exact same
  content to the clipboard. Both operate on the mode and Week's KPIs currently shown.
