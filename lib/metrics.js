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
    const diffWeeks = Math.round((Date.UTC(
      currentWeekStart.getFullYear(), currentWeekStart.getMonth(), currentWeekStart.getDate()
    ) - Date.UTC(
      firstWeekStart.getFullYear(), firstWeekStart.getMonth(), firstWeekStart.getDate()
    )) / (7 * DAY_MS));

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
  // Project keys are interpolated into every JQL query. Accept only the syntax
  // JIRA assigns to project keys so imported settings cannot escape project scope.
  function projectKeyForJql(project) {
    const key = String(project && project.key || "").trim();
    if (!/^[A-Za-z][A-Za-z0-9_]{0,254}$/.test(key)) {
      throw new Error("Invalid JIRA project key. Use letters, digits, and underscores, starting with a letter.");
    }
    return key;
  }

  function quoteList(statuses) {
    return statuses
      .map((s) => `"${String(s).trim().replace(/"/g, '\\"')}"`)
      .filter((s) => s !== '""')
      .join(", ");
  }

  // Accept a trailing top-level user ORDER BY, but keep query ordering
  // deterministic by removing only that suffix before each builder appends its
  // own sort. The scanner leaves quoted literals, escaped quotes, and nested
  // function arguments untouched (including Jira account IDs in quoted values).
  function additionalJqlClause(project) {
    const text = String(project && project.extraJql || "").trim();
    if (!text) return "";

    let depth = 0;
    let quote = null;
    let escaped = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === quote) {
          quote = null;
        }
        continue;
      }
      if (ch === "\"" || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === "(") {
        depth += 1;
        continue;
      }
      if (ch === ")") {
        if (depth === 0) return ` AND (${text})`;
        depth -= 1;
        continue;
      }
      if (depth !== 0 || (i > 0 && /[A-Za-z0-9_]/.test(text[i - 1]))) continue;
      const orderBy = /^ORDER\s+BY\b/i.exec(text.slice(i));
      if (!orderBy) continue;
      const sortFields = text.slice(i + orderBy[0].length).trim();
      if (!sortFields) continue;
      const filter = text.slice(0, i).trim();
      return filter ? ` AND (${filter})` : "";
    }
    return ` AND (${text})`;
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
    const key = projectKeyForJql(project);
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
    jql += additionalJqlClause(project);
    jql += " ORDER BY updated DESC";
    return jql;
  }

  // Epic Lead Time uses a dedicated project-only query so project-wide
  // Additional JQL and Issue types counted settings cannot remove Epics from
  // the overview. The metric-specific Lead Time type selection is still
  // checked locally before a duration is included.
  function buildLeadEpicJql(project, windowStart, windowEnd) {
    const key = projectKeyForJql(project);
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
    jql += ` AND issuetype = ${quoteList(["Epic"])} ORDER BY updated DESC`;
    return jql;
  }

  function buildLeadEpicOpenJql(project) {
    const key = projectKeyForJql(project);
    return `project = "${key}" AND statusCategory != Done AND ` +
      `issuetype = ${quoteList(["Epic"])} ORDER BY updated DESC`;
  }

  // Backward-compatible helper name; growing Lead Time now analyzes Epics only.
  function buildLeadOpenJql(project) {
    return buildLeadEpicOpenJql(project);
  }

  // --- Extracting key dates from a ticket's changelog ---
  function statusTransitions(histories) {
    // Returns [{ at: Date, to: string, from: string }] sorted chronologically
    const events = [];
    for (const h of histories || []) {
      const at = new Date(h.created);
      for (const it of h.items || []) {
        if (it.field === "status" || it.fieldId === "status") {
          events.push({
            at,
            to: it.toString,
            from: it.fromString,
            toId: it.toId,
            fromId: it.fromId,
          });
        }
      }
    }
    events.sort((a, b) => a.at - b.at);
    return events;
  }

  function issueHistories(issue) {
    // fetchIssuesWithChangelog stores the paginated, authoritative history here
    // when the search response only carried a truncated changelog.
    if (issue && Array.isArray(issue._changelog)) return issue._changelog;
    return issue && issue.changelog && Array.isArray(issue.changelog.histories)
      ? issue.changelog.histories
      : [];
  }

  // JQL for tickets that changed status into a board or backlog status within
  // the window. Used to measure additions to the board and moves back to
  // backlog. Returns null if neither group is configured for the project.
  function buildChurnJql(project, windowStart, windowEnd) {
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
    const key = projectKeyForJql(project);
    let jql = `project = "${key}" AND (${clauses.join(" OR ")})`;
    jql += issueTypeClause(project);
    jql += additionalJqlClause(project);
    jql += " ORDER BY updated DESC";
    return jql;
  }

  // Committed throughput is limited to the team's Waiting and Work in progress
  // categories. Workflow end belongs to the broader board set, but is not work
  // waiting to be started or actively in progress and must not inflate this KPI.
  function committedStatusesFor(project) {
    const waiting = Array.isArray(project && project.waitingStatuses) ? project.waitingStatuses : [];
    const inProgress = Array.isArray(project && project.inProgressStatuses) ? project.inProgressStatuses : [];
    const seen = new Set();
    const statuses = [];
    for (const value of [...waiting, ...inProgress]) {
      const name = String(value || "").trim();
      const key = name.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      statuses.push(name);
    }
    return statuses;
  }

  // JQL candidate query for issues that were in a Committed-eligible status
  // during the analysis period. `status WAS IN` also captures tickets that
  // entered Waiting / Work in progress before the period and remain there.
  // Returns null when neither Waiting nor Work in progress is configured.
  function buildReadySnapshotJql(project, windowStart, windowEnd) {
    const eligible = committedStatusesFor(project);
    if (!eligible.length) return null;
    const key = projectKeyForJql(project);
    let jql =
      `project = "${key}" AND status WAS IN (${quoteList(eligible)}) ` +
      `DURING ("${isoDate(windowStart)}", "${isoDate(windowEnd)}")`;
    jql += issueTypeClause(project);
    jql += additionalJqlClause(project);
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

  // --- Status-time analysis -------------------------------------------------
  // The configured list is the visual Kanban order. Comparisons use normalized
  // keys, while the original spelling/order remains available to the dashboard.
  function normalizeOrderedStatuses(list) {
    const seen = new Set();
    const out = [];
    for (const value of Array.isArray(list) ? list : []) {
      const name = String(value || "").trim();
      const key = name.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ name, key, order: out.length });
    }
    return out;
  }

  function resolveStatusTimeFlow(project, mode) {
    const configured = project && project.statusTimeFlow &&
      project.statusTimeFlow[mode === "run" ? "run" : "build"];
    const done = new Set((project && project.doneStatuses || [])
      .map((s) => String(s).trim().toLowerCase()).filter(Boolean));
    const all = normalizeOrderedStatuses(configured);
    const invalidDoneStatuses = all.filter((s) => done.has(s.key)).map((s) => s.name);
    const statuses = all.filter((s) => !done.has(s.key));
    const board = new Set((project && project.readyStatuses || [])
      .map((s) => String(s).trim().toLowerCase()).filter(Boolean));
    return {
      statuses: statuses.map((s) => Object.assign({}, s, { isBoardEntry: board.has(s.key) })),
      invalidDoneStatuses,
    };
  }

  // Candidate query only: exact intervals are always reconstructed locally from
  // the changelog and clipped to half-open [windowStart, windowEnd[ bounds.
  function buildStatusDurationJql(project, mode, statuses, windowStart, windowEnd) {
    if (!statuses || !statuses.length) return null;
    if (!String(project && project.key || "").trim()) return null;
    const key = projectKeyForJql(project);
    let jql = `project = "${key}" AND status WAS IN (${quoteList(statuses.map((s) => s.name))}) ` +
      `DURING ("${isoDate(windowStart)}", "${isoDate(windowEnd)}")`;
    if (mode === "run") {
      const labels = (project.runLabels || []).map((s) => String(s).trim()).filter(Boolean);
      if (labels.length) jql += ` AND labels IN (${quoteList(labels)})`;
    }
    jql += issueTypeClause(project);
    jql += additionalJqlClause(project);
    return jql + " ORDER BY updated DESC";
  }

  // Returns the status at the start of an observation. When a first changelog
  // event has no `from` value, the preceding status is unknowable and is never
  // fabricated from today's status.
  function statusAtWindowStart(issue, events, start) {
    const created = issue && issue.fields && issue.fields.created ? new Date(issue.fields.created) : null;
    if (!events.length) {
      const status = issue && issue.fields && issue.fields.status && issue.fields.status.name;
      return { status: status || null, known: !!status && (!created || created <= start) };
    }
    let status = null;
    let known = false;
    for (const event of events) {
      if (event.at > start) break;
      if (event.to != null && String(event.to).trim()) {
        status = event.to;
        known = true;
      }
    }
    if (!known && events[0].from != null && String(events[0].from).trim()) {
      status = events[0].from;
      known = true;
    }
    return { status: status || null, known };
  }

  function extractFlowStatusIntervals(issue, events, options) {
    const requestedStart = options.windowStart;
    const requestedEnd = options.windowEnd;
    const now = options.now || new Date();
    const created = issue && issue.fields && issue.fields.created ? new Date(issue.fields.created) : null;
    const effectiveEnd = new Date(Math.min(requestedEnd.getTime(), now.getTime()));
    let start = requestedStart;
    if (created && created > start) start = created;
    if (start >= effectiveEnd) return { intervals: [], partial: false };

    const state = statusAtWindowStart(issue, events, start);
    let status = state.status;
    let known = state.known;
    let cursor = start;
    let partial = !known;
    const intervals = [];
    const pushInterval = (end) => {
      if (!known || !status || end <= cursor) return;
      const key = String(status).trim().toLowerCase();
      if (options.flowSet.has(key)) {
        intervals.push({ statusKey: key, start: cursor, end, durationMs: end - cursor });
      }
    };
    for (const event of events) {
      if (event.at <= start) continue;
      if (event.at >= effectiveEnd) break;
      pushInterval(event.at);
      cursor = event.at;
      if (event.to != null && String(event.to).trim()) {
        status = event.to;
        known = true;
      } else {
        status = null;
        known = false;
        partial = true;
      }
    }
    pushInterval(effectiveEnd);
    return { intervals, partial };
  }

  async function analyzeStatusDuration(client, project, mode, windowStart, windowEnd, onProgress, weeks) {
    const flow = resolveStatusTimeFlow(project, mode);
    if (!flow.statuses.length) {
      return {
        enabled: false, available: false,
        reason: "Configure the ordered Kanban flow statuses for this team.",
        statuses: [], invalidDoneStatuses: flow.invalidDoneStatuses,
      };
    }
    const jql = buildStatusDurationJql(project, mode, flow.statuses, windowStart, windowEnd);
    if (!jql) return { enabled: false, available: false, reason: "A JIRA project key is required.", statuses: [] };
    if (onProgress) onProgress("Analysing time spent by status…");
    const issues = await fetchIssuesWithChangelog(client, jql, onProgress,
      ["created", "summary", "labels", "status"]);
    const observedWeeks = Array.isArray(weeks) ? weeks : [];
    const byKey = new Map(flow.statuses.map((s) => [s.key, Object.assign({}, s, {
      totalMs: 0, ticketCount: 0, segmentCount: 0,
      weekly: observedWeeks.map(() => ({ totalMs: 0, ticketCount: 0, segmentCount: 0 })),
    })]));
    const flowSet = new Set(byKey.keys());
    let incompleteIssueCount = 0;
    let partialIssueCount = 0;
    let countedIssueCount = 0;
    for (const issue of issues) {
      if (issue._changelogComplete === false) { incompleteIssueCount += 1; continue; }
      const intervals = extractFlowStatusIntervals(issue, statusTransitions(issueHistories(issue)), {
        windowStart, windowEnd, now: new Date(), flowSet,
      });
      if (intervals.partial) partialIssueCount += 1;
      const perTicket = new Map();
      const perTicketSegments = new Map();
      const perTicketWeek = new Map();
      intervals.intervals.forEach((part) => {
        perTicket.set(part.statusKey, (perTicket.get(part.statusKey) || 0) + part.durationMs);
        perTicketSegments.set(part.statusKey, (perTicketSegments.get(part.statusKey) || 0) + 1);
        observedWeeks.forEach((week, weekIndex) => {
          const start = Math.max(part.start.getTime(), week.start.getTime());
          const end = Math.min(part.end.getTime(), week.end.getTime());
          if (end <= start) return;
          const key = `${part.statusKey}\u0000${weekIndex}`;
          const value = perTicketWeek.get(key) || { statusKey: part.statusKey, weekIndex, totalMs: 0, segmentCount: 0 };
          value.totalMs += end - start;
          value.segmentCount += 1;
          perTicketWeek.set(key, value);
        });
      });
      if (perTicket.size) countedIssueCount += 1;
      perTicket.forEach((durationMs, key) => {
        const row = byKey.get(key);
        row.totalMs += durationMs;
        row.ticketCount += 1;
        row.segmentCount += perTicketSegments.get(key) || 0;
      });
      perTicketWeek.forEach((value) => {
        const row = byKey.get(value.statusKey);
        const weekly = row && row.weekly[value.weekIndex];
        if (!weekly) return;
        weekly.totalMs += value.totalMs;
        weekly.ticketCount += 1;
        weekly.segmentCount += value.segmentCount;
      });
    }
    const thresholdMs = 2 * DAY_MS;
    const statuses = flow.statuses.map((flowStatus) => {
      const row = byKey.get(flowStatus.key);
      const averageMs = row.ticketCount ? row.totalMs / row.ticketCount : null;
      const weekly = row.weekly.map((week) => {
        const weeklyAverageMs = week.ticketCount ? week.totalMs / week.ticketCount : null;
        return Object.assign({}, week, {
          averageMs: weeklyAverageMs,
          averageHours: weeklyAverageMs == null ? null : weeklyAverageMs / 3600000,
        });
      });
      return Object.assign({}, row, {
        averageMs,
        averageHours: averageMs == null ? null : averageMs / 3600000,
        weekly,
        exceedsAverageThreshold: averageMs != null && averageMs > thresholdMs,
      });
    });
    return {
      enabled: true, available: true, statuses, hasObservedIntervals: statuses.some((row) => row.totalMs > 0), thresholdMs,
      windowStart, windowEnd: new Date(Math.min(windowEnd.getTime(), Date.now())),
      requestedWindowEnd: windowEnd, totalCandidateIssues: issues.length,
      countedIssueCount, incompleteIssueCount, partialIssueCount,
      invalidDoneStatuses: flow.invalidDoneStatuses, jql,
    };
  }

  // True if the ticket was in one of the supplied eligible statuses during
  // [start, end). The candidate query spans the analysis period, so every
  // weekly window must be checked locally. Never infer status before creation;
  // the configured end is exclusive like every other weekly counting window.
  function wasReadyDuring(issue, events, start, end, eligibleSet) {
    const rawCreated = issue && issue.fields && issue.fields.created;
    const created = rawCreated ? new Date(rawCreated) : null;
    if (!created || isNaN(created) || created.getTime() >= end.getTime()) return false;
    const effectiveStart = created > start ? created : start;
    if (effectiveStart >= end || !eligibleSet || !eligibleSet.size) return false;

    const st0 = statusAtTime(issue, events, effectiveStart);
    if (st0 && eligibleSet.has(String(st0).trim().toLowerCase())) return true;
    const s = effectiveStart.getTime();
    const e = end.getTime();
    for (const ev of events || []) {
      const at = ev.at.getTime();
      if (!Number.isFinite(at)) continue;
      if (at < s) continue;
      if (at >= e) break;
      if (ev.to && eligibleSet.has(String(ev.to).trim().toLowerCase())) return true;
    }
    return false;
  }

  async function mapLimit(items, limit, fn) {
    const values = Array.from(items || []);
    let nextIndex = 0;
    const workerCount = Math.min(values.length, Math.max(1, Math.floor(limit) || 1));
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextIndex < values.length) {
        const index = nextIndex++;
        await fn(values[index], index);
      }
    }));
  }

  // Completes embedded changelogs where necessary. Keep detail requests bounded
  // so large JIRA projects do not serialize every round-trip or flood the API.
  async function ensureIssueChangelogs(client, issues, onProgress) {
    await mapLimit(issues, 3, async (issue) => {
      const cl = issue.changelog;
      const needFull =
        !cl ||
        !Array.isArray(cl.histories) ||
        (typeof cl.total === "number" && cl.total > cl.histories.length);
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
    });
    return issues;
  }

  async function fetchIssuesWithChangelog(client, jql, onProgress, fields) {
    const issues = await client.searchAll(
      jql,
      fields || ["created", "resolutiondate", "summary", "status"],
      "changelog"
    );
    return ensureIssueChangelogs(client, issues, onProgress);
  }

  function nameSet(values) {
    return new Set((Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
  }

  function issueMatchesTypes(issue, types) {
    const selected = nameSet(types);
    if (!selected.size) return true;
    const name = issue && issue.fields && issue.fields.issuetype && issue.fields.issuetype.name;
    return selected.has(String(name || "").trim().toLowerCase());
  }

  function statusCatalog(project) {
    return Array.isArray(project && project._statusCatalog) ? project._statusCatalog : [];
  }

  /* Returns the status names shared by every selected issue-type workflow.
   * Empty issue-type selection means every project workflow. This is used only
   * by the Lead fallback: the normal start-status calculation intentionally
   * counts every non-Done interval after the selected start. */
  function commonNonDoneStatusNames(groups, issueTypes) {
    const all = Array.isArray(groups) ? groups : [];
    const wanted = nameSet(issueTypes);
    const selected = all.filter((group) =>
      !wanted.size || wanted.has(String(group && group.issueTypeName || "").trim().toLowerCase())
    );
    if (!selected.length) return [];
    const first = selected[0].statuses || [];
    const rest = selected.slice(1).map((group) => new Set(
      (group.statuses || [])
        .filter((status) => status && status.categoryKey !== "done")
        .map((status) => String(status.name || "").trim().toLowerCase())
        .filter(Boolean)
    ));
    return first
      .filter((status) => {
        const key = String(status && status.name || "").trim().toLowerCase();
        return key && status.categoryKey !== "done" && rest.every((set) => set.has(key));
      })
      .map((status) => String(status.name || "").trim())
      .filter(Boolean);
  }

  function statusIsDone(project, name, id) {
    const normalizedId = String(id || "").trim();
    const normalizedName = String(name || "").trim().toLowerCase();
    const catalog = statusCatalog(project);
    const metadata = catalog.find((status) =>
      (normalizedId && String(status.id || "") === normalizedId) ||
      (!normalizedId && String(status.name || "").trim().toLowerCase() === normalizedName)
    );
    if (metadata && metadata.categoryKey) return metadata.categoryKey === "done";
    return nameSet(project && project.doneStatuses).has(normalizedName);
  }

  function initialStatus(issue, events) {
    if (events.length && events[0].from && String(events[0].from).trim()) return events[0].from;
    return null;
  }

  function findStartStatusDate(issue, events, startStatus, endDate) {
    const target = String(startStatus || "").trim().toLowerCase();
    if (!target) return null;
    const created = issue && issue.fields && issue.fields.created ? new Date(issue.fields.created) : null;
    if (!created || isNaN(created)) return null;
    let status = initialStatus(issue, events);
    if (status && String(status).trim().toLowerCase() === target) return created;
    for (const event of events) {
      if (endDate && event.at >= endDate) break;
      if (event.to && String(event.to).trim().toLowerCase() === target) return event.at;
      if (!event.to || !String(event.to).trim()) return null;
      status = event.to;
    }
    return null;
  }

  /* Sums all known time from the selected start status until an end boundary,
   * excluding every interval in a JIRA Done-category status. The start
   * transition is included and the end boundary is exclusive. */
  function durationFromStartToBoundary(issue, events, startDate, endDate, project) {
    if (!startDate) return { available: false, durationMs: null };
    if (!endDate || endDate <= startDate) return { available: true, durationMs: 0 };
    let status = initialStatus(issue, events);
    let statusId = events.length ? events[0].fromId : null;
    if (!status) return { available: false, durationMs: null };
    let cursor = startDate;
    for (const event of events) {
      if (event.at > startDate) break;
      if (!event.to || !String(event.to).trim()) return { available: false, durationMs: null };
      status = event.to;
      statusId = event.toId || null;
    }
    let durationMs = 0;
    const add = (until) => {
      if (until > cursor && !statusIsDone(project, status, statusId)) durationMs += until - cursor;
    };
    for (const event of events) {
      if (event.at <= startDate) continue;
      if (event.at >= endDate) break;
      add(event.at);
      cursor = event.at;
      if (!event.to || !String(event.to).trim()) return { available: false, durationMs: null };
      status = event.to;
      statusId = event.toId || null;
    }
    add(endDate);
    return { available: true, durationMs };
  }

  /* Reconstructs exact time in a chosen set of statuses between creation and
   * closing. The first changelog `from` establishes the initial status. When
   * JIRA cannot establish it, report unavailable rather than inventing time.
   * This is retained for imports from v1.37 that used status-inclusion lists. */
  function selectedStatusDuration(issue, events, start, end, selectedStatuses) {
    const selected = nameSet(selectedStatuses);
    if (!selected.size) return { available: false, durationMs: null };
    if (!start || !end || end <= start) return { available: true, durationMs: 0 };
    if (!events.length || !events[0].from || !String(events[0].from).trim()) {
      return { available: false, durationMs: null };
    }
    let status = events[0].from;
    let cursor = start;
    for (const event of events) {
      if (event.at <= start) {
        if (event.to && String(event.to).trim()) status = event.to;
        else return { available: false, durationMs: null };
      }
    }
    let durationMs = 0;
    const add = (until) => {
      if (until <= cursor) return;
      if (selected.has(String(status || "").trim().toLowerCase())) durationMs += until - cursor;
    };
    for (const event of events) {
      if (event.at <= start) continue;
      if (event.at >= end) break;
      add(event.at);
      cursor = event.at;
      if (!event.to || !String(event.to).trim()) return { available: false, durationMs: null };
      status = event.to;
    }
    add(end);
    return { available: true, durationMs };
  }

  /* For legacy Lead settings without an explicit start/filter, growing Lead
   * Time is reconstructed from creation while excluding all Done intervals. */
  function nonDoneDuration(events, start, end, project) {
    if (!start || !end || end <= start) return { available: true, durationMs: 0 };
    if (!events.length || !events[0].from || !String(events[0].from).trim()) {
      return { available: false, durationMs: null };
    }
    let status = events[0].from;
    let statusId = events[0].fromId || null;
    let cursor = start;
    for (const event of events) {
      if (event.at > start) break;
      if (!event.to || !String(event.to).trim()) return { available: false, durationMs: null };
      status = event.to;
      statusId = event.toId || null;
    }
    let durationMs = 0;
    const add = (until) => {
      if (until > cursor && !statusIsDone(project, status, statusId)) durationMs += until - cursor;
    };
    for (const event of events) {
      if (event.at <= start) continue;
      if (event.at >= end) break;
      add(event.at);
      cursor = event.at;
      if (!event.to || !String(event.to).trim()) return { available: false, durationMs: null };
      status = event.to;
      statusId = event.toId || null;
    }
    add(end);
    return { available: true, durationMs };
  }

  function durationScope(issueTypes, statuses, startStatus, fallbackEnabled, fallbackStatuses) {
    const types = Array.isArray(issueTypes) ? issueTypes.map((v) => String(v).trim()).filter(Boolean) : [];
    const selectedStatuses = Array.isArray(statuses) ? statuses.map((v) => String(v).trim()).filter(Boolean) : [];
    const fallback = Array.isArray(fallbackStatuses)
      ? fallbackStatuses.map((v) => String(v).trim()).filter(Boolean)
      : [];
    const start = String(startStatus || "").trim();
    return {
      issueTypes: types,
      startStatus: start,
      statuses: selectedStatuses,
      fallbackEnabled: !!start && fallbackEnabled === true,
      fallbackStatuses: fallback,
      usesStartStatus: !!start,
      usesStatusFilter: selectedStatuses.length > 0 && !start,
      legacy: !start,
    };
  }

  function growingLeadDuration(issue, events, scope, project, asOf) {
    if (issue._changelogComplete === false) return { available: false, reason: "history-incomplete" };
    const created = new Date(issue.fields && issue.fields.created);
    if (isNaN(created) || created > asOf) return { available: false, reason: "invalid-created" };
    if (scope.usesStatusFilter) {
      return selectedStatusDuration(issue, events, created, asOf, scope.statuses);
    }
    if (scope.usesStartStatus) {
      const startDate = findStartStatusDate(issue, events, scope.startStatus, null);
      if (startDate) {
        return durationFromStartToBoundary(issue, events, startDate, asOf, project);
      }
      if (scope.fallbackEnabled) {
        const fallback = selectedStatusDuration(issue, events, created, asOf, scope.fallbackStatuses);
        return Object.assign({}, fallback, { fallbackUsed: !!fallback.available });
      }
      return { available: false, reason: "start-not-reached" };
    }
    return nonDoneDuration(events, created, asOf, project);
  }

  function computeIssueDates(issue, project, clampStart, options) {
    const opts = options || {};
    let created = new Date(issue.fields.created);
    const rawCreated = new Date(created);
    const events = opts.events || statusTransitions(issueHistories(issue));

    // End date = last entry into a JIRA Done-category status. The category is
    // resolved from the project status catalog; configured names remain a
    // compatibility fallback when metadata is unavailable.
    let doneDate = null;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].to && statusIsDone(project, events[i].to, events[i].toId)) {
        doneDate = events[i].at;
        break;
      }
    }
    if (!doneDate && issue.fields.resolutiondate) {
      doneDate = new Date(issue.fields.resolutiondate);
    }

    // Cycle Time is independent of the shared workflow categories. When no
    // explicit Cycle start is configured, measure from issue creation.
    let cycleDefaultStart = created;

    const leadStartDate = opts.leadStartStatus
      ? findStartStatusDate(issue, events, opts.leadStartStatus, doneDate)
      : rawCreated;
    const cycleStartDate = opts.cycleStartStatus
      ? findStartStatusDate(issue, events, opts.cycleStartStatus, doneDate)
      : cycleDefaultStart;

    // Clamping is applied only after eligibility has been established. A
    // missing configured start status remains unavailable, never a creation
    // fallback.
    if (clampStart) {
      const clamp = clampStart.getTime();
      if (created.getTime() < clamp) created = new Date(clamp);
      if (cycleDefaultStart.getTime() < clamp) cycleDefaultStart = new Date(clamp);
    }
    const clampDate = (date) => {
      if (!date) return null;
      return clampStart && date.getTime() < clampStart.getTime() ? new Date(clampStart) : date;
    };

    return {
      created,
      rawCreated,
      startDate: cycleDefaultStart,
      leadStartDate: clampDate(leadStartDate),
      cycleStartDate: clampDate(cycleStartDate),
      doneDate,
    };
  }

  // ===================== RUN MODE (support / run) =====================

  function runMonthlyBounds(now) {
    const reference = now ? new Date(now) : new Date();
    const year = reference.getFullYear();
    return {
      year,
      previousYear: year - 1,
      start: new Date(year - 1, 0, 1),
      end: new Date(year, reference.getMonth() + 1, 1),
    };
  }

  // Monthly query is a separate candidate search so the longer comparison
  // window cannot change weekly lists or historical snapshots.
  function buildRunMonthlyJql(project, windowStart, windowEnd) {
    const key = projectKeyForJql(project);
    const labels = (project.runLabels || []).filter(Boolean);
    const startStr = isoDate(windowStart);
    const endStr = isoDate(windowEnd);
    const clauses = [
      `(created >= "${startStr}" AND created < "${endStr}")`,
      `(resolutiondate >= "${startStr}" AND resolutiondate < "${endStr}")`,
    ];
    const done = (project.doneStatuses || []).filter(Boolean);
    if (done.length) {
      // Widen status-history dates by a calendar day at both ends; this query
      // only selects candidates, and exact month bounds are applied locally.
      const statusFrom = isoDate(addDays(windowStart, -1));
      const statusTo = isoDate(addDays(windowEnd, 1));
      clauses.push(`status CHANGED TO (${quoteList(done)}) AFTER "${statusFrom}" BEFORE "${statusTo}"`);
      // Match Run's `closedAt = now` fallback for currently Done tickets with
      // no resolution date or reconstructable closing event.
      clauses.push(`(resolution IS EMPTY AND status IN (${quoteList(done)}))`);
    }
    let jql = `project = "${key}" AND (${clauses.join(" OR ")})`;
    if (labels.length) jql += ` AND labels IN (${quoteList(labels)})`;
    jql += issueTypeClause(project);
    jql += additionalJqlClause(project);
    return jql + " ORDER BY created ASC";
  }

  // Builds the Jan-through-current-month comparison for Run. Opened means
  // created in the calendar month; closed uses the canonical Run `closedAt`.
  // The current month is compared to the previous year over the same elapsed
  // duration, capped at the previous month's exclusive end. Ticket dates are
  // bucketed in one pass so large yearly populations remain inexpensive.
  function buildRunMonthlyFlow(tickets, now) {
    const reference = now ? new Date(now) : new Date();
    const bounds = runMonthlyBounds(reference);
    const year = bounds.year;
    const previousYear = bounds.previousYear;
    const currentMonth = reference.getMonth();
    const months = Array.from({ length: currentMonth + 1 }, (_, month) => {
      const currentStart = new Date(year, month, 1);
      const currentMonthEnd = new Date(year, month + 1, 1);
      const isCurrent = month === currentMonth;
      const currentCutoff = isCurrent ? reference : currentMonthEnd;
      const previousStart = new Date(previousYear, month, 1);
      const previousMonthEnd = new Date(previousYear, month + 1, 1);
      const previousCutoff = isCurrent
        ? new Date(Math.min(
            previousStart.getTime() + Math.max(0, currentCutoff.getTime() - currentStart.getTime()),
            previousMonthEnd.getTime()
          ))
        : previousMonthEnd;
      return {
        month,
        label: new Intl.DateTimeFormat("en-GB", { month: "short" }).format(currentStart),
        isCurrent,
        currentStart,
        currentCutoff,
        previousStart,
        previousCutoff,
        created: 0,
        closed: 0,
        previousCreated: 0,
        previousClosed: 0,
      };
    });
    for (const ticket of tickets || []) {
      for (const [field, currentKey, previousKey] of [
        ["created", "created", "previousCreated"],
        ["closedAt", "closed", "previousClosed"],
      ]) {
        if (!ticket || !ticket[field]) continue;
        const value = new Date(ticket[field]);
        if (isNaN(value.getTime())) continue;
        const month = value.getMonth();
        const bucket = months[month];
        if (!bucket) continue;
        if (value.getFullYear() === year && value >= bucket.currentStart && value < bucket.currentCutoff) {
          bucket[currentKey] += 1;
        } else if (value.getFullYear() === previousYear && value >= bucket.previousStart && value < bucket.previousCutoff) {
          bucket[previousKey] += 1;
        }
      }
    }
    return {
      year,
      previousYear,
      months,
      queryStart: bounds.start,
      queryEnd: bounds.end,
      currentMonthStart: new Date(year, currentMonth, 1),
      currentCutoff: reference,
      previousMonthCutoff: months.length ? months[months.length - 1].previousCutoff : null,
    };
  }

  // JQL for the weekly Run snapshots: project + labels, currently unresolved
  // issues, and closures in the selected weekly range.
  function buildRunJql(project, windowStart, windowEnd) {
    const key = projectKeyForJql(project);
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
      candidates.push(`status CHANGED TO (${quoteList(done)}) AFTER "${dateStr}"`);
    }
    let jql = `project = "${key}"`;
    if (labels.length) jql += ` AND labels IN (${quoteList(labels)})`;
    if (endStr) jql += ` AND created < "${endStr}"`;
    jql += ` AND (${candidates.join(" OR ")})`;
    jql += issueTypeClause(project);
    jql += additionalJqlClause(project);
    jql += " ORDER BY created ASC";
    return jql;
  }

  /* Analysis of a project in RUN mode. Weeks Mon 00:00 -> next Mon 00:00.
   * Weekly metrics include creations, closures, current open-ticket snapshots,
   * per-day creation flow and resolution duration. A separate monthly query
   * supplies Jan-to-current-month created/closed counts versus the same months
   * of the previous year without changing the weekly population.
   */
  async function analyzeRunProject(client, project, cfg, onProgress) {
    const now = new Date();
    const win = buildWindowWeeks(configStartDate(cfg), now, cfg.runPeriodMode);
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
    const monthlyBounds = runMonthlyBounds(now);
    const monthlyJql = buildRunMonthlyJql(project, monthlyBounds.start, monthlyBounds.end);
    const fields = [
      "created", "updated", "resolutiondate", "resolution", "summary", "labels",
      "status", "assignee", "priority",
    ];
    if (onProgress) onProgress("JIRA query (run)…");
    const weeklyCandidates = await client.searchAll(jql, fields, "changelog");
    let monthlyCandidates = [];
    let monthlyError = null;
    if (onProgress) onProgress("JIRA query (monthly Run flow)…");
    try {
      monthlyCandidates = await client.searchAll(monthlyJql, fields, "changelog");
    } catch (error) {
      // The optional year-over-year chart must not prevent the established
      // weekly Run dashboard from rendering (for example at JIRA's page cap).
      monthlyError = String(error && error.message || "Monthly JIRA query failed.")
        .replace(/[\\r\\n]+/g, " ").slice(0, 300);
    }

    // The two bounded populations overlap. Deduplicate before completing
    // changelogs so an issue appearing in both searches incurs one detail fetch.
    const candidateByKey = new Map();
    for (const issue of [...weeklyCandidates, ...monthlyCandidates]) {
      if (!issue || !issue.key) continue;
      const previous = candidateByKey.get(issue.key);
      const historyLength = (value) => value && value.changelog && Array.isArray(value.changelog.histories)
        ? value.changelog.histories.length : -1;
      if (!previous || historyLength(issue) > historyLength(previous)) candidateByKey.set(issue.key, issue);
    }
    const uniqueCandidates = await ensureIssueChangelogs(client, Array.from(candidateByKey.values()), onProgress);
    const issueByKey = new Map(uniqueCandidates.map((issue) => [issue.key, issue]));
    const issues = weeklyCandidates.map((issue) => issueByKey.get(issue.key)).filter(Boolean);
    const monthlyIssues = monthlyCandidates.map((issue) => issueByKey.get(issue.key)).filter(Boolean);

    const HOUR_MS = 60 * 60 * 1000;
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
    function fieldChangeTimeline(issue, fieldName) {
      const wanted = fieldName.toLowerCase();
      const changes = [];
      for (const h of issueHistories(issue)) {
        const at = new Date(h.created);
        for (const item of h.items || []) {
          const name = String(item.fieldId || item.field || "").toLowerCase();
          if (name === wanted) changes.push({ at, item });
        }
      }
      changes.sort((a, b) => b.at - a.at);
      return changes;
    }

    function fieldAtTime(changes, currentValue, cutoff) {
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

    const ticketCoreByKey = new Map(uniqueCandidates.map((issue) => {
      const f = issue.fields || {};
      const created = f.created ? new Date(f.created) : null;
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
      return [issue.key, {
        issue, key: issue.key, summary: f.summary || "",
        labels: Array.isArray(f.labels) ? f.labels.filter(Boolean) : [],
        created, updated: f.updated ? new Date(f.updated) : null, resolved,
        statusEvents, doneEvents, currentStatus, currentAssignee, currentPriority,
        closedAt: finalDoneEvent || resolved || (currentlyDone ? now : null),
        closedAtApprox: !!(currentlyDone && !finalDoneEvent && !resolved),
        url: `${client.baseUrl}/browse/${issue.key}`,
      }];
    }));
    const tickets = issues.map((issue) => {
      const core = ticketCoreByKey.get(issue.key);
      return Object.assign({}, core, {
        assigneeChanges: fieldChangeTimeline(issue, "assignee"),
        priorityChanges: fieldChangeTimeline(issue, "priority"),
      });
    }).filter(Boolean);
    const monthlyTickets = monthlyIssues
      .map((issue) => ticketCoreByKey.get(issue.key))
      .filter(Boolean);

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
      const assignee = fieldAtTime(t.assigneeChanges, t.currentAssignee, cutoff);
      const priority = fieldAtTime(t.priorityChanges, t.currentPriority, cutoff);
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
          const assignee = fieldAtTime(t.assigneeChanges, t.currentAssignee, at);
          const priority = fieldAtTime(t.priorityChanges, t.currentPriority, at);
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
    await mapLimit(maxPriorityTickets.values(), 3, async (t) => {
      if (onProgress) onProgress(`First comment ${t.key}…`);
      try { t.firstCommentDate = await client.getFirstCommentDate(t.key); }
      catch (e) { t.firstCommentDate = null; }
    });
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
          avgResolutionCount: prevClosed.filter((t) => t.created).length,
        };
      }
      snapshot.openAtPrevWeekEnd = prev ? prev.openNow : null;
      snapshot.closedPrevWeek = prev ? prev.closedThisWeek : null;
      snapshot.closedPrevSameElapsed = comparison ? comparison.closedThisWeek : null;
      snapshot.createdPrevWeek = prev ? prev.createdThisWeek : null;
      snapshot.createdPrevSameElapsed = comparison ? comparison.createdThisWeek : null;
      snapshot.avgResolutionPrevSameElapsed = comparison ? comparison.avgResolutionHours : null;
      snapshot.avgResolutionPrevSameElapsedCount = comparison ? comparison.avgResolutionCount : 0;
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

    const monthlyFlow = monthlyError ? null : buildRunMonthlyFlow(monthlyTickets, now);
    if (monthlyFlow) {
      monthlyFlow.incompleteHistoryCount = monthlyIssues.filter(
        (issue) => issue._changelogComplete === false
      ).length;
    }
    const statusDuration = await analyzeStatusDuration(
      client, project, "run", weeks[0].start, weeks[n - 1].end, onProgress, weeks
    );
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
      openCount, closeCount, snapshots, monthlyFlow, monthlyError,
      maxPriorities: project.maxPriorities || [], generatedAt: now,
      totalIssues: issues.length,
      historicalDataIncomplete: issues.some((issue) => issue._changelogComplete === false),
      statusDuration,
      jql,
      monthlyJql,
    }, ref);
  }

  /* Orchestration: fetches the tickets and computes all the metrics.
   * client = JKDJira.makeClient(cfg)
   */
  async function analyzeProject(client, project, cfg, onProgress) {
    const win = buildWindowWeeks(configStartDate(cfg), null, cfg.buildPeriodMode);
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
    // The project status endpoint is the authority for green Done-category
    // statuses. Keep a fallback to the saved names for older/offline clients.
    let workflowGroups = [];
    if (typeof client.getProjectStatusGroups === "function") {
      try {
        workflowGroups = await client.getProjectStatusGroups(project.key);
      } catch (e) {
        workflowGroups = [];
      }
    }
    const workflowStatuses = [];
    const workflowSeen = new Set();
    workflowGroups.forEach((group) => (group.statuses || []).forEach((status) => {
      const key = String(status.id || status.name || "").trim().toLowerCase();
      if (!key || workflowSeen.has(key)) return;
      workflowSeen.add(key);
      workflowStatuses.push(status);
    }));
    const configuredDone = workflowStatuses
      .filter((status) => status.categoryKey === "done")
      .map((status) => status.name)
      .filter(Boolean);
    const analysisProject = Object.assign({}, project, {
      doneStatuses: configuredDone.length ? configuredDone : (project.doneStatuses || []),
      _statusCatalog: workflowStatuses,
    });
    analysisProject._leadFallbackStatuses = commonNonDoneStatusNames(
      workflowGroups,
      analysisProject.leadTimeIssueTypes
    );
    const jql = buildJql(analysisProject, windowStart, windowEnd);

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
    const fields = ["created", "resolutiondate", "summary", "labels", "status", "issuetype"];
    if (spField) fields.push(spField);

    if (onProgress) onProgress("JIRA query…");
    const issues = await fetchIssuesWithChangelog(client, jql, onProgress, fields);
    const leadEpicJql = buildLeadEpicJql(analysisProject, windowStart, windowEnd);
    const leadEpicOpenJql = buildLeadEpicOpenJql(analysisProject);
    if (onProgress) onProgress("Loading Epic Lead Time closures…");
    let leadEpicIssues = [];
    let leadEpicQueryAvailable = true;
    try {
      leadEpicIssues = await fetchIssuesWithChangelog(client, leadEpicJql, onProgress, fields);
    } catch (e) {
      // Keep the other Build metrics available if the dedicated Epic closure
      // query fails; the Epic Lead Time overview reports unavailable coverage.
      leadEpicQueryAvailable = false;
    }
    if (onProgress) onProgress("Loading open Epics for growing Lead Time…");
    let leadEpicOpenIssues = [];
    let leadEpicOpenQueryAvailable = true;
    try {
      leadEpicOpenIssues = await fetchIssuesWithChangelog(client, leadEpicOpenJql, onProgress, fields);
    } catch (e) {
      // The closed Epic indicators remain available if the open-Epic query fails.
      leadEpicOpenQueryAvailable = false;
    }
    const leadAsOf = new Date();

    const throughput = new Array(n).fill(0);
    const storyPointsWeekly = new Array(n).fill(0);
    const spCounts = new Array(n).fill(0);
    const leadBuckets = Array.from({ length: n }, () => []);
    const cycleBuckets = Array.from({ length: n }, () => []);
    // Duration filters belong to this Build team. Empty lists retain the
    // historical all-types / legacy duration calculation for that team.
    const leadScope = durationScope(
      analysisProject.leadTimeIssueTypes,
      analysisProject.leadTimeStatuses,
      analysisProject.leadTimeStartStatus,
      analysisProject.leadTimeFallbackEnabled !== false,
      analysisProject._leadFallbackStatuses
    );
    const epicLeadFallbackTypes = leadScope.issueTypes.length
      ? leadScope.issueTypes
      : ["Epic"];
    const epicLeadScope = durationScope(
      analysisProject.leadTimeIssueTypes,
      analysisProject.leadTimeStatuses,
      analysisProject.leadTimeStartStatus,
      analysisProject.leadTimeFallbackEnabled !== false,
      commonNonDoneStatusNames(workflowGroups, epicLeadFallbackTypes)
    );
    const cycleScope = durationScope(
      analysisProject.cycleTimeIssueTypes,
      analysisProject.cycleTimeStatuses,
      analysisProject.cycleTimeStartStatus
    );
    const details = [];

    for (const issue of issues) {
      const events = statusTransitions(issueHistories(issue));
      const dates = computeIssueDates(
        issue,
        analysisProject,
        clampStart,
        {
          events,
          leadStartStatus: leadScope.startStatus,
          cycleStartStatus: cycleScope.startStatus,
        }
      );
      const { created, startDate, doneDate, leadStartDate, cycleStartDate } = dates;
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
      // Filtered metrics deliberately observe the complete creation-to-closing
      // journey, independent of the dashboard's loaded-week lower bound.
      const rawCreated = new Date(issue.fields.created);
      const filteredStart = isNaN(rawCreated) ? created : rawCreated;
      const leadIncluded = issueMatchesTypes(issue, leadScope.issueTypes);
      const cycleIncluded = issueMatchesTypes(issue, cycleScope.issueTypes);
      let leadDays = null;
      let cycleDays = null;
      let leadAvailable = leadIncluded;
      let cycleAvailable = cycleIncluded;
      let leadFallbackUsed = false;
      // Empty status lists deliberately retain legacy dates, which are exactly
      // the all-statuses duration while avoiding false unavailability for old
      // tickets whose initial changelog status cannot be reconstructed.
      if (leadIncluded) {
        if (leadScope.usesStatusFilter) {
          const duration = issue._changelogComplete === false
            ? { available: false } : selectedStatusDuration(issue, events, filteredStart, doneDate, leadScope.statuses);
          leadAvailable = !!duration.available;
          leadDays = duration.available ? duration.durationMs / DAY_MS : null;
        } else if (leadScope.usesStartStatus) {
          let duration;
          if (issue._changelogComplete === false) {
            duration = { available: false };
          } else if (leadStartDate) {
            duration = durationFromStartToBoundary(issue, events, leadStartDate, doneDate, analysisProject);
          } else if (leadScope.fallbackEnabled) {
            // The configured start was never reached. Use only the common
            // non-Done statuses for the selected Lead issue types, beginning
            // at creation, so earlier workflow time is not silently lost.
            duration = selectedStatusDuration(
              issue, events, filteredStart, doneDate, leadScope.fallbackStatuses
            );
            leadFallbackUsed = !!duration.available;
          } else {
            duration = { available: false };
          }
          leadAvailable = !!duration.available;
          leadDays = duration.available ? duration.durationMs / DAY_MS : null;
        } else {
          leadDays = (doneDate - created) / DAY_MS;
        }
        if (leadDays != null && leadDays >= 0) leadBuckets[wi].push(leadDays);
      }
      if (cycleIncluded) {
        if (cycleScope.usesStatusFilter) {
          const duration = issue._changelogComplete === false
            ? { available: false } : selectedStatusDuration(issue, events, filteredStart, doneDate, cycleScope.statuses);
          cycleAvailable = !!duration.available;
          cycleDays = duration.available ? duration.durationMs / DAY_MS : null;
        } else if (cycleScope.usesStartStatus) {
          const duration = issue._changelogComplete === false
            ? { available: false }
            : durationFromStartToBoundary(issue, events, cycleStartDate, doneDate, analysisProject);
          cycleAvailable = !!duration.available;
          cycleDays = duration.available ? duration.durationMs / DAY_MS : null;
        } else {
          cycleDays = (doneDate - startDate) / DAY_MS;
        }
        if (cycleDays != null && cycleDays >= 0) cycleBuckets[wi].push(cycleDays);
      }

      const leadExclusionReason = !leadIncluded
        ? "issue-type-excluded"
        : leadAvailable ? null : (issue._changelogComplete === false
          ? "history-incomplete"
          : (!leadStartDate && leadScope.fallbackEnabled ? "fallback-unavailable" : "start-not-reached"));
      const cycleExclusionReason = !cycleIncluded
        ? "issue-type-excluded"
        : cycleAvailable ? null : (issue._changelogComplete === false ? "history-incomplete" : "start-not-reached");
      details.push({
        key: issue.key,
        summary: issue.fields.summary,
        labels: Array.isArray(issue.fields.labels) ? issue.fields.labels.filter(Boolean) : [],
        week: weeks[wi].label,
        weekIndex: wi,
        doneDate,
        storyPoints: sp,
        leadDays,
        cycleDays,
        leadIncluded,
        cycleIncluded,
        leadAvailable,
        cycleAvailable,
        leadFallbackUsed,
        leadStartDate,
        cycleStartDate,
        leadExclusionReason,
        cycleExclusionReason,
        url: `${client.baseUrl}/browse/${issue.key}`,
      });
    }

    const isEpicIssue = (issue) => String(
      issue && issue.fields && issue.fields.issuetype && issue.fields.issuetype.name || ""
    ).trim().toLowerCase() === "epic";
    const leadClosedDetails = [];
    for (const issue of leadEpicIssues) {
      // JQL is project + Epic only. Recheck both the issue type and the
      // independent Lead Time type selection locally before calculating.
      if (!isEpicIssue(issue) || !issueMatchesTypes(issue, epicLeadScope.issueTypes)) continue;
      const events = statusTransitions(issueHistories(issue));
      const dates = computeIssueDates(issue, analysisProject, clampStart, {
        events,
        leadStartStatus: epicLeadScope.startStatus,
      });
      const { created, doneDate, leadStartDate } = dates;
      if (!doneDate || weekIndexOf(doneDate, weeks) < 0) continue;
      const rawCreated = new Date(issue.fields.created);
      const filteredStart = isNaN(rawCreated) ? created : rawCreated;
      let leadDays = null;
      let leadAvailable = true;
      let leadFallbackUsed = false;
      if (epicLeadScope.usesStatusFilter) {
        const duration = issue._changelogComplete === false
          ? { available: false }
          : selectedStatusDuration(issue, events, filteredStart, doneDate, epicLeadScope.statuses);
        leadAvailable = !!duration.available;
        leadDays = duration.available ? duration.durationMs / DAY_MS : null;
      } else if (epicLeadScope.usesStartStatus) {
        let duration;
        if (issue._changelogComplete === false) {
          duration = { available: false };
        } else if (leadStartDate) {
          duration = durationFromStartToBoundary(issue, events, leadStartDate, doneDate, analysisProject);
        } else if (epicLeadScope.fallbackEnabled) {
          duration = selectedStatusDuration(
            issue, events, filteredStart, doneDate, epicLeadScope.fallbackStatuses
          );
          leadFallbackUsed = !!duration.available;
        } else {
          duration = { available: false };
        }
        leadAvailable = !!duration.available;
        leadDays = duration.available ? duration.durationMs / DAY_MS : null;
      } else {
        leadDays = (doneDate - created) / DAY_MS;
      }
      const hasValidLeadDays = leadDays != null && Number.isFinite(leadDays) && leadDays >= 0;
      const leadExclusionReason = !leadAvailable
        ? (issue._changelogComplete === false
          ? "history-incomplete"
          : (!leadStartDate && epicLeadScope.fallbackEnabled ? "fallback-unavailable" : "start-not-reached"))
        : hasValidLeadDays ? null : "invalid-duration";
      leadClosedDetails.push({
        key: issue.key,
        summary: issue.fields.summary,
        labels: Array.isArray(issue.fields.labels) ? issue.fields.labels.filter(Boolean) : [],
        doneDate,
        leadDays: hasValidLeadDays ? leadDays : null,
        leadAvailable: leadAvailable && hasValidLeadDays,
        leadFallbackUsed,
        leadExclusionReason,
        url: `${client.baseUrl}/browse/${issue.key}`,
      });
    }
    leadClosedDetails.sort((a, b) => new Date(b.doneDate) - new Date(a.doneDate));
    const leadClosedValues = leadClosedDetails
      .filter((detail) => detail.leadAvailable && detail.leadDays != null)
      .map((detail) => detail.leadDays);
    const growingLeadValues = [];
    let growingLeadOpenCount = 0;
    let growingLeadFallbackCount = 0;
    let growingLeadUnavailableCount = 0;
    for (const issue of leadEpicOpenIssues) {
      if (!isEpicIssue(issue) || !issueMatchesTypes(issue, epicLeadScope.issueTypes)) continue;
      const currentStatus = issue.fields && issue.fields.status;
      if (statusIsDone(analysisProject, currentStatus && currentStatus.name, currentStatus && currentStatus.id)) continue;
      growingLeadOpenCount += 1;
      const events = statusTransitions(issueHistories(issue));
      const duration = growingLeadDuration(issue, events, epicLeadScope, analysisProject, leadAsOf);
      if (!duration.available || duration.durationMs == null || duration.durationMs < 0) {
        growingLeadUnavailableCount += 1;
        continue;
      }
      growingLeadValues.push(duration.durationMs / DAY_MS);
      if (duration.fallbackUsed) growingLeadFallbackCount += 1;
    }
    const leadOverview = {
      latestClosed: leadClosedDetails.length ? leadClosedDetails[0] : null,
      closedQueryAvailable: leadEpicQueryAvailable,
      closedIssueCount: leadClosedDetails.length,
      closedAvailableCount: leadClosedValues.length,
      averageClosedDays: average(leadClosedValues),
      openQueryAvailable: leadEpicOpenQueryAvailable,
      openIssueCount: growingLeadOpenCount,
      openAvailableCount: growingLeadValues.length,
      openUnavailableCount: growingLeadUnavailableCount,
      openFallbackCount: growingLeadFallbackCount,
      growingAverageDays: average(growingLeadValues),
      asOf: leadAsOf,
    };

    const leadWeekly = leadBuckets.map((b) => aggregate(b, cfg.aggregate));
    const cycleWeekly = cycleBuckets.map((b) => aggregate(b, cfg.aggregate));

    // --- Flow signals ---
    // Committed throughput uses only statuses configured under Waiting or
    // Work in progress. Workflow end is still part of the broader board set
    // for the additions signal, but is excluded from committed counts.
    const committedStatuses = committedStatusesFor(analysisProject);
    const committedSet = new Set(committedStatuses.map((s) => s.toLowerCase()));
    const boardSet = new Set(
      (analysisProject.readyStatuses || [])
        .map((s) => String(s).trim().toLowerCase())
        .filter(Boolean)
    );
    const backlogSet = new Set(
      (analysisProject.backlogStatuses || [])
        .map((s) => String(s).trim().toLowerCase())
        .filter(Boolean)
    );

    // 1) Committed throughput = number of selected-type tickets in a Waiting
    //    or Work in progress status during the configured committed window.
    //    Workflow end statuses are excluded. The issue's status is replayed
    //    from its changelog for each week's exact configured window.
    const slots = resolveSlots(cfg);
    const readySnapshot = new Array(n).fill(0);
    let committedHistoryIncompleteCount = 0;
    let committedMissingCreationDateCount = 0;
    const snapJql = buildReadySnapshotJql(analysisProject, weeks[0].start, weeks[n - 1].end);
    if (snapJql) {
      if (onProgress) onProgress(`Committed snapshot (${slots.engageLabel})…`);
      const snapIssues = await fetchIssuesWithChangelog(client, snapJql, onProgress, ["created", "status", "issuetype"]);
      for (const issue of snapIssues) {
        // JQL applies project, Additional JQL, and issue-type scope. Recheck the
        // selected types locally as a safeguard against malformed/mock results.
        if (!issueMatchesTypes(issue, analysisProject.issueTypes)) continue;
        const rawCreated = issue && issue.fields && issue.fields.created;
        if (!rawCreated || isNaN(new Date(rawCreated))) {
          committedMissingCreationDateCount += 1;
          continue;
        }
        if (issue._changelogComplete === false) {
          committedHistoryIncompleteCount += 1;
          continue;
        }
        const events = statusTransitions(issueHistories(issue));
        for (let wi = 0; wi < n; wi++) {
          // Window bounds computed in calendar days (see weekInstant).
          const start = weekInstant(weeks[wi].start, slots.engageFrom);
          const end = weekInstant(weeks[wi].start, slots.engageTo);
          if (wasReadyDuring(issue, events, start, end, committedSet)) {
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
    const churnJql = buildChurnJql(analysisProject, windowStart, windowEnd);
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
          if (boardSet.size && boardSet.has(to) && !boardSet.has(from)) {
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
    const statusDuration = await analyzeStatusDuration(
      client, analysisProject, "build", windowStart, windowEnd, onProgress, weeks
    );
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
      committedHistoryIncompleteCount,
      committedMissingCreationDateCount,
      readyAdded,
      backlogReturned: backlogBack,
      hasEngage: !!snapJql,
      committedStatuses,
      hasChurn: !!churnJql,
      engageLabel: slots.engageLabel,
      churnLabel: slots.churnLabel,
      leadWeekly,
      cycleWeekly,
      leadOverview,
      counts: leadBuckets.map((b) => b.length),
      leadCounts: leadBuckets.map((b) => b.length),
      cycleCounts: cycleBuckets.map((b) => b.length),
      durationFilters: { lead: leadScope, cycle: cycleScope },
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
      statusDuration,
      jql,
      leadEpicJql,
      leadEpicOpenJql,
      leadOpenJql: leadEpicOpenJql,
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
    additionalJqlClause,
    buildLeadEpicJql,
    buildLeadEpicOpenJql,
    buildLeadOpenJql,
    buildRunJql,
    buildStatusDurationJql,
    analyzeStatusDuration,
    extractFlowStatusIntervals,
    resolveStatusTimeFlow,
    statusAtWindowStart,
    analyzeRunProject,
    runMonthlyBounds,
    buildRunMonthlyJql,
    buildRunMonthlyFlow,
    buildChurnJql,
    buildReadySnapshotJql,
    statusAtTime,
    wasReadyDuring,
    computeIssueDates,
    analyzeProject,
    isoDate,
  };
})(typeof self !== "undefined" ? self : this);
