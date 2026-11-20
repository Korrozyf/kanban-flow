const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadStore() {
  const context = vm.createContext({
    chrome: {
      runtime: { getManifest: () => ({ version: "1.47.0" }) },
      storage: { local: {} },
    },
    crypto: { randomUUID: () => "generated-id" },
  });
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "store.js"), "utf8");
  vm.runInContext(source, context, { filename: "lib/store.js" });
  return context.JKDStore;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const completeConfig = {
  baseUrl: "https://example.atlassian.net",
  email: "facilitator@example.com",
  token: "secret-token",
  startDate: "2024-01-08",
  buildPeriodMode: "complete",
  runPeriodMode: "recent",
  aggregate: "average",
  stableThresholdPct: 17,
  engageDay: 1,
  engageStart: "08:30",
  engageEnd: "13:00",
  churnStartDay: 2,
  churnStartTime: "13:00",
  churnEndDay: 5,
  churnEndTime: "00:00",
  storyPointsField: "customfield_10042",
  projects: [
    {
      id: "team-1",
      name: "Delivery",
      key: "DEL",
      mode: "build",
      trackStoryPoints: true,
      extraJql: "project = DEL AND labels not in (archived)",
      waitingStatuses: ["Ready"],
      inProgressStatuses: ["In Progress"],
      doneStatuses: ["Done"],
      readyStatuses: ["Ready", "In Progress", "Done"],
      backlogStatuses: ["Backlog"],
      issueTypes: ["Story", "Bug"],
      leadTimeIssueTypes: ["Epic"],
      leadTimeStartStatus: "Approved",
      leadTimeFallbackEnabled: false,
      leadTimeStatuses: ["Ready"],
      cycleTimeIssueTypes: ["Story"],
      cycleTimeStartStatus: "In Progress",
      cycleTimeStatuses: ["In Progress"],
      runLabels: ["run"],
      maxPriorities: ["Highest", "High"],
      statusTimeFlow: {
        build: ["Ready", "In Progress"],
        run: ["New", "Investigating"],
      },
    },
    {
      id: "team-2",
      name: "Support",
      key: "SUP",
      mode: "run",
      trackStoryPoints: false,
      extraJql: "component = Support",
      waitingStatuses: ["New"],
      inProgressStatuses: ["Investigating"],
      doneStatuses: ["Resolved"],
      readyStatuses: ["New", "Investigating", "Resolved"],
      backlogStatuses: [],
      issueTypes: ["Incident"],
      leadTimeIssueTypes: [],
      leadTimeStartStatus: "",
      leadTimeFallbackEnabled: false,
      leadTimeStatuses: [],
      cycleTimeIssueTypes: [],
      cycleTimeStartStatus: "",
      cycleTimeStatuses: [],
      runLabels: ["support"],
      maxPriorities: ["Highest"],
      statusTimeFlow: {
        build: [],
        run: ["New", "Investigating", "Resolved"],
      },
    },
  ],
};

test("current global and per-project settings round-trip into an empty configuration", () => {
  const store = loadStore();
  const exported = plain(store.buildExport(completeConfig, { includeToken: false }));
  const imported = plain(store.parseImport(exported, {}).config);

  assert.equal(exported.formatVersion, store.EXPORT_FORMAT);
  assert.equal(Object.hasOwn(exported.config, "token"), false);
  assert.equal(imported.token, "");
  assert.equal(imported.baseUrl, completeConfig.baseUrl);
  assert.equal(imported.email, completeConfig.email);
  assert.equal(imported.startDate, completeConfig.startDate);
  assert.equal(imported.buildPeriodMode, completeConfig.buildPeriodMode);
  assert.equal(imported.runPeriodMode, completeConfig.runPeriodMode);
  assert.equal(imported.aggregate, completeConfig.aggregate);
  assert.equal(imported.stableThresholdPct, completeConfig.stableThresholdPct);
  assert.equal(imported.engageDay, completeConfig.engageDay);
  assert.equal(imported.engageStart, completeConfig.engageStart);
  assert.equal(imported.engageEnd, completeConfig.engageEnd);
  assert.equal(imported.churnStartDay, completeConfig.churnStartDay);
  assert.equal(imported.churnStartTime, completeConfig.churnStartTime);
  assert.equal(imported.churnEndDay, completeConfig.churnEndDay);
  assert.equal(imported.churnEndTime, completeConfig.churnEndTime);
  assert.equal(imported.storyPointsField, completeConfig.storyPointsField);
  assert.deepEqual(imported.projects, completeConfig.projects);
  assert.ok(store.parseImport(exported, {}).warnings.some((warning) => warning.includes("API token")));
});

test("project selection includes only checked IDs and retains source order", () => {
  const store = loadStore();
  const exported = plain(store.buildExport(completeConfig, {
    projectIds: ["team-2"],
  }));
  assert.deepEqual(exported.config.projects.map((project) => project.id), ["team-2"]);
});

test("an empty project selection exports global settings only", () => {
  const store = loadStore();
  const exported = plain(store.buildExport(completeConfig, { projectIds: [] }));
  assert.deepEqual(exported.config.projects, []);
  assert.equal(exported.config.baseUrl, completeConfig.baseUrl);
});

test("API token remains opt-in and an omitted token preserves the destination token", () => {
  const store = loadStore();
  const withoutToken = plain(store.buildExport(completeConfig, {}));
  const withToken = plain(store.buildExport(completeConfig, { includeToken: true }));
  assert.equal(Object.hasOwn(withoutToken.config, "token"), false);
  assert.equal(withToken.config.token, completeConfig.token);
  assert.equal(store.parseImport(withoutToken, { token: "existing-token" }).config.token, "existing-token");
});
