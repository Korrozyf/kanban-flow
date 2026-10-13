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
      "Trend compares the displayed reference week with the previous week. " +
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

  // The analysis start date is shared by Build and Run, but exposed next to
  // each mode's period control so it is available where it is used.
  function syncStartDateInputs(value) {
    const date = value || "";
    ["buildStartDate", "runStartDate"].forEach((id) => {
      const input = $(id);
      if (input) input.value = date;
    });
  }

  function setupPeriodControls(mode, r) {
    const prefix = mode === "run" ? "run" : "build";
    const active = periodModeFor(mode);
    syncStartDateInputs(cfg.startDate);
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
      notes.push("Since start date needs a start date; the five latest weeks are shown instead.");
    }
    if (r.truncated && r.weeks.length) {
      notes.push(
        `Since start date is limited to the first 52 weeks (${r.weeks[0].label} → ` +
        `${r.weeks[r.weeks.length - 1].label}); later weeks are not loaded.`
      );
    }
    if (index === 0) notes.push("No previous loaded week is available for trend comparison.");
    if (mode === "build" && r.committedHistoryIncompleteCount) {
      notes.push(`${r.committedHistoryIncompleteCount} committed-throughput candidate(s) were excluded because JIRA history was incomplete.`);
    }
    if (mode === "build" && r.committedMissingCreationDateCount) {
      notes.push(`${r.committedMissingCreationDateCount} committed-throughput candidate(s) were excluded because their creation date was unavailable.`);
    }
    const snapshot = mode === "run" ? (r.snapshots || [])[index] : null;
    if (mode === "run" && !r.weeks[index].current &&
        (r.historicalDataIncomplete || (snapshot && snapshot.statusUnavailableCount))) {
      notes.push("Some complete status histories could not be reconstructed; affected historical values are unavailable and excluded from reconstructed stocks.");
    }
    if (!r.weeks[index].current) {
      notes.push(`The key figures and ticket lists describe the historical week ${r.weeks[index].label}.`);
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
      el.title = cur ? "Current week (in progress)" : `Selected historical week ${label}`;
    });
    document.querySelectorAll(".week-context").forEach((el) => {
      el.innerHTML = cur
        ? 'the <strong>current week</strong> ("current" badge)'
        : `the <strong>selected week ${label}</strong>`;
    });
    document.querySelectorAll(".week-context-short").forEach((el) => {
      el.textContent = cur ? "the current week" : `the selected week ${label}`;
    });
    document.querySelectorAll(".week-context-plain").forEach((el) => {
      el.textContent = cur ? "current week" : `selected week ${label}`;
    });
    document.querySelectorAll(".week-context-cap").forEach((el) => {
      el.textContent = cur ? "Current week" : `Selected week ${label}`;
    });
    document.querySelectorAll(".legend-current").forEach((el) => {
      el.classList.toggle("hidden", chartCurrentIndex(r) < 0);
    });
    return { isCurrent: cur, label };
  }

  function chartCurrentIndex(r) {
    return r.weeks.findIndex((period) => period.current);
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
      const type = box.dataset.chartType || "weekly";
      const statusTime = type === "status-time";
      const monthly = type === "monthly";
      const scrollable = statusTime || monthly || (r.periodMode === "complete" && (type === "weekly" || type === "week"));
      box.classList.toggle("chart-scroll", scrollable);
      box.tabIndex = scrollable ? 0 : -1;
      if (scrollable) {
        box.setAttribute("aria-label", statusTime
          ? "Scrollable average time by status comparison chart. Use the horizontal scrollbar to view all statuses."
          : monthly
            ? "Scrollable monthly Run flow comparison chart. Use the horizontal scrollbar to view all months."
            : `Scrollable ${r.weeks.length}-week chart`);
      } else {
        box.removeAttribute("aria-label");
      }
    });
  }

  function showView(mode) {
    $("buildView").classList.toggle("hidden", mode === "run");
    $("runView").classList.toggle("hidden", mode !== "run");
  }

  function fmtStatusDays(hours) {
    return `${(hours / 24).toFixed(hours / 24 < 10 ? 1 : 0)} d`;
  }

  // The observed-period average remains independent of Week's KPIs. Each
  // status also carries a local weekly aggregate so the selected week can be
  // compared without another JIRA request.
  function renderStatusTimeCharts(mode, statusDuration, index, week) {
    const prefix = mode === "run" ? "run" : "build";
    const panel = $(`${prefix}StatusTimePanel`);
    const message = $(`${prefix}StatusTimeMessage`);
    const content = panel.querySelector(".status-time-content");
    const average = $(`${prefix}StatusTimeAverageChart`);
    average.innerHTML = "";
    panel.classList.remove("hidden");
    if (!statusDuration || !statusDuration.enabled) {
      message.textContent = statusDuration && statusDuration.reason
        ? statusDuration.reason
        : "Configure the ordered Kanban flow statuses for this team.";
      content.classList.add("hidden");
      return;
    }
    const statuses = statusDuration.statuses || [];
    if (!statuses.length || statusDuration.hasObservedIntervals === false) {
      message.textContent = "No time was observed in the configured flow statuses during this analysis period.";
      content.classList.add("hidden");
      return;
    }
    const notices = [];
    if (statusDuration.invalidDoneStatuses && statusDuration.invalidDoneStatuses.length) {
      notices.push(`Closing status(es) omitted from the flow: ${statusDuration.invalidDoneStatuses.join(", ")}.`);
    }
    if (statusDuration.incompleteIssueCount) {
      notices.push(`${statusDuration.incompleteIssueCount} ticket(s) with incomplete changelogs were excluded.`);
    }
    if (statusDuration.partialIssueCount) {
      notices.push(`${statusDuration.partialIssueCount} ticket(s) have an unknown initial status; only known intervals were counted.`);
    }
    message.textContent = notices.join(" ");
    content.classList.remove("hidden");
    const selected = statuses.map((status) => (status.weekly || [])[index] || {});
    const observedValues = statuses.map((status) => status.averageHours == null ? null : status.averageHours / 24);
    const selectedValues = selected.map((entry) => entry.averageHours == null ? null : entry.averageHours / 24);
    // The threshold applies independently to both displayed averages. This
    // keeps the visual marker tied to the exact bar that needs attention.
    const observedAlerts = observedValues.map((value) => value != null && value > 2);
    const selectedAlerts = selectedValues.map((value) => value != null && value > 2);
    const labels = statuses.map((status, i) =>
      `${status.name}${status.isBoardEntry ? " (Board)" : ""}${observedAlerts[i] || selectedAlerts[i] ? " ⚠" : ""}`
    );
    const description = statuses.map((status, i) => {
      const current = selected[i];
      const board = status.isBoardEntry ? " Board-entry status." : "";
      const observedAlert = observedAlerts[i] ? " Alert: observed-period average is above 2 days." : "";
      const selectedAlert = selectedAlerts[i] ? ` Alert: ${week.label} average is above 2 days.` : "";
      return `${status.name}: observed period ${status.averageHours == null ? "not available" : fmtStatusDays(status.averageHours)}; ` +
        `${week.label} ${current.averageHours == null ? "not available" : fmtStatusDays(current.averageHours)}.${board}${observedAlert}${selectedAlert}`;
    }).join(" ");
    JKDCharts.groupedBarChart(average, {
      title: "Average time by status: observed period and selected week",
      description,
      unit: "days",
      labels,
      series: [
        {
          label: "Observed analysis period",
          values: observedValues,
          valueTexts: observedValues.map((value) => value == null ? "–" : `${value.toFixed(value < 10 ? 1 : 0)} d`),
          className: "status-time-observed",
          alertValues: observedAlerts,
        },
        {
          label: `Selected week (${week.label})`,
          values: selectedValues,
          valueTexts: selectedValues.map((value) => value == null ? "–" : `${value.toFixed(value < 10 ? 1 : 0)} d`),
          className: "status-time-selected",
          alertValues: selectedAlerts,
        },
      ],
      categoryClassNames: statuses.map((status) =>
        status.isBoardEntry ? "status-time-board-category" : ""
      ),
      minBandWidth: 132,
    });
  }

  function durationScopeLabel(scope) {
    const types = scope && scope.issueTypes && scope.issueTypes.length ? scope.issueTypes.join(", ") : "all issue types";
    if (scope && scope.startStatus) {
      const fallback = scope.fallbackEnabled ? "; fallback to common non-Done time" : "";
      return `${types} • from “${scope.startStatus}” to Done${fallback}`;
    }
    const statuses = scope && scope.statuses && scope.statuses.length ? scope.statuses.join(", ") : "creation to Done (legacy)";
    return `${types} • ${statuses}`;
  }

  function durationDetail(value, included, available, excludedLabel, reason, fallbackUsed) {
    if (!included) return { text: "–", info: null, title: excludedLabel };
    if (!available || value == null) {
      const title = reason === "start-not-reached"
        ? "Excluded: the configured start status was never reached before closing."
        : reason === "fallback-unavailable"
          ? "Unavailable: the start status was not reached and the common non-Done status history could not be reconstructed."
          : reason === "history-incomplete"
            ? "Unavailable: the required JIRA status history is incomplete."
            : "Unavailable: the required JIRA status history could not be reconstructed.";
      return { text: "–", info: null, title };
    }
    return {
      text: fmtDays(value),
      info: cycleInfo(value),
      title: fallbackUsed
        ? "Lead Time fallback: the start status was not reached; common non-Done status time was counted from creation."
        : "",
    };
  }

  function renderLeadOverview(r) {
    const overview = r.leadOverview || {};
    const scope = durationScopeLabel(r.durationFilters && r.durationFilters.lead);
    const note = $("leadFilterNote");
    $("leadAggLabel").textContent = "(observed period · days)";
    $("leadValue").textContent = fmtDays(overview.averageClosedDays);
    const epicScopeNote = `Query scope: selected project + Epic type; project Additional JQL and Issue types counted are not applied. Lead Time filters: ${scope}.`;
    note.textContent = overview.closedQueryAvailable === false
      ? `Epic closure query unavailable · ${epicScopeNote}`
      : overview.closedIssueCount
        ? `${overview.closedAvailableCount}/${overview.closedIssueCount} matching Epic closures included · ${epicScopeNote}`
        : `No matching Epic closure in the observed period · ${epicScopeNote}`;

    const latestValue = $("leadLatestValue");
    const latestNote = $("leadLatestNote");
    const latest = overview.latestClosed;
    latestValue.textContent = latest && latest.leadAvailable ? fmtDays(latest.leadDays) : "–";
    latestNote.replaceChildren();
    if (!latest) {
      latestNote.textContent = overview.closedQueryAvailable === false
        ? "Epic closure data could not be loaded from JIRA; refresh or check the connection."
        : "No matching Epic closed during the observed period.";
    } else {
      const link = document.createElement("a");
      link.href = latest.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = latest.key;
      latestNote.append(link, ` — closed ${fmtDate(latest.doneDate)}`);
      if (latest.summary) latestNote.append(` · ${latest.summary}`);
      if (!latest.leadAvailable) {
        const reason = latest.leadExclusionReason === "history-incomplete"
          ? "Lead Time unavailable: the JIRA status history is incomplete."
          : latest.leadExclusionReason === "fallback-unavailable"
            ? "Lead Time unavailable: the required common-status history could not be reconstructed."
            : latest.leadExclusionReason === "start-not-reached"
              ? "Lead Time unavailable: the configured start status was not reached and fallback is disabled."
              : "Lead Time unavailable for this ticket.";
        latestNote.append(` · ${reason}`);
      } else if (latest.leadFallbackUsed) {
        latestNote.append(" · calculated with the common non-Done status fallback");
      }
    }

    const growingValue = $("leadGrowingValue");
    const growingNote = $("leadGrowingNote");
    growingValue.textContent = fmtDays(overview.growingAverageDays);
    if (overview.openQueryAvailable === false) {
      growingNote.textContent = "Current open-Epic data could not be loaded from JIRA; refresh or check the connection.";
    } else if (!overview.openIssueCount) {
      growingNote.textContent = "No matching Epic is currently outside a Done status.";
    } else if (!overview.openAvailableCount) {
      growingNote.textContent =
        `No usable Lead Time history for ${overview.openIssueCount} matching open Epic(s); ` +
        "incomplete history or an unreached start without an available fallback.";
    } else {
      growingNote.textContent =
        `Mean of ${overview.openAvailableCount} of ${overview.openIssueCount} matching open Epic(s), ` +
        `as of ${new Date(overview.asOf).toLocaleString("en-GB")}` +
        (overview.openFallbackCount ? ` · fallback used for ${overview.openFallbackCount}` : "") + ".";
    }
  }

  function renderResult(project, r, index) {
    hideStatus();
    $("dashboard").classList.remove("hidden");
    showView("build");

    const last = (arr) => arr[arr.length - 1];
    const aggLabel = r.aggregate === "average" ? "(average)" : "(median)";
    const values = r;

    renderComparisonNote(r, index, "build");
    const ctx = applyWeekContext(r, index);
    setChartScrolling(r);

    // Cards
    const curLabel = r.weeks[index].label;
    const weekPhrase = ctx.isCurrent
      ? `current week ${curLabel} (incomplete)`
      : `week ${curLabel}`;
    $("thrValue").textContent = values.throughput[index];
    $("thrNote").textContent = `completed tickets — ${weekPhrase}`;
    $("engageValue").textContent = r.hasEngage ? values.throughputEngage[index] : "–";
    $("engageNote").textContent = r.hasEngage
      ? `Waiting / Work in progress only during ${r.engageLabel} — week ${curLabel}; Workflow end is excluded; carryovers can count again`
      : "Set the team's Waiting or Work in progress statuses (⚙ Settings).";
    // Story points (per-team option): card + chart + column hidden
    // until the option is enabled / the JIRA field is found.
    const spOn = !!r.hasStoryPoints;
    $("spCard").classList.toggle("hidden", !spOn);
    $("spChartPanel").classList.toggle("hidden", !spOn);
    document
      .querySelectorAll("#detailTable .sp-col")
      .forEach((th) => th.classList.toggle("hidden", !spOn));
    if (spOn) {
      $("spValue").textContent = fmtPoints(values.storyPointsWeekly[index]);
      $("spNote").textContent =
        `points delivered on ${values.storyPointsCounts[index]} estimated ticket(s) — ` +
        weekPhrase;
      trendBadge("spTrend", JKDMetrics.computeTrend(
        values.storyPointsWeekly, cfg.stableThresholdPct, true, index
      ));
    } else if (r.trackStoryPoints) {
      // Option enabled but field not found: flagged without blocking.
      $("spCard").classList.remove("hidden");
      $("spValue").textContent = "–";
      $("spNote").textContent =
        "Story points field not found on this JIRA site — specify it in ⚙ Settings.";
      trendBadge("spTrend", { direction: "na", pct: null, good: null });
    }

    renderLeadOverview(r);
    $("cycleValue").textContent = fmtDays(r.cycleWeekly[index]);
    $("cycleFilterNote").textContent = `days — ${durationScopeLabel(r.durationFilters && r.durationFilters.cycle)} — ${weekPhrase}`;
    $("cycleAggLabel").textContent = aggLabel;
    trendBadge("cycleTrend", JKDMetrics.computeTrend(r.cycleWeekly, cfg.stableThresholdPct, false, index));

    if ($("engageLegend")) {
      $("engageLegend").textContent = r.engageLabel
        ? `Committed (Waiting / WIP ${r.engageLabel})`
        : "Committed";
    }

    trendBadge("thrTrend", JKDMetrics.computeTrend(values.throughput, cfg.stableThresholdPct, true, index));
    trendBadge("engageTrend", r.hasEngage
      ? JKDMetrics.computeTrend(values.throughputEngage, cfg.stableThresholdPct, true, index)
      : { direction: "na", pct: null, good: null });

    const labels = r.weeks.map((w) => w.label);
    // Committed + delivered throughput on the same chart (grouped bars).
    const series = [];
    if (r.hasEngage) {
      series.push({
        label: "Committed throughput",
        values: values.throughputEngage,
        className: "bar-engage",
        currentClassName: "bar-engage-current",
      });
    }
    series.push({
      label: "Delivered throughput",
      values: values.throughput,
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
            values: values.storyPointsWeekly,
            className: "bar-done",
            currentClassName: "bar-done-current",
          },
        ],
        ...chartOptions(r, index),
      });
    }
    JKDCharts.lineChart($("cycleChart"), {
      title: `Cycle time per week (${durationScopeLabel(r.durationFilters && r.durationFilters.cycle)})`, seriesLabel: "Cycle time", unit: "days",
      labels, values: r.cycleWeekly, ...chartOptions(r, index),
    });
    renderStatusTimeCharts("build", r.statusDuration, index, r.weeks[index]);

    // Detail table — only tickets completed in the selected week.
    const tbody = $("detailTable").querySelector("tbody");
    tbody.innerHTML = "";
    const curDetails = r.details.filter((d) => d.weekIndex === index);
    curDetails.forEach((d) => {
      const tr = document.createElement("tr");
      const doneStr = d.doneDate.toLocaleDateString("en-GB");
      tr.innerHTML =
        `<td><a href="${escapeHtml(d.url)}" target="_blank" rel="noopener">${escapeHtml(d.key)}</a></td>` +
        `<td>${escapeHtml(d.summary || "")}</td>` +
        labelsCell(d.labels) +
        `<td>${d.week}</td>` +
        `<td>${doneStr}</td>` +
        (spOn ? `<td>${fmtPoints(d.storyPoints)}</td>` : "") +
        (function () {
          const lead = durationDetail(d.leadDays, d.leadIncluded, d.leadAvailable, "Issue type excluded by the Lead Time filter.", d.leadExclusionReason, d.leadFallbackUsed);
          const cycle = durationDetail(d.cycleDays, d.cycleIncluded, d.cycleAvailable, "Issue type excluded by the Cycle Time filter.", d.cycleExclusionReason);
          const leadCell = `<td${lead.title ? ` title="${escapeHtml(lead.title)}"` : ""}>${lead.text}</td>`;
          const cycleCell = cycle.info ? durationCell(cycle.text, cycle.info) : `<td${cycle.title ? ` title="${escapeHtml(cycle.title)}"` : ""}>${cycle.text}</td>`;
          return leadCell + cycleCell;
        })();
      tbody.appendChild(tr);
    });
    $("detailCount").textContent = curDetails.length;
    $("jqlText").textContent =
      `Weekly metrics: ${r.jql}\nEpic Lead Time (closed): ${r.leadEpicJql}\n` +
      `Epic Lead Time (open): ${r.leadEpicOpenJql}`;
    $("footerInfo").textContent =
      `${project.name} • ${r.totalIssues} tickets analysed • ` +
      `updated ${new Date().toLocaleString("en-GB")}`;
  }

  function fmtDate(d) {
    return d ? d.toLocaleDateString("en-GB") : "–";
  }
  // Labels are rendered as individually escaped chips. An empty label set is
  // explicit rather than leaving an ambiguous blank cell.
  function labelsCell(labels) {
    const labelValues = Array.isArray(labels) ? labels.filter(Boolean) : [];
    if (!labelValues.length) return '<td class="ticket-labels">–</td>';
    return '<td class="ticket-labels">' + labelValues.map((label) =>
      `<span class="ticket-label">${escapeHtml(label)}</span>`
    ).join("") + '</td>';
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
    const openWhen = ctx.isCurrent ? "as of now" : `at the end of the week ${curLabel}`;
    $("runOpenNote").textContent =
      r.openAtPrevWeekEnd == null
        ? `open ${openWhen} — no previous week to compare`
        : `open ${openWhen} — vs ${r.openAtPrevWeekEnd} open at the previous week cut-off`;
    $("runCloseValue").textContent = r.closedThisWeek;
    $("runCloseNote").textContent =
      r.closedPrevSameElapsed == null
        ? `closed in the week ${curLabel} — no previous week to compare`
        : ctx.isCurrent
          ? `closed in the week ${curLabel} — vs ${r.closedPrevSameElapsed} over the same period ` +
            `of the previous week (${r.elapsedHours} h elapsed)` +
            (r.closedPrevWeek == null ? "" : ` — ${r.closedPrevWeek} over the entire previous week`)
          : `closed in the week ${curLabel} — vs ${r.closedPrevSameElapsed} in the previous week`;
    $("runCreatedValue").textContent = r.createdThisWeek;
    $("runCreatedNote").textContent =
      r.createdPrevSameElapsed == null
        ? `created in the week ${curLabel} — no previous week to compare`
        : ctx.isCurrent
          ? `created in the week ${curLabel} — vs ${r.createdPrevSameElapsed} over the same period ` +
            `of the previous week (${r.elapsedHours} h elapsed)` +
            (r.createdPrevWeek == null ? "" : ` — ${r.createdPrevWeek} over the entire previous week`)
          : `created in the week ${curLabel} — vs ${r.createdPrevSameElapsed} in the previous week`;

    // Average resolution time of tickets closed in this week. Same colour
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
        ? `no ticket closed in the week ${curLabel}`
        : `average created → closed over ${r.avgResolutionCount} closed ticket(s) ` +
          `in the week ${curLabel}` +
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

    const labels = base.weeks.map((w) => w.label);
    const flowOpened = base.snapshots.map((snapshot) => snapshot.createdThisWeek);
    const flowClosed = base.snapshots.map((snapshot) => snapshot.closedThisWeek);
    // Opened (created) and closed by week.
    JKDCharts.groupedBarChart($("runFlowChart"), {
      title: "Tickets opened and closed per week",
      labels,
      series: [
        { label: "Opened", values: flowOpened, className: "bar-open", currentClassName: "bar-open-current" },
        { label: "Closed", values: flowClosed, className: "bar-closed", currentClassName: "bar-closed-current" },
      ],
      ...chartOptions(base, index),
    });

    const monthly = base.monthlyFlow;
    if (monthly && monthly.months && monthly.months.length) {
      const months = monthly.months;
      const monthLabels = months.map((month) => month.label);
      const currentYearHeading = $("runMonthlyCurrentYear");
      const previousYearHeading = $("runMonthlyPreviousYear");
      if (currentYearHeading) currentYearHeading.textContent = String(monthly.year);
      if (previousYearHeading) previousYearHeading.textContent = String(monthly.previousYear);
      const openedCurrent = months.map((month) => month.created);
      const closedCurrent = months.map((month) => month.closed);
      const openedPrevious = months.map((month) => month.previousCreated);
      const closedPrevious = months.map((month) => month.previousClosed);
      const monthlyDescription = months.map((month) =>
        `${month.label}: ${monthly.year} created ${month.created}, closed ${month.closed}; ` +
        `${monthly.previousYear} created ${month.previousCreated}, closed ${month.previousClosed}` +
        (month.isCurrent ? " (month to date and equivalent elapsed period)" : "") + "."
      ).join(" ");
      JKDCharts.groupedBarChart($("runMonthlyChart"), {
        title: `Tickets created and closed by month: ${monthly.year} vs ${monthly.previousYear}`,
        description: monthlyDescription,
        labels: monthLabels,
        series: [
          { label: `Opened / created ${monthly.year}`, values: openedCurrent, className: "bar-month-created-current" },
          { label: `Closed ${monthly.year}`, values: closedCurrent, className: "bar-month-closed-current" },
          { label: `Opened / created ${monthly.previousYear}`, values: openedPrevious, className: "bar-month-created-previous" },
          { label: `Closed ${monthly.previousYear}`, values: closedPrevious, className: "bar-month-closed-previous" },
        ],
        currentIndex: -1,
        minBandWidth: 70,
        showValues: false,
      });
      const currentMonth = months[months.length - 1];
      const currentCutoff = monthly.currentCutoff instanceof Date
        ? monthly.currentCutoff : new Date(monthly.currentCutoff);
      const previousCutoff = monthly.previousMonthCutoff instanceof Date
        ? monthly.previousMonthCutoff : new Date(monthly.previousMonthCutoff);
      $("runMonthlyNote").textContent =
        `Opened means tickets created; closed uses the latest Workflow end transition, then resolution date, ` +
        `then now for a currently closed ticket with no reconstructable date. ` +
        `Completed months compare full calendar months. ${currentMonth.label} ${monthly.year} ` +
        `is counted through ${currentCutoff.toLocaleString("en-GB")} and compared with ` +
        `${currentMonth.label} ${monthly.previousYear} through ` +
        `${previousCutoff.toLocaleString("en-GB")} (same elapsed duration, capped at month end). ` +
        `The JIRA project, Run labels, Issue types counted and Additional JQL filters apply.` +
        (monthly.incompleteHistoryCount
          ? ` ${monthly.incompleteHistoryCount} monthly candidate(s) had incomplete changelogs; closing-date counts may be affected.`
          : "");
      const table = $("runMonthlyTable");
      const headers = ["Month", `Opened / created ${monthly.year}`, `Closed ${monthly.year}`, `Opened / created ${monthly.previousYear}`, `Closed ${monthly.previousYear}`];
      const headerRow = document.createElement("tr");
      headers.forEach((label) => {
        const th = document.createElement("th");
        th.textContent = label;
        headerRow.appendChild(th);
      });
      table.querySelector("thead").replaceChildren(headerRow);
      const tableBody = table.querySelector("tbody");
      tableBody.replaceChildren();
      months.forEach((month) => {
        const row = document.createElement("tr");
        [month.label, month.created, month.closed, month.previousCreated, month.previousClosed]
          .forEach((value) => {
            const cell = document.createElement("td");
            cell.textContent = String(value);
            row.appendChild(cell);
          });
        tableBody.appendChild(row);
      });
      const monthlyDetails = $("runMonthlyPanel").querySelector(".monthly-data-details");
      if (monthlyDetails) monthlyDetails.hidden = false;
    } else {
      const chart = $("runMonthlyChart");
      chart.replaceChildren();
      chart.textContent = "Monthly comparison unavailable.";
      const note = $("runMonthlyNote");
      note.textContent = base.monthlyError
        ? `The monthly query failed (${base.monthlyError}). Weekly Run metrics remain available. Check the JIRA connection and query scope, then retry.`
        : "Monthly comparison is unavailable.";
      const table = $("runMonthlyTable");
      table.querySelector("thead").replaceChildren();
      table.querySelector("tbody").replaceChildren();
      const monthlyDetails = $("runMonthlyPanel").querySelector(".monthly-data-details");
      if (monthlyDetails) monthlyDetails.hidden = true;
      const currentYearHeading = $("runMonthlyCurrentYear");
      const previousYearHeading = $("runMonthlyPreviousYear");
      if (currentYearHeading) currentYearHeading.textContent = "Unavailable";
      if (previousYearHeading) previousYearHeading.textContent = "Unavailable";
    }

    // Creation trend by day across the selected week.
    const currentDays = r.createdPerDayCurrent || [];
    const previousDays = r.createdPerDayPrev || [];
    const dailyLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].slice(0, currentDays.length);
    const dailySeries = [];
    if (r.createdPerDayPrev) {
      dailySeries.push({ label: "Previous week", values: previousDays, className: "bar-open" });
    }
    dailySeries.push({
      label: ctx.isCurrent ? "Current week" : curLabel,
      values: currentDays,
      className: ctx.isCurrent ? "bar-done-current" : "bar-done",
    });
    JKDCharts.groupedBarChart($("runDailyChart"), {
      title: "Tickets created per calendar day",
      labels: dailyLabels,
      series: dailySeries,
      currentIndex: -1,
      minBandWidth: 38,
    });
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    const dailyWhen = ctx.isCurrent ? "in the current week so far" : `in week ${curLabel}`;
    $("runDailyNote").textContent = r.createdPerDayPrev
      ? `${sum(currentDays)} ticket(s) created ${dailyWhen} vs ${sum(previousDays)} in the previous week.`
      : `${sum(currentDays)} ticket(s) created ${dailyWhen} — no previous week to compare.`;
    renderStatusTimeCharts("run", base.statusDuration, index, base.weeks[index]);

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
      labelsCell(t.labels) +
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
        labelsCell(t.labels) +
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
        labelsCell(t.labels) +
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
        labelsCell(t.labels) +
        `<td>${escapeHtml(historicalValue(t.priority, t.priorityAvailable, "–"))}</td>` +
        `<td>${fmtDate(t.created)}</td>` +
        ageCell(t.hoursToFirstComment) +
        (t.hoursToResolution != null ? ageCell(t.hoursToResolution) : `<td>not resolved at cut-off</td>`);
      mpBody.appendChild(tr);
    });
    $("runMaxPrioCount").textContent = r.maxPriorityList.length;

    $("runJqlText").textContent = `Weekly metrics: ${r.jql}\nMonthly opened/closed: ${r.monthlyJql}`;
    $("footerInfo").textContent =
      `${project.name} • run • ${r.totalIssues} tickets analysed • ` +
      `updated ${new Date().toLocaleString("en-GB")}`;
  }

  function renderSignals(r, index) {
    const values = r;
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
      if (w.current) tr.classList.add("row-current");
      if (i === index) tr.classList.add("row-selected");
      const wl = w.current ? `${w.label} (current)` : w.label;
      tr.innerHTML =
        `<td>${wl}</td>` + cell(values.readyAdded[i]) + cell(values.backlogReturned[i]);
      tbody.appendChild(tr);
    });
    // Summary of the selected week (answers to "was there any, how many").
    const ci = index;
    const when = r.weeks[ci].current ? "this week" : `in the selected week ${r.weeks[ci].label}`;
    const added = values.readyAdded[ci];
    const back = values.backlogReturned[ci];
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
    ["exportBtn", "markdownDownloadBtn", "markdownCopyBtn"].forEach((id) => {
      const btn = $(id);
      if (btn) btn.disabled = !on;
    });
  }

  function markdownExport() {
    if (!loadedResult || !loadedProject || selectedWeekIndex < 0 ||
        typeof JKDMarkdown === "undefined") return null;
    return JKDMarkdown.build({
      project: loadedProject,
      mode: loadedMode,
      result: loadedResult,
      selectedWeekIndex: selectedWeekIndex,
      stableThresholdPct: cfg.stableThresholdPct,
      detailLevel: $("markdownLevel").value === "analysis" ? "analysis" : "summary",
    });
  }

  function downloadMarkdown() {
    const data = markdownExport();
    if (!data) return;
    try {
      JKDMarkdown.download(data.markdown, data.fileName);
      const detailed = $("markdownLevel").value === "analysis";
      setStatus(`Markdown saved: ${data.fileName} (${detailed ? "ticket lists included" : "summary only"}).`);
      setTimeout(hideStatus, 6000);
    } catch (e) {
      console.error(e);
      setStatus(`Markdown export failed: ${e.message}`, "error");
    }
  }

  async function copyMarkdown() {
    const btn = $("markdownCopyBtn");
    const data = markdownExport();
    if (!data) return;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "… Copying";
    try {
      await JKDMarkdown.copy(data.markdown);
      btn.textContent = "✓ Copied";
      setStatus("Markdown copied to the clipboard. Paste it into your AI agent or editor.");
      setTimeout(() => { btn.textContent = label; }, 3000);
      setTimeout(hideStatus, 6000);
    } catch (e) {
      console.error(e);
      setStatus(`Markdown could not be copied: ${e.message}`, "error");
      btn.textContent = label;
    } finally {
      btn.disabled = false;
    }
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
        includeDetails,
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
    const startInput = $(`${prefix}StartDate`);
    const key = mode === "run" ? "runPeriodMode" : "buildPeriodMode";
    cfg[key] = selected && selected.value === "complete" ? "complete" : "recent";
    cfg.startDate = startInput ? startInput.value || "" : "";
    syncStartDateInputs(cfg.startDate);
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
            "choose a date equal to or earlier than the current week in Analysis period.",
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
    syncStartDateInputs(cfg.startDate);
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
      $(`${prefix}StartDate`).addEventListener("input", (event) => {
        // Keep the duplicate control in the other mode visually in sync. The
        // value is saved only when Apply is pressed.
        syncStartDateInputs(event.target.value);
      });
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
    $("markdownDownloadBtn").addEventListener("click", downloadMarkdown);
    $("markdownCopyBtn").addEventListener("click", copyMarkdown);
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
