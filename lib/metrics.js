/* Kanban Flow — calcul des indicateurs de flux (throughput, lead time, cycle time)
 * Semaines ISO du lundi au dimanche, en heure locale.
 */
(function (global) {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;

  // --- Gestion des semaines (lundi -> dimanche, heure locale) ---
  function startOfWeek(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    const dow = (x.getDay() + 6) % 7; // lundi = 0 ... dimanche = 6
    x.setDate(x.getDate() - dow);
    return x;
  }

  // Nombre maximal de semaines complètes précédentes affichées.
  const MAX_PREV_WEEKS = 3;

  // Décalage en JOURS CALENDAIRES (et non en tranches de 24 h) : indispensable
  // pour rester juste lors des changements d'heure (une semaine peut faire
  // 167 h ou 169 h).
  function addDays(date, n) {
    const x = new Date(date);
    x.setDate(x.getDate() + n);
    return x;
  }

  /* Convertit un offset exprimé en ms depuis le lundi 00:00 en INSTANT RÉEL de
   * la semaine considérée. La partie « jours » est appliquée en jours
   * calendaires, la partie « heures » ensuite : un passage à l'heure d'été/hiver
   * au milieu de la semaine ne décale donc plus les bornes de comptage. */
  function weekInstant(weekStart, offsetMs) {
    const d = Math.floor(offsetMs / DAY_MS);
    const rest = offsetMs - d * DAY_MS;
    return new Date(addDays(weekStart, d).getTime() + rest);
  }

  /* ---------- Créneaux hebdomadaires configurables (réglage global) ----------
   * Les créneaux sont exprimés en OFFSET depuis le lundi 00:00 de la semaine.
   * jour : 0 = lundi … 6 = dimanche ; heure : "HH:MM" (24:00 accepté).
   * Valeurs par défaut = comportement historique :
   *   engagé            : lundi 00:00 → lundi 12:00
   *   ajouts / retraits : lundi 12:00 → samedi 00:00 (= vendredi fin de journée)
   */
  const WEEK_DAYS = [
    "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche",
  ];
  // Ordre de repli des priorités (la plus élevée d'abord) si l'API JIRA
  // /rest/api/3/priority n'est pas joignable.
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
    // Minuit pile se lit mieux comme « fin de journée de la veille »
    // (samedi 00:00 => « vendredi 24h »).
    if (rest === 0 && d > 0) return `${WEEK_DAYS[Math.min(6, d - 1)]} 24h`;
    const day = WEEK_DAYS[Math.min(6, Math.max(0, d))] || "lundi";
    const hm = mi ? `${h}h${String(mi).padStart(2, "0")}` : `${h}h`;
    return `${day} ${hm}`;
  }

  /* Retourne les offsets (ms depuis lundi 00:00) + libellés lisibles. */
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

  // Renvoie les N dernières semaines (la dernière = semaine en cours).
  function buildWeeks(n, now) {
    const ref = now ? new Date(now) : new Date();
    const currentMonday = startOfWeek(ref);
    const weeks = [];
    for (let i = n - 1; i >= 0; i--) {
      const start = new Date(currentMonday);
      start.setDate(start.getDate() - i * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 7); // borne exclusive
      weeks.push({ start, end, label: formatWeekLabel(start) });
    }
    return weeks;
  }

  /* Construit la fenêtre de semaines à partir de la « date de démarrage du
   * macrocycle » (première semaine). La semaine en cours est toujours la
   * dernière ; on affiche jusqu'à MAX_PREV_WEEKS semaines complètes précédentes,
   * bornées par la première semaine du macrocycle.
   * Renvoie :
   *  - future: true            → la première semaine est postérieure à la semaine en cours
   *  - weeks[]                 → { start, end, label, current, complete }
   *  - currentIndex            → index de la semaine en cours (dernière)
   *  - completeCount           → nombre de semaines complètes affichées
   *  - hasComparison           → au moins 1 semaine précédente pour comparer
   */
  /* Parse la « date de démarrage du macrocycle » en date LOCALE à minuit.
   * Accepte "YYYY-MM-DD" (évite le décalage UTC de new Date()). Renvoie null si
   * absente ou invalide. */
  function parseMacroStartDate(macroStart) {
    if (!macroStart) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(macroStart).trim());
    const parsed = m
      ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      : new Date(macroStart);
    if (isNaN(parsed.getTime())) return null;
    parsed.setHours(0, 0, 0, 0);
    return parsed;
  }

  function buildMacrocycleWeeks(macroStart, now) {
    const currentWeekStart = startOfWeek(now ? new Date(now) : new Date());
    // Sans date de macrocycle valide : repli sur la semaine en cours + MAX_PREV_WEEKS
    // semaines complètes précédentes (comportement par défaut).
    let parsed = parseMacroStartDate(macroStart);
    if (!parsed || isNaN(parsed.getTime())) {
      parsed = new Date(currentWeekStart);
      parsed.setDate(parsed.getDate() - MAX_PREV_WEEKS * 7);
    }
    const firstWeekStart = startOfWeek(parsed);
    const msPerWeek = 7 * DAY_MS;
    // Arrondi pour absorber les décalages d'heure d'été.
    const diffWeeks = Math.round((currentWeekStart - firstWeekStart) / msPerWeek);

    if (diffWeeks < 0) {
      return {
        future: true,
        weeks: [],
        currentIndex: -1,
        completeCount: 0,
        hasComparison: false,
        firstWeekStart,
        currentWeekStart,
      };
    }

    const prevCount = Math.min(MAX_PREV_WEEKS, diffWeeks);
    const weeks = [];
    for (let i = prevCount; i >= 0; i--) {
      const start = new Date(currentWeekStart);
      start.setDate(start.getDate() - i * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 7); // borne exclusive
      const isCurrent = i === 0;
      weeks.push({
        start,
        end,
        label: formatWeekLabel(start),
        current: isCurrent, // semaine en cours (incomplète)
        complete: !isCurrent, // semaine complète (lun→dim révolus)
      });
    }
    return {
      future: false,
      weeks,
      currentIndex: weeks.length - 1,
      completeCount: prevCount,
      hasComparison: prevCount >= 1,
      firstWeekStart,
      currentWeekStart,
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

  // --- Agrégations ---
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
  // Variance de population (moyenne des carrés des écarts à la moyenne).
  function variance(arr) {
    if (!arr.length) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return arr.reduce((s, v) => s + (v - mean) * (v - mean), 0) / arr.length;
  }
  function aggregate(arr, mode) {
    return mode === "average" ? average(arr) : median(arr);
  }

  // --- Tendance : compare la dernière valeur à la précédente ---
  // higherIsBetter : true pour le throughput, false pour lead/cycle time.
  function computeTrend(values, thresholdPct, higherIsBetter) {
    const valid = values.filter((v) => v !== null && v !== undefined && !isNaN(v));
    if (valid.length < 2) return { direction: "na", pct: null, good: null };
    const last = values[values.length - 1];
    const prev = values[values.length - 2];
    if (last === null || prev === null || isNaN(last) || isNaN(prev)) {
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

  // --- Construction du JQL ---
  function quoteList(statuses) {
    return statuses
      .map((s) => `"${String(s).trim().replace(/"/g, '\\"')}"`)
      .filter((s) => s !== '""')
      .join(", ");
  }

  // windowEnd est la borne EXCLUSIVE de la fenêtre (lundi 00:00 de la semaine
  // suivant la dernière semaine analysée). En JQL, une date sans heure vaut
  // 00:00, donc BEFORE "<lundi suivant>" = jusqu'à la fin du dimanche.
  function buildJql(project, windowStart, windowEnd) {
    const key = String(project.key).trim();
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
    if (project.extraJql && project.extraJql.trim()) {
      jql += ` AND (${project.extraJql.trim()})`;
    }
    jql += " ORDER BY updated DESC";
    return jql;
  }

  // --- Extraction des dates clés depuis le changelog d'un ticket ---
  function statusTransitions(histories) {
    // Renvoie [{ at: Date, to: string, from: string }] triés chronologiquement
    const events = [];
    for (const h of histories || []) {
      const at = new Date(h.created);
      for (const it of h.items || []) {
        if (it.field === "status" || it.fieldId === "status") {
          events.push({ at, to: it.toString, from: it.fromString });
        }
      }
    }
    events.sort((a, b) => a.at - b.at);
    return events;
  }

  function issueHistories(issue) {
    return (issue.changelog && issue.changelog.histories) || issue._changelog || [];
  }

  // JQL des tickets ayant changé de statut vers Ready ou Backlog dans la fenêtre.
  // Sert à mesurer les ajouts en Ready et les remises en backlog. Renvoie null
  // si aucun statut Ready/Backlog n'est configuré pour le projet.
  function buildChurnJql(project, windowStart, windowEnd) {
    const key = String(project.key).trim();
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
    let jql = `project = "${key}" AND (${clauses.join(" OR ")})`;
    if (project.extraJql && project.extraJql.trim()) {
      jql += ` AND (${project.extraJql.trim()})`;
    }
    jql += " ORDER BY updated DESC";
    return jql;
  }

  // JQL des tickets ayant été en statut Ready pendant la fenêtre d'analyse.
  // Sert au throughput engagé (snapshot du lundi). `status WAS IN` capte aussi
  // les tickets entrés en Ready avant la fenêtre et toujours présents. Renvoie
  // null si aucun statut Ready n'est configuré.
  function buildReadySnapshotJql(project, windowStart, windowEnd) {
    const ready = (project.readyStatuses || []).filter(Boolean);
    if (!ready.length) return null;
    const key = String(project.key).trim();
    let jql =
      `project = "${key}" AND status WAS IN (${quoteList(ready)}) ` +
      `DURING ("${isoDate(windowStart)}", "${isoDate(windowEnd)}")`;
    if (project.extraJql && project.extraJql.trim()) {
      jql += ` AND (${project.extraJql.trim()})`;
    }
    jql += " ORDER BY updated DESC";
    return jql;
  }

  // Reconstruit le statut d'un ticket à l'instant T à partir de son changelog.
  // events = statusTransitions(...) trié chronologiquement. Renvoie le statut
  // courant si aucune transition, sinon le dernier statut atteint avant ou à T
  // (ou le statut initial — `from` de la 1re transition — si T est antérieur).
  function statusAtTime(issue, events, T) {
    if (!events.length) {
      return issue.fields && issue.fields.status && issue.fields.status.name
        ? issue.fields.status.name
        : null;
    }
    const t = T.getTime();
    let status = events[0].from; // statut initial (avant la 1re transition)
    for (const ev of events) {
      if (ev.at.getTime() <= t) status = ev.to;
      else break;
    }
    return status;
  }

  // Vrai si le ticket a été EN statut Ready à un moment quelconque de la
  // fenêtre [start, end] (bornes incluses). Sert au throughput engagé, mesuré
  // sur le créneau du lundi minuit -> midi. On teste l'état au début du créneau
  // (déjà en Ready) PUIS toute transition entrant en Ready avant/à `end`.
  function wasReadyDuring(issue, events, start, end, readySet) {
    const st0 = statusAtTime(issue, events, start);
    if (st0 && readySet.has(st0.toLowerCase())) return true;
    const s = start.getTime();
    const e = end.getTime();
    for (const ev of events) {
      const at = ev.at.getTime();
      if (at < s) continue;
      if (at > e) break;
      if (ev.to && readySet.has(ev.to.toLowerCase())) return true;
    }
    return false;
  }

  // Récupère les tickets d'une requête JQL avec leur changelog complet.
  async function fetchIssuesWithChangelog(client, jql, onProgress, fields) {
    const issues = await client.searchAll(
      jql,
      fields || ["created", "resolutiondate", "summary", "status"],
      "changelog"
    );
    for (const issue of issues) {
      const cl = issue.changelog;
      const needFull =
        !cl ||
        (typeof cl.total === "number" &&
          cl.histories &&
          cl.total > cl.histories.length);
      if (needFull) {
        if (onProgress) onProgress(`Changelog ${issue.key}…`);
        try {
          issue._changelog = await client.getChangelog(issue.key);
        } catch (e) {
          issue._changelog = (cl && cl.histories) || [];
        }
      }
    }
    return issues;
  }

  function computeIssueDates(issue, project, clampStart) {
    const done = new Set((project.doneStatuses || []).map((s) => s.toLowerCase()));
    const wip = new Set((project.inProgressStatuses || []).map((s) => s.toLowerCase()));
    let created = new Date(issue.fields.created);
    const histories =
      (issue.changelog && issue.changelog.histories) || issue._changelog || [];
    const events = statusTransitions(histories);

    // Date de fin = dernière entrée dans un statut "terminé"
    let doneDate = null;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].to && done.has(events[i].to.toLowerCase())) {
        doneDate = events[i].at;
        break;
      }
    }
    if (!doneDate && issue.fields.resolutiondate) {
      doneDate = new Date(issue.fields.resolutiondate);
    }

    // Date de début = première entrée dans un statut "en cours"
    let startDate = null;
    for (let i = 0; i < events.length; i++) {
      if (events[i].to && wip.has(events[i].to.toLowerCase())) {
        startDate = events[i].at;
        break;
      }
    }
    const startApprox = !startDate;
    if (!startDate) startDate = created; // repli : cycle time = lead time

    // Bornage au démarrage du macrocycle : si une date de référence (création
    // pour le lead time, 1re mise en cours pour le cycle time) est antérieure au
    // démarrage du macrocycle, on la ramène à cette date. On ne compte donc
    // jamais le temps écoulé avant le début du macrocycle.
    if (clampStart) {
      const clamp = clampStart.getTime();
      if (created.getTime() < clamp) created = new Date(clamp);
      if (startDate.getTime() < clamp) startDate = new Date(clamp);
    }

    return { created, startDate, doneDate, startApprox };
  }

  // ===================== MODE RUN (support / run) =====================

  // JQL des tickets de run : projet + labels de run, en gardant ceux créés
  // depuis le début de la fenêtre OU encore non résolus (pour l'encours).
  function buildRunJql(project, windowStart, windowEnd) {
    const key = String(project.key).trim();
    const labels = (project.runLabels || []).filter(Boolean);
    const dateStr = isoDate(windowStart);
    const createdClause = windowEnd
      ? `(created >= "${dateStr}" AND created < "${isoDate(windowEnd)}")`
      : `created >= "${dateStr}"`;
    // Tickets fermés PENDANT la fenêtre mais créés avant : il faut aussi les
    // rapatrier, sinon la liste "fermés cette semaine" les manquerait.
    const resolvedClause = windowEnd
      ? `(resolutiondate >= "${dateStr}" AND resolutiondate < "${isoDate(windowEnd)}")`
      : `resolutiondate >= "${dateStr}"`;
    let jql = `project = "${key}"`;
    if (labels.length) jql += ` AND labels IN (${quoteList(labels)})`;
    jql += ` AND (${createdClause} OR ${resolvedClause} OR resolution IS EMPTY)`;
    if (project.extraJql && project.extraJql.trim()) {
      jql += ` AND (${project.extraJql.trim()})`;
    }
    jql += " ORDER BY created ASC";
    return jql;
  }

  /* Analyse d'un projet en mode RUN. Semaines lun 00:00 -> dim 23:59.
   * Indicateurs :
   *  1. Tickets ouverts (non résolus) : nombre par semaine (encours à la fin de
   *     chaque semaine) + liste des tickets actuellement ouverts.
   *  2. Variance du nombre de tickets créés sur des fenêtres de 24h glissantes
   *     (pas horaire) à l'intérieur de chaque semaine.
   *  3. Liste (instantané) des tickets ouverts non assignés + lien JIRA.
   *  4. Liste (instantané) des tickets en priorité maximale : date de création,
   *     délai création -> premier commentaire, délai création -> résolution.
   */
  async function analyzeRunProject(client, project, cfg, onProgress) {
    const win = buildMacrocycleWeeks(cfg.macrocycleStart);
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
    const windowStart = weeks[0].start;

    const jql = buildRunJql(project, windowStart, weeks[n - 1].end);
    if (onProgress) onProgress("Requête JIRA (run)…");
    // Le changelog est nécessaire pour dater précisément l'entrée dans un statut
    // de fermeture (ex. "Cancelled") quand JIRA ne fournit pas de resolutiondate.
    const issues = await fetchIssuesWithChangelog(client, jql, onProgress, [
      "created",
      "updated",
      "resolutiondate",
      "resolution",
      "summary",
      "status",
      "assignee",
      "priority",
    ]);

    const HOUR_MS = 60 * 60 * 1000;
    const now = new Date();
    const maxPrioSet = new Set(
      (project.maxPriorities || []).map((s) => String(s).toLowerCase()).filter(Boolean)
    );
    // Ordre des priorités JIRA (index 0 = la plus élevée). Récupéré depuis JIRA
    // pour respecter l'ordre réel du site ; repli sur un ordre usuel si l'appel échoue.
    let prioOrder = [];
    if (client.getPriorities) {
      try {
        prioOrder = await client.getPriorities();
      } catch (e) {
        prioOrder = [];
      }
    }
    if (!prioOrder.length) prioOrder = DEFAULT_PRIORITY_ORDER;
    const prioRanks = new Map();
    prioOrder.forEach((name, i) => prioRanks.set(String(name).trim().toLowerCase(), i));
    // Rang de tri : plus petit = priorité plus élevée ; inconnu/absent en dernier.
    const prioRank = (name) => {
      if (!name) return 9999;
      const r = prioRanks.get(String(name).trim().toLowerCase());
      return r == null ? 9998 : r;
    };
    const tsAsc = (d) => (d ? d.getTime() : Number.POSITIVE_INFINITY);
    const tsDesc = (d) => (d ? d.getTime() : Number.NEGATIVE_INFINITY);
    // Statuts de fermeture configurés : un ticket qui s'y trouve est considéré
    // fermé (donc exclu des stats), au même titre qu'un ticket résolu.
    const doneSet = new Set(
      (project.doneStatuses || []).map((s) => String(s).toLowerCase()).filter(Boolean)
    );
    // Statuts "backlog" du run : un ticket ouvert dans l'un de ces statuts est
    // considéré NON PLANIFIÉ (pas encore pris en charge par l'équipe). Tout
    // autre statut = ticket présent dans le board, donc à traiter.
    const backlogSet = new Set(
      (project.backlogStatuses || [])
        .map((s) => String(s).trim().toLowerCase())
        .filter(Boolean)
    );

    // Normalisation des tickets.
    const tickets = issues.map((it) => {
      const f = it.fields || {};
      const created = f.created ? new Date(f.created) : null;
      const updated = f.updated ? new Date(f.updated) : null;
      const resolved = f.resolutiondate ? new Date(f.resolutiondate) : null;
      const statusName = f.status ? f.status.name : "";
      const inDoneStatus = statusName && doneSet.has(statusName.trim().toLowerCase());
      // Date effective de fermeture. Priorité :
      //   1. dernière entrée dans un statut de fermeture (changelog) — vaut pour
      //      TOUS les statuts de fermeture configurés (Done, Cancelled, ...) ;
      //   2. resolutiondate si le changelog ne fournit rien ;
      //   3. "maintenant" en dernier recours (ticket clos par statut sans trace).
      let doneStatusAt = null;
      if (inDoneStatus) {
        const evs = statusTransitions(issueHistories(it));
        for (let i = evs.length - 1; i >= 0; i--) {
          const to = (evs[i].to || "").trim().toLowerCase();
          if (doneSet.has(to)) {
            doneStatusAt = evs[i].at;
            break;
          }
        }
      }
      const closedAt = doneStatusAt || resolved || (inDoneStatus ? now : null);
      const isOpen = !resolved && !inDoneStatus;
      const inBacklogStatus = Boolean(
        statusName && backlogSet.has(statusName.trim().toLowerCase())
      );
      return {
        key: it.key,
        summary: f.summary || "",
        status: statusName,
        created,
        updated,
        resolved,
        closedAt,
        closedAtApprox: !doneStatusAt && !resolved && inDoneStatus,
        isOpen,
        inBacklogStatus,
        assignee: f.assignee ? f.assignee.displayName || f.assignee.name : null,
        priority: f.priority ? f.priority.name : null,
        url: `${client.baseUrl}/browse/${it.key}`,
      };
    });

    // 1) Ouverts par semaine = tickets dont la DATE DE CRÉATION tombe dans les
    //    bornes de la semaine considérée [lundi 00:00, lundi suivant 00:00[,
    //    quel que soit leur statut. Aucun cumul entre semaines : un ticket créé
    //    en semaine 1 n'est jamais recompté en semaine 2.
    const openCount = new Array(n).fill(0);
    for (const t of tickets) {
      if (!t.created) continue;
      const wi = weekIndexOf(t.created, weeks);
      if (wi < 0) continue; // créé hors fenêtre d'analyse
      openCount[wi] += 1;
    }
    // Liste des tickets actuellement ouverts (non résolus), triés par PRIORITÉ
    // décroissante (la plus élevée d'abord) puis par date de création croissante
    // (les plus anciens d'abord).
    // Les tickets ouverts dont le statut est un statut de backlog du run sont
    // exclus d'ici et listés à part ("ouverts non planifiés").
    const sortOpen = (a, b) =>
      prioRank(a.priority) - prioRank(b.priority) ||
      tsAsc(a.created) - tsAsc(b.created);
    const openList = tickets
      .filter((t) => t.isOpen && !t.inBacklogStatus)
      .sort(sortOpen);
    // Ouverts non planifiés = ouverts dans un statut de backlog du run.
    const backlogList = tickets
      .filter((t) => t.isOpen && t.inBacklogStatus)
      .sort(sortOpen);
    // Compteurs d'ancienneté (en heures) : depuis l'ouverture et depuis la
    // dernière action enregistrée sur le ticket (champ `updated`).
    for (const t of openList.concat(backlogList)) {
      t.hoursSinceCreated = t.created
        ? Math.max(0, (now - t.created) / HOUR_MS)
        : null;
      t.hoursSinceUpdated = t.updated
        ? Math.max(0, (now - t.updated) / HOUR_MS)
        : null;
    }

    // 1bis) Fermés par semaine (stat équivalente aux ouverts) = tickets dont la
    //    DATE DE FERMETURE tombe dans les bornes de la semaine considérée.
    //    Un ticket est fermé s'il est résolu OU dans un statut de fermeture.
    //    Aucun cumul entre semaines.
    const closeCount = new Array(n).fill(0);
    for (const t of tickets) {
      if (!t.closedAt) continue;
      const wi = weekIndexOf(t.closedAt, weeks);
      if (wi < 0) continue; // fermé hors fenêtre d'analyse
      closeCount[wi] += 1;
    }
    // Liste des tickets fermés PENDANT LA SEMAINE EN COURS (résolus ou entrés
    // dans un statut de fermeture), triés par PRIORITÉ décroissante puis par
    // date de fermeture décroissante (les fermetures les plus récentes d'abord).
    const curWeek = weeks[win.currentIndex];
    const closedList = tickets
      .filter(
        (t) =>
          !t.isOpen &&
          t.closedAt &&
          t.closedAt >= curWeek.start &&
          t.closedAt < curWeek.end
      )
      .sort(
        (a, b) =>
          prioRank(a.priority) - prioRank(b.priority) ||
          tsDesc(b.closedAt) - tsDesc(a.closedAt)
      );
    // Durée totale ouverture → fermeture (en heures), pour le code couleur.
    for (const t of closedList) {
      t.hoursOpenToClosed =
        t.created && t.closedAt
          ? Math.max(0, (t.closedAt - t.created) / HOUR_MS)
          : null;
    }
    // Temps MOYEN de résolution (création → fermeture) des tickets fermés
    // pendant la semaine en cours. Aucun cumul inter-semaines : la population
    // est exactement closedList.
    const avgOf = (arr) =>
      arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    const curResolutionHours = closedList
      .map((t) => t.hoursOpenToClosed)
      .filter((h) => h != null);
    const avgResolutionHours = avgOf(curResolutionHours);
    const avgResolutionCount = curResolutionHours.length;

    // 2) Tickets créés pendant la semaine en cours, comparés aux créations de la
    //    semaine précédente sur la MÊME durée écoulée (ex. mardi 14h → du lundi
    //    00:00 au mardi 14h de la semaine précédente). Remplace l'ancienne
    //    variance sur 24h glissantes (unité en tickets², peu lisible).
    const createdTimes = tickets.filter((t) => t.created).map((t) => t.created.getTime());
    const nowMs = now.getTime();
    const curIdx = win.currentIndex;
    const curStartMs = weeks[curIdx].start.getTime();
    const elapsedMs = Math.min(weeks[curIdx].end.getTime(), nowMs) - curStartMs;
    const countCreatedBetween = (from, to) =>
      createdTimes.filter((ct) => ct >= from && ct < to).length;
    const createdThisWeek = countCreatedBetween(curStartMs, curStartMs + elapsedMs);
    let createdPrevSameElapsed = null;
    let createdPrevWeek = null;
    if (curIdx >= 1) {
      const prevStart = weeks[curIdx - 1].start.getTime();
      const prevEnd = weeks[curIdx - 1].end.getTime();
      // Borne haute plafonnée à la fin de la semaine précédente : si la semaine
      // en cours est plus longue (changement d'heure), la fenêtre « même durée
      // écoulée » ne doit pas mordre sur la semaine en cours.
      const prevCut = Math.min(prevStart + elapsedMs, prevEnd);
      createdPrevSameElapsed = countCreatedBetween(prevStart, prevCut);
      createdPrevWeek = countCreatedBetween(prevStart, prevEnd);
    }

    // 2bis) Créations par JOUR de la semaine (lundi → dimanche) pour la semaine
    //    en cours et la semaine précédente. Chaque ticket est rattaché au seul
    //    jour de sa création : aucun cumul entre jours ni entre semaines.
    //    Les bornes de jour sont calculées en JOURS CALENDAIRES (pas en tranches
    //    de 24 h) : lors d'un changement d'heure, la semaine fait 167 h ou 169 h
    //    et un découpage à pas fixe ferait déborder le dimanche sur le lundi de
    //    la semaine suivante (double comptage) ou perdrait une heure (ticket non
    //    compté). Les 8 bornes couvrent exactement [lundi 00:00, lundi+7 00:00[.
    function dayBounds(weekStart) {
      const b = new Array(8);
      for (let d = 0; d <= 7; d++) b[d] = addDays(weekStart, d).getTime();
      return b;
    }
    function createdPerDay(weekStart) {
      const out = new Array(7).fill(0);
      if (!weekStart) return out;
      const b = dayBounds(weekStart);
      for (const ct of createdTimes) {
        if (ct < b[0] || ct >= b[7]) continue; // hors de CETTE semaine
        for (let d = 0; d < 7; d++) {
          if (ct < b[d + 1]) {
            out[d] += 1;
            break;
          }
        }
      }
      return out;
    }
    const createdPerDayCurrent = createdPerDay(weeks[curIdx].start);
    const createdPerDayPrev =
      curIdx >= 1 ? createdPerDay(weeks[curIdx - 1].start) : null;
    // Jours déjà écoulés dans la semaine en cours (1..7) : au-delà, la
    // comparaison avec la semaine précédente n'aurait pas de sens. Compté sur
    // les bornes calendaires (et non en tranches de 24 h).
    const curBounds = dayBounds(weeks[curIdx].start);
    let elapsedDays = 1;
    for (let d = 1; d < 7; d++) {
      if (nowMs >= curBounds[d]) elapsedDays = d + 1;
    }

    // 3) Tickets ouverts non assignés (instantané actuel).
    const unassignedList = tickets
      .filter((t) => t.isOpen && !t.assignee)
      .sort((a, b) => (a.created && b.created ? a.created - b.created : 0));

    // 4) Tickets en priorité maximale (instantané) : délais 1er commentaire et résolution.
    let maxPriorityList = tickets.filter(
      (t) => t.priority && maxPrioSet.has(t.priority.toLowerCase())
    );
    // Tri : priorité décroissante (la plus élevée d'abord) puis date de
    // création croissante (les plus anciens d'abord).
    maxPriorityList.sort(
      (a, b) =>
        prioRank(a.priority) - prioRank(b.priority) ||
        tsAsc(a.created) - tsAsc(b.created)
    );
    for (const t of maxPriorityList) {
      t.firstCommentDate = null;
      if (onProgress) onProgress(`Premier commentaire ${t.key}…`);
      try {
        t.firstCommentDate = await client.getFirstCommentDate(t.key);
      } catch (e) {
        t.firstCommentDate = null;
      }
      const h1 =
        t.created && t.firstCommentDate
          ? (t.firstCommentDate - t.created) / HOUR_MS
          : null;
      const hr =
        t.created && t.resolved ? (t.resolved - t.created) / HOUR_MS : null;
      // On écarte les durées négatives (anomalies de données).
      t.hoursToFirstComment = h1 != null && h1 >= 0 ? h1 : null;
      t.hoursToResolution = hr != null && hr >= 0 ? hr : null;
    }

    const thr = parseInt(cfg.stableThresholdPct, 10);
    const threshold = isNaN(thr) ? 10 : thr;

    // --- Bases de comparaison des cartes de haut de page (semaine en cours vs précédente) ---
    // Ouverts : stock ACTUEL de tickets non résolus, comparé au stock encore
    // ouvert à la FIN de la semaine précédente (= lundi 00:00 de la semaine en cours).
    // KPI "Tickets ouverts" = TOUS les tickets de run actuellement ouverts
    // (board + backlog), inchangé : la répartition board/backlog ne concerne
    // que les listes de détail.
    const openNow = openList.length + backlogList.length;
    let openAtPrevWeekEnd = null;
    if (curIdx >= 1) {
      const boundary = weeks[curIdx - 1].end.getTime();
      openAtPrevWeekEnd = tickets.filter(
        (t) =>
          t.created &&
          t.created.getTime() < boundary &&
          (!t.closedAt || t.closedAt.getTime() >= boundary)
      ).length;
    }
    // Fermés : tickets fermés PENDANT la semaine en cours. La base de
    // comparaison est la semaine précédente restreinte à la MÊME durée écoulée
    // (ex. mardi 14h → du lundi 00:00 au mardi 14h de la semaine précédente),
    // sinon on compare un début de semaine à une semaine entière.
    const closedThisWeek = closeCount[curIdx];
    const closedPrevWeek = curIdx >= 1 ? closeCount[curIdx - 1] : null;
    let closedPrevSameElapsed = null;
    let avgResolutionPrevSameElapsed = null;
    if (curIdx >= 1) {
      const prevStart = weeks[curIdx - 1].start.getTime();
      // Plafonnée à la fin de la semaine précédente (cf. créations).
      const prevCut = Math.min(
        prevStart + elapsedMs,
        weeks[curIdx - 1].end.getTime()
      );
      const prevClosed = tickets.filter((t) => {
        if (!t.closedAt) return false;
        const c = t.closedAt.getTime();
        return c >= prevStart && c < prevCut;
      });
      closedPrevSameElapsed = prevClosed.length;
      // Base de comparaison du temps moyen de résolution : mêmes bornes que
      // pour le nombre de fermetures (même durée écoulée).
      avgResolutionPrevSameElapsed = avgOf(
        prevClosed
          .filter((t) => t.created && t.closedAt)
          .map((t) => Math.max(0, (t.closedAt - t.created) / HOUR_MS))
      );
    }

    return {
      mode: "run",
      future: false,
      weeks,
      currentIndex: win.currentIndex,
      completeCount: win.completeCount,
      hasComparison: win.hasComparison,
      firstWeekStart: win.firstWeekStart,
      openCount,
      openList,
      backlogList,
      closeCount,
      closedList,
      openNow,
      openAtPrevWeekEnd,
      closedThisWeek,
      closedPrevWeek,
      closedPrevSameElapsed,
      avgResolutionHours,
      avgResolutionCount,
      avgResolutionPrevSameElapsed,
      createdThisWeek,
      createdPrevSameElapsed,
      createdPrevWeek,
      createdPerDayCurrent,
      createdPerDayPrev,
      elapsedDays,
      elapsedHours: Math.round(elapsedMs / HOUR_MS),
      unassignedList,
      maxPriorityList,
      maxPriorities: project.maxPriorities || [],
      generatedAt: now,
      trends: {
        // Ouverts : stock actuel vs stock à la fin de la semaine précédente.
        open:
          openAtPrevWeekEnd == null
            ? { direction: "na", pct: null, good: null }
            : computeTrend([openAtPrevWeekEnd, openNow], threshold, false),
        // Fermés : fermetures de la semaine en cours vs semaine précédente.
        close:
          closedPrevSameElapsed == null
            ? { direction: "na", pct: null, good: null }
            : computeTrend(
                [closedPrevSameElapsed, closedThisWeek],
                threshold,
                true
              ),
        // Créations : semaine en cours vs même durée écoulée la semaine précédente.
        // Plus de créations = charge entrante accrue → higherIsBetter = false.
        created:
          createdPrevSameElapsed == null
            ? { direction: "na", pct: null, good: null }
            : computeTrend(
                [createdPrevSameElapsed, createdThisWeek],
                threshold,
                false
              ),
        // Temps moyen de résolution : plus court = mieux → higherIsBetter=false.
        resolution:
          avgResolutionPrevSameElapsed == null || avgResolutionHours == null
            ? { direction: "na", pct: null, good: null }
            : computeTrend(
                [avgResolutionPrevSameElapsed, avgResolutionHours],
                threshold,
                false
              ),
      },
      totalIssues: issues.length,
      jql,
    };
  }

  /* Orchestration : récupère les tickets et calcule tous les indicateurs.
   * client = JKDJira.makeClient(cfg)
   */
  async function analyzeProject(client, project, cfg, onProgress) {
    // Fenêtre pilotée par la date de démarrage du macrocycle (première semaine).
    const win = buildMacrocycleWeeks(cfg.macrocycleStart);
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
    // Date de bornage lead/cycle time = date de démarrage du macrocycle choisie
    // (repli sur la 1re semaine de la fenêtre si aucune date valide).
    const clampStart =
      parseMacroStartDate(cfg.macrocycleStart) || win.firstWeekStart;

    const windowEnd = weeks[n - 1].end; // borne exclusive (lundi suivant)
    const jql = buildJql(project, windowStart, windowEnd);

    // --- Story points (option par équipe) ---
    // Le champ est un customfield dont l'id varie selon le site JIRA : on prend
    // celui configuré, sinon on le détecte par son nom. Si on ne le trouve pas,
    // l'indicateur est simplement désactivé (aucune erreur bloquante).
    let spField = null;
    if (project.trackStoryPoints) {
      const configured = String(cfg.storyPointsField || "").trim();
      if (configured) {
        spField = configured;
      } else if (typeof client.findStoryPointsField === "function") {
        if (onProgress) onProgress("Détection du champ story points…");
        try {
          spField = await client.findStoryPointsField();
        } catch (e) {
          spField = null;
        }
      }
    }
    const fields = ["created", "resolutiondate", "summary", "status"];
    if (spField) fields.push(spField);

    if (onProgress) onProgress("Requête JIRA…");
    const issues = await fetchIssuesWithChangelog(client, jql, onProgress, fields);

    const throughput = new Array(n).fill(0);
    const storyPointsWeekly = new Array(n).fill(0);
    const spCounts = new Array(n).fill(0);
    const leadBuckets = Array.from({ length: n }, () => []);
    const cycleBuckets = Array.from({ length: n }, () => []);
    const details = [];

    for (const issue of issues) {
      const { created, startDate, doneDate, startApprox } = computeIssueDates(
        issue,
        project,
        clampStart
      );
      if (!doneDate) continue;
      const wi = weekIndexOf(doneDate, weeks);
      if (wi < 0) continue; // terminé hors fenêtre

      throughput[wi] += 1;
      // Story points livrés = somme des points des tickets terminés dans la
      // semaine (même rattachement hebdomadaire que le throughput réalisé).
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
      const leadDays = (doneDate - created) / DAY_MS;
      const cycleDays = (doneDate - startDate) / DAY_MS;
      if (leadDays >= 0) leadBuckets[wi].push(leadDays);
      if (cycleDays >= 0) cycleBuckets[wi].push(cycleDays);

      details.push({
        key: issue.key,
        summary: issue.fields.summary,
        week: weeks[wi].label,
        weekIndex: wi,
        doneDate,
        storyPoints: sp,
        leadDays,
        cycleDays,
        startApprox,
        url: `${client.baseUrl}/browse/${issue.key}`,
      });
    }

    const leadWeekly = leadBuckets.map((b) => aggregate(b, cfg.aggregate));
    const cycleWeekly = cycleBuckets.map((b) => aggregate(b, cfg.aggregate));

    // --- Signaux de flux ---
    const readySet = new Set(
      (project.readyStatuses || [])
        .map((s) => String(s).trim().toLowerCase())
        .filter(Boolean)
    );
    const backlogSet = new Set(
      (project.backlogStatuses || [])
        .map((s) => String(s).trim().toLowerCase())
        .filter(Boolean)
    );

    // 1) Throughput engagé = nombre de tickets EN statut Ready sur le créneau du
    //    LUNDI ENTRE MINUIT ET MIDI (00:00 -> 12:00). On considère qu'un ticket
    //    est engagé s'il a été en Ready à un instant quelconque de ce créneau :
    //    on reconstruit son statut à partir de son changelog.
    const slots = resolveSlots(cfg);
    const readySnapshot = new Array(n).fill(0);
    const snapJql = buildReadySnapshotJql(project, weeks[0].start, weeks[n - 1].end);
    if (snapJql) {
      if (onProgress) onProgress(`Snapshot board (${slots.engageLabel})…`);
      const snapIssues = await fetchIssuesWithChangelog(client, snapJql, onProgress);
      for (const issue of snapIssues) {
        const events = statusTransitions(issueHistories(issue));
        for (let wi = 0; wi < n; wi++) {
          // Bornes du créneau calculées en jours calendaires (cf. weekInstant).
          const start = weekInstant(weeks[wi].start, slots.engageFrom);
          const noon = weekInstant(weeks[wi].start, slots.engageTo);
          if (wasReadyDuring(issue, events, start, noon, readySet)) {
            readySnapshot[wi] += 1;
          }
        }
      }
    }

    // 2) Ajouts en Ready = tickets PLACÉS en statut Ready (depuis n'importe quel
    //    autre statut) ENTRE le lundi 12:00 et le vendredi fin de journée
    //    (= samedi 00:00).
    // 3) Retraits = tickets PLACÉS en statut Backlog / "To do" (depuis n'importe
    //    quel autre statut) sur LE MÊME CRÉNEAU lundi 12:00 → vendredi fin de
    //    journée.
    const readyAdded = new Array(n).fill(0);
    const backlogBack = new Array(n).fill(0);
    const churnJql = buildChurnJql(project, windowStart, windowEnd);
    if (churnJql) {
      if (onProgress) onProgress("Analyse Ready / Backlog…");
      const churnIssues = await fetchIssuesWithChangelog(client, churnJql, onProgress);
      for (const issue of churnIssues) {
        const events = statusTransitions(issueHistories(issue));
        for (const ev of events) {
          const wi = weekIndexOf(ev.at, weeks);
          if (wi < 0) continue;
          const to = ev.to ? ev.to.trim().toLowerCase() : "";
          const from = ev.from ? ev.from.trim().toLowerCase() : "";
          // Créneau commun : [lundi 12:00, samedi 00:00[ de la semaine concernée.
          // Bornes en jours calendaires (robustes au changement d'heure).
          const slotStart = weekInstant(weeks[wi].start, slots.churnFrom).getTime();
          const slotEnd = weekInstant(weeks[wi].start, slots.churnTo).getTime();
          const t = ev.at.getTime();
          const inSlot = t >= slotStart && t < slotEnd;
          if (!inSlot) continue;
          // Ajout : entrée en statut Ready depuis n'importe quel autre statut.
          if (readySet.size && readySet.has(to) && !readySet.has(from)) {
            readyAdded[wi] += 1;
          }
          // Retrait : entrée en statut Backlog / "To do" depuis un autre statut.
          if (backlogSet.size && backlogSet.has(to) && !backlogSet.has(from)) {
            backlogBack[wi] += 1;
          }
        }
      }
    }

    const thr = parseInt(cfg.stableThresholdPct, 10);
    const threshold = isNaN(thr) ? 10 : thr;

    // Les tendances comparent la SEMAINE EN COURS à la SEMAINE PRÉCÉDENTE.
    // La semaine en cours étant incomplète, la comparaison est à lire comme un
    // « où en est-on par rapport à la semaine dernière », pas comme un bilan.

    return {
      future: false,
      weeks,
      currentIndex: win.currentIndex,
      completeCount: win.completeCount,
      hasComparison: win.hasComparison,
      firstWeekStart: win.firstWeekStart,
      throughput,
      storyPointsWeekly,
      storyPointsCounts: spCounts,
      hasStoryPoints: !!spField,
      storyPointsField: spField,
      trackStoryPoints: !!project.trackStoryPoints,
      throughputEngage: readySnapshot,
      readyAdded,
      backlogReturned: backlogBack,
      hasEngage: !!snapJql,
      hasChurn: !!churnJql,
      engageLabel: slots.engageLabel,
      churnLabel: slots.churnLabel,
      leadWeekly,
      cycleWeekly,
      counts: leadBuckets.map((b) => b.length),
      trends: {
        // Comparaison SEMAINE EN COURS vs SEMAINE PRÉCÉDENTE (les deux dernières
        // entrées des séries hebdomadaires), et non plus deux semaines complètes.
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
      jql,
    };
  }

  global.JKDMetrics = {
    startOfWeek,
    buildWeeks,
    buildMacrocycleWeeks,
    parseMacroStartDate,
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
    buildRunJql,
    analyzeRunProject,
    buildChurnJql,
    buildReadySnapshotJql,
    statusAtTime,
    wasReadyDuring,
    computeIssueDates,
    analyzeProject,
    isoDate,
  };
})(typeof self !== "undefined" ? self : this);
