/* Kanban Flow — stockage de la configuration (chrome.storage.local) */
(function (global) {
  "use strict";
  const api = typeof browser !== "undefined" ? browser : chrome;
  const KEY = "jkd_config";

  const DEFAULT_CONFIG = {
    baseUrl: "",
    email: "",
    token: "",
    weeks: 3,
    // Date de démarrage du macrocycle = première semaine de référence (ISO "YYYY-MM-DD").
    // Vide => par défaut on affiche la semaine en cours + 3 semaines complètes précédentes.
    macrocycleStart: "",
    aggregate: "median", // "median" | "average"
    stableThresholdPct: 10,
    // Créneaux hebdomadaires (réglage global, appliqué à toutes les équipes build).
    // jour : 0 = lundi … 6 = dimanche ; heure "HH:MM" (24:00 accepté).
    engageDay: 0,
    engageStart: "00:00",
    engageEnd: "12:00",
    churnStartDay: 0,
    churnStartTime: "12:00",
    churnEndDay: 5, // samedi 00:00 = vendredi fin de journée (borne exclusive)
    churnEndTime: "00:00",
    // Champ JIRA portant les story points (customfield_100xx). Vide => détection
    // automatique par le nom du champ (« Story Points » / « Story point estimate »).
    storyPointsField: "",
    projects: [
      // {
      //   id: "uuid",
      //   name: "Équipe A",
      //   key: "PROJ",
      //   mode: "build",              // "build" (flux Kanban) | "run" (support/run)
      //   inProgressStatuses: ["In Progress"],
      //   doneStatuses: ["Done"],
      //   readyStatuses: ["Ready"],
      //   backlogStatuses: ["Backlog"],
      //   trackStoryPoints: false,     // suivre les story points (mode build)
      //   runLabels: ["run", "support"], // labels identifiant les tickets de run
      //   maxPriorities: ["Highest"],    // valeurs de priorité "maximale"
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
          r.then(resolve, reject); // Firefox (promesse)
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
    return cfg;
  }

  async function saveConfig(cfg) {
    await storageSet({ [KEY]: cfg });
  }

  /* ---------- Export / import de la configuration ----------
   * Objectif : ne rien avoir à ressaisir lors d'une mise à jour de l'extension
   * (le stockage local est perdu si l'extension est supprimée/réinstallée,
   * et systématiquement sur un module temporaire Firefox).
   * Le jeton API est un secret : il n'est exporté que sur demande explicite.
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

  /* Valide un fichier importé et le fusionne avec la config courante.
   * Retourne { config, warnings }. Lève une Error si le fichier est invalide.
   * Un jeton absent du fichier n'écrase jamais le jeton déjà en place.
   */
  function parseImport(payload, currentCfg) {
    let data = payload;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch (e) {
        throw new Error("Fichier illisible : ce n'est pas du JSON valide.");
      }
    }
    if (!data || typeof data !== "object") throw new Error("Fichier vide ou invalide.");
    if (data.app && data.app !== EXPORT_APP) {
      throw new Error("Ce fichier ne provient pas de Kanban Flow.");
    }
    if (data.formatVersion && Number(data.formatVersion) > EXPORT_FORMAT) {
      throw new Error(
        "Fichier créé par une version plus récente de l'extension. Mettez l'extension à jour."
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
      macrocycleStart:
        typeof src.macrocycleStart === "string" ? src.macrocycleStart : current.macrocycleStart || "",
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
      if (!cfg.token) warnings.push("Le fichier ne contient pas le jeton API : ressaisissez-le.");
      else warnings.push("Jeton API conservé (absent du fichier importé).");
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
          runLabels: list(p.runLabels),
          maxPriorities: list(p.maxPriorities),
          extraJql: String(p.extraJql || ""),
        };
      });

    if (!cfg.projects.length) warnings.push("Aucune équipe dans le fichier importé.");
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
