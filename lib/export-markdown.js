/* Kanban Flow — local Markdown data export
 * Builds a mode-specific, analysis-ready document without sending JIRA data
 * anywhere. Ticket descriptions and raw JIRA objects are deliberately excluded.
 */
(function (global) {
  "use strict";

  function text(value) {
    return String(value == null ? "" : value)
      .replace(/\|/g, "\\|")
      .replace(/[\r\n]+/g, " ")
      .replace(/`/g, "\\`");
  }
  function date(value) {
    return value ? new Date(value).toLocaleDateString("en-GB") : "Unavailable";
  }
  function stamp(value) {
    const d = value || new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}h${p(d.getMinutes())}`;
  }
  function slug(value) {
    return String(value || "dashboard").toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "").slice(0, 60) || "dashboard";
  }
  function days(value) { return value == null || isNaN(value) ? "Unavailable" : `${Number(value).toFixed(1)} d`; }
  function points(value) {
    return value == null || isNaN(value) ? "Unavailable" :
      (Number.isInteger(Number(value)) ? String(value) : Number(value).toFixed(1));
  }
  function duration(hours) {
    if (hours == null || isNaN(hours)) return "Unavailable";
    return hours < 24 ? `${Number(hours).toFixed(1)} h` : `${(Number(hours) / 24).toFixed(1)} d`;
  }
  function count(value) { return value == null ? "Unavailable" : String(value); }
  function labels(values) {
    return Array.isArray(values) && values.filter(Boolean).length
      ? values.filter(Boolean).map((v) => String(v).replace(/[\r\n]+/g, " ")).join(", ") : "–";
  }
  function table(headers, rows) {
    if (!rows.length) return "No tickets in this list.\n";
    return `| ${headers.map(text).join(" | ")} |\n| ${headers.map(() => "---").join(" | ")} |\n` +
      rows.map((row) => `| ${row.map(text).join(" | ")} |`).join("\n") + "\n";
  }
  function trendLabel(trend) {
    if (!trend || trend.direction === "na") return "Unavailable";
    if (trend.direction === "stable") return "Stable";
    const pct = trend.pct == null ? "" : ` (${trend.pct > 0 ? "+" : ""}${trend.pct.toFixed(0)}%)`;
    return `${trend.direction === "up" ? "Up" : "Down"}${pct}`;
  }
  function selectedMeta(project, mode, result, index, generatedAt) {
    const periods = result.weeks && result.weeks.length ? result.weeks : result.weeks;
    const selected = periods[index];
    const first = periods[0];
    const last = periods[periods.length - 1];
    const lines = [
      "# Kanban Flow data export", "",
      `- **Team:** ${text(project.name)} (${text(project.key)})`,
      `- **Mode:** ${mode === "run" ? "Run" : "Build"}`,
      `- **Analysis period:** ${result.periodMode === "complete" ? "Since start date" : "Last weeks"}`,
      `- **Loaded range:** ${first.label} to ${last.label}`,
      `- **Week KPIs:** ${selected.label}${selected.current ? " (current week, in progress)" : ""}`,
      `- **Generated at:** ${new Date(generatedAt).toLocaleString("en-GB")}`,
    ];
    const warnings = [];
    if (result.missingStartDate) warnings.push("Since start date was requested without a valid start date; Last weeks is shown instead.");
    if (result.truncated) warnings.push(`Since start date is limited to the first 52 weeks (${first.label} to ${last.label}); later weeks are not loaded.`);
    if (mode === "run" && result.historicalDataIncomplete) warnings.push("Some JIRA changelogs were incomplete; historical values that could not be reconstructed reliably are marked Unavailable.");
    if (mode === "build" && result.committedHistoryIncompleteCount) warnings.push(`${result.committedHistoryIncompleteCount} committed-throughput candidate(s) were excluded because JIRA history was incomplete.`);
    if (mode === "build" && result.committedMissingCreationDateCount) warnings.push(`${result.committedMissingCreationDateCount} committed-throughput candidate(s) were excluded because their creation date was unavailable.`);
    if (warnings.length) lines.push("", "## Export warnings", "", ...warnings.map((w) => `- ${w}`));
    return lines;
  }
  function filterScope(scope) {
    const types = scope && scope.issueTypes && scope.issueTypes.length ? scope.issueTypes.join(", ") : "all issue types";
    if (scope && scope.startStatus) {
      const fallback = scope.fallbackEnabled ? "; fallback to common non-Done status time" : "";
      return `${types}; from “${scope.startStatus}” to Done${fallback}`;
    }
    const statuses = scope && scope.statuses && scope.statuses.length ? scope.statuses.join(", ") : "creation to Done (legacy)";
    return `${types}; ${statuses}`;
  }
  function filteredDays(value, included, available, reason, fallbackUsed) {
    if (!included) return "Excluded by issue type filter";
    if (reason === "start-not-reached") return "Excluded (start status not reached)";
    if (reason === "fallback-unavailable") return "Unavailable (Lead fallback history)";
    if (reason === "history-incomplete") return "Unavailable (incomplete status history)";
    if (!available || value == null) return "Unavailable (status history)";
    return `${days(value)}${fallbackUsed ? " (Lead fallback: common non-Done statuses from creation)" : ""}`;
  }

  function appendStatusTime(lines, statusDuration, selectedWeekIndex, selectedWeekLabel) {
    lines.push("## Time spent by status", "");
    if (!statusDuration || !statusDuration.enabled) {
      lines.push(statusDuration && statusDuration.reason ? statusDuration.reason : "Not configured.");
      return;
    }
    const statuses = statusDuration.statuses || [];
    if (!statuses.length || statusDuration.hasObservedIntervals === false) {
      lines.push("No time was observed in the configured flow statuses during this analysis period.");
      return;
    }
    const selectedLabel = selectedWeekLabel || "selected week";
    lines.push(table(["Status", "Observed-period average per ticket", `Average in ${selectedLabel}`, "Observed tickets", `Tickets in ${selectedLabel}`, "Board entry", "Observed average > 2 days alert", `Average in ${selectedLabel} > 2 days alert`], statuses.map((status) => {
      const selected = (status.weekly || [])[selectedWeekIndex] || {};
      const selectedAlert = selected.averageHours != null && selected.averageHours > 48;
      return [
        status.name, duration(status.averageHours), duration(selected.averageHours), count(status.ticketCount), count(selected.ticketCount),
        status.isBoardEntry ? "Yes" : "No", status.exceedsAverageThreshold ? "Yes" : "No", selectedAlert ? "Yes" : "No",
      ];
    })));
    if (statusDuration.incompleteIssueCount) lines.push(`- ${statusDuration.incompleteIssueCount} ticket(s) with incomplete changelogs were excluded.`);
    if (statusDuration.partialIssueCount) lines.push(`- ${statusDuration.partialIssueCount} ticket(s) have an unknown initial status; only known intervals were counted.`);
  }

  function buildExport(project, result, index, threshold, detailLevel, generatedAt) {
    const lines = selectedMeta(project, "build", result, index, generatedAt);
    const periods = result.weeks;
    const values = result;
    const trend = (series, good) => global.JKDMetrics.computeTrend(series, threshold, good, index);
    lines.push("", "## Week's KPIs", "");
    const kpis = [
      ["Delivered throughput", count(values.throughput[index]), trendLabel(trend(values.throughput, true))],
      ["Committed throughput", result.hasEngage ? count(values.throughputEngage[index]) : "Unavailable", result.hasEngage ? trendLabel(trend(values.throughputEngage, true)) : "Unavailable"],
    ];
    if (result.trackStoryPoints) kpis.splice(2, 0, ["Delivered story points", result.hasStoryPoints ? points(values.storyPointsWeekly[index]) : "Unavailable", result.hasStoryPoints ? trendLabel(trend(values.storyPointsWeekly, true)) : "Unavailable"]);
    const leadOverview = result.leadOverview || {};
    kpis.push(["Cycle time", days(values.cycleWeekly[index]), trendLabel(trend(values.cycleWeekly, false))]);
    if (result.hasChurn) {
      kpis.push([`Added to board (${result.churnLabel})`, count(values.readyAdded[index]), "Not a trend metric"]);
      kpis.push([`Moved back to backlog (${result.churnLabel})`, count(values.backlogReturned[index]), "Not a trend metric"]);
    }
    lines.push(table(["KPI", "Value", "Trend / scope"], kpis));
    if (result.hasEngage) {
      const committedStatuses = Array.isArray(result.committedStatuses) && result.committedStatuses.length
        ? result.committedStatuses.join(", ")
        : "Waiting / Work in progress";
      lines.push(`Committed throughput counts only issues in Waiting or Work in progress (${text(committedStatuses)}) during the configured window; Workflow end is excluded. It is a weekly stock snapshot, so an issue still in an eligible status can be counted again in a later week.`);
    }
    lines.push(`- **Team Lead Time filter:** ${filterScope(result.durationFilters && result.durationFilters.lead)}.`);
    lines.push(`- **Team Cycle Time filter:** ${filterScope(result.durationFilters && result.durationFilters.cycle)}.`);
    lines.push("## Weekly series", "");
    const headers = ["Week", "Delivered throughput"];
    if (result.hasEngage) headers.splice(1, 0, "Committed throughput");
    if (result.trackStoryPoints) headers.push("Delivered story points", "Estimated tickets");
    headers.push("Cycle time");
    if (result.hasChurn) headers.push("Added to board", "Moved back to backlog");
    lines.push(table(headers, periods.map((period, i) => {
      const row = [`${period.label}${period.current ? " (current, incomplete)" : ""}`, count(values.throughput[i])];
      if (result.hasEngage) row.splice(1, 0, count(values.throughputEngage[i]));
      if (result.trackStoryPoints) row.push(result.hasStoryPoints ? points(values.storyPointsWeekly[i]) : "Unavailable", result.hasStoryPoints ? count(values.storyPointsCounts[i]) : "Unavailable");
      row.push(days(values.cycleWeekly[i]));
      if (result.hasChurn) row.push(count(values.readyAdded[i]), count(values.backlogReturned[i]));
      return row;
    })));
    const latestLead = leadOverview.latestClosed;
    const latestLeadValue = latestLead
      ? (latestLead.leadAvailable ? days(latestLead.leadDays) : "Unavailable")
      : leadOverview.closedQueryAvailable === false
        ? "Epic query unavailable"
        : "No matching Epic closure in the observed period";
    const latestCoverage = detailLevel === "analysis" && latestLead
      ? `Epic ${latestLead.key}, closed ${date(latestLead.doneDate)}` +
        (latestLead.leadFallbackUsed ? "; common non-Done fallback used" : "")
      : "Most recently closed matching Epic in the observed period";
    const growingCoverage = leadOverview.openQueryAvailable === false
      ? "Current open-Epic query unavailable"
      : leadOverview.openIssueCount
        ? `${count(leadOverview.openAvailableCount)} of ${count(leadOverview.openIssueCount)} matching open Epic(s); as of ${new Date(leadOverview.asOf || generatedAt).toLocaleString("en-GB")}`
        : "No matching open Epics outside Done";
    lines.push("## Epic Lead Time overview", "", table(["Measure", "Value", "Coverage"], [
      ["Latest Epic closure", latestLeadValue, latestCoverage],
      ["Average Epic Lead Time (observed period)", days(leadOverview.averageClosedDays), leadOverview.closedQueryAvailable === false ? "Epic closure query unavailable" : `${count(leadOverview.closedAvailableCount)} of ${count(leadOverview.closedIssueCount)} matching Epic closure(s)`],
      ["Growing Epic Lead Time (open Epics)", days(leadOverview.growingAverageDays), growingCoverage],
    ]));
    lines.push("Epic queries are limited to the selected JIRA project and issue type Epic; project-level Additional JQL and Issue types counted are intentionally not applied. The team-specific Lead Time issue-type selection and duration settings still apply.");
    if (leadOverview.openFallbackCount) lines.push(`- Lead fallback was used for ${leadOverview.openFallbackCount} open Epic(s).`);
    if (leadOverview.openUnavailableCount) lines.push(`- Growing Lead Time is unavailable for ${leadOverview.openUnavailableCount} matching open Epic(s) because their status history or start boundary could not be reconstructed.`);
    appendStatusTime(lines, result.statusDuration, index, result.weeks[index] && result.weeks[index].label);
    if (detailLevel === "analysis") {
      const tickets = result.details.filter((ticket) => ticket.weekIndex === index);
      lines.push("## Completed tickets in Week's KPIs", "");
      const h = ["Key", "Summary", "Labels", "Completed", "Lead time", "Cycle time"];
      if (result.trackStoryPoints) h.splice(4, 0, "Story points");
      lines.push(table(h, tickets.map((ticket) => {
        const row = [ticket.key, ticket.summary, labels(ticket.labels), date(ticket.doneDate), filteredDays(ticket.leadDays, ticket.leadIncluded, ticket.leadAvailable, ticket.leadExclusionReason, ticket.leadFallbackUsed), filteredDays(ticket.cycleDays, ticket.cycleIncluded, ticket.cycleAvailable, ticket.cycleExclusionReason)];
        if (result.trackStoryPoints) row.splice(4, 0, points(ticket.storyPoints));
        return row;
      })));
    }
    lines.push("## Interpretation notes", "", "- Ticket descriptions are never included in this export.");
    return lines.join("\n") + "\n";
  }
  function historical(value, available, empty) { return available === false ? "Unavailable" : (value || empty); }
  function runExport(project, base, index, detailLevel, generatedAt) {
    const periods = base.weeks;
    const r = Object.assign({}, base, base.snapshots[index]);
    const lines = selectedMeta(project, "run", base, index, generatedAt);
    const comparison = r.isCurrent ? "Trend vs equivalent elapsed period in previous week" : "Trend vs previous complete week";
    lines.push("", "## Week's KPIs", "", table(["KPI", "Value", comparison], [
      ["Open tickets at cut-off", count(r.openNow), trendLabel(r.trends.open)],
      ["Closed tickets", count(r.closedThisWeek), trendLabel(r.trends.close)],
      ["Created tickets", count(r.createdThisWeek), trendLabel(r.trends.created)],
      ["Average resolution time", duration(r.avgResolutionHours), trendLabel(r.trends.resolution)],
    ]));
    lines.push("- **Cut-off:** " + (r.isCurrent ? `now (${new Date(r.cutoff).toLocaleString("en-GB")})` : `end of ${periods[index].label}`));
    if (r.statusUnavailableCount) lines.push(`- **Unavailable historical statuses:** ${r.statusUnavailableCount} ticket(s), excluded from reconstructed open stock.`);
    lines.push("", "## Weekly flow series", "", table(["Week", "Created tickets", "Closed tickets"], periods.map((period, i) => [
      `${period.label}${period.current ? " (current, incomplete)" : ""}`, count(base.snapshots[i].createdThisWeek), count(base.snapshots[i].closedThisWeek)
    ])));
    const days = r.createdDayLabels || (r.createdPerDayCurrent || []).map((_, i) => `Day ${i + 1}`);
    lines.push("## Daily created tickets for Week's KPIs", "", table(["Day", "Selected week", "Previous week"], days.map((day, i) => [day, count((r.createdPerDayCurrent || [])[i]), r.createdPerDayPrev ? count(r.createdPerDayPrev[i]) : "Unavailable"])));
    const monthly = base.monthlyFlow;
    if (monthly && Array.isArray(monthly.months)) {
      const lastMonth = monthly.months[monthly.months.length - 1];
      lines.push(
        "## Monthly opened vs closed",
        "",
        `Opened means tickets created during the month. Closed uses the latest Workflow end transition, ` +
          `then resolution date, then now for a currently closed ticket with no reconstructable date. ` +
          `Completed months compare full calendar months; the current month compares elapsed time through ` +
          `${new Date(monthly.currentCutoff).toLocaleString("en-GB")} with the matching month last year ` +
          `through ${new Date(monthly.previousMonthCutoff).toLocaleString("en-GB")} (capped at that month's end).`,
        "",
        table(
          ["Month", `Opened / created ${monthly.year}`, `Closed ${monthly.year}`, `Opened / created ${monthly.previousYear}`, `Closed ${monthly.previousYear}`],
          monthly.months.map((month) => [month.label, count(month.created), count(month.closed), count(month.previousCreated), count(month.previousClosed)])
        )
      );
      if (lastMonth) lines.push(`The monthly comparison uses a separate bounded Run query with the same project, labels, Issue types counted and Additional JQL scope as the weekly data.`);
      if (monthly.incompleteHistoryCount) lines.push(`- ${monthly.incompleteHistoryCount} monthly candidate(s) had incomplete changelogs; closing-date counts may be affected.`);
    } else {
      lines.push(
        "## Monthly opened vs closed",
        "",
        `Unavailable: the monthly query could not be completed (${text(base.monthlyError || "no monthly data returned")}). Weekly Run metrics remain available.`
      );
    }
    appendStatusTime(lines, base.statusDuration, index, base.weeks[index] && base.weeks[index].label);
    if (detailLevel === "analysis") {
      const openRows = (tickets) => tickets.map((t) => [t.key, t.summary, labels(t.labels), historical(t.status, t.statusAvailable, "–"), historical(t.priority, t.priorityAvailable, "–"), historical(t.assignee, t.assigneeAvailable, "Unassigned"), date(t.created), duration(t.hoursSinceCreated), t.updatedAvailable === false ? "Unavailable" : duration(t.hoursSinceUpdated)]);
      lines.push("## Highest-priority tickets", "", table(["Key", "Summary", "Labels", "Priority", "Created", "To first comment", "To resolution"], r.maxPriorityList.map((t) => [t.key, t.summary, labels(t.labels), historical(t.priority, t.priorityAvailable, "–"), date(t.created), duration(t.hoursToFirstComment), t.hoursToResolution == null ? "Not resolved at cut-off" : duration(t.hoursToResolution)])));
      lines.push("## Unassigned open tickets", "", table(["Key", "Summary", "Labels", "Status", "Priority", "Created"], r.unassignedList.map((t) => [t.key, t.summary, labels(t.labels), historical(t.status, t.statusAvailable, "–"), historical(t.priority, t.priorityAvailable, "–"), date(t.created)])));
      const h = ["Key", "Summary", "Labels", "Status", "Priority", "Assignee", "Created", "Age since created", "Since last activity"];
      lines.push("## Open tickets on board at cut-off", "", table(h, openRows(r.openList)));
      lines.push("## Unplanned open tickets at cut-off", "", table(h, openRows(r.backlogList || [])));
      lines.push("## Tickets closed in Week's KPIs", "", table(["Key", "Summary", "Labels", "Status", "Priority", "Assignee", "Created", "Closed", "Time open"], r.closedList.map((t) => [t.key, t.summary, labels(t.labels), historical(t.status, t.statusAvailable, "–"), historical(t.priority, t.priorityAvailable, "–"), historical(t.assignee, t.assigneeAvailable, "Unassigned"), date(t.created), `${date(t.closedAt)}${t.closedAtApprox ? " (approximated)" : ""}`, duration(t.hoursOpenToClosed)])));
    }
    lines.push("## Interpretation notes", "", "- Open tickets are a stock at the selected cut-off, not a weekly flow.", "- Created and closed tickets are flows within the selected week.", "- Historical status, assignee and priority values are reconstructed from JIRA changelogs when available; Unavailable is never silently replaced with current data.", "- Ticket descriptions are never included in this export.");
    return lines.join("\n") + "\n";
  }
  function build(options) {
    const generatedAt = options.generatedAt || new Date();
    const markdown = options.mode === "run"
      ? runExport(options.project, options.result, options.selectedWeekIndex, options.detailLevel, generatedAt)
      : buildExport(options.project, options.result, options.selectedWeekIndex, options.stableThresholdPct, options.detailLevel, generatedAt);
    return { markdown, fileName: `kanban-flow_${slug(options.project.name)}_${options.mode}_${stamp(generatedAt)}.md` };
  }
  function download(markdown, fileName) {
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = fileName; link.style.display = "none";
    document.body.appendChild(link); link.click();
    setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 10000);
  }
  async function copy(markdown) {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") throw new Error("Clipboard access is unavailable. Download the Markdown file instead.");
    await navigator.clipboard.writeText(markdown);
  }
  global.JKDMarkdown = { build, download, copy };
})(typeof self !== "undefined" ? self : this);
