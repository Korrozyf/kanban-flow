"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

process.env.TZ = "UTC";
const context = vm.createContext({ console, Intl, Date, Map, Set, Math, Number, String, Array, Object });
context.self = context;
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "..", "lib", "metrics.js"), "utf8"),
  context,
  { filename: "lib/metrics.js" }
);
const metrics = context.JKDMetrics;
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "..", "lib", "export-markdown.js"), "utf8"),
  context,
  { filename: "lib/export-markdown.js" }
);

test("monthly flow counts half-open month buckets and compares month-to-date fairly", () => {
  const now = new Date(2026, 2, 15, 12, 0, 0, 0);
  const previousMarchCut = new Date(2025, 2, 15, 12, 0, 0, 0);
  const tickets = [
    { created: new Date(2026, 0, 1), closedAt: new Date(2026, 0, 31, 23, 59, 0) },
    { created: new Date(2026, 0, 31, 23, 59, 59, 999), closedAt: new Date(2026, 1, 1) },
    { created: new Date(2026, 1, 1), closedAt: new Date(2026, 1, 28, 23, 59, 59, 999) },
    { created: new Date(2026, 2, 1), closedAt: new Date(2026, 2, 15, 11, 59, 59, 999) },
    { created: new Date(2026, 2, 15, 12), closedAt: new Date(2026, 2, 15, 12) },
    { created: new Date(2025, 0, 1), closedAt: new Date(2025, 0, 31, 23, 59, 59, 999) },
    { created: new Date(2025, 1, 28, 23, 59, 59, 999), closedAt: new Date(2025, 2, 1) },
    { created: new Date(2025, 2, 1), closedAt: new Date(2025, 2, 1) },
    { created: new Date(previousMarchCut.getTime() - 1), closedAt: new Date(previousMarchCut.getTime() - 1) },
    { created: previousMarchCut, closedAt: previousMarchCut },
  ];

  const result = metrics.buildRunMonthlyFlow(tickets, now);
  assert.equal(result.year, 2026);
  assert.equal(result.previousYear, 2025);
  assert.equal(result.months.length, 3);
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.months.map((month) => [month.created, month.closed, month.previousCreated, month.previousClosed]))),
    [
      [2, 1, 1, 1],
      [1, 2, 1, 0],
      [1, 1, 2, 3],
    ]
  );
  assert.equal(result.months[2].previousCutoff.getTime(), previousMarchCut.getTime());
});

test("month-to-date comparison is capped at the end of a shorter prior-year month", () => {
  const now = new Date(2024, 1, 29, 12, 0, 0, 0);
  const previousMonthEnd = new Date(2023, 2, 1);
  const result = metrics.buildRunMonthlyFlow([
    { created: new Date(2024, 1, 29, 11, 59), closedAt: null },
    { created: now, closedAt: now },
    { created: new Date(2023, 1, 28, 23, 59), closedAt: new Date(2023, 1, 28, 23, 59) },
    { created: previousMonthEnd, closedAt: previousMonthEnd },
  ], now);
  const february = result.months[1];
  assert.equal(february.created, 1);
  assert.equal(february.previousCreated, 1);
  assert.equal(february.previousClosed, 1);
  assert.equal(february.previousCutoff.getTime(), previousMonthEnd.getTime());
});

test("monthly Run JQL uses month bounds and preserves all configured team filters", () => {
  const jql = metrics.buildRunMonthlyJql({
    key: "OPS",
    runLabels: ["support"],
    issueTypes: ["Bug"],
    doneStatuses: ["Done", "Cancelled"],
    extraJql: 'assignee = "account-id-123" ORDER BY priority DESC',
  }, new Date(2025, 0, 1), new Date(2026, 11, 1));

  assert.match(jql, /project = "OPS"/);
  assert.match(jql, /labels IN \("support"\)/);
  assert.match(jql, /created >= "2025-01-01" AND created < "2026-12-01"/);
  assert.match(jql, /resolutiondate >= "2025-01-01" AND resolutiondate < "2026-12-01"/);
  assert.match(jql, /status CHANGED TO \("Done", "Cancelled"\) AFTER "2024-12-31" BEFORE "2026-12-02"/);
  assert.match(jql, /resolution IS EMPTY AND status IN \("Done", "Cancelled"\)/);
  assert.match(jql, /issuetype IN \("Bug"\)/);
  assert.match(jql, /assignee = "account-id-123"/);
  assert.match(jql, /ORDER BY created ASC$/);
  assert.doesNotMatch(jql, /ORDER BY priority DESC/);
});

test("all JQL builders reject malformed project keys that could escape project scope", () => {
  const project = {
    key: 'OPS" OR project = "SECRET',
    runLabels: ["support"],
    issueTypes: ["Bug"],
    doneStatuses: ["Done"],
    readyStatuses: ["Ready"],
    waitingStatuses: ["Ready"],
    inProgressStatuses: [],
    backlogStatuses: ["Backlog"],
  };
  const start = new Date(2026, 0, 1);
  const end = new Date(2026, 1, 1);
  const builders = [
    () => metrics.buildJql(project, start, end),
    () => metrics.buildLeadEpicJql(project, start, end),
    () => metrics.buildLeadEpicOpenJql(project),
    () => metrics.buildChurnJql(project, start, end),
    () => metrics.buildReadySnapshotJql(project, start, end),
    () => metrics.buildStatusDurationJql(project, "run", [{ name: "In Progress" }], start, end),
    () => metrics.buildRunJql(project, start, end),
    () => metrics.buildRunMonthlyJql(project, start, end),
  ];
  builders.forEach((build) => assert.throws(build, /Invalid JIRA project key/));
});

test("Run Markdown summary includes monthly counts without ticket details", () => {
  const result = {
    weeks: [{ label: "02/03", current: false }],
    periodMode: "recent",
    snapshots: [{
      openNow: 1,
      closedThisWeek: 2,
      createdThisWeek: 3,
      avgResolutionHours: 24,
      trends: { open: { direction: "na" }, close: { direction: "na" }, created: { direction: "na" }, resolution: { direction: "na" } },
      isCurrent: false,
      cutoff: new Date(2026, 2, 8),
      statusUnavailableCount: 0,
      createdPerDayCurrent: [3],
      createdPerDayPrev: null,
    }],
    statusDuration: { enabled: false, reason: "Not configured." },
    monthlyFlow: {
      year: 2026,
      previousYear: 2025,
      currentCutoff: new Date(2026, 2, 15, 12),
      previousMonthCutoff: new Date(2025, 2, 15, 12),
      incompleteHistoryCount: 0,
      months: [{ label: "Jan", created: 4, closed: 2, previousCreated: 3, previousClosed: 1 }],
    },
  };
  const output = context.JKDMarkdown.build({
    project: { name: "Operations", key: "OPS" },
    mode: "run",
    result,
    selectedWeekIndex: 0,
    detailLevel: "summary",
    generatedAt: new Date(2026, 2, 15),
  }).markdown;
  assert.match(output, /## Monthly opened vs closed/);
  assert.match(output, /Opened \/ created 2026.*Closed 2026.*Opened \/ created 2025.*Closed 2025/);
  assert.match(output, /\| Jan \| 4 \| 2 \| 3 \| 1 \|/);
  assert.doesNotMatch(output, /OPS-\d+/);

  result.monthlyFlow = null;
  result.monthlyError = "JIRA 400 — monthly query failed";
  const unavailableOutput = context.JKDMarkdown.build({
    project: { name: "Operations", key: "OPS" },
    mode: "run",
    result,
    selectedWeekIndex: 0,
    detailLevel: "summary",
    generatedAt: new Date(2026, 2, 15),
  }).markdown;
  assert.match(unavailableOutput, /## Monthly opened vs closed/);
  assert.match(unavailableOutput, /weekly Run metrics remain available/i);
  assert.match(unavailableOutput, /JIRA 400/);
});

test("Run analysis uses a separately scoped monthly query regardless of weekly mode", async () => {
  const now = new Date();
  const capturedJql = [];
  const client = {
    baseUrl: "https://example.atlassian.net",
    async searchAll(jql) { capturedJql.push(jql); return []; },
  };
  const project = {
    key: "OPS",
    name: "Operations",
    runLabels: ["support"],
    issueTypes: ["Bug"],
    extraJql: 'assignee = "account-id-123"',
    doneStatuses: ["Done"],
    backlogStatuses: [],
    maxPriorities: [],
  };
  const result = await metrics.analyzeRunProject(client, project, { runPeriodMode: "recent" });
  const janLastYear = `${now.getFullYear() - 1}-01-01`;
  assert.equal(capturedJql.length, 2);
  assert.match(capturedJql[0], /resolution IS EMPTY/);
  assert.match(capturedJql[1], new RegExp(`created >= "${janLastYear}"`));
  assert.match(capturedJql[1], /labels IN \("support"\)/);
  assert.match(capturedJql[1], /issuetype IN \("Bug"\)/);
  assert.match(capturedJql[1], /assignee = "account-id-123"/);
  assert.match(result.monthlyJql, new RegExp(`created >= "${janLastYear}"`));
  assert.equal(result.monthlyFlow.year, now.getFullYear());
  assert.equal(result.monthlyFlow.months.length, now.getMonth() + 1);
});

test("monthly query failure leaves weekly Run results available", async () => {
  const client = {
    baseUrl: "https://example.atlassian.net",
    async searchAll(jql) {
      if (jql.includes("created >=")) throw new Error("JIRA 400 — monthly query is too broad");
      return [];
    },
  };
  const project = {
    key: "OPS", name: "Operations", runLabels: ["support"], issueTypes: [],
    doneStatuses: ["Done"], backlogStatuses: [], maxPriorities: [], extraJql: "",
  };
  const result = await metrics.analyzeRunProject(client, project, { runPeriodMode: "recent" });

  assert.equal(result.monthlyFlow, null);
  assert.match(result.monthlyError, /JIRA 400/);
  assert.ok(result.snapshots.length > 0);
  assert.equal(result.totalIssues, 0);
});

test("monthly-only JIRA candidates feed monthly counts without changing weekly population", async () => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const previousYear = currentYear - 1;
  const month = now.getMonth();
  const makeIssue = (key, created, status, histories = [], resolutiondate = null) => ({
    key,
    fields: {
      created: created.toISOString(),
      updated: created.toISOString(),
      resolutiondate,
      resolution: resolutiondate ? { name: "Done" } : null,
      summary: key,
      labels: ["support"],
      status: { name: status },
      assignee: null,
      priority: null,
    },
    changelog: { histories, total: histories.length },
  });
  const currentMonthStart = new Date(currentYear, month, 1);
  const previousMonthStart = new Date(previousYear, month, 1);
  const currentCreated = makeIssue("OPS-CURRENT", currentMonthStart, "In Progress");
  const previousClosedAt = previousMonthStart;
  const previousClosed = makeIssue("OPS-PREVIOUS", previousMonthStart, "Done", [
    { created: previousClosedAt.toISOString(), items: [{ field: "status", fromString: "In Progress", toString: "Done" }] },
  ]);
  const client = {
    baseUrl: "https://example.atlassian.net",
    async searchAll(jql) { return jql.includes("created >=") ? [currentCreated, previousClosed] : []; },
  };
  const result = await metrics.analyzeRunProject(client, {
    key: "OPS", name: "Operations", runLabels: ["support"], issueTypes: ["Bug"],
    doneStatuses: ["Done"], backlogStatuses: [], maxPriorities: [], extraJql: "",
  }, { runPeriodMode: "recent" });

  assert.equal(result.totalIssues, 0);
  assert.equal(result.monthlyFlow.months[month].created, 1);
  assert.equal(result.monthlyFlow.months[month].closed, 0);
  assert.equal(result.monthlyFlow.months[month].previousCreated, 1);
  assert.equal(result.monthlyFlow.months[month].previousClosed, 1);
});
