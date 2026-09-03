/* Kanban Flow — dashboard logic */
(function () {
  "use strict";
  const api = typeof browser !== "undefined" ? browser : chrome;
  const $ = (id) => document.getElementById(id);

  let cfg = null;
  // Last rendered result: used to name and title the exported image.
  let lastRender = null;
  let loadedResult = null;
  let loadedProject = null;
  let loadedMode = null;
  let selectedWeekIndex = -1;

  function setStatus(msg, kind) {
    const panel = $("statusPanel");
    const el = $("statusMessage");
    panel.classList.remove("hidden", "error", "loading");
    if (kind) panel.classList.add(kind);
    panel.setAttribute("role", kind === "error" ? "alert" : "status");
    panel.setAttribute("aria-live", kind === "error" ? "assertive" : "polite");
    el.textContent = msg;
    panel.classList.remove("hidden");
  }
  function hideStatus() {
    $("statusPanel").classList.add("hidden");
  }

  function fmtDays(v) {
    return v == null || isNaN(v) ? "–" : v.toFixed(1);
  }

  // Story points: integer if possible (5), otherwise 1 decimal (2.5).
  function fmtPoints(v) {
    if (v == null || isNaN(v)) return "–";
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  }

  function trendBadge(elId, trend, unit) {
    const el = $(elId);
    el.className = "trend";
    const arrows = { up: "▲", down: "▼", stable: "▬", na: "–" };
    const arrow = arrows[trend.direction] || "–";
    let label;
    if (trend.direction === "na") {
      label = "n/a";
    } else if (trend.direction === "stable") {
      label = "stable";
      el.classList.add("stable");
    } else {
      label = trend.direction === "up" ? "up" : "down";
      if (trend.good === true) el.classList.add("good");
      else if (trend.good === false) el.classList.add("bad");
    }
    let pctTxt = "";
    if (trend.pct != null && !isNaN(trend.pct)) {
      pctTxt = ` ${trend.pct > 0 ? "+" : ""}${trend.pct.toFixed(0)}%`;
    }
    el.textContent = `${arrow} ${label}${pctTxt}`;
    el.title =
      "Trend compares the displayed reference period with the previous week. " +
      "Green = improvement, red = deterioration, blue = stable.";
  }

  function populateProjects() {
    const sel = $("projectSelect");
    sel.innerHTML = '<option value="">— Select a team —</option>';
    (cfg.projects || []).forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.name} (${p.key})`;
      sel.appendChild(opt);
    });
  }

  function periodModeFor(mode) {
    return cfg[mode === "run" ? "runPeriodMode" : "buildPeriodMode"] === "complete"
      ? "complete" : "recent";
  }

  function setupPeriodControls(mode, r) {
    const prefix = mode === "run" ? "run" : "build";
    const active = periodModeFor(mode);
    document.querySelectorAll(`input[name="${prefix}Period"]`).forEach((radio) => {
      radio.checked = radio.value === active;
    });
    const select = $(`${prefix}WeekSelect`);
    select.innerHTML = "";
    r.weeks.forEach((week, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = `${week.label}${week.current ? " — current" : ""}`;
      select.appendChild(option);
    });
    select.value = String(selectedWeekIndex);
  }

  function renderComparisonNote(r, index, mode) {
    const info = $(`${mode === "run" ? "run" : "build"}PeriodWarning`);
    const notes = [];
    if (r.missingStartDate) {
      notes.push("Complete needs a start date; the five latest weeks are shown instead.");
    }
    if (r.truncated && r.weeks.length) {
      notes.push(
        `Complete is limited to the first 52 weeks (${r.weeks[0].label} → ` +
        `${r.weeks[r.weeks.length - 1].label}); more recent weeks are not loaded.`
      );
    }
    if (index === 0) notes.push("No previous loaded week is available for trend comparison.");
    const snapshot = mode === "run" && r.snapshots ? r.snapshots[index] : null;
    if (mode === "run" && !r.weeks[index].current &&
        (r.historicalDataIncomplete || (snapshot && snapshot.statusUnavailableCount))) {
      notes.push("Some complete status histories could not be reconstructed; affected historical values are unavailable and excluded from reconstructed stocks.");
    }
    if (!r.weeks[index].current) {
      notes.push(`The key figures and ticket lists describe the historical week of ${r.weeks[index].label}.`);
    }
    info.classList.toggle("hidden", !notes.length);
    info.textContent = notes.join(" ");
  }

  function applyWeekContext(r, index) {
    const week = r.weeks[index];
    const cur = !!week.current;
    const label = week.label;
    document.body.classList.toggle("no-current-week", !cur);
    document.querySelectorAll(".pill-current").forEach((el) => {
      el.textContent = cur ? "current" : `selected: ${label}`;
      el.title = cur ? "Current week (incomplete)" : `Selected historical week of ${label}`;
    });
    document.querySelectorAll(".week-context").forEach((el) => {
      el.innerHTML = cur
        ? 'the <strong>current week</strong> ("current" badge)'
        : `the <strong>selected week of ${label}</strong>`;
    });
    document.querySelectorAll(".week-context-short").forEach((el) => {
      el.textContent = cur ? "the current week" : `the selected week of ${label}`;
    });
    document.querySelectorAll(".week-context-plain").forEach((el) => {
      el.textContent = cur ? "current week" : `selected week of ${label}`;
    });
    document.querySelectorAll(".week-context-cap").forEach((el) => {
      el.textContent = cur ? "Current week" : `Selected week of ${label}`;
    });
    document.querySelectorAll(".legend-current").forEach((el) => {
      el.classList.toggle("hidden", r.currentWeekIndex == null || r.currentWeekIndex < 0);
    });
    return { isCurrent: cur, label };
  }

  function chartCurrentIndex(r) {
    return r.currentWeekIndex == null ? (r.hasCurrentWeek ? r.currentIndex : -1) : r.currentWeekIndex;
  }

  function chartOptions(r, index) {
    return {
      currentIndex: chartCurrentIndex(r),
      selectedIndex: index,
      minBandWidth: r.periodMode === "complete" ? 46 : null,
    };
  }

  function setChartScrolling(r) {
    document.querySelectorAll(".chart-box").forEach((box) => {
      const weekly = !box.contains($("runDailyChart"));
      const scrollable = r.periodMode === "complete" && weekly;
      box.classList.toggle("chart-scroll", scrollable);
      box.tabIndex = scrollable ? 0 : -1;
      if (scrollable) {
        box.setAttribute("aria-label", `Scrollable ${r.weeks.length}-week chart`);
      } else {
        box.removeAttribute("aria-label");
      }
    });
  }

  function showView(mode) {
    $("buildView").classList.toggle("hidden", mode === "run");
    $("runView").classList.toggle("hidden", mode !== "run");
  }

  function renderResult(project, r, index) {
    hideStatus();
    $("dashboard").classList.remove("hidden");
    showView("build");

    const last = (arr) => arr[arr.length - 1];
    const aggLabel = r.aggregate === "average" ? "(average)" : "(median)";
    $("leadAggLabel").textContent = aggLabel;
    $("cycleAggLabel").textContent = aggLabel;

    renderComparisonNote(r, index, "build");
    const ctx = applyWeekContext(r, index);
    setChartScrolling(r);

    // Cards
    const curLabel = r.weeks[index].label;
    const weekPhrase = ctx.isCurrent
      ? `current week of ${curLabel} (incomplete)`
      : `week of ${curLabel}`;
    $("thrValue").textContent = r.throughput[index];
    $("thrNote").textContent = `completed tickets — ${weekPhrase}`;
    $("engageValue").textContent = r.hasEngage ? r.throughputEngage[index] : "–";
    $("engageNote").textContent = r.hasEngage
      ? `tickets on the board (${r.engageLabel}) — week of ${curLabel}`
      : "Set the team's board statuses (⚙ Settings).";
    // Story points (per-team option): card + chart + column hidden
    // until the option is enabled / the JIRA field is found.
    const spOn = !!r.hasStoryPoints;
    $("spCard").classList.toggle("hidden", !spOn);
    $("spChartPanel").classList.toggle("hidden", !spOn);
    document
      .querySelectorAll("#detailTable .sp-col")
      .forEach((th) => th.classList.toggle("hidden", !spOn));
    if (spOn) {
      $("spValue").textContent = fmtPoints(r.storyPointsWeekly[index]);
      $("spNote").textContent =
        `points delivered on ${r.storyPointsCounts[index]} estimated ticket(s) — ` +
        weekPhrase;
      trendBadge("spTrend", JKDMetrics.computeTrend(
        r.storyPointsWeekly, cfg.stableThresholdPct, true, index
      ));
    } else if (r.trackStoryPoints) {
      // Option enabled but field not found: flagged without blocking.
      $("spCard").classList.remove("hidden");
      $("spValue").textContent = "–";
      $("spNote").textContent =
        "Story points field not found on this JIRA site — specify it in ⚙ Settings.";
      trendBadge("spTrend", { direction: "na", pct: null, good: null });
    }

    $("leadValue").textContent = fmtDays(r.leadWeekly[index]);
    $("cycleValue").textContent = fmtDays(r.cycleWeekly[index]);

    if ($("engageLegend")) {
      $("engageLegend").textContent = r.engageLabel
        ? `Committed (board ${r.engageLabel})`
        : "Committed";
    }

    trendBadge("thrTrend", JKDMetrics.computeTrend(r.throughput, cfg.stableThresholdPct, true, index));
    trendBadge("engageTrend", r.hasEngage
      ? JKDMetrics.computeTrend(r.throughputEngage, cfg.stableThresholdPct, true, index)
      : { direction: "na", pct: null, good: null });
    trendBadge("leadTrend", JKDMetrics.computeTrend(r.leadWeekly, cfg.stableThresholdPct, false, index));
    trendBadge("cycleTrend", JKDMetrics.computeTrend(r.cycleWeekly, cfg.stableThresholdPct, false, index));

    const labels = r.weeks.map((w) => w.label);
    // Committed + delivered throughput on the same chart (grouped bars).
    const series = [];
    if (r.hasEngage) {
      series.push({
        label: "Committed throughput",
        values: r.throughputEngage,
        className: "bar-engage",
        currentClassName: "bar-engage-current",
      });
    }
    series.push({
      label: "Delivered throughput",
      values: r.throughput,
      className: "bar-done",
      currentClassName: "bar-done-current",
    });
    JKDCharts.groupedBarChart($("throughputChart"), {
      title: "Committed and delivered throughput per week",
      labels,
      series,
      ...chartOptions(r, index),
    });
    renderSignals(r, index);
    if (spOn) {
      JKDCharts.groupedBarChart($("spChart"), {
        title: "Delivered story points per week",
        labels,
        series: [
          {
            label: "Delivered story points",
            values: r.storyPointsWeekly,
            className: "bar-done",
            currentClassName: "bar-done-current",
          },
        ],
        ...chartOptions(r, index),
      });
    }
    JKDCharts.lineChart($("leadChart"), {
      title: "Lead time per week",
      seriesLabel: "Lead time",
      unit: "days",
      labels,
      values: r.leadWeekly,
      ...chartOptions(r, index),
    });
    JKDCharts.lineChart($("cycleChart"), {
      title: "Cycle time per week",
      seriesLabel: "Cycle time",
      unit: "days",
      labels,
      values: r.cycleWeekly,
      ...chartOptions(r, index),
    });

    // Detail table — only tickets completed in the selected reference week.
    const tbody = $("detailTable").querySelector("tbody");
    tbody.innerHTML = "";
    const curDetails = r.details.filter((d) => d.weekIndex === index);
    curDetails.forEach((d) => {
      const tr = document.createElement("tr");
      const doneStr = d.doneDate.toLocaleDateString("en-GB");
      tr.innerHTML =
        `<td><a href="${escapeHtml(d.url)}" target="_blank" rel="noopener">${escapeHtml(d.key)}</a></td>` +
        `<td>${escapeHtml(d.summary || "")}</td>` +
        `<td>${d.week}</td>` +
        `<td>${doneStr}</td>` +
        (spOn ? `<td>${fmtPoints(d.storyPoints)}</td>` : "") +
        `<td>${fmtDays(d.leadDays)}</td>` +
        durationCell(
          `${fmtDays(d.cycleDays)}${d.startApprox ? " *" : ""}`,
          cycleInfo(d.cycleDays)
        );
      tbody.appendChild(tr);
    });
    $("detailCount").textContent = curDetails.length;
    $("jqlText").textContent = r.jql;
    $("footerInfo").textContent =
      `${project.name} • ${r.totalIssues} tickets analysed • ` +
      `updated ${new Date().toLocaleString("en-GB")}` +
      (r.details.some((d) => d.startApprox)
        ? " • * approximated cycle time (no entry into an \"in progress\" status)"
        : "");
  }

  function fmtDate(d) {
    return d ? d.toLocaleDateString("en-GB") : "–";
  }
  function fmtDuration(hours) {
    if (hours == null || isNaN(hours)) return "–";
    if (hours < 24) return `${hours.toFixed(1)} h`;
    return `${(hours / 24).toFixed(1)} d`;
  }
  // Thresholds common to all durations displayed (lists + cards):
  // green ≤ 1 d, amber 1–2 d, red > 2 d.
  function ageInfo(hours) {
    if (hours == null || isNaN(hours)) return null;
    const d = hours / 24;
    if (d <= 1) return { cls: "age-ok", label: "Less than 1 day" };
    if (d <= 2) return { cls: "age-warn", label: "Between 1 and 2 days" };
    return { cls: "age-bad", label: "More than 2 days" };
  }
  // Cycle time thresholds (build mode), in days:
  // green ≤ 2 d, amber 2–4 d, red > 4 d. Same colours as run mode.
  function cycleInfo(days) {
    if (days == null || isNaN(days)) return null;
    if (days <= 2) return { cls: "age-ok", label: "Less than 2 days" };
    if (days <= 4) return { cls: "age-warn", label: "Between 2 and 4 days" };
    return { cls: "age-bad", label: "More than 4 days" };
  }
  // Duration cell with dot + tooltip (redundant encoding).
  function durationCell(text, info) {
    if (!info) return `<td>${text}</td>`;
    return (
      `<td class="age ${info.cls}" title="${info.label}">` +
      `<span class="age-dot" aria-hidden="true"></span>${text}</td>`
    );
  }

  function renderRunResult(project, base, index) {
    const r = Object.assign({}, base, base.snapshots[index]);
    hideStatus();
    $("dashboard").classList.remove("hidden");
    showView("run");
    renderComparisonNote(base, index, "run");
    const ctx = applyWeekContext(base, index);
    setChartScrolling(base);

    const curLabel = base.weeks[index].label;

    // Cards
    $("runOpenValue").textContent = r.openNow;
    const openWhen = ctx.isCurrent ? "as of now" : `at the end of the week of ${curLabel}`;
    $("runOpenNote").textContent =
      r.openAtPrevWeekEnd == null
        ? `open ${openWhen} — no previous week to compare`
        : `open ${openWhen} — vs ${r.openAtPrevWeekEnd} open at the previous week cut-off`;
    $("runCloseValue").textContent = r.closedThisWeek;
    $("runCloseNote").textContent =
      r.closedPrevSameElapsed == null
        ? `closed in the week of ${curLabel} — no previous week to compare`
        : ctx.isCurrent
          ? `closed in the week of ${curLabel} — vs ${r.closedPrevSameElapsed} over the same period ` +
            `of the previous week (${r.elapsedHours} h elapsed)` +
            (r.closedPrevWeek == null ? "" : ` — ${r.closedPrevWeek} over the entire previous week`)
          : `closed in the week of ${curLabel} — vs ${r.closedPrevSameElapsed} in the previous week`;
    $("runCreatedValue").textContent = r.createdThisWeek;
    $("runCreatedNote").textContent =
      r.createdPrevSameElapsed == null
        ? `created in the week of ${curLabel} — no previous week to compare`
        : ctx.isCurrent
          ? `created in the week of ${curLabel} — vs ${r.createdPrevSameElapsed} over the same period ` +
            `of the previous week (${r.elapsedHours} h elapsed)` +
            (r.createdPrevWeek == null ? "" : ` — ${r.createdPrevWeek} over the entire previous week`)
          : `created in the week of ${curLabel} — vs ${r.createdPrevSameElapsed} in the previous week`;

    // Average resolution time of tickets closed this week. Same colour
    // coding as the duration columns in the lists: dot + tooltip, with the
    // text keeping normal contrast (never information by colour alone).
    const resolEl = $("runResolValue");
    const resolInfo = ageInfo(r.avgResolutionHours);
    resolEl.className = "metric" + (resolInfo ? ` age ${resolInfo.cls}` : "");
    resolEl.title = resolInfo ? resolInfo.label : "";
    resolEl.innerHTML = resolInfo
      ? `<span class="age-dot" aria-hidden="true"></span>${fmtDuration(r.avgResolutionHours)}`
      : "–";
    $("runResolNote").textContent =
      r.avgResolutionCount === 0
        ? `no ticket closed in the week of ${curLabel}`
        : `average created → closed over ${r.avgResolutionCount} closed ticket(s) ` +
          `in the week of ${curLabel}` +
          (r.avgResolutionPrevSameElapsed == null
            ? " — no previous week to compare"
            : ctx.isCurrent
              ? ` — vs ${fmtDuration(r.avgResolutionPrevSameElapsed)} over the same period ` +
                `of the previous week (${r.elapsedHours} h elapsed)`
              : ` — vs ${fmtDuration(r.avgResolutionPrevSameElapsed)} in the previous week`);

    trendBadge("runOpenTrend", r.trends.open);
    trendBadge("runCloseTrend", r.trends.close);
    trendBadge("runCreatedTrend", r.trends.created);
    trendBadge("runResolTrend", r.trends.resolution);

    const labels = r.weeks.map((w) => w.label);
    // Opened (created) and closed on the same chart, week by week.
    JKDCharts.groupedBarChart($("runFlowChart"), {
      title: "Tickets opened and closed per week",
      labels,
      series: [
        { label: "Opened", values: r.openCount, className: "bar-open", currentClassName: "bar-open-current" },
        { label: "Closed", values: r.closeCount, className: "bar-closed", currentClassName: "bar-closed-current" },
      ],
      ...chartOptions(base, index),
    });
    // Creations per day: selected reference week vs previous loaded week.
    // Weekdays (Mon→Fri) are always displayed; Saturday and Sunday only
    // appear if either compared week has at least one creation.
    const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const dayIdx = [0, 1, 2, 3, 4];
    [5, 6].forEach((d) => {
      const cur = r.createdPerDayCurrent[d] || 0;
      const prev = r.createdPerDayPrev ? r.createdPerDayPrev[d] || 0 : 0;
      if (cur > 0 || prev > 0) dayIdx.push(d);
    });
    const pickDays = (arr) => dayIdx.map((d) => arr[d] || 0);
    const daySeries = [];
    if (r.createdPerDayPrev) {
      daySeries.push({ label: "Previous week", values: pickDays(r.createdPerDayPrev), className: "bar-open" });
    }
    daySeries.push({
      label: ctx.isCurrent ? "Current week" : `Week of ${curLabel}`,
      values: pickDays(r.createdPerDayCurrent),
      className: ctx.isCurrent ? "bar-done-current" : "bar-done",
    });
    JKDCharts.groupedBarChart($("runDailyChart"), {
      title: "Tickets created per day",
      labels: dayIdx.map((d) => dayNames[d]),
      series: daySeries,
      currentIndex: -1,
    });
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    const dailyWhen = ctx.isCurrent
      ? `this week (${r.elapsedDays} day(s) elapsed)`
      : `in the week of ${curLabel}`;
    $("runDailyNote").textContent = r.createdPerDayPrev
      ? `${sum(r.createdPerDayCurrent)} ticket(s) created ${dailyWhen} ` +
        `vs ${sum(r.createdPerDayPrev)} over the entire previous week.`
      : `${sum(r.createdPerDayCurrent)} ticket(s) created ${dailyWhen} — no previous week to compare.`;

    // Open table
    const openBody = $("runOpenTable").querySelector("tbody");
    openBody.innerHTML = "";
    // Coloured age counters: green < 1 d, orange 1–2 d, red > 2 d.
    // Colour dot + tooltip: the information is never carried by colour
    // alone, and the text keeps the table's normal contrast.
    const ageCell = (hours, unavailable) => {
      if (unavailable) return `<td title="Not reconstructable from the JIRA changelog">unavailable</td>`;
      const info = ageInfo(hours);
      if (!info) return `<td>–</td>`;
      const { cls, label } = info;
      return (
        `<td class="age ${cls}" title="${label}">` +
        `<span class="age-dot" aria-hidden="true"></span>${fmtDuration(hours)}` +
        `</td>`
      );
    };
    // Same layout/formatting for the board list and the backlog list.
    const historicalValue = (value, available, empty) =>
      available === false ? "unavailable" : (value || empty);
    const openRow = (t) =>
      `<td><a href="${escapeHtml(t.url)}" target="_blank" rel="noopener">${escapeHtml(t.key)}</a></td>` +
      `<td>${escapeHtml(t.summary)}</td>` +
      `<td>${escapeHtml(t.statusAvailable === false ? "unavailable" : (t.status || ""))}</td>` +
      `<td>${escapeHtml(historicalValue(t.priority, t.priorityAvailable, "–"))}</td>` +
      `<td>${escapeHtml(historicalValue(t.assignee, t.assigneeAvailable, "— unassigned"))}</td>` +
      `<td>${fmtDate(t.created)}</td>` +
      ageCell(t.hoursSinceCreated) +
      ageCell(t.hoursSinceUpdated, t.updatedAvailable === false);
    r.openList.forEach((t) => {
      const tr = document.createElement("tr");
      tr.innerHTML = openRow(t);
      openBody.appendChild(tr);
    });
    $("runOpenCount").textContent = r.openList.length;

    // Unplanned open tickets table (run backlog statuses)
    const backlogBody = $("runBacklogTable").querySelector("tbody");
    backlogBody.innerHTML = "";
    (r.backlogList || []).forEach((t) => {
      const tr = document.createElement("tr");
      tr.innerHTML = openRow(t);
      backlogBody.appendChild(tr);
    });
    $("runBacklogCount").textContent = (r.backlogList || []).length;

    // Closed table (stat equivalent to open)
    const closedBody = $("runClosedTable").querySelector("tbody");
    closedBody.innerHTML = "";
    r.closedList.forEach((t) => {
      const tr = document.createElement("tr");
      // Closing date = entry into a closing status (changelog) or
      // resolution date; the ~ suffix flags an approximated date.
      const closedTxt = t.closedAt
        ? fmtDate(t.closedAt) + (t.closedAtApprox ? " ~" : "")
        : "–";
      tr.innerHTML =
        `<td><a href="${escapeHtml(t.url)}" target="_blank" rel="noopener">${escapeHtml(t.key)}</a></td>` +
        `<td>${escapeHtml(t.summary)}</td>` +
        `<td>${escapeHtml(t.status || "")}</td>` +
        `<td>${escapeHtml(historicalValue(t.priority, t.priorityAvailable, "–"))}</td>` +
        `<td>${escapeHtml(historicalValue(t.assignee, t.assigneeAvailable, "— unassigned"))}</td>` +
        `<td>${fmtDate(t.created)}</td>` +
        `<td>${closedTxt}</td>` +
        ageCell(t.hoursOpenToClosed);
      closedBody.appendChild(tr);
    });
    $("runCloseListCount").textContent = r.closedList.length;

    // Unassigned table
    const unBody = $("runUnassignedTable").querySelector("tbody");
    unBody.innerHTML = "";
    r.unassignedList.forEach((t) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td><a href="${escapeHtml(t.url)}" target="_blank" rel="noopener">${escapeHtml(t.key)}</a></td>` +
        `<td>${escapeHtml(t.summary)}</td>` +
        `<td>${escapeHtml(t.status || "")}</td>` +
        `<td>${escapeHtml(historicalValue(t.priority, t.priorityAvailable, "–"))}</td>` +
        `<td>${fmtDate(t.created)}</td>`;
      unBody.appendChild(tr);
    });
    $("runUnassignedCount").textContent = r.unassignedList.length;

    // Highest-priority table
    const mpBody = $("runMaxPrioTable").querySelector("tbody");
    mpBody.innerHTML = "";
    r.maxPriorityList.forEach((t) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td><a href="${escapeHtml(t.url)}" target="_blank" rel="noopener">${escapeHtml(t.key)}</a></td>` +
        `<td>${escapeHtml(t.summary)}</td>` +
        `<td>${escapeHtml(historicalValue(t.priority, t.priorityAvailable, "–"))}</td>` +
        `<td>${fmtDate(t.created)}</td>` +
        ageCell(t.hoursToFirstComment) +
        (t.hoursToResolution != null ? ageCell(t.hoursToResolution) : `<td>not resolved at cut-off</td>`);
      mpBody.appendChild(tr);
    });
    $("runMaxPrioCount").textContent = r.maxPriorityList.length;

    $("runJqlText").textContent = r.jql;
    $("footerInfo").textContent =
      `${project.name} • run • ${r.totalIssues} tickets analysed • ` +
      `updated ${new Date().toLocaleString("en-GB")}`;
  }

  function renderSignals(r, index) {
    const panel = $("signalsPanel");
    const tbody = $("signalsTable").querySelector("tbody");
    const note = $("currentSignals");
    tbody.innerHTML = "";
    if (!r.hasChurn) {
      panel.classList.add("hidden");
      return;
    }
    panel.classList.remove("hidden");
    const head = (id, base) => {
      const el = $(id);
      if (el) el.textContent = r.churnLabel ? `${base} (${r.churnLabel})` : base;
    };
    head("sigAddedHead", "Added to board");
    head("sigBackHead", "Moved back to backlog");
    const cell = (v) =>
      v > 0
        ? `<td class="sig-warn">⚠ ${v}</td>`
        : `<td class="sig-zero">0</td>`;
    r.weeks.forEach((w, i) => {
      const tr = document.createElement("tr");
      if (i === r.currentWeekIndex) tr.classList.add("row-current");
      if (i === index) tr.classList.add("row-selected");
      const wl = w.current ? `${w.label} (current)` : w.label;
      tr.innerHTML =
        `<td>${wl}</td>` + cell(r.readyAdded[i]) + cell(r.backlogReturned[i]);
      tbody.appendChild(tr);
    });
    // Summary of the reference week (answers to "was there any, how many").
    const ci = index;
    const when = r.weeks[ci].current ? "this week" : `in the selected week of ${r.weeks[ci].label}`;
    const added = r.readyAdded[ci];
    const back = r.backlogReturned[ci];
    const parts = [];
    parts.push(
      added > 0
        ? `<span class="badge warn">⚠ ${added} ticket(s) added to the board (${r.churnLabel}) ${when}</span>`
        : `<span class="badge">No ticket added to the board (${r.churnLabel}) ${when}</span>`
    );
    parts.push(
      back > 0
        ? `<span class="badge warn">⚠ ${back} ticket(s) moved back to backlog (${r.churnLabel}) ${when}</span>`
        : `<span class="badge">No move back to backlog (${r.churnLabel}) ${when}</span>`
    );
    note.innerHTML = parts.join(" ");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }

  // --- Export of the full metrics page as an image ---------------------

  function setExportEnabled(on) {
    const btn = $("exportBtn");
    if (btn) btn.disabled = !on;
  }

  async function exportImage() {
    const btn = $("exportBtn");
    if (!lastRender) return;
    const format = $("exportFormat").value === "jpeg" ? "jpeg" : "png";
    const prevLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "… Capturing";

    // Header visible only in the image: team, mode, generation date.
    const header = $("exportHeader");
    $("exportTitle").textContent = `Kanban Flow — ${lastRender.project.name}`;
    $("exportSubtitle").textContent =
      `Mode ${lastRender.mode === "run" ? "run" : "build"} • ` +
      `${lastRender.weeksLabel} • generated on ${new Date().toLocaleString("en-GB")}`;
    header.classList.remove("hidden");

    try {
      const includeDetails = $("exportDetails").checked;
      const res = await JKDExport.exportNode($("dashboard"), {
        format,
        name: lastRender.project.name,
        openDetails: includeDetails,
      });
      const ko = Math.round(res.bytes / 1024);
      setStatus(
        `Image saved: ${res.fileName} (${res.width}×${res.height} px, ${ko} KB` +
          (includeDetails ? ", ticket lists included" : ", ticket lists collapsed") +
          ")."
      );
      setTimeout(hideStatus, 6000);
    } catch (e) {
      console.error(e);
      setStatus(`Image export failed: ${e.message}`, "error");
    } finally {
      header.classList.add("hidden");
      btn.textContent = prevLabel;
      btn.disabled = false;
    }
  }

  function renderSelectedWeek(index) {
    if (!loadedResult || !loadedProject) return;
    const max = loadedResult.weeks.length - 1;
    selectedWeekIndex = Math.max(0, Math.min(max, Number(index)));
    const prefix = loadedMode === "run" ? "run" : "build";
    $(`${prefix}WeekSelect`).value = String(selectedWeekIndex);
    if (loadedMode === "run") {
      renderRunResult(loadedProject, loadedResult, selectedWeekIndex);
    } else {
      renderResult(loadedProject, loadedResult, selectedWeekIndex);
    }
    const week = loadedResult.weeks[selectedWeekIndex];
    lastRender = {
      project: loadedProject,
      mode: loadedMode,
      weeksLabel: `selected week ${week.label}; loaded range ` +
        `${loadedResult.weeks[0].label} to ${loadedResult.weeks[max].label}`,
    };
  }

  async function applyPeriod(mode) {
    const prefix = mode === "run" ? "run" : "build";
    const selected = document.querySelector(`input[name="${prefix}Period"]:checked`);
    const key = mode === "run" ? "runPeriodMode" : "buildPeriodMode";
    cfg[key] = selected && selected.value === "complete" ? "complete" : "recent";
    await JKDStore.saveConfig(cfg);
    await runAnalysis();
  }

  async function runAnalysis() {
    const id = $("projectSelect").value;
    if (!id) {
      $("dashboard").classList.add("hidden");
      setExportEnabled(false);
      lastRender = null;
      setStatus("Select a team to display its flow metrics.");
      return;
    }
    const project = (cfg.projects || []).find((p) => p.id === id);
    if (!project) return;

    if (!cfg.baseUrl || !cfg.email || !cfg.token) {
      setStatus(
        "Incomplete settings: fill in the JIRA URL, e-mail and API token in ⚙ Settings.",
        "error"
      );
      return;
    }

    $("dashboard").classList.add("hidden");
    setExportEnabled(false);
    lastRender = null;
    setStatus(`Loading data for "${project.name}"…`, "loading");

    try {
      const client = JKDJira.makeClient(cfg);
      const isRun = project.mode === "run";
      const r = isRun
        ? await JKDMetrics.analyzeRunProject(client, project, cfg, (m) =>
            setStatus(m, "loading")
          )
        : await JKDMetrics.analyzeProject(client, project, cfg, (m) =>
            setStatus(m, "loading")
          );
      if (r.future) {
        $("dashboard").classList.add("hidden");
        const d = r.firstWeekStart.toLocaleDateString("en-GB");
        setStatus(
          `The start date (week of ${d}) is in the future ` +
            "relative to the current week. No data to display: " +
            "choose a date equal to or earlier than the current week in ⚙ Settings.",
          "error"
        );
        return;
      }
      loadedResult = r;
      loadedProject = project;
      loadedMode = isRun ? "run" : "build";
      selectedWeekIndex = r.weeks.length - 1;
      setupPeriodControls(loadedMode, r);
      renderSelectedWeek(selectedWeekIndex);
      setExportEnabled(true);
    } catch (e) {
      console.error(e);
      let hint = "";
      if (e.status === 401 || e.status === 403) {
        hint = " Check the e-mail and API token (Settings).";
      } else if (e.status === 400) {
        hint = " The JQL query may be invalid (statuses or project key).";
      } else if (e.status === 404) {
        hint = " JIRA URL or project key not found.";
      }
      setStatus(`Error: ${e.message}.${hint}`, "error");
    }
  }

  async function init() {
    cfg = await JKDStore.loadConfig();
    populateProjects();

    if (!cfg.baseUrl || !cfg.email || !cfg.token) {
      setStatus(
        "Welcome! Start by setting up your JIRA connection and your teams in ⚙ Settings.",
        "error"
      );
    } else if (!cfg.projects || cfg.projects.length === 0) {
      setStatus(
        "No team configured. Add your projects in ⚙ Settings.",
        "error"
      );
    }

    ["build", "run"].forEach((mode) => {
      const prefix = mode;
      document.querySelectorAll(`input[name="${prefix}Period"]`).forEach((radio) => {
        radio.checked = radio.value === periodModeFor(mode);
      });
      $(`${prefix}PeriodApply`).addEventListener("click", () => applyPeriod(mode));
      $(`${prefix}WeekSelect`).addEventListener("change", (event) => {
        if (loadedMode === mode) renderSelectedWeek(event.target.value);
      });
    });

    $("projectSelect").addEventListener("change", runAnalysis);
    $("refreshBtn").addEventListener("click", async () => {
      cfg = await JKDStore.loadConfig();
      runAnalysis();
    });
    $("exportBtn").addEventListener("click", exportImage);
    $("optionsBtn").addEventListener("click", () => api.runtime.openOptionsPage());

    checkUpdate();
  }

  /* ---------- update indicator ---------- */

  // Asks the background worker (single network path); falls back to an in-page
  // check when messaging is unavailable. Never blocks the dashboard.
  async function checkUpdate() {
    if (typeof JKDUpdate === "undefined") return;
    let state = null;
    try {
      const res = await api.runtime.sendMessage({ type: "jkd-update-check" });
      if (res && res.ok) state = res.state;
    } catch (e) {
      /* no listener (e.g. page opened outside the extension context) */
    }
    if (!state) {
      try {
        state = await JKDUpdate.checkForUpdate({});
      } catch (e) {
        return;
      }
    }
    if (!state || !state.updateAvailable) return;
    $("updateDot").classList.remove("hidden");
    $("updateDotLabel").classList.remove("hidden");
    $("optionsBtn").title = `Settings — update available: ${state.latest} (installed ${state.current})`;
  }

  document.addEventListener("DOMContentLoaded", init);
})();
