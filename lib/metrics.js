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

  const WINDOW_WEEKS = 5;
  const COMPLETE_WINDOW_WEEKS = 52;
  // Kept for backwards compatibility with the previous naming.
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

  /* Builds an analysis window.
   * - recent: the current week and the four previous weeks, independently of
   *   startDate;
   * - complete: the first 52 weeks from the week containing startDate, stopping
   *   at the current week when it is reached sooner.
   * Calendar-day arithmetic keeps week boundaries correct across DST changes.
   */
  function buildWindowWeeks(startDate, now, periodMode) {
    const currentWeekStart = startOfWeek(now ? new Date(now) : new Date());
    const mode = periodMode === "complete" ? "complete" : "recent";
    const parsed = parseStartDate(startDate);
    const missingStartDate = mode === "complete" && !parsed;
    const firstWeekStart =
      mode === "recent" || !parsed
        ? addDays(currentWeekStart, -(WINDOW_WEEKS - 1) * 7)
        : startOfWeek(parsed);
    const diffWeeks = Math.round(
      (currentWeekStart - firstWeekStart) / (7 * DAY_MS)
    );

    if (mode === "complete" && parsed && diffWeeks < 0) {
      return {
        future: true,
        weeks: [],
        currentIndex: -1,
        currentWeekIndex: -1,
        hasCurrentWeek: false,
        completeCount: 0,
        hasComparison: false,
        firstWeekStart,
        currentWeekStart,
        periodMode: mode,
        truncated: false,
        missingStartDate: false,
      };
    }

    const available = mode === "recent" || missingStartDate
      ? WINDOW_WEEKS
      : diffWeeks + 1;
    const count = mode === "complete" && !missingStartDate
      ? Math.min(COMPLETE_WINDOW_WEEKS, available)
      : WINDOW_WEEKS;
    const weeks = [];
    for (let i = 0; i < count; i++) {
      const start = addDays(firstWeekStart, i * 7);
      const end = addDays(start, 7);
      const isCurrent = start.getTime() === currentWeekStart.getTime();
      weeks.push({
        start,
        end,
        label: formatWeekLabel(start),
        current: isCurrent,
        complete: !isCurrent,
      });
    }
    const currentWeekIndex = weeks.findIndex((w) => w.current);
    const hasCurrentWeek = currentWeekIndex >= 0;
    return {
      future: false,
      weeks,
      currentIndex: count - 1,
      currentWeekIndex,
      hasCurrentWeek,
      completeCount: hasCurrentWeek ? count - 1 : count,
      hasComparison: count >= 2,
      firstWeekStart,
      currentWeekStart,
      periodMode: mode,
      truncated: mode === "complete" && !missingStartDate && available > count,
      missingStartDate,
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

  // --- Trend: compares a reference value to the preceding week ---
  // higherIsBetter: true for throughput, false for lead/cycle time.
  function computeTrend(values, thresholdPct, higherIsBetter, referenceIndex) {
    const index = referenceIndex == null ? values.length - 1 : referenceIndex;
    if (index < 1 || index >= values.length) {
      return { direction: "na", pct: null, good: null };
    }
    const last = values[index];
    const prev = values[index - 1];
    if (last === null || last === undefined || prev === null || prev === undefined ||
        isNaN(last) || isNaN(prev)) {
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
          issue._changelogComplete = true;
        } catch (e) {
          issue._changelog = (cl && cl.histories) || [];
          issue._changelogComplete = false;
        }
      } else {
        issue._changelogComplete = true;
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
    const endStr = windowEnd ? isoDate(windowEnd) : null;
    // Historical snapshots need tickets created before the displayed range if
    // they were still open during it. Resolved-after-start and unresolved
    // tickets cover that stock; status changes cover closing statuses that do
    // not set a resolution date (for example Cancelled).
    const candidates = ["resolution IS EMPTY", `resolutiondate >= "${dateStr}"`];
    const done = (project.doneStatuses || []).filter(Boolean);
    if (done.length) {
      candidates.push(
        `status CHANGED TO (${quoteList(done)}) AFTER "${dateStr}"`
      );
    }
    let jql = `project = "${key}"`;
    if (labels.length) jql += ` AND labels IN (${quoteList(labels)})`;
    if (endStr) jql += ` AND created < "${endStr}"`;
    jql += ` AND (${candidates.join(" OR ")})`;
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
    const win = buildWindowWeeks(
      configStartDate(cfg),
      null,
      cfg.runPeriodMode
    );
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
    const jql = buildRunJql(project, weeks[0].start, weeks[n - 1].end);
    if (onProgress) onProgress("JIRA query (run)…");
    const issues = await fetchIssuesWithChangelog(client, jql, onProgress, [
      "created", "updated", "resolutiondate", "resolution", "summary",
      "status", "assignee", "priority",
    ]);

    const HOUR_MS = 60 * 60 * 1000;
    const now = new Date();
    const nowMs = now.getTime();
    const doneSet = new Set(
      (project.doneStatuses || []).map((s) => String(s).trim().toLowerCase()).filter(Boolean)
    );
    const backlogSet = new Set(
      (project.backlogStatuses || []).map((s) => String(s).trim().toLowerCase()).filter(Boolean)
    );
    const maxPrioSet = new Set(
      (project.maxPriorities || []).map((s) => String(s).trim().toLowerCase()).filter(Boolean)
    );

    let prioOrder = [];
    if (client.getPriorities) {
      try { prioOrder = await client.getPriorities(); } catch (e) { prioOrder = []; }
    }
    if (!prioOrder.length) prioOrder = DEFAULT_PRIORITY_ORDER;
    const prioRanks = new Map();
    prioOrder.forEach((name, i) => prioRanks.set(String(name).trim().toLowerCase(), i));
    const prioRank = (name) => {
      if (!name) return 9999;
      const rank = prioRanks.get(String(name).trim().toLowerCase());
      return rank == null ? 9998 : rank;
    };
    const tsAsc = (d) => (d ? d.getTime() : Number.POSITIVE_INFINITY);
    const tsDesc = (d) => (d ? d.getTime() : Number.NEGATIVE_INFINITY);
    const avgOf = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

    // Reconstructs a non-status field by walking changes after the cut-off
    // backwards from its current value. Full changelogs make the value exact;
    // a missing `from` value is reported instead of silently using today's one.
    function fieldAtTime(issue, fieldNames, currentValue, cutoff) {
      const names = new Set(fieldNames.map((x) => x.toLowerCase()));
      const changes = [];
      for (const h of issueHistories(issue)) {
        const at = new Date(h.created);
        for (const item of h.items || []) {
          const name = String(item.fieldId || item.field || "").toLowerCase();
          if (names.has(name)) changes.push({ at, item });
        }
      }
      changes.sort((a, b) => b.at - a.at);
      let value = currentValue;
      let available = true;
      for (const change of changes) {
        if (change.at <= cutoff) continue;
        const item = change.item;
        if (item.fromString != null) value = item.fromString || null;
        else if (item.from != null) value = item.from || null;
        else { value = null; available = false; }
      }
      return { value, available };
    }

    const tickets = issues.map((issue) => {
      const f = issue.fields || {};
      const created = f.created ? new Date(f.created) : null;
      const updated = f.updated ? new Date(f.updated) : null;
      const resolved = f.resolutiondate ? new Date(f.resolutiondate) : null;
      const statusEvents = statusTransitions(issueHistories(issue));
      const doneEvents = statusEvents.filter(
        (ev) => ev.to && doneSet.has(String(ev.to).trim().toLowerCase())
      );
      const currentStatus = f.status ? f.status.name : "";
      const currentAssignee = f.assignee
        ? f.assignee.displayName || f.assignee.name || null
        : null;
      const currentPriority = f.priority ? f.priority.name : null;
      const finalDoneEvent = doneEvents.length ? doneEvents[doneEvents.length - 1].at : null;
      const currentlyDone = currentStatus && doneSet.has(currentStatus.trim().toLowerCase());
      const closedAt = finalDoneEvent || resolved || (currentlyDone ? now : null);
      return {
        issue, key: issue.key, summary: f.summary || "", created, updated, resolved,
        statusEvents, doneEvents, currentStatus, currentAssignee, currentPriority,
        closedAt, closedAtApprox: currentlyDone && !finalDoneEvent && !resolved,
        url: `${client.baseUrl}/browse/${issue.key}`,
      };
    });

    const openCount = new Array(n).fill(0);
    const closeCount = new Array(n).fill(0);
    for (const t of tickets) {
      if (t.created) {
        const wi = weekIndexOf(t.created, weeks);
        if (wi >= 0) openCount[wi] += 1;
      }
    }

    function closureInWeek(t, week, cutoff) {
      // One canonical closing date per ticket (the latest Done entry, then the
      // resolution date fallback). This keeps weekly closure buckets mutually
      // exclusive even when a ticket was reopened and closed more than once.
      return t.closedAt && t.closedAt >= week.start && t.closedAt < cutoff
        ? t.closedAt : null;
    }

    function dayCounts(week, cutoff) {
      const out = new Array(7).fill(0);
      const bounds = Array.from({ length: 8 }, (_, d) => addDays(week.start, d).getTime());
      const limit = Math.min(cutoff.getTime(), week.end.getTime());
      for (const t of tickets) {
        if (!t.created) continue;
        const time = t.created.getTime();
        if (time < bounds[0] || time >= bounds[7] || time >= limit) continue;
        for (let d = 0; d < 7; d++) {
          if (time < bounds[d + 1]) { out[d] += 1; break; }
        }
      }
      return out;
    }

    function ticketAtCutoff(t, cutoff) {
      if (!t.created || t.created >= cutoff) return null;
      const historical = cutoff.getTime() !== nowMs;
      const historyAvailable = !historical || t.issue._changelogComplete !== false;
      const reconstructedStatus = historyAvailable
        ? statusAtTime(t.issue, t.statusEvents, cutoff)
        : null;
      // A transition whose initial `from` value is missing cannot establish the
      // status before that first event. Do not classify such a historical ticket.
      const statusAvailable = historyAvailable && (!historical || reconstructedStatus != null);
      const status = statusAvailable ? reconstructedStatus : "unavailable";
      const inDoneStatus = statusAvailable && doneSet.has(status.trim().toLowerCase());
      const resolvedByCutoff = Boolean(t.resolved && t.resolved < cutoff);
      const isOpen = statusAvailable && !inDoneStatus && !resolvedByCutoff;
      const assignee = fieldAtTime(
        t.issue, ["assignee"], t.currentAssignee, cutoff
      );
      const priority = fieldAtTime(
        t.issue, ["priority"], t.currentPriority, cutoff
      );
      return Object.assign({}, t, {
        status,
        isOpen,
        inBacklogStatus: isOpen && backlogSet.has(status.trim().toLowerCase()),
        statusAvailable,
        assignee: assignee.value,
        assigneeAvailable: historyAvailable && assignee.available,
        priority: priority.value,
        priorityAvailable: historyAvailable && priority.available,
        hoursSinceCreated: Math.max(0, (cutoff - t.created) / HOUR_MS),
        // JIRA's current `updated` field cannot be rewound reliably. Historical
        // rows state that limitation instead of showing a misleading duration.
        hoursSinceUpdated: cutoff.getTime() === nowMs && t.updated
          ? Math.max(0, (cutoff - t.updated) / HOUR_MS)
          : null,
        updatedAvailable: cutoff.getTime() === nowMs,
      });
    }

    const snapshots = weeks.map((week, index) => {
      const isCurrent = week.current;
      const cutoff = isCurrent ? now : new Date(Math.min(week.end.getTime(), nowMs));
      // A past-week snapshot is the state immediately before the exclusive
      // Monday boundary; events exactly at that boundary belong to next week.
      const stateCutoff = isCurrent ? cutoff : new Date(cutoff.getTime() - 1);
      const state = tickets.map((t) => ticketAtCutoff(t, stateCutoff)).filter(Boolean);
      const sortOpen = (a, b) =>
        prioRank(a.priority) - prioRank(b.priority) || tsAsc(a.created) - tsAsc(b.created);
      const openList = state.filter((t) => t.isOpen && !t.inBacklogStatus).sort(sortOpen);
      const backlogList = state.filter((t) => t.isOpen && t.inBacklogStatus).sort(sortOpen);
      const closedList = tickets
        .map((t) => ({ ticket: t, at: closureInWeek(t, week, cutoff) }))
        .filter((entry) => entry.at)
        .map((entry) => {
          const t = entry.ticket;
          const at = entry.at;
          const assignee = fieldAtTime(t.issue, ["assignee"], t.currentAssignee, at);
          const priority = fieldAtTime(t.issue, ["priority"], t.currentPriority, at);
          const historyAvailable = t.issue._changelogComplete !== false;
          return Object.assign({}, t, {
            closedAt: at,
            status: historyAvailable
              ? (statusAtTime(t.issue, t.statusEvents, at) || t.currentStatus)
              : "unavailable",
            statusAvailable: historyAvailable,
            assignee: assignee.value,
            assigneeAvailable: historyAvailable && assignee.available,
            priority: priority.value,
            priorityAvailable: historyAvailable && priority.available,
            hoursOpenToClosed: t.created ? Math.max(0, (at - t.created) / HOUR_MS) : null,
          });
        })
        .sort((a, b) =>
          prioRank(a.priority) - prioRank(b.priority) || tsDesc(b.closedAt) - tsDesc(a.closedAt)
        );
      const unassignedList = openList.concat(backlogList)
        .filter((t) => t.assigneeAvailable && !t.assignee)
        .sort((a, b) => tsAsc(a.created) - tsAsc(b.created));
      const maxPriorityList = state
        .filter((t) => t.priority && maxPrioSet.has(t.priority.toLowerCase()))
        .sort((a, b) =>
          prioRank(a.priority) - prioRank(b.priority) || tsAsc(a.created) - tsAsc(b.created)
        );
      const resolutionValues = closedList
        .map((t) => t.hoursOpenToClosed).filter((h) => h != null);
      const elapsedMs = Math.max(0, cutoff.getTime() - week.start.getTime());
      const createdThisWeek = tickets.filter(
        (t) => t.created && t.created >= week.start && t.created < cutoff
      ).length;
      return {
        index, cutoff, isCurrent, openList, backlogList, closedList,
        unassignedList, maxPriorityList,
        statusUnavailableCount: state.filter((t) => !t.statusAvailable).length,
        openNow: openList.length + backlogList.length,
        closedThisWeek: closedList.length,
        createdThisWeek,
        avgResolutionHours: avgOf(resolutionValues),
        avgResolutionCount: resolutionValues.length,
        createdPerDayCurrent: dayCounts(week, cutoff),
        elapsedMs,
        elapsedHours: Math.round(elapsedMs / HOUR_MS),
        elapsedDays: Math.max(1, Math.min(7,
          Array.from({ length: 7 }, (_, d) => addDays(week.start, d).getTime())
            .filter((bound) => cutoff.getTime() >= bound).length
        )),
      };
    });

    snapshots.forEach((snapshot, index) => {
      closeCount[index] = snapshot.closedList.length;
    });

    // First-comment dates are fetched once for the union of tickets that can
    // appear in a highest-priority snapshot; switching weeks remains local.
    const maxPriorityTickets = new Map();
    snapshots.forEach((s) => s.maxPriorityList.forEach((t) => maxPriorityTickets.set(t.key, t)));
    for (const t of maxPriorityTickets.values()) {
      if (onProgress) onProgress(`First comment ${t.key}…`);
      try { t.firstCommentDate = await client.getFirstCommentDate(t.key); }
      catch (e) { t.firstCommentDate = null; }
    }
    snapshots.forEach((snapshot) => {
      snapshot.maxPriorityList.forEach((t) => {
        const source = maxPriorityTickets.get(t.key);
        const comment = source && source.firstCommentDate;
        t.firstCommentDate = comment && comment < snapshot.cutoff ? comment : null;
        t.hoursToFirstComment = t.created && t.firstCommentDate
          ? Math.max(0, (t.firstCommentDate - t.created) / HOUR_MS) : null;
        t.hoursToResolution = t.created && t.resolved && t.resolved < snapshot.cutoff
          ? Math.max(0, (t.resolved - t.created) / HOUR_MS) : null;
      });
    });

    const thr = parseInt(cfg.stableThresholdPct, 10);
    const threshold = isNaN(thr) ? 10 : thr;
    snapshots.forEach((snapshot, index) => {
      const prev = index > 0 ? snapshots[index - 1] : null;
      let comparison = prev;
      if (prev && snapshot.isCurrent) {
        const prevCutoff = new Date(Math.min(
          weeks[index - 1].end.getTime(),
          weeks[index - 1].start.getTime() + snapshot.elapsedMs
        ));
        const prevState = tickets.map((t) => ticketAtCutoff(t, prevCutoff)).filter(Boolean);
        const prevClosed = tickets
          .map((t) => ({ ticket: t, at: closureInWeek(t, weeks[index - 1], prevCutoff) }))
          .filter((entry) => entry.at)
          .map((entry) => Object.assign({}, entry.ticket, { closedAt: entry.at }));
        comparison = {
          openNow: prevState.filter((t) => t.isOpen).length,
          closedThisWeek: prevClosed.length,
          createdThisWeek: tickets.filter(
            (t) => t.created && t.created >= weeks[index - 1].start && t.created < prevCutoff
          ).length,
          avgResolutionHours: avgOf(prevClosed
            .filter((t) => t.created)
            .map((t) => Math.max(0, (t.closedAt - t.created) / HOUR_MS))),
        };
      }
      snapshot.openAtPrevWeekEnd = prev ? prev.openNow : null;
      snapshot.closedPrevWeek = prev ? prev.closedThisWeek : null;
      snapshot.closedPrevSameElapsed = comparison ? comparison.closedThisWeek : null;
      snapshot.createdPrevWeek = prev ? prev.createdThisWeek : null;
      snapshot.createdPrevSameElapsed = comparison ? comparison.createdThisWeek : null;
      snapshot.avgResolutionPrevSameElapsed = comparison ? comparison.avgResolutionHours : null;
      snapshot.createdPerDayPrev = prev ? prev.createdPerDayCurrent : null;
      const trend = (previous, current, higherIsBetter) =>
        previous == null || current == null
          ? { direction: "na", pct: null, good: null }
          : computeTrend([previous, current], threshold, higherIsBetter);
      snapshot.trends = {
        open: trend(snapshot.openAtPrevWeekEnd, snapshot.openNow, false),
        close: trend(snapshot.closedPrevSameElapsed, snapshot.closedThisWeek, true),
        created: trend(snapshot.createdPrevSameElapsed, snapshot.createdThisWeek, false),
        resolution: trend(
          snapshot.avgResolutionPrevSameElapsed, snapshot.avgResolutionHours, false
        ),
      };
    });

    const ref = snapshots[win.currentIndex];
    return Object.assign({
      mode: "run", future: false, weeks,
      currentIndex: win.currentIndex,
      currentWeekIndex: win.currentWeekIndex,
      hasCurrentWeek: win.hasCurrentWeek,
      completeCount: win.completeCount,
      hasComparison: win.hasComparison,
      firstWeekStart: win.firstWeekStart,
      periodMode: win.periodMode,
      truncated: win.truncated,
      missingStartDate: win.missingStartDate,
      openCount, closeCount, snapshots,
      maxPriorities: project.maxPriorities || [], generatedAt: now,
      totalIssues: issues.length,
      historicalDataIncomplete: issues.some((issue) => issue._changelogComplete === false),
      jql,
    }, ref);
  }

  /* Orchestration: fetches the tickets and computes all the metrics.
   * client = JKDJira.makeClient(cfg)
   */
  async function analyzeProject(client, project, cfg, onProgress) {
    const win = buildWindowWeeks(
      configStartDate(cfg),
      null,
      cfg.buildPeriodMode
    );
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
    const configuredStart = parseStartDate(configStartDate(cfg));
    const clampStart = win.periodMode === "complete"
      ? (configuredStart || win.firstWeekStart)
      : (configuredStart && configuredStart < win.firstWeekStart
          ? configuredStart
          : win.firstWeekStart);

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

    // The dashboard computes Build trends for its selected reference index.

    return {
      future: false,
      weeks,
      currentIndex: win.currentIndex,
      currentWeekIndex: win.currentWeekIndex,
      hasCurrentWeek: win.hasCurrentWeek,
      completeCount: win.completeCount,
      hasComparison: win.hasComparison,
      firstWeekStart: win.firstWeekStart,
      periodMode: win.periodMode,
      truncated: win.truncated,
      missingStartDate: win.missingStartDate,
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
        // Initial values use the last loaded week; the dashboard recomputes
        // these locally when another reference week is selected.
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
    COMPLETE_WINDOW_WEEKS,
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
