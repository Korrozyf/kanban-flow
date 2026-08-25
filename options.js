/* Kanban Flow — page de configuration */
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
        // Statuts de fermeture : champ commun aux deux modes (le mode build le
        // saisit dans .p-done, le mode run dans .p-done-run). On prend celui
        // qui est renseigné selon le mode actif, avec repli sur l'autre.
        doneStatuses: (function () {
          const build = parseList(row.querySelector(".p-done").value);
          const run = parseList(row.querySelector(".p-done-run").value);
          if (row.querySelector(".p-mode").value === "run") {
            return run.length ? run : build;
          }
          return build.length ? build : run;
        })(),
        readyStatuses: parseList(row.querySelector(".p-ready").value),
        // Statuts backlog : champ commun aux deux modes (build = .p-backlog,
        // run = .p-backlog-run). On prend celui du mode actif, repli sur l'autre.
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
    "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche",
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
    res.textContent = "Test en cours…";
    const cfg = collectConfig();
    if (!cfg.baseUrl || !cfg.email || !cfg.token) {
      res.className = "test-result err";
      res.textContent = "Renseignez URL, e-mail et jeton d'abord.";
      return;
    }
    try {
      const client = JKDJira.makeClient(cfg);
      const me = await client.testConnection();
      res.className = "test-result ok";
      res.textContent = `✓ Connecté en tant que ${me.displayName || me.emailAddress || "utilisateur"}.`;
    } catch (e) {
      res.className = "test-result err";
      let hint = "";
      if (e.status === 401 || e.status === 403) hint = " (e-mail ou jeton invalide)";
      else if (e.status === 404) hint = " (URL du site incorrecte ?)";
      res.textContent = `✗ Échec : ${e.message}${hint}`;
    }
  }

  async function save() {
    const cfg = collectConfig();
    await JKDStore.saveConfig(cfg);
    const res = $("saveResult");
    res.className = "test-result ok";
    res.textContent = "✓ Enregistré.";
    setTimeout(() => (res.textContent = ""), 2500);
  }

  /* Remplit le formulaire depuis une config (init et import). */
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

  /* Export : télécharge un JSON reprenant l'état actuel du formulaire. */
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
        ? "✓ Exporté (jeton API inclus — conservez ce fichier en sûreté)."
        : "✓ Exporté (sans le jeton API).",
      "ok"
    );
  }

  /* Import : valide le fichier, remplace la config et l'enregistre. */
  async function importConfigFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const current = collectConfig();
      const { config, warnings } = JKDStore.parseImport(text, current);
      const nb = config.projects.length;
      const ok = window.confirm(
        `Remplacer la configuration actuelle par celle du fichier ?\n` +
          `${nb} équipe(s) seront importée(s). Cette action écrase les réglages en cours.`
      );
      if (!ok) {
        backupMsg("Import annulé.", "");
        return;
      }
      applyConfig(config);
      await JKDStore.saveConfig(config);
      const suffix = warnings.length ? " — " + warnings.join(" ") : "";
      backupMsg(`✓ Configuration importée et enregistrée (${nb} équipe(s)).${suffix}`, "ok");
    } catch (e) {
      backupMsg(`✗ ${e.message || "Import impossible."}`, "err");
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
        ev.target.value = ""; // permet de réimporter le même fichier
      });
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
