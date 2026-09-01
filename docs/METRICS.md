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
- [5. Build mode — indicator by indicator](#5-build-mode--indicator-by-indicator)
- [6. Run mode — indicator by indicator](#6-run-mode--indicator-by-indicator)
- [7. Shared computations](#7-shared-computations)
- [8. Quick reference table](#8-quick-reference-table)

---

## 1. Conventions

**Time zone.** Everything is computed in the **browser's local time**. JIRA returns
timestamps with an offset; they are parsed into local `Date` objects.

**Weeks.** A week runs from **Monday 00:00:00.000 to the next Monday 00:00:00.000
(exclusive)**. Bounds are half-open `[start, end[`, so a ticket dated Monday 00:00 on
the dot belongs to the week that *starts*, never to the one that ends.

**Analysis window.** Driven by the **Start date** setting (`startDate`, legacy key
`macrocycleStart`):

- the window is the **week containing the start date plus the 4 following weeks**
  (`WINDOW_WEEKS = 5`);
- if the **current week falls inside** that period, the window stops there (fewer than
  5 weeks may be displayed) and the current week is the reference week;
- if the window is **entirely in the past**, all 5 weeks are displayed, **none** is
  flagged as current, and the **last week of the window** becomes the reference week
  for the KPI cards and trends;
- if the start date is **in the future**, the dashboard says so and computes nothing;
- if the start date is **empty**, the window falls back to the 5 weeks ending on the
  current week.

**Reference week.** Called `currentIndex` in the code. It is the last week displayed.
`hasCurrentWeek` tells whether that week really is the ongoing one; when it is not, the
current-week colour code and wording are switched off across the whole page.

**Daylight saving.** Week and day boundaries are computed in **calendar days**, never in
fixed 24-hour slices. A week can be 167 h or 169 h long; using a fixed step would either
double count an hour or lose one (helpers `addDays()` and `weekInstant()`).

**Status matching.** Every status you type in the settings is compared to the JIRA
status name after `trim()` + lowercase. The names must otherwise match your JIRA
statuses exactly — a status you mistype simply never matches, which is the historical
cause of counters stuck at zero.

---

## 2. Settings and what they drive

### Global settings (section 2 of the settings page)

| Setting | Key | Used by |
| --- | --- | --- |
| Start date | `startDate` | Builds the 5-week window (both modes). Also **clamps** lead/cycle time (see §5.5). |
| Lead/cycle time aggregation | `aggregate` | `median` (default) or `average` for the weekly lead and cycle time series. |
| "Stable" threshold (%) | `stableThresholdPct` | A week-over-week variation whose absolute value is ≤ this threshold is reported as *stable* instead of up/down. Default 10. |
| JIRA story points field | `storyPointsField` | Forces the custom field id. Empty ⇒ auto-detection by field name. |
| Committed — day / start / end | `engageDay`, `engageStart`, `engageEnd` | Window in which a ticket must have been on the board to be *committed*. Default Monday 00:00 → Monday 12:00. |
| Additions / removals — start & end | `churnStartDay`, `churnStartTime`, `churnEndDay`, `churnEndTime` | Window in which board additions and moves back to backlog are counted. Default Monday 12:00 → Saturday 00:00 (i.e. end of Friday). |

Counting windows are stored as an **offset from Monday 00:00** of each week and
re-anchored week by week, so they follow the week, not a fixed timestamp.

### Per-team settings (section 3)

| Setting | Key | Mode | Used by |
| --- | --- | --- | --- |
| JIRA project key | `key` | both | `project = "<key>"` in every query. |
| Kanban type | `mode` | both | Selects the build or run engine. |
| Additional JQL | `extraJql` | both | Appended as `AND (<your JQL>)` to **every** query of that team. |
| Issue types counted | `issueTypes` | both | Appended as `AND issuetype IN (…)` to **every** query. Empty ⇒ all types. |
| "In progress" statuses | `inProgressStatuses` | build | Start of cycle time. |
| "Done" statuses | `doneStatuses` | build | End date ⇒ throughput, story points, lead, cycle. |
| Board statuses | `readyStatuses` | build | Committed throughput + additions to board. |
| "Backlog" statuses | `backlogStatuses` | build | Moves back to backlog. |
| Track story points | `trackStoryPoints` | build | Enables the story points card, chart and column. |
| Run ticket labels | `runLabels` | run | `labels IN (…)` in the run query. Empty ⇒ the whole project. |
| "Highest" priorities | `maxPriorities` | run | Membership of the highest-priority list. |
| Closing statuses | `doneStatuses` | run | A ticket in one of them counts as closed even without a resolution. |
| Run "Backlog" statuses | `backlogStatuses` | run | Splits open tickets into *on the board* vs *unplanned*. |

`doneStatuses` and `backlogStatuses` are **shared** between the two modes: the settings
page shows a different input per mode, but they write to the same key.

---

## 3. JIRA API calls

All calls are authenticated with **HTTP Basic** (Atlassian e-mail + API token) against
your site's REST API v3.

| Endpoint | Method | When | Why |
| --- | --- | --- | --- |
| `/rest/api/3/myself` | GET | *Test connection* button | Credential check. |
| `/rest/api/3/search/jql` | POST | Every analysis | Ticket search, paginated with `nextPageToken`, 100 issues per page, `expand: "changelog"`. |
| `/rest/api/3/issue/{key}/changelog` | GET | Fallback | Only when the changelog embedded in the search result is **truncated** (`total > histories.length`). Paginated. |
| `/rest/api/3/priority` | GET | Run analysis | Real priority order of your site, used to sort ticket lists. Falls back to a built-in order if unavailable. |
| `/rest/api/3/issue/{key}/comment?maxResults=1&orderBy=created` | GET | Run analysis | Date of the **first comment**, one call per highest-priority ticket. |
| `/rest/api/3/field` | GET | Build analysis | Story points field detection, only when the option is on and no field id is configured. |
| `/rest/api/3/project/{key}` | GET | Settings page | *Load types from JIRA* button — lists the project's real issue type names. |

**Fields requested** in the search:

- build: `created`, `resolutiondate`, `summary`, `status` (+ the story points custom
  field when the option is on);
- run: `created`, `updated`, `resolutiondate`, `resolution`, `summary`, `status`,
  `assignee`, `priority`;
- board snapshot and flow-signal queries: the default four fields — only the changelog
  matters there.

**Story points field detection.** `GET /rest/api/3/field` is scanned for an exact name
match among `story points`, `story point estimate`, `points de story`, `story point`,
then for a loose `/story\s*point/i` match. If nothing is found, the metric is disabled
and the card says so; the rest of the dashboard is unaffected.

---

## 4. JQL queries

Dates are injected as `YYYY-MM-DD`. In JQL a date without a time means **00:00**, so
`BEFORE "<Monday following the last week>"` really means *up to Sunday 23:59*. Every
query is bounded on **both** sides.

Notation below: `W0` = Monday 00:00 of the first week of the window, `Wn` = Monday 00:00
of the week following the last week of the window, `TYPES` = `AND issuetype IN (…)` when
issue types are configured, `EXTRA` = `AND (<additional JQL>)` when set.

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

Feeds: delivered throughput, delivered story points, lead time, cycle time, and the
completed-tickets list.

### 4.2 Build — board snapshot (`buildReadySnapshotJql`)

Returns `null` (query skipped, indicator hidden) when no board status is configured.

```jql
project = "KEY"
  AND status WAS IN ("Ready") DURING ("W0", "Wn")
  TYPES EXTRA
ORDER BY updated DESC
```

`WAS IN … DURING` deliberately also returns tickets that entered the board **before**
the window and are still there. Feeds: committed throughput.

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

### 4.4 Run — support tickets (`buildRunJql`)

```jql
project = "KEY"
  AND labels IN ("run", "support")
  AND (   (created >= "W0" AND created < "Wn")
       OR (resolutiondate >= "W0" AND resolutiondate < "Wn")
       OR resolution IS EMPTY )
  TYPES EXTRA
ORDER BY created ASC
```

The three OR branches exist for three different needs: tickets **created** in the window
(weekly creations), tickets **closed** in the window but created before it (otherwise the
"closed this week" list would miss them), and **every still-open ticket** whatever its
age (the open-tickets stock is a current snapshot, not a windowed count).

The exact JQL actually sent is displayed at the bottom of the dashboard, so you can
paste it into JIRA and check the population yourself.

---

## 5. Build mode — indicator by indicator

### 5.0 Ticket dates (shared preprocessing)

For each ticket returned by §4.1, `computeIssueDates()` derives:

- **End date** = date of the **last** transition **into** one of your "Done" statuses,
  read from the changelog. If the changelog has none, `resolutiondate` is used. A ticket
  with no end date is skipped entirely.
- **Start date** = date of the **first** transition into one of your "In progress"
  statuses. If there is none, the creation date is used instead and the ticket is
  flagged `*` in the list (cycle time then equals lead time).
- **Creation date** = JIRA `created`.
- **Clamping**: creation date and start date earlier than the configured **Start date**
  are pulled forward to it. Time elapsed before the start date is never counted, so
  a long-standing ticket does not produce an absurd lead time.

The ticket is then attached to the week containing its **end date**
(`weekIndexOf(doneDate)`); tickets ending outside the window are ignored.

### 5.1 Delivered throughput

> Number of tickets whose **end date** falls in the week.

```
throughput[w] = count( tickets | end date ∈ [week w start, week w end[ )
```

Settings involved: project key, "Done" statuses, issue types, additional JQL, start date
(window). Trend: current week vs previous week, higher is better.

### 5.2 Committed throughput

> Number of tickets that were **on the board during the committed window** of the week.

For each week `w` and each ticket of the snapshot query (§4.2), the counting window is
re-anchored to that week:

```
start = week w Monday 00:00 + engage start offset      (default Monday 00:00)
end   = week w Monday 00:00 + engage end offset        (default Monday 12:00)
committed[w] += 1  if the ticket was in a board status at any instant of [start, end]
```

"Was in a board status" is evaluated by **replaying the changelog**: the status at
`start` is reconstructed (`statusAtTime()`), and if it is not a board status, every
transition inside the window is scanned for an entry into one (`wasReadyDuring()`).
Bounds here are **inclusive** on both ends.

This is a **stock**, not a flow: a ticket sitting on the board for three weeks is counted
in all three. That is intentional — the question is "how much work had the team taken on
that Monday morning?".

Settings involved: board statuses, committed window (day/start/end), issue types,
additional JQL. If no board status is configured, the query is skipped and the indicator
is hidden.

### 5.3 Added to board / Moved back to backlog

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

### 5.4 Delivered story points

Only when **Track story points** is enabled for the team.

```
storyPoints[w] = Σ ticket.<story points field>   over the tickets counted in throughput[w]
storyPointsCounts[w] = number of those tickets that carry a numeric value
```

The value is read from the custom field resolved in §3. A missing, empty or
non-numeric value is skipped: the ticket still counts in the throughput but contributes
0 to the sum, and shows `–` in the list. Same weekly bucketing as the throughput (end
date), so the two series describe the same population.

### 5.5 Lead time and cycle time

Per ticket, in days:

```
lead  = (end date − creation date) / 86 400 000
cycle = (end date − start date)    / 86 400 000
```

Both use the **clamped** dates of §5.0. Negative values (data anomalies) are discarded.
Values are collected per week, then aggregated:

```
leadWeekly[w]  = median(lead values of week w)     ← or average, per the setting
cycleWeekly[w] = median(cycle values of week w)
```

The median is the default because a single very old ticket would otherwise dominate the
average. A week with no completed ticket has no value (the chart shows a gap, the card
shows `–`). Trends use `higherIsBetter = false`.

The completed-tickets list shows the per-ticket values, with a coloured dot on the cycle
time: green ≤ 2 days, amber 2–4 days, red > 4 days.

---

## 6. Run mode — indicator by indicator

### 6.0 Ticket normalisation (shared preprocessing)

For every ticket returned by §4.4:

- **Closing date** (`closedAt`), in order of preference:
  1. date of the **last transition into one of the closing statuses**, read from the
     changelog — this is what allows a `Cancelled` ticket with no resolution to be dated
     correctly;
  2. `resolutiondate`;
  3. *now*, as a last resort, flagged with `~` in the "Closed on" column.
- **Open** = not resolved **and** not in a closing status.
- **Unplanned** = open **and** in one of the run "Backlog" statuses.
- **Age counters** (hours): `now − created` and `now − updated`.

Priority ordering uses the site's own priority list (`GET /rest/api/3/priority`, highest
first); unknown or missing priorities sort last.

### 6.1 Open tickets

Two distinct things share the name:

**Weekly series** (bar chart) — a **creation-based** count, exclusive between weeks:

```
opened[w] = count( tickets | creation date ∈ week w )
```

**KPI card** — the **current stock**:

```
openNow = count( tickets currently open )        = board list + unplanned list
```

compared to the stock still open at the end of the previous week:

```
openAtPrevWeekEnd = count( tickets | created < previous week end
                                     and (not closed or closed ≥ previous week end) )
```

Trend: fewer is better.

**Lists.** Open tickets are split in two by the run "Backlog" statuses: *open tickets on
the board* and *unplanned open tickets (backlog)*. Both are sorted by **priority
descending, then creation date ascending** (oldest first), and show the two age counters
with a coloured dot: green ≤ 1 day, amber 1–2 days, red > 2 days.

### 6.2 Closed tickets

```
closed[w]       = count( tickets | closing date ∈ week w )
closedThisWeek  = closed[reference week]
```

Comparison base — the previous week truncated to the **same elapsed duration**, so a
partial week is never compared to a full one:

```
elapsed  = min(reference week end, now) − reference week start
prevCut  = min(previous week start + elapsed, previous week end)
closedPrevSameElapsed = count( tickets | closing date ∈ [previous week start, prevCut[ )
```

The full previous week total is still shown in the card note. Trend: more is better.

**List**: tickets closed **within the reference week only**, sorted by priority
descending then closing date descending, with the `created → closed` duration and the
same colour code.

### 6.3 Created tickets

```
createdThisWeek       = count( creation date ∈ [reference week start, reference week start + elapsed[ )
createdPrevSameElapsed= count( creation date ∈ [previous week start, prevCut[ )
```

Same "equal elapsed duration" principle as §6.2. Trend: **fewer is better** (more
creations = more incoming load).

### 6.4 Creations per day

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

### 6.5 Average resolution time

```
population = tickets closed within the reference week      (= the closed list)
avgResolutionHours = mean( closing date − creation date )   over that population
```

Comparison base: the same mean over the tickets closed in the previous week **within
the same elapsed duration** (`[previous week start, prevCut[`). Trend: shorter is
better. The card carries a coloured dot with the list thresholds (≤ 1 day, ≤ 2 days,
> 2 days).

### 6.6 Unassigned tickets

Current snapshot, no weekly bucketing: open tickets with no assignee, sorted by
ascending creation date.

### 6.7 Highest-priority tickets

Current snapshot: tickets whose priority is one of the team's configured "highest"
values, sorted by priority descending then creation ascending. For each of them:

```
hoursToFirstComment = first comment date − creation date     (one API call per ticket)
hoursToResolution   = resolution date    − creation date     ("unresolved" if none)
```

Negative durations (data anomalies) are discarded. Both delays use the age colour code.

---

## 7. Shared computations

### 7.1 Trend badges

Every KPI card compares the **reference week to the previous week** (`computeTrend`):

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
| Lead time, cycle time | no |
| Open tickets (run), created tickets (run), average resolution time | no |
| Closed tickets (run) | yes |

Three run indicators (closed, created, average resolution time) compare against the
previous week **truncated to the same elapsed duration**; the others compare full weekly
values.

### 7.2 Colour thresholds

| Where | Green | Amber | Red |
| --- | --- | --- | --- |
| Run age and duration counters, average resolution time | ≤ 1 day | 1–2 days | > 2 days |
| Build cycle time column | ≤ 2 days | 2–4 days | > 4 days |

Colour is never the only carrier of the information: each value also has a tooltip
spelling out the bracket.

### 7.3 Exclusivity of counts

Each weekly indicator attaches a ticket to **exactly one** week, the one containing its
reference event. The full rationale, including the three deliberately non-exclusive
indicators, is in the README section
[Exclusivity of counts](../README.md#exclusivity-of-counts).

---

## 8. Quick reference table

| Indicator | Mode | Query | Reference event | Key settings |
| --- | --- | --- | --- | --- |
| Delivered throughput | build | §4.1 | end date | "Done" statuses |
| Committed throughput | build | §4.2 | board presence during the window | board statuses, committed window |
| Added to board | build | §4.3 | transition date | board statuses, additions window |
| Moved back to backlog | build | §4.3 | transition date | backlog statuses, additions window |
| Delivered story points | build | §4.1 | end date | track story points, story points field |
| Lead time | build | §4.1 | end date | "Done" statuses, start date (clamp), aggregation |
| Cycle time | build | §4.1 | end date | "In progress" + "Done" statuses, start date (clamp), aggregation |
| Open tickets (series) | run | §4.4 | creation date | run labels |
| Open tickets (card & lists) | run | §4.4 | current snapshot | closing statuses, run "Backlog" statuses |
| Closed tickets | run | §4.4 | closing date | closing statuses |
| Created tickets | run | §4.4 | creation date | run labels |
| Creations per day | run | §4.4 | creation date | run labels |
| Average resolution time | run | §4.4 | closing date | closing statuses |
| Unassigned | run | §4.4 | current snapshot | run labels |
| Highest priority | run | §4.4 + comments | current snapshot | "highest" priorities |

All rows additionally depend on: project key, issue types counted, additional JQL, start
date (window), and "stable" threshold (trend wording).
