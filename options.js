/* Kanban Flow — settings page */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);

  function parseList(str) {
    return String(str || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function addProjectRow(project) {
    const tpl = $("projectTemplate");
    const node = tpl.content.firstElementChild.cloneNode(true);
    const p = project || {
      id: JKDStore.uuid(),
      name: "",
      key: "",
      mode: "build",
      trackStoryPoints: false,
      inProgressStatuses: [],
      doneStatuses: [],
      readyStatuses: [],
      backlogStatuses: [],
      runLabels: [],
      maxPriorities: [],
      extraJql: "",
    };
    node.dataset.id = p.id;
    node.querySelector(".p-name").value = p.name || "";
    node.querySelector(".p-key").value = p.key || "";
    node.querySelector(".p-jql").value = p.extraJql || "";
    node.querySelector(".p-wip").value = (p.inProgressStatuses || []).join(", ");
    node.querySelector(".p-done").value = (p.doneStatuses || []).join(", ");
    node.querySelector(".p-done-run").value = (p.doneStatuses || []).join(", ");
    node.querySelector(".p-ready").value = (p.readyStatuses || []).join(", ");
    node.querySelector(".p-backlog").value = (p.backlogStatuses || []).join(", ");
    node.querySelector(".p-backlog-run").value = (p.backlogStatuses || []).join(", ");
    node.querySelector(".p-runlabels").value = (p.runLabels || []).join(", ");
    node.querySelector(".p-maxprio").value = (p.maxPriorities || []).join(", ");
    node.querySelector(".p-storypoints").checked = !!p.trackStoryPoints;

    const modeSel = node.querySelector(".p-mode");
    modeSel.value = p.mode === "run" ? "run" : "build";
    const applyMode = () => {
      node.dataset.mode = modeSel.value;
    };
    modeSel.addEventListener("change", applyMode);
    applyMode();

    node.querySelector(".p-remove").addEventListener("click", () => node.remove());
    $("projectList").appendChild(node);
  }

  function collectProjects() {
    const rows = $("projectList").querySelectorAll(".project");
    const projects = [];
    rows.forEach((row) => {
      const name = row.querySelector(".p-name").value.trim();
      const key = row.querySelector(".p-key").value.trim();
      if (!name && !key) return;
      projects.push({
        id: row.dataset.id || JKDStore.uuid(),
        name: name || key,
        key,
        mode: row.querySelector(".p-mode").value === "run" ? "run" : "build",
        trackStoryPoints: row.querySelector(".p-storypoints").checked,
        extraJql: row.querySelector(".p-jql").value.trim(),
        inProgressStatuses: parseList(row.querySelector(".p-wip").value),
        // Closing statuses: field shared by both modes (build mode enters it
        // in .p-done, run mode in .p-done-run). We take the one filled in for
        // the active mode, falling back to the other.
        doneStatuses: (function () {
          const build = parseList(row.querySelector(".p-done").value);
          const run = parseList(row.querySelector(".p-done-run").value);
          if (row.querySelector(".p-mode").value === "run") {
            return run.length ? run : build;
          }
          return build.length ? build : run;
        })(),
        readyStatuses: parseList(row.querySelector(".p-ready").value),
        // Backlog statuses: field shared by both modes (build = .p-backlog,
        // run = .p-backlog-run). We take the one for the active mode, falling back to the other.
        backlogStatuses: (function () {
          const build = parseList(row.querySelector(".p-backlog").value);
          const run = parseList(row.querySelector(".p-backlog-run").value);
          if (row.querySelector(".p-mode").value === "run") {
            return run.length ? run : build;
          }
          return build.length ? build : run;
        })(),
        runLabels: parseList(row.querySelector(".p-runlabels").value),
        maxPriorities: parseList(row.querySelector(".p-maxprio").value),
      });
    });
    return projects;
  }

  const WEEK_DAYS = [
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  ];

  function fillDaySelects() {
    ["engageDay", "churnStartDay", "churnEndDay"].forEach((id) => {
      const sel = $(id);
      if (!sel || sel.options.length) return;
      WEEK_DAYS.forEach((label, i) => {
        const o = document.createElement("option");
        o.value = String(i);
        o.textContent = label;
        sel.appendChild(o);
      });
    });
  }

  function collectConfig() {
    return {
      baseUrl: JKDJira.normalizeBaseUrl($("baseUrl").value),
      email: $("email").value.trim(),
      token: $("token").value,
      macrocycleStart: $("macrocycleStart").value || "",
      aggregate: $("aggregate").value,
      stableThresholdPct: Math.max(0, parseInt($("threshold").value, 10) || 10),
      engageDay: parseInt($("engageDay").value, 10) || 0,
      engageStart: $("engageStart").value || "00:00",
      engageEnd: $("engageEnd").value || "12:00",
      churnStartDay: parseInt($("churnStartDay").value, 10) || 0,
      churnStartTime: $("churnStartTime").value || "12:00",
      churnEndDay: parseInt($("churnEndDay").value, 10) || 0,
      churnEndTime: $("churnEndTime").value || "00:00",
      storyPointsField: $("storyPointsField").value.trim(),
      projects: collectProjects(),
    };
  }

  async function testConnection() {
    const res = $("testResult");
    res.className = "test-result";
    res.textContent = "Testing…";
    const cfg = collectConfig();
    if (!cfg.baseUrl || !cfg.email || !cfg.token) {
      res.className = "test-result err";
      res.textContent = "Fill in the URL, e-mail and token first.";
      return;
    }
    try {
      const client = JKDJira.makeClient(cfg);
      const me = await client.testConnection();
      res.className = "test-result ok";
      res.textContent = `✓ Connected as ${me.displayName || me.emailAddress || "user"}.`;
    } catch (e) {
      res.className = "test-result err";
      let hint = "";
      if (e.status === 401 || e.status === 403) hint = " (invalid e-mail or token)";
      else if (e.status === 404) hint = " (incorrect site URL?)";
      res.textContent = `✗ Failed: ${e.message}${hint}`;
    }
  }

  async function save() {
    const cfg = collectConfig();
    await JKDStore.saveConfig(cfg);
    const res = $("saveResult");
    res.className = "test-result ok";
    res.textContent = "✓ Saved.";
    setTimeout(() => (res.textContent = ""), 2500);
  }

  /* Fills the form from a config (init and import). */
  function applyConfig(cfg) {
    $("baseUrl").value = cfg.baseUrl || "";
    $("email").value = cfg.email || "";
    $("token").value = cfg.token || "";
    $("macrocycleStart").value = cfg.macrocycleStart || "";
    $("aggregate").value = cfg.aggregate || "median";
    $("threshold").value = cfg.stableThresholdPct != null ? cfg.stableThresholdPct : 10;
    fillDaySelects();
    $("engageDay").value = String(cfg.engageDay != null ? cfg.engageDay : 0);
    $("engageStart").value = cfg.engageStart || "00:00";
    $("engageEnd").value = cfg.engageEnd || "12:00";
    $("churnStartDay").value = String(cfg.churnStartDay != null ? cfg.churnStartDay : 0);
    $("churnStartTime").value = cfg.churnStartTime || "12:00";
    $("churnEndDay").value = String(cfg.churnEndDay != null ? cfg.churnEndDay : 5);
    $("churnEndTime").value = cfg.churnEndTime || "00:00";
    $("storyPointsField").value = cfg.storyPointsField || "";

    $("projectList").innerHTML = "";
    if (cfg.projects && cfg.projects.length) {
      cfg.projects.forEach(addProjectRow);
    } else {
      addProjectRow();
    }
  }

  function backupMsg(text, kind) {
    const el = $("backupResult");
    el.className = "test-result" + (kind ? " " + kind : "");
    el.textContent = text;
  }

  /* Export: downloads a JSON reflecting the current form state. */
  function exportConfig() {
    const includeToken = $("includeToken").checked;
    const payload = JKDStore.buildExport(collectConfig(), { includeToken });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kanban-flow-config_${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    backupMsg(
      includeToken
        ? "✓ Exported (API token included — keep this file safe)."
        : "✓ Exported (without the API token).",
      "ok"
    );
  }

  /* Import: validates the file, replaces the config and saves it. */
  async function importConfigFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const current = collectConfig();
      const { config, warnings } = JKDStore.parseImport(text, current);
      const nb = config.projects.length;
      const ok = window.confirm(
        `Replace the current settings with the file's?\n` +
          `${nb} team(s) will be imported. This action overwrites the current settings.`
      );
      if (!ok) {
        backupMsg("Import cancelled.", "");
        return;
      }
      applyConfig(config);
      await JKDStore.saveConfig(config);
      const suffix = warnings.length ? " — " + warnings.join(" ") : "";
      backupMsg(`✓ Settings imported and saved (${nb} team(s)).${suffix}`, "ok");
    } catch (e) {
      backupMsg(`✗ ${e.message || "Import failed."}`, "err");
    }
  }

  async function init() {
    const cfg = await JKDStore.loadConfig();
    applyConfig(cfg);

    $("addProjectBtn").addEventListener("click", () => addProjectRow());
    $("testBtn").addEventListener("click", testConnection);
    $("saveBtn").addEventListener("click", save);
    $("exportBtn").addEventListener("click", exportConfig);
    $("importBtn").addEventListener("click", () => $("importFile").click());
    $("importFile").addEventListener("change", (ev) => {
      const file = ev.target.files && ev.target.files[0];
      importConfigFile(file).finally(() => {
        ev.target.value = ""; // allows re-importing the same file
      });
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
