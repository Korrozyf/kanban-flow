/* Kanban Flow — configuration storage (chrome.storage.local) */
(function (global) {
  "use strict";
  const api = typeof browser !== "undefined" ? browser : chrome;
  const KEY = "jkd_config";

  const DEFAULT_CONFIG = {
    baseUrl: "",
    email: "",
    token: "",
    weeks: 3,
    // Analysis start date = first week of the Complete period (ISO date).
    // Last weeks ignores it; Complete without it falls back to Last weeks.
    startDate: "",
    // Dashboard period preferences are global but independent per mode.
    // "recent" = current week + 4 previous weeks; "complete" = up to the
    // first 52 weeks from startDate.
    buildPeriodMode: "recent",
    runPeriodMode: "recent",
    aggregate: "median", // "median" | "average"
    stableThresholdPct: 10,
    // Weekly counting windows (global setting, applied to all build teams).
    // day: 0 = Monday … 6 = Sunday; time "HH:MM" (24:00 accepted).
    engageDay: 0,
    engageStart: "00:00",
    engageEnd: "12:00",
    churnStartDay: 0,
    churnStartTime: "12:00",
    churnEndDay: 5, // Saturday 00:00 = Friday end of day (exclusive boundary)
    churnEndTime: "00:00",
    // JIRA field holding the story points (customfield_100xx). Empty => automatic
    // detection by field name ("Story Points" / "Story point estimate").
    storyPointsField: "",
    projects: [
      // {
      //   id: "uuid",
      //   name: "Team A",
      //   key: "PROJ",
      //   mode: "build",              // "build" (Kanban flow) | "run" (support/run)
      //   inProgressStatuses: ["In Progress"],
      //   doneStatuses: ["Done"],
      //   readyStatuses: ["Ready"],
      //   backlogStatuses: ["Backlog"],
      //   issueTypes: ["Story", "Bug"],   // empty = every issue type counted
      //   trackStoryPoints: false,     // track story points (build mode)
      //   runLabels: ["run", "support"], // labels identifying run tickets
      //   maxPriorities: ["Highest"],    // "highest" priority values
      //   extraJql: ""
      // }
    ],
  };

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function storageGet(key) {
    return new Promise((resolve, reject) => {
      try {
        const r = api.storage.local.get(key);
        if (r && typeof r.then === "function") {
          r.then(resolve, reject); // Firefox (promise)
        } else {
          api.storage.local.get(key, (res) => {
            const err = api.runtime.lastError;
            if (err) reject(err);
            else resolve(res);
          });
        }
      } catch (e) {
        reject(e);
      }
    });
  }

  function storageSet(obj) {
    return new Promise((resolve, reject) => {
      try {
        const r = api.storage.local.set(obj);
        if (r && typeof r.then === "function") {
          r.then(resolve, reject);
        } else {
          api.storage.local.set(obj, () => {
            const err = api.runtime.lastError;
            if (err) reject(err);
            else resolve();
          });
        }
      } catch (e) {
        reject(e);
      }
    });
  }

  async function loadConfig() {
    const res = await storageGet(KEY);
    const saved = (res && res[KEY]) || {};
    const cfg = Object.assign({}, DEFAULT_CONFIG, saved);
    cfg.projects = Array.isArray(saved.projects) ? saved.projects : [];
    // Migration: "macrocycleStart" was renamed "startDate" in 1.26.0.
    if (!cfg.startDate && typeof saved.macrocycleStart === "string") {
      cfg.startDate = saved.macrocycleStart;
    }
    delete cfg.macrocycleStart;
    return cfg;
  }

  async function saveConfig(cfg) {
    await storageSet({ [KEY]: cfg });
  }

  /* ---------- Configuration export / import ----------
   * Goal: avoid having to re-enter everything after an extension update
   * (local storage is lost if the extension is removed/reinstalled, and
   * always on a Firefox temporary add-on).
   * The API token is a secret: it is only exported on explicit request.
   */
  const EXPORT_FORMAT = 1;
  const EXPORT_APP = "kanban-flow";

  function extensionVersion() {
    try {
      return (api.runtime.getManifest() || {}).version || "";
    } catch (e) {
      return "";
    }
  }

  function buildExport(cfg, options) {
    const includeToken = !!(options && options.includeToken);
    const config = Object.assign({}, cfg);
    config.projects = Array.isArray(cfg.projects) ? cfg.projects : [];
    if (includeToken) config.token = cfg.token || "";
    else delete config.token;
    return {
      app: EXPORT_APP,
      formatVersion: EXPORT_FORMAT,
      extensionVersion: extensionVersion(),
      exportedAt: new Date().toISOString(),
      tokenIncluded: includeToken,
      config,
    };
  }

  /* Validates an imported file and merges it with the current config.
   * Returns { config, warnings }. Throws an Error if the file is invalid.
   * A token missing from the file never overwrites the one already in place.
   */
  function parseImport(payload, currentCfg) {
    let data = payload;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch (e) {
        throw new Error("Unreadable file: this is not valid JSON.");
      }
    }
    if (!data || typeof data !== "object") throw new Error("Empty or invalid file.");
    if (data.app && data.app !== EXPORT_APP) {
      throw new Error("This file does not come from Kanban Flow.");
    }
    if (data.formatVersion && Number(data.formatVersion) > EXPORT_FORMAT) {
      throw new Error(
        "File created by a newer version of the extension. Please update the extension."
      );
    }
    const src = data.config && typeof data.config === "object" ? data.config : data;
    const day = (v, def) => {
      const d = Number(v);
      return Number.isInteger(d) && d >= 0 && d <= 6 ? d : def;
    };
    const hm = (v, def) => (/^\d{1,2}:\d{2}$/.test(String(v || "")) ? String(v) : def);
    const warnings = [];
    const current = currentCfg || {};

    const cfg = Object.assign({}, DEFAULT_CONFIG, {
      baseUrl: typeof src.baseUrl === "string" ? src.baseUrl : current.baseUrl || "",
      email: typeof src.email === "string" ? src.email : current.email || "",
      // "macrocycleStart" = legacy key (files exported before 1.26.0).
      startDate:
        typeof src.startDate === "string"
          ? src.startDate
          : typeof src.macrocycleStart === "string"
            ? src.macrocycleStart
            : current.startDate || "",
      buildPeriodMode: src.buildPeriodMode === "complete" ||
        (src.buildPeriodMode == null && current.buildPeriodMode === "complete")
        ? "complete" : "recent",
      runPeriodMode: src.runPeriodMode === "complete" ||
        (src.runPeriodMode == null && current.runPeriodMode === "complete")
        ? "complete" : "recent",
      aggregate: src.aggregate === "average" ? "average" : "median",
      stableThresholdPct: Number.isFinite(Number(src.stableThresholdPct))
        ? Math.max(0, Math.min(100, Number(src.stableThresholdPct)))
        : DEFAULT_CONFIG.stableThresholdPct,
      engageDay: day(src.engageDay, DEFAULT_CONFIG.engageDay),
      engageStart: hm(src.engageStart, DEFAULT_CONFIG.engageStart),
      engageEnd: hm(src.engageEnd, DEFAULT_CONFIG.engageEnd),
      churnStartDay: day(src.churnStartDay, DEFAULT_CONFIG.churnStartDay),
      churnStartTime: hm(src.churnStartTime, DEFAULT_CONFIG.churnStartTime),
      churnEndDay: day(src.churnEndDay, DEFAULT_CONFIG.churnEndDay),
      churnEndTime: hm(src.churnEndTime, DEFAULT_CONFIG.churnEndTime),
      storyPointsField:
        typeof src.storyPointsField === "string" ? src.storyPointsField.trim() : "",
    });

    if (typeof src.token === "string" && src.token) {
      cfg.token = src.token;
    } else {
      cfg.token = current.token || "";
      if (!cfg.token) warnings.push("The file does not contain the API token: please re-enter it.");
      else warnings.push("API token kept (absent from the imported file).");
    }

    const projects = Array.isArray(src.projects) ? src.projects : [];
    cfg.projects = projects
      .filter((p) => p && typeof p === "object")
      .map((p) => {
        const list = (v) =>
          Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : [];
        return {
          id: typeof p.id === "string" && p.id ? p.id : uuid(),
          name: String(p.name || "").trim(),
          key: String(p.key || "").trim(),
          mode: p.mode === "run" ? "run" : "build",
          trackStoryPoints: !!p.trackStoryPoints,
          inProgressStatuses: list(p.inProgressStatuses),
          doneStatuses: list(p.doneStatuses),
          readyStatuses: list(p.readyStatuses),
          backlogStatuses: list(p.backlogStatuses),
          issueTypes: list(p.issueTypes),
          runLabels: list(p.runLabels),
          maxPriorities: list(p.maxPriorities),
          extraJql: String(p.extraJql || ""),
        };
      });

    if (!cfg.projects.length) warnings.push("No team in the imported file.");
    return { config: cfg, warnings };
  }

  global.JKDStore = {
    loadConfig,
    saveConfig,
    uuid,
    DEFAULT_CONFIG,
    buildExport,
    parseImport,
    EXPORT_FORMAT,
  };
})(typeof self !== "undefined" ? self : this);
