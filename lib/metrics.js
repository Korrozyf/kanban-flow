/* Kanban Flow — flow metrics computation (throughput, lead time, cycle time)
 * ISO weeks Monday to Sunday, in local time.
 */
(function (global) {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;

  // --- Week management (Monday -> Sunday, local time) ---
  function startOfWeek(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    const dow = (x.getDay() + 6) % 7; // Monday = 0 ... Sunday = 6
    x.setDate(x.getDate() - dow);
    return x;
  }

  // Number of weeks displayed, counted FROM the configured start date.
  const WINDOW_WEEKS = 5;
  // Kept for backwards compatibility with the previous naming (number of
  // previous weeks shown when no start date is configured).
  const MAX_PREV_WEEKS = WINDOW_WEEKS - 1;

  /* Reads the analysis start date from the config. `startDate` is the current
   * key; `macrocycleStart` is the legacy key kept so an older saved config or
   * an older exported file keeps working. */
  function configStartDate(cfg) {
    if (!cfg) return "";
    if (typeof cfg.startDate === "string" && cfg.startDate) return cfg.startDate;
    if (typeof cfg.macrocycleStart === "string" && cfg.macrocycleStart) {
      return cfg.macrocycleStart;
    }
    return "";
  }

  // Offset in CALENDAR DAYS (rather than 24h slices): essential to stay
  // accurate across daylight-saving changes (a week can be 167h or 169h).
  function addDays(date, n) {
    const x = new Date(date);
    x.setDate(x.getDate() + n);
    return x;
  }

  /* Converts an offset expressed in ms since Monday 00:00 into the REAL INSTANT
   * of the week in question. The "days" part is applied in calendar days, then
   * the "hours" part: a daylight-saving transition in the middle of the week no
   * longer shifts the counting boundaries. */
  function weekInstant(weekStart, offsetMs) {
    const d = Math.floor(offsetMs / DAY_MS);
    const rest = offsetMs - d * DAY_MS;
    return new Date(addDays(weekStart, d).getTime() + rest);
  }

  /* ---------- Configurable weekly counting windows (global setting) ----------
   * Windows are expressed as an OFFSET from Monday 00:00 of the week.
   * day: 0 = Monday … 6 = Sunday ; time: "HH:MM" (24:00 accepted).
   * Default values = historical behaviour:
   *   committed         : Monday 00:00 → Monday 12:00
   *   added / removed    : Monday 12:00 → Saturday 00:00 (= Friday end of day)
   */
  const WEEK_DAYS = [
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  ];
  // Fallback priority order (highest first) used if the JIRA API
  // /rest/api/3/priority is unreachable.
  const DEFAULT_PRIORITY_ORDER = [
    "Blocker", "Highest", "Critical", "High", "Major",
    "Medium", "Normal", "Low", "Minor", "Lowest", "Trivial",
  ];
  const DEFAULT_SLOTS = {
    engageDay: 0,
    engageStart: "00:00",
    engageEnd: "12:00",
    churnStartDay: 0,
    churnStartTime: "12:00",
    churnEndDay: 5,
    churnEndTime: "00:00",
  };

  function parseHm(time) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(time == null ? "" : time).trim());
    if (!m) return null;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h < 0 || h > 24 || mi < 0 || mi > 59) return null;
    if (h === 24 && mi !== 0) return null;
    return h * 3600000 + mi * 60000;
  }

  function slotOffset(day, time, fallbackMs) {
    const d = Number(day);
    const t = parseHm(time);
    if (!Number.isInteger(d) || d < 0 || d > 6 || t === null) return fallbackMs;
    return d * DAY_MS + t;
  }

  function offsetLabel(offsetMs) {
    const d = Math.floor(offsetMs / DAY_MS);
    const rest = offsetMs - d * DAY_MS;
    const h = Math.floor(rest / 3600000);
    const mi = Math.floor((rest % 3600000) / 60000);
    // Midnight on the dot reads better as "end of the previous day"
    // (Saturday 00:00 => "previous day 24:00").
    if (rest === 0 && d > 0) return `${WEEK_DAYS[Math.min(6, d - 1)]} 24h`;
    const day = WEEK_DAYS[Math.min(6, Math.max(0, d))] || "Monday";
    const hm = mi ? `${h}h${String(mi).padStart(2, "0")}` : `${h}h`;
    return `${day} ${hm}`;
  }

  /* Returns the offsets (ms since Monday 00:00) + human-readable labels. */
  function resolveSlots(cfg) {
    const c = cfg || {};
    const engageFrom = slotOffset(
      c.engageDay != null ? c.engageDay : DEFAULT_SLOTS.engageDay,
      c.engageStart || DEFAULT_SLOTS.engageStart,
      0
    );
    const engageTo = slotOffset(
      c.engageDay != null ? c.engageDay : DEFAULT_SLOTS.engageDay,
      c.engageEnd || DEFAULT_SLOTS.engageEnd,
      12 * 3600000
    );
    const churnFrom = slotOffset(
      c.churnStartDay != null ? c.churnStartDay : DEFAULT_SLOTS.churnStartDay,
      c.churnStartTime || DEFAULT_SLOTS.churnStartTime,
      12 * 3600000
    );
    const churnTo = slotOffset(
      c.churnEndDay != null ? c.churnEndDay : DEFAULT_SLOTS.churnEndDay,
      c.churnEndTime || DEFAULT_SLOTS.churnEndTime,
      5 * DAY_MS
    );
    return {
      engageFrom,
      engageTo: engageTo > engageFrom ? engageTo : engageFrom + 12 * 3600000,
      churnFrom,
      churnTo: churnTo > churnFrom ? churnTo : churnFrom + DAY_MS,
      engageLabel: `${offsetLabel(engageFrom)} → ${offsetLabel(engageTo)}`,
      churnLabel: `${offsetLabel(churnFrom)} → ${offsetLabel(churnTo)}`,
    };
  }

  // Returns the last N weeks (the last one = current week).
  function buildWeeks(n, now) {
    const ref = now ? new Date(now) : new Date();
    const currentMonday = startOfWeek(ref);
    const weeks = [];
    for (let i = n - 1; i >= 0; i--) {
      const start = new Date(currentMonday);
      start.setDate(start.getDate() - i * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 7); // exclusive boundary
      weeks.push({ start, end, label: formatWeekLabel(start) });
    }
    return weeks;
  }

  /* Parses the analysis start date as a LOCAL date at midnight.
   * Accepts "YYYY-MM-DD" (avoids the UTC shift of new Date()). Returns null if
   * missing or invalid. */
  function parseStartDate(startDate) {
    if (!startDate) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(startDate).trim());
    const parsed = m
      ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      : new Date(startDate);
    if (isNaN(parsed.getTime())) return null;
    parsed.setHours(0, 0, 0, 0);
    return parsed;
  }

  /* Builds the week window FROM the configured start date: the week containing
   * that date, plus the WINDOW_WEEKS - 1 weeks that follow, stopping at the
   * current week when it falls inside that period.
   *
   * Two situations:
   *  - the current week is inside the window → it is the last week displayed
   *    and is flagged `current` (incomplete);
   *  - the whole window is in the past → the WINDOW_WEEKS weeks are displayed,
   *    none is flagged `current`, and the last one is the reference week for
   *    the key figures and the trends.
   *
   * Returns:
   *  - future: true            → the first week is after the current week
   *  - weeks[]                 → { start, end, label, current, complete }
   *  - currentIndex            → index of the reference week (last one shown)
   *  - hasCurrentWeek          → the reference week IS the current week
   *  - completeCount           → number of complete weeks shown
   *  - hasComparison           → at least 1 previous week to compare against
   */
  function buildWindowWeeks(startDate, now) {
    const currentWeekStart = startOfWeek(now ? new Date(now) : new Date());
    // Without a valid start date: fall back to a window ending on the current
    // week (WINDOW_WEEKS weeks up to today).
    let parsed = parseStartDate(startDate);
    if (!parsed || isNaN(parsed.getTime())) {
      parsed = addDays(currentWeekStart, -(WINDOW_WEEKS - 1) * 7);
    }
    const firstWeekStart = startOfWeek(parsed);
    const msPerWeek = 7 * DAY_MS;
    // Rounded to absorb daylight-saving shifts.
    const diffWeeks = Math.round((currentWeekStart - firstWeekStart) / msPerWeek);

    if (diffWeeks < 0) {
      return {
        future: true,
        weeks: [],
        currentIndex: -1,
        hasCurrentWeek: false,
        completeCount: 0,
        hasComparison: false,
        firstWeekStart,
        currentWeekStart,
      };
    }

    const count = Math.min(WINDOW_WEEKS, diffWeeks + 1);
    const weeks = [];
    for (let i = 0; i < count; i++) {
      const start = addDays(firstWeekStart, i * 7);
      const end = addDays(start, 7); // exclusive boundary
      const isCurrent = i === diffWeeks;
      weeks.push({
        start,
        end,
        label: formatWeekLabel(start),
        current: isCurrent, // current week (incomplete)
        complete: !isCurrent, // complete week (Mon→Sun elapsed)
      });
    }
    const hasCurrentWeek = diffWeeks <= count - 1;
    return {
      future: false,
      weeks,
      currentIndex: count - 1,
      hasCurrentWeek,
      completeCount: hasCurrentWeek ? count - 1 : count,
      hasComparison: count >= 2,
      firstWeekStart,
      currentWeekStart,
    };
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }
  function formatWeekLabel(start) {
    return `${pad2(start.getDate())}/${pad2(start.getMonth() + 1)}`;
  }
  function isoDate(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function weekIndexOf(date, weeks) {
    for (let i = 0; i < weeks.length; i++) {
      if (date >= weeks[i].start && date < weeks[i].end) return i;
    }
    return -1;
  }

  // --- Aggregations ---
  function median(arr) {
    if (!arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function average(arr) {
    if (!arr.length) return null;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }
  // Population variance (average of squared deviations from the mean).
  function variance(arr) {
    if (!arr.length) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return arr.reduce((s, v) => s + (v - mean) * (v - mean), 0) / arr.length;
  }
  function aggregate(arr, mode) {
    return mode === "average" ? average(arr) : median(arr);
  }

  // --- Trend: compares the last value to the previous one ---
  // higherIsBetter: true for throughput, false for lead/cycle time.
  function computeTrend(values, thresholdPct, higherIsBetter) {
    const valid = values.filter((v) => v !== null && v !== undefined && !isNaN(v));
    if (valid.length < 2) return { direction: "na", pct: null, good: null };
    const last = values[values.length - 1];
    const prev = values[values.length - 2];
    if (last === null || prev === null || isNaN(last) || isNaN(prev)) {
      return { direction: "na", pct: null, good: null };
    }
    if (prev === 0) {
      if (last === 0) return { direction: "stable", pct: 0, good: null };
      const up = last > 0;
      return { direction: up ? "up" : "down", pct: null, good: higherIsBetter ? up : !up };
    }
    const pct = ((last - prev) / Math.abs(prev)) * 100;
    if (Math.abs(pct) <= thresholdPct) return { direction: "stable", pct, good: null };
    const up = pct > 0;
    return { direction: up ? "up" : "down", pct, good: higherIsBetter ? up : !up };
  }

  // --- JQL building ---
  function quoteList(statuses) {
    return statuses
      .map((s) => `"${String(s).trim().replace(/"/g, '\\"')}"`)
      .filter((s) => s !== '""')
      .join(", ");
  }

  /* Optional "issue types" restriction, shared by every query of both modes.
   * The names come from the JIRA project itself (picked in the settings), so
   * they always match; JQL string comparison is case-insensitive anyway.
   * Returns "" when no type is selected = every type is counted. */
  function issueTypeClause(project) {
    const types = (project && project.issueTypes) || [];
    const list = types.map((t) => String(t).trim()).filter(Boolean);
    if (!list.length) return "";
    return ` AND issuetype IN (${quoteList(list)})`;
  }

  // windowEnd is the EXCLUSIVE boundary of the window (Monday 00:00 of the week
  // following the last analysed week). In JQL, a date without a time means
  // 00:00, so BEFORE "<next Monday>" = up to the end of Sunday.
  function buildJql(project, windowStart, windowEnd) {
    const key = String(project.key).trim();
    const done = (project.doneStatuses || []).filter(Boolean);
    const dateStr = isoDate(windowStart);
    const endStr = windowEnd ? isoDate(windowEnd) : null;
    let jql = `project = "${key}" AND `;
    if (done.length) {
      jql += `status CHANGED TO (${quoteList(done)}) AFTER "${dateStr}"`;
      if (endStr) jql += ` BEFORE "${endStr}"`;
    } else {
      jql += `statusCategory = Done AND resolutiondate >= "${dateStr}"`;
      if (endStr) jql += ` AND resolutiondate < "${endStr}"`;
    }
    jql += issueTypeClause(project);
    if (project.extraJql && project.extraJql.trim()) {
      jql += ` AND (${project.extraJql.trim()})`;
    }
    jql += " ORDER BY updated DESC";
    return jql;
  }

  // --- Extracting key dates from a ticket's changelog ---
  function statusTransitions(histories) {
    // Returns [{ at: Date, to: string, from: string }] sorted chronologically
    const events = [];
    for (const h of histories || []) {
      const at = new Date(h.created);
      for (const it of h.items || []) {
        if (it.field === "status" || it.fieldId === "status") {
          events.push({ at, to: it.toString, from: it.fromString });
        }
      }
    }
    events.sort((a, b) => a.at - b.at);
    return events;
  }

  function issueHistories(issue) {
    return (issue.changelog && issue.changelog.histories) || issue._changelog || [];
  }

  // JQL for tickets that changed status to Ready or Backlog within the window.
  // Used to measure additions to Ready and moves back to backlog. Returns null
  // if no Ready/Backlog status is configured for the project.
  function buildChurnJql(project, windowStart, windowEnd) {
    const key = String(project.key).trim();
    const ready = (project.readyStatuses || []).filter(Boolean);
    const backlog = (project.backlogStatuses || []).filter(Boolean);
    const dateStr = isoDate(windowStart);
    const range = windowEnd
      ? `AFTER "${dateStr}" BEFORE "${isoDate(windowEnd)}"`
      : `AFTER "${dateStr}"`;
    const clauses = [];
    if (ready.length) clauses.push(`status CHANGED TO (${quoteList(ready)}) ${range}`);
    if (backlog.length) clauses.push(`status CHANGED TO (${quoteList(backlog)}) ${range}`);
    if (!clauses.length) return null;
    let jql = `project = "${key}" AND (${clauses.join(" OR ")})`;
    jql += issueTypeClause(project);
    if (project.extraJql && project.extraJql.trim()) {
      jql += ` AND (${project.extraJql.trim()})`;
    }
    jql += " ORDER BY updated DESC";
    return jql;
  }

  // JQL for tickets that were in Ready status during the analysis window.
  // Used for committed throughput (Monday snapshot). `status WAS IN` also
  // captures tickets that entered Ready before the window and are still
  // present. Returns null if no Ready status is configured.
  function buildReadySnapshotJql(project, windowStart, windowEnd) {
    const ready = (project.readyStatuses || []).filter(Boolean);
    if (!ready.length) return null;
    const key = String(project.key).trim();
    let jql =
      `project = "${key}" AND status WAS IN (${quoteList(ready)}) ` +
      `DURING ("${isoDate(windowStart)}", "${isoDate(windowEnd)}")`;
    jql += issueTypeClause(project);
    if (project.extraJql && project.extraJql.trim()) {
      jql += ` AND (${project.extraJql.trim()})`;
    }
    jql += " ORDER BY updated DESC";
    return jql;
  }

  // Reconstructs a ticket's status at instant T from its changelog.
  // events = statusTransitions(...) sorted chronologically. Returns the current
  // status if there is no transition, otherwise the last status reached before
  // or at T (or the initial status — `from` of the 1st transition — if T is
  // earlier).
  function statusAtTime(issue, events, T) {
    if (!events.length) {
      return issue.fields && issue.fields.status && issue.fields.status.name
        ? issue.fields.status.name
        : null;
    }
    const t = T.getTime();
    let status = events[0].from; // initial status (before the 1st transition)
    for (const ev of events) {
      if (ev.at.getTime() <= t) status = ev.to;
      else break;
    }
    return status;
  }

  // True if the ticket was IN Ready status at any point during the window
  // [start, end] (bounds inclusive). Used for committed throughput, measured
  // over the Monday midnight -> noon window. We test the state at the start of
  // the window (already in Ready) THEN any transition entering Ready before/at
  // `end`.
  function wasReadyDuring(issue, events, start, end, readySet) {
    const st0 = statusAtTime(issue, events, start);
    if (st0 && readySet.has(st0.toLowerCase())) return true;
    const s = start.getTime();
    const e = end.getTime();
    for (const ev of events) {
      const at = ev.at.getTime();
      if (at < s) continue;
      if (at > e) break;
      if (ev.to && readySet.has(ev.to.toLowerCase())) return true;
    }
    return false;
  }

  // Fetches the tickets for a JQL query with their full changelog.
  async function fetchIssuesWithChangelog(client, jql, onProgress, fields) {
    const issues = await client.searchAll(
      jql,
      fields || ["created", "resolutiondate", "summary", "status"],
      "changelog"
    );
    for (const issue of issues) {
      const cl = issue.changelog;
      const needFull =
        !cl ||
        (typeof cl.total === "number" &&
          cl.histories &&
          cl.total > cl.histories.length);
      if (needFull) {
        if (onProgress) onProgress(`Changelog ${issue.key}…`);
        try {
          issue._changelog = await client.getChangelog(issue.key);
        } catch (e) {
          issue._changelog = (cl && cl.histories) || [];
        }
      }
    }
    return issues;
  }

  function computeIssueDates(issue, project, clampStart) {
    const done = new Set((project.doneStatuses || []).map((s) => s.toLowerCase()));
    const wip = new Set((project.inProgressStatuses || []).map((s) => s.toLowerCase()));
    let created = new Date(issue.fields.created);
    const histories =
      (issue.changelog && issue.changelog.histories) || issue._changelog || [];
    const events = statusTransitions(histories);

    // End date = last entry into a "done" status
    let doneDate = null;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].to && done.has(events[i].to.toLowerCase())) {
        doneDate = events[i].at;
        break;
      }
    }
    if (!doneDate && issue.fields.resolutiondate) {
      doneDate = new Date(issue.fields.resolutiondate);
    }

    // Start date = first entry into an "in progress" status
    let startDate = null;
    for (let i = 0; i < events.length; i++) {
      if (events[i].to && wip.has(events[i].to.toLowerCase())) {
        startDate = events[i].at;
        break;
      }
    }
    const startApprox = !startDate;
    if (!startDate) startDate = created; // fallback: cycle time = lead time

    // Clamped to the start date: if a reference date (creation for lead time,
    // first move to in-progress for cycle time) is earlier than the configured
    // start date, it is pulled forward to that date. This means time elapsed
    // before the start date is never counted.
    if (clampStart) {
      const clamp = clampStart.getTime();
      if (created.getTime() < clamp) created = new Date(clamp);
      if (startDate.getTime() < clamp) startDate = new Date(clamp);
    }

    return { created, startDate, doneDate, startApprox };
  }

  // ===================== RUN MODE (support / run) =====================

  // JQL for run tickets: project + run labels, keeping those created since the
  // start of the window OR still unresolved (for the current workload).
  function buildRunJql(project, windowStart, windowEnd) {
    const key = String(project.key).trim();
    const labels = (project.runLabels || []).filter(Boolean);
    const dateStr = isoDate(windowStart);
    const createdClause = windowEnd
      ? `(created >= "${dateStr}" AND created < "${isoDate(windowEnd)}")`
      : `created >= "${dateStr}"`;
    // Tickets closed DURING the window but created before it also need to be
    // pulled in, otherwise the "closed this week" list would miss them.
    const resolvedClause = windowEnd
      ? `(resolutiondate >= "${dateStr}" AND resolutiondate < "${isoDate(windowEnd)}")`
      : `resolutiondate >= "${dateStr}"`;
    let jql = `project = "${key}"`;
    if (labels.length) jql += ` AND labels IN (${quoteList(labels)})`;
    jql += ` AND (${createdClause} OR ${resolvedClause} OR resolution IS EMPTY)`;
    jql += issueTypeClause(project);
    if (project.extraJql && project.extraJql.trim()) {
      jql += ` AND (${project.extraJql.trim()})`;
    }
    jql += " ORDER BY created ASC";
    return jql;
  }

  /* Analysis of a project in RUN mode. Weeks Mon 00:00 -> Sun 23:59.
   * Metrics:
   *  1. Open tickets (unresolved): count per week (workload at the end of each
   *     week) + list of currently open tickets.
   *  2. Variance of the number of tickets created over sliding 24h windows
   *     (hourly step) within each week.
   *  3. (Snapshot) list of unassigned open tickets + JIRA link.
   *  4. (Snapshot) list of highest-priority tickets: creation date, delay
   *     creation -> first comment, delay creation -> resolution.
   */
  async function analyzeRunProject(client, project, cfg, onProgress) {
    const win = buildWindowWeeks(configStartDate(cfg));
    if (win.future) {
      return {
        mode: "run",
        future: true,
        firstWeekStart: win.firstWeekStart,
        currentWeekStart: win.currentWeekStart,
      };
    }
    const weeks = win.weeks;
    const n = weeks.length;
    const windowStart = weeks[0].start;

    const jql = buildRunJql(project, windowStart, weeks[n - 1].end);
    if (onProgress) onProgress("JIRA query (run)…");
    // The changelog is needed to precisely date entry into a closing status
    // (e.g. "Cancelled") when JIRA does not provide a resolutiondate.
    const issues = await fetchIssuesWithChangelog(client, jql, onProgress, [
      "created",
      "updated",
      "resolutiondate",
      "resolution",
      "summary",
      "status",
      "assignee",
      "priority",
    ]);

    const HOUR_MS = 60 * 60 * 1000;
    const now = new Date();
    const maxPrioSet = new Set(
      (project.maxPriorities || []).map((s) => String(s).toLowerCase()).filter(Boolean)
    );
    // JIRA priority order (index 0 = highest). Fetched from JIRA to respect the
    // site's real order; falls back to a usual order if the call fails.
    let prioOrder = [];
    if (client.getPriorities) {
      try {
        prioOrder = await client.getPriorities();
      } catch (e) {
        prioOrder = [];
      }
    }
    if (!prioOrder.length) prioOrder = DEFAULT_PRIORITY_ORDER;
    const prioRanks = new Map();
    prioOrder.forEach((name, i) => prioRanks.set(String(name).trim().toLowerCase(), i));
    // Sort rank: smaller = higher priority; unknown/missing goes last.
    const prioRank = (name) => {
      if (!name) return 9999;
      const r = prioRanks.get(String(name).trim().toLowerCase());
      return r == null ? 9998 : r;
    };
    const tsAsc = (d) => (d ? d.getTime() : Number.POSITIVE_INFINITY);
    const tsDesc = (d) => (d ? d.getTime() : Number.NEGATIVE_INFINITY);
    // Configured closing statuses: a ticket in one of these is considered
    // closed (and therefore excluded from stats), just like a resolved ticket.
    const doneSet = new Set(
      (project.doneStatuses || []).map((s) => String(s).toLowerCase()).filter(Boolean)
    );
    // Run "backlog" statuses: an open ticket in one of these statuses is
    // considered UNPLANNED (not yet picked up by the team). Any other status =
    // ticket present on the board, therefore to be worked on.
    const backlogSet = new Set(
      (project.backlogStatuses || [])
        .map((s) => String(s).trim().toLowerCase())
        .filter(Boolean)
    );

    // Ticket normalisation.
    const tickets = issues.map((it) => {
      const f = it.fields || {};
      const created = f.created ? new Date(f.created) : null;
      const updated = f.updated ? new Date(f.updated) : null;
      const resolved = f.resolutiondate ? new Date(f.resolutiondate) : null;
      const statusName = f.status ? f.status.name : "";
      const inDoneStatus = statusName && doneSet.has(statusName.trim().toLowerCase());
      // Effective closing date. Priority:
      //   1. last entry into a closing status (changelog) — applies to ALL
      //      configured closing statuses (Done, Cancelled, ...);
      //   2. resolutiondate if the changelog provides nothing;
      //   3. "now" as a last resort (ticket closed by status with no trace).
      let doneStatusAt = null;
      if (inDoneStatus) {
        const evs = statusTransitions(issueHistories(it));
        for (let i = evs.length - 1; i >= 0; i--) {
          const to = (evs[i].to || "").trim().toLowerCase();
          if (doneSet.has(to)) {
            doneStatusAt = evs[i].at;
            break;
          }
        }
      }
      const closedAt = doneStatusAt || resolved || (inDoneStatus ? now : null);
      const isOpen = !resolved && !inDoneStatus;
      const inBacklogStatus = Boolean(
        statusName && backlogSet.has(statusName.trim().toLowerCase())
      );
      return {
        key: it.key,
        summary: f.summary || "",
        status: statusName,
        created,
        updated,
        resolved,
        closedAt,
        closedAtApprox: !doneStatusAt && !resolved && inDoneStatus,
        isOpen,
        inBacklogStatus,
        assignee: f.assignee ? f.assignee.displayName || f.assignee.name : null,
        priority: f.priority ? f.priority.name : null,
        url: `${client.baseUrl}/browse/${it.key}`,
      };
    });

    // 1) Opened per week = tickets whose CREATION DATE falls within the bounds
    //    of the week in question [Monday 00:00, next Monday 00:00[, regardless
    //    of status. No carry-over between weeks: a ticket created in week 1 is
    //    never recounted in week 2.
    const openCount = new Array(n).fill(0);
    for (const t of tickets) {
      if (!t.created) continue;
      const wi = weekIndexOf(t.created, weeks);
      if (wi < 0) continue; // created outside the analysis window
      openCount[wi] += 1;
    }
    // List of currently open (unresolved) tickets, sorted by descending
    // PRIORITY (highest first) then ascending creation date (oldest first).
    // Open tickets whose status is a run backlog status are excluded here and
    // listed separately ("unplanned open").
    const sortOpen = (a, b) =>
      prioRank(a.priority) - prioRank(b.priority) ||
      tsAsc(a.created) - tsAsc(b.created);
    const openList = tickets
      .filter((t) => t.isOpen && !t.inBacklogStatus)
      .sort(sortOpen);
    // Unplanned open = open in a run backlog status.
    const backlogList = tickets
      .filter((t) => t.isOpen && t.inBacklogStatus)
      .sort(sortOpen);
    // Age counters (in hours): since opening and since the last recorded
    // activity on the ticket (`updated` field).
    for (const t of openList.concat(backlogList)) {
      t.hoursSinceCreated = t.created
        ? Math.max(0, (now - t.created) / HOUR_MS)
        : null;
      t.hoursSinceUpdated = t.updated
        ? Math.max(0, (now - t.updated) / HOUR_MS)
        : null;
    }

    // 1bis) Closed per week (metric equivalent to opened) = tickets whose
    //    CLOSING DATE falls within the bounds of the week in question.
    //    A ticket is closed if resolved OR in a closing status.
    //    No carry-over between weeks.
    const closeCount = new Array(n).fill(0);
    for (const t of tickets) {
      if (!t.closedAt) continue;
      const wi = weekIndexOf(t.closedAt, weeks);
      if (wi < 0) continue; // closed outside the analysis window
      closeCount[wi] += 1;
    }
    // List of tickets closed DURING THE CURRENT WEEK (resolved or entered a
    // closing status), sorted by descending PRIORITY then descending closing
    // date (most recent closures first).
    const curWeek = weeks[win.currentIndex];
    const closedList = tickets
      .filter(
        (t) =>
          !t.isOpen &&
          t.closedAt &&
          t.closedAt >= curWeek.start &&
          t.closedAt < curWeek.end
      )
      .sort(
        (a, b) =>
          prioRank(a.priority) - prioRank(b.priority) ||
          tsDesc(b.closedAt) - tsDesc(a.closedAt)
      );
    // Total duration created → closed (in hours), for colour coding.
    for (const t of closedList) {
      t.hoursOpenToClosed =
        t.created && t.closedAt
          ? Math.max(0, (t.closedAt - t.created) / HOUR_MS)
          : null;
    }
    // AVERAGE resolution time (creation → closing) for tickets closed during
    // the current week. No carry-over between weeks: the population is exactly
    // closedList.
    const avgOf = (arr) =>
      arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    const curResolutionHours = closedList
      .map((t) => t.hoursOpenToClosed)
      .filter((h) => h != null);
    const avgResolutionHours = avgOf(curResolutionHours);
    const avgResolutionCount = curResolutionHours.length;

    // 2) Tickets created during the current week, compared to creations in the
    //    previous week over the SAME ELAPSED duration (e.g. Tuesday 2pm →
    //    Monday 00:00 to Tuesday 2pm of the previous week). Replaces the former
    //    sliding-24h variance (unit in tickets², hard to read).
    const createdTimes = tickets.filter((t) => t.created).map((t) => t.created.getTime());
    const nowMs = now.getTime();
    const curIdx = win.currentIndex;
    const curStartMs = weeks[curIdx].start.getTime();
    const elapsedMs = Math.min(weeks[curIdx].end.getTime(), nowMs) - curStartMs;
    const countCreatedBetween = (from, to) =>
      createdTimes.filter((ct) => ct >= from && ct < to).length;
    const createdThisWeek = countCreatedBetween(curStartMs, curStartMs + elapsedMs);
    let createdPrevSameElapsed = null;
    let createdPrevWeek = null;
    if (curIdx >= 1) {
      const prevStart = weeks[curIdx - 1].start.getTime();
      const prevEnd = weeks[curIdx - 1].end.getTime();
      // Upper bound capped at the end of the previous week: if the current week
      // is longer (daylight-saving change), the "same elapsed duration" window
      // must not bleed into the current week.
      const prevCut = Math.min(prevStart + elapsedMs, prevEnd);
      createdPrevSameElapsed = countCreatedBetween(prevStart, prevCut);
      createdPrevWeek = countCreatedBetween(prevStart, prevEnd);
    }

    // 2bis) Creations per DAY of the week (Monday → Sunday) for the current
    //    week and the previous week. Each ticket is attributed to a single
    //    creation day: no carry-over between days or between weeks.
    //    Day boundaries are computed in CALENDAR DAYS (not 24h slices): during
    //    a daylight-saving change, the week is 167h or 169h long, and a
    //    fixed-step split would let Sunday overflow into the following week's
    //    Monday (double counting) or lose an hour (an uncounted ticket). The 8
    //    boundaries cover exactly [Monday 00:00, Monday+7 00:00[.
    function dayBounds(weekStart) {
      const b = new Array(8);
      for (let d = 0; d <= 7; d++) b[d] = addDays(weekStart, d).getTime();
      return b;
    }
    function createdPerDay(weekStart) {
      const out = new Array(7).fill(0);
      if (!weekStart) return out;
      const b = dayBounds(weekStart);
      for (const ct of createdTimes) {
        if (ct < b[0] || ct >= b[7]) continue; // outside THIS week
        for (let d = 0; d < 7; d++) {
          if (ct < b[d + 1]) {
            out[d] += 1;
            break;
          }
        }
      }
      return out;
    }
    const createdPerDayCurrent = createdPerDay(weeks[curIdx].start);
    const createdPerDayPrev =
      curIdx >= 1 ? createdPerDay(weeks[curIdx - 1].start) : null;
    // Days already elapsed in the current week (1..7): beyond that, comparing
    // with the previous week would not make sense. Counted on calendar
    // boundaries (not 24h slices).
    const curBounds = dayBounds(weeks[curIdx].start);
    let elapsedDays = 1;
    for (let d = 1; d < 7; d++) {
      if (nowMs >= curBounds[d]) elapsedDays = d + 1;
    }

    // 3) Unassigned open tickets (current snapshot).
    const unassignedList = tickets
      .filter((t) => t.isOpen && !t.assignee)
      .sort((a, b) => (a.created && b.created ? a.created - b.created : 0));

    // 4) Highest-priority tickets (snapshot): first comment and resolution delays.
    let maxPriorityList = tickets.filter(
      (t) => t.priority && maxPrioSet.has(t.priority.toLowerCase())
    );
    // Sort: descending priority (highest first) then ascending creation date
    // (oldest first).
    maxPriorityList.sort(
      (a, b) =>
        prioRank(a.priority) - prioRank(b.priority) ||
        tsAsc(a.created) - tsAsc(b.created)
    );
    for (const t of maxPriorityList) {
      t.firstCommentDate = null;
      if (onProgress) onProgress(`First comment ${t.key}…`);
      try {
        t.firstCommentDate = await client.getFirstCommentDate(t.key);
      } catch (e) {
        t.firstCommentDate = null;
      }
      const h1 =
        t.created && t.firstCommentDate
          ? (t.firstCommentDate - t.created) / HOUR_MS
          : null;
      const hr =
        t.created && t.resolved ? (t.resolved - t.created) / HOUR_MS : null;
      // Negative durations are discarded (data anomalies).
      t.hoursToFirstComment = h1 != null && h1 >= 0 ? h1 : null;
      t.hoursToResolution = hr != null && hr >= 0 ? hr : null;
    }

    const thr = parseInt(cfg.stableThresholdPct, 10);
    const threshold = isNaN(thr) ? 10 : thr;

    // --- Comparison bases for the top-of-page cards (current week vs previous) ---
    // Open: CURRENT stock of unresolved tickets, compared to the stock still
    // open at the END of the previous week (= Monday 00:00 of the current week).
    // "Open tickets" KPI = ALL run tickets currently open (board + backlog),
    // unchanged: the board/backlog split only concerns the detail lists.
    const openNow = openList.length + backlogList.length;
    let openAtPrevWeekEnd = null;
    if (curIdx >= 1) {
      const boundary = weeks[curIdx - 1].end.getTime();
      openAtPrevWeekEnd = tickets.filter(
        (t) =>
          t.created &&
          t.created.getTime() < boundary &&
          (!t.closedAt || t.closedAt.getTime() >= boundary)
      ).length;
    }
    // Closed: tickets closed DURING the current week. The comparison base is
    // the previous week restricted to the SAME ELAPSED duration (e.g. Tuesday
    // 2pm → Monday 00:00 to Tuesday 2pm of the previous week), otherwise a
    // partial week would be compared to a full week.
    const closedThisWeek = closeCount[curIdx];
    const closedPrevWeek = curIdx >= 1 ? closeCount[curIdx - 1] : null;
    let closedPrevSameElapsed = null;
    let avgResolutionPrevSameElapsed = null;
    if (curIdx >= 1) {
      const prevStart = weeks[curIdx - 1].start.getTime();
      // Capped at the end of the previous week (see creations).
      const prevCut = Math.min(
        prevStart + elapsedMs,
        weeks[curIdx - 1].end.getTime()
      );
      const prevClosed = tickets.filter((t) => {
        if (!t.closedAt) return false;
        const c = t.closedAt.getTime();
        return c >= prevStart && c < prevCut;
      });
      closedPrevSameElapsed = prevClosed.length;
      // Comparison base for the average resolution time: same bounds as for
      // the closing count (same elapsed duration).
      avgResolutionPrevSameElapsed = avgOf(
        prevClosed
          .filter((t) => t.created && t.closedAt)
          .map((t) => Math.max(0, (t.closedAt - t.created) / HOUR_MS))
      );
    }

    return {
      mode: "run",
      future: false,
      weeks,
      currentIndex: win.currentIndex,
      hasCurrentWeek: win.hasCurrentWeek,
      completeCount: win.completeCount,
      hasComparison: win.hasComparison,
      firstWeekStart: win.firstWeekStart,
      openCount,
      openList,
      backlogList,
      closeCount,
      closedList,
      openNow,
      openAtPrevWeekEnd,
      closedThisWeek,
      closedPrevWeek,
      closedPrevSameElapsed,
      avgResolutionHours,
      avgResolutionCount,
      avgResolutionPrevSameElapsed,
      createdThisWeek,
      createdPrevSameElapsed,
      createdPrevWeek,
      createdPerDayCurrent,
      createdPerDayPrev,
      elapsedDays,
      elapsedHours: Math.round(elapsedMs / HOUR_MS),
      unassignedList,
      maxPriorityList,
      maxPriorities: project.maxPriorities || [],
      generatedAt: now,
      trends: {
        // Open: current stock vs stock at the end of the previous week.
        open:
          openAtPrevWeekEnd == null
            ? { direction: "na", pct: null, good: null }
            : computeTrend([openAtPrevWeekEnd, openNow], threshold, false),
        // Closed: closures this week vs the previous week.
        close:
          closedPrevSameElapsed == null
            ? { direction: "na", pct: null, good: null }
            : computeTrend(
                [closedPrevSameElapsed, closedThisWeek],
                threshold,
                true
              ),
        // Creations: current week vs same elapsed duration the previous week.
        // More creations = increased incoming load → higherIsBetter = false.
        created:
          createdPrevSameElapsed == null
            ? { direction: "na", pct: null, good: null }
            : computeTrend(
                [createdPrevSameElapsed, createdThisWeek],
                threshold,
                false
              ),
        // Average resolution time: shorter = better → higherIsBetter=false.
        resolution:
          avgResolutionPrevSameElapsed == null || avgResolutionHours == null
            ? { direction: "na", pct: null, good: null }
            : computeTrend(
                [avgResolutionPrevSameElapsed, avgResolutionHours],
                threshold,
                false
              ),
      },
      totalIssues: issues.length,
      jql,
    };
  }

  /* Orchestration: fetches the tickets and computes all the metrics.
   * client = JKDJira.makeClient(cfg)
   */
  async function analyzeProject(client, project, cfg, onProgress) {
    // Window driven by the configured start date (first week).
    const win = buildWindowWeeks(configStartDate(cfg));
    if (win.future) {
      return {
        future: true,
        firstWeekStart: win.firstWeekStart,
        currentWeekStart: win.currentWeekStart,
      };
    }
    const weeks = win.weeks;
    const n = weeks.length;
    const windowStart = weeks[0].start;
    // Lead/cycle time clamp date = the configured start date (falls back to the
    // window's 1st week if no valid date is set).
    const clampStart = parseStartDate(configStartDate(cfg)) || win.firstWeekStart;

    const windowEnd = weeks[n - 1].end; // exclusive boundary (next Monday)
    const jql = buildJql(project, windowStart, windowEnd);

    // --- Story points (per-team option) ---
    // The field is a customfield whose id varies by JIRA site: we use the
    // configured one, otherwise detect it by name. If it cannot be found, the
    // metric is simply disabled (no blocking error).
    let spField = null;
    if (project.trackStoryPoints) {
      const configured = String(cfg.storyPointsField || "").trim();
      if (configured) {
        spField = configured;
      } else if (typeof client.findStoryPointsField === "function") {
        if (onProgress) onProgress("Detecting the story points field…");
        try {
          spField = await client.findStoryPointsField();
        } catch (e) {
          spField = null;
        }
      }
    }
    const fields = ["created", "resolutiondate", "summary", "status"];
    if (spField) fields.push(spField);

    if (onProgress) onProgress("JIRA query…");
    const issues = await fetchIssuesWithChangelog(client, jql, onProgress, fields);

    const throughput = new Array(n).fill(0);
    const storyPointsWeekly = new Array(n).fill(0);
    const spCounts = new Array(n).fill(0);
    const leadBuckets = Array.from({ length: n }, () => []);
    const cycleBuckets = Array.from({ length: n }, () => []);
    const details = [];

    for (const issue of issues) {
      const { created, startDate, doneDate, startApprox } = computeIssueDates(
        issue,
        project,
        clampStart
      );
      if (!doneDate) continue;
      const wi = weekIndexOf(doneDate, weeks);
      if (wi < 0) continue; // completed outside the window

      throughput[wi] += 1;
      // Delivered story points = sum of the points of tickets completed within
      // the week (same weekly bucketing as delivered throughput).
      let sp = null;
      if (spField) {
        const raw = issue.fields ? issue.fields[spField] : null;
        const num = Number(raw);
        if (raw != null && raw !== "" && Number.isFinite(num)) {
          sp = num;
          storyPointsWeekly[wi] += num;
          spCounts[wi] += 1;
        }
      }
      const leadDays = (doneDate - created) / DAY_MS;
      const cycleDays = (doneDate - startDate) / DAY_MS;
      if (leadDays >= 0) leadBuckets[wi].push(leadDays);
      if (cycleDays >= 0) cycleBuckets[wi].push(cycleDays);

      details.push({
        key: issue.key,
        summary: issue.fields.summary,
        week: weeks[wi].label,
        weekIndex: wi,
        doneDate,
        storyPoints: sp,
        leadDays,
        cycleDays,
        startApprox,
        url: `${client.baseUrl}/browse/${issue.key}`,
      });
    }

    const leadWeekly = leadBuckets.map((b) => aggregate(b, cfg.aggregate));
    const cycleWeekly = cycleBuckets.map((b) => aggregate(b, cfg.aggregate));

    // --- Flow signals ---
    const readySet = new Set(
      (project.readyStatuses || [])
        .map((s) => String(s).trim().toLowerCase())
        .filter(Boolean)
    );
    const backlogSet = new Set(
      (project.backlogStatuses || [])
        .map((s) => String(s).trim().toLowerCase())
        .filter(Boolean)
    );

    // 1) Committed throughput = number of tickets IN Ready status during the
    //    MONDAY MIDNIGHT-TO-NOON window (00:00 -> 12:00). A ticket is
    //    considered committed if it was in Ready at any instant during this
    //    window: its status is reconstructed from its changelog.
    const slots = resolveSlots(cfg);
    const readySnapshot = new Array(n).fill(0);
    const snapJql = buildReadySnapshotJql(project, weeks[0].start, weeks[n - 1].end);
    if (snapJql) {
      if (onProgress) onProgress(`Board snapshot (${slots.engageLabel})…`);
      const snapIssues = await fetchIssuesWithChangelog(client, snapJql, onProgress);
      for (const issue of snapIssues) {
        const events = statusTransitions(issueHistories(issue));
        for (let wi = 0; wi < n; wi++) {
          // Window bounds computed in calendar days (see weekInstant).
          const start = weekInstant(weeks[wi].start, slots.engageFrom);
          const noon = weekInstant(weeks[wi].start, slots.engageTo);
          if (wasReadyDuring(issue, events, start, noon, readySet)) {
            readySnapshot[wi] += 1;
          }
        }
      }
    }

    // 2) Added to Ready = tickets MOVED into Ready status (from any other
    //    status) BETWEEN Monday 12:00 and Friday end of day (= Saturday 00:00).
    // 3) Removed = tickets MOVED into Backlog / "To do" status (from any other
    //    status) over THE SAME WINDOW Monday 12:00 → Friday end of day.
    const readyAdded = new Array(n).fill(0);
    const backlogBack = new Array(n).fill(0);
    const churnJql = buildChurnJql(project, windowStart, windowEnd);
    if (churnJql) {
      if (onProgress) onProgress("Analysing Ready / Backlog…");
      const churnIssues = await fetchIssuesWithChangelog(client, churnJql, onProgress);
      for (const issue of churnIssues) {
        const events = statusTransitions(issueHistories(issue));
        for (const ev of events) {
          const wi = weekIndexOf(ev.at, weeks);
          if (wi < 0) continue;
          const to = ev.to ? ev.to.trim().toLowerCase() : "";
          const from = ev.from ? ev.from.trim().toLowerCase() : "";
          // Common window: [Monday 12:00, Saturday 00:00[ of the week in
          // question. Bounds in calendar days (robust to daylight-saving change).
          const slotStart = weekInstant(weeks[wi].start, slots.churnFrom).getTime();
          const slotEnd = weekInstant(weeks[wi].start, slots.churnTo).getTime();
          const t = ev.at.getTime();
          const inSlot = t >= slotStart && t < slotEnd;
          if (!inSlot) continue;
          // Added: entry into Ready status from any other status.
          if (readySet.size && readySet.has(to) && !readySet.has(from)) {
            readyAdded[wi] += 1;
          }
          // Removed: entry into Backlog / "To do" status from another status.
          if (backlogSet.size && backlogSet.has(to) && !backlogSet.has(from)) {
            backlogBack[wi] += 1;
          }
        }
      }
    }

    const thr = parseInt(cfg.stableThresholdPct, 10);
    const threshold = isNaN(thr) ? 10 : thr;

    // Trends compare the CURRENT WEEK to the PREVIOUS WEEK.
    // Since the current week is incomplete, the comparison should be read as
    // "where do we stand compared to last week", not as a final tally.

    return {
      future: false,
      weeks,
      currentIndex: win.currentIndex,
      hasCurrentWeek: win.hasCurrentWeek,
      completeCount: win.completeCount,
      hasComparison: win.hasComparison,
      firstWeekStart: win.firstWeekStart,
      throughput,
      storyPointsWeekly,
      storyPointsCounts: spCounts,
      hasStoryPoints: !!spField,
      storyPointsField: spField,
      trackStoryPoints: !!project.trackStoryPoints,
      throughputEngage: readySnapshot,
      readyAdded,
      backlogReturned: backlogBack,
      hasEngage: !!snapJql,
      hasChurn: !!churnJql,
      engageLabel: slots.engageLabel,
      churnLabel: slots.churnLabel,
      leadWeekly,
      cycleWeekly,
      counts: leadBuckets.map((b) => b.length),
      trends: {
        // Comparison CURRENT WEEK vs PREVIOUS WEEK (the last two entries of the
        // weekly series), no longer two complete weeks.
        throughput: computeTrend(throughput, threshold, true),
        storyPoints: spField
          ? computeTrend(storyPointsWeekly, threshold, true)
          : { direction: "na", pct: null, good: null },
        engage: computeTrend(readySnapshot, threshold, true),
        lead: computeTrend(leadWeekly, threshold, false),
        cycle: computeTrend(cycleWeekly, threshold, false),
      },
      details: details.sort((a, b) => b.doneDate - a.doneDate),
      totalIssues: issues.length,
      aggregate: cfg.aggregate,
      jql,
    };
  }

  global.JKDMetrics = {
    startOfWeek,
    buildWeeks,
    buildWindowWeeks,
    // Legacy aliases (previous naming), kept so external harnesses keep working.
    buildMacrocycleWeeks: buildWindowWeeks,
    parseStartDate,
    parseMacroStartDate: parseStartDate,
    configStartDate,
    WINDOW_WEEKS,
    MAX_PREV_WEEKS,
    resolveSlots,
    DEFAULT_SLOTS,
    weekInstant,
    addDays,
    weekIndexOf,
    median,
    average,
    variance,
    aggregate,
    computeTrend,
    buildJql,
    buildRunJql,
    analyzeRunProject,
    buildChurnJql,
    buildReadySnapshotJql,
    statusAtTime,
    wasReadyDuring,
    computeIssueDates,
    analyzeProject,
    isoDate,
  };
})(typeof self !== "undefined" ? self : this);
