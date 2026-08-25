/* Kanban Flow — logique du tableau de bord */
(function () {
  "use strict";
  const api = typeof browser !== "undefined" ? browser : chrome;
  const $ = (id) => document.getElementById(id);

  let cfg = null;
  // Dernier rendu affiché : sert à nommer et titrer l'image exportée.
  let lastRender = null;

  function setStatus(msg, kind) {
    const panel = $("statusPanel");
    const el = $("statusMessage");
    panel.classList.remove("hidden", "error", "loading");
    if (kind) panel.classList.add(kind);
    el.textContent = msg;
    panel.classList.remove("hidden");
  }
  function hideStatus() {
    $("statusPanel").classList.add("hidden");
  }

  function fmtDays(v) {
    return v == null || isNaN(v) ? "–" : v.toFixed(1);
  }

  // Story points : entier si possible (5), sinon 1 décimale (2.5).
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
      label = trend.direction === "up" ? "hausse" : "baisse";
      if (trend.good === true) el.classList.add("good");
      else if (trend.good === false) el.classList.add("bad");
    }
    let pctTxt = "";
    if (trend.pct != null && !isNaN(trend.pct)) {
      pctTxt = ` ${trend.pct > 0 ? "+" : ""}${trend.pct.toFixed(0)}%`;
    }
    el.textContent = `${arrow} ${label}${pctTxt}`;
    el.title =
      "Tendance calculée sur les 2 dernières semaines COMPLÈTES " +
      "(la semaine en cours, incomplète, est exclue de la comparaison). " +
      "Vert = amélioration, rouge = dégradation, bleu = stable.";
  }

  function populateProjects() {
    const sel = $("projectSelect");
    sel.innerHTML = '<option value="">— Choisir une équipe —</option>';
    (cfg.projects || []).forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.name} (${p.key})`;
      sel.appendChild(opt);
    });
  }

  // Bandeau d'information sur la fenêtre analysée / la base de comparaison.
  function renderComparisonNote(r) {
    const info = $("comparisonNote");
    if (!r.hasComparison) {
      info.classList.remove("hidden");
      info.textContent =
        "ℹ La date de démarrage du macrocycle correspond à la semaine en cours : " +
        "aucune semaine précédente, donc pas de comparaison de tendance.";
    } else {
      info.classList.add("hidden");
      info.textContent = "";
    }
  }

  function showView(mode) {
    $("buildView").classList.toggle("hidden", mode === "run");
    $("runView").classList.toggle("hidden", mode !== "run");
  }

  function renderResult(project, r) {
    hideStatus();
    $("dashboard").classList.remove("hidden");
    showView("build");

    const last = (arr) => arr[arr.length - 1];
    const aggLabel = r.aggregate === "average" ? "(moyenne)" : "(médiane)";
    $("leadAggLabel").textContent = aggLabel;
    $("cycleAggLabel").textContent = aggLabel;

    renderComparisonNote(r);

    // Cartes
    const curLabel = last(r.weeks).label;
    $("thrValue").textContent = last(r.throughput);
    $("thrNote").textContent = `tickets terminés — semaine en cours du ${curLabel} (incomplète)`;
    $("engageValue").textContent = r.hasEngage ? last(r.throughputEngage) : "–";
    $("engageNote").textContent = r.hasEngage
      ? `tickets sur le board (${r.engageLabel}) — semaine du ${curLabel}`
      : "Définissez les statuts du board de l'équipe (⚙ Configuration).";
    // Story points (option par équipe) : carte + graphique + colonne masqués
    // tant que l'option n'est pas activée / le champ JIRA introuvable.
    const spOn = !!r.hasStoryPoints;
    $("spCard").classList.toggle("hidden", !spOn);
    $("spChartPanel").classList.toggle("hidden", !spOn);
    document
      .querySelectorAll("#detailTable .sp-col")
      .forEach((th) => th.classList.toggle("hidden", !spOn));
    if (spOn) {
      $("spValue").textContent = fmtPoints(last(r.storyPointsWeekly));
      $("spNote").textContent =
        `points livrés sur ${last(r.storyPointsCounts)} ticket(s) estimé(s) — ` +
        `semaine en cours du ${curLabel} (incomplète)`;
      trendBadge("spTrend", r.trends.storyPoints);
    } else if (r.trackStoryPoints) {
      // Option activée mais champ introuvable : on le signale sans bloquer.
      $("spCard").classList.remove("hidden");
      $("spValue").textContent = "–";
      $("spNote").textContent =
        "Champ story points introuvable sur ce site JIRA — précisez-le dans ⚙ Configuration.";
      trendBadge("spTrend", { direction: "na", pct: null, good: null });
    }

    $("leadValue").textContent = fmtDays(last(r.leadWeekly));
    $("cycleValue").textContent = fmtDays(last(r.cycleWeekly));

    if ($("engageLegend")) {
      $("engageLegend").textContent = r.engageLabel
        ? `Engagé (board ${r.engageLabel})`
        : "Engagé";
    }

    trendBadge("thrTrend", r.trends.throughput);
    trendBadge("engageTrend", r.hasEngage ? r.trends.engage : { direction: "na", pct: null, good: null });
    trendBadge("leadTrend", r.trends.lead);
    trendBadge("cycleTrend", r.trends.cycle);

    const labels = r.weeks.map((w) => w.label);
    // Throughput engagé + réalisé sur un même graphique (barres groupées).
    const series = [];
    if (r.hasEngage) {
      series.push({
        values: r.throughputEngage,
        className: "bar-engage",
        currentClassName: "bar-engage-current",
      });
    }
    series.push({
      values: r.throughput,
      className: "bar-done",
      currentClassName: "bar-done-current",
    });
    JKDCharts.groupedBarChart($("throughputChart"), {
      labels,
      series,
      currentIndex: r.currentIndex,
    });
    renderSignals(r);
    if (spOn) {
      JKDCharts.groupedBarChart($("spChart"), {
        labels,
        series: [
          {
            values: r.storyPointsWeekly,
            className: "bar-done",
            currentClassName: "bar-done-current",
          },
        ],
        currentIndex: r.currentIndex,
      });
    }
    JKDCharts.lineChart($("leadChart"), {
      labels,
      values: r.leadWeekly,
      currentIndex: r.currentIndex,
    });
    JKDCharts.lineChart($("cycleChart"), {
      labels,
      values: r.cycleWeekly,
      currentIndex: r.currentIndex,
    });

    // Table détail — uniquement les tickets terminés dans la SEMAINE EN COURS.
    const tbody = $("detailTable").querySelector("tbody");
    tbody.innerHTML = "";
    const curDetails = r.details.filter((d) => d.weekIndex === r.currentIndex);
    curDetails.forEach((d) => {
      const tr = document.createElement("tr");
      const doneStr = d.doneDate.toLocaleDateString("fr-FR");
      tr.innerHTML =
        `<td><a href="${d.url}" target="_blank" rel="noopener">${d.key}</a></td>` +
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
      `${project.name} • ${r.totalIssues} tickets analysés • ` +
      `mis à jour ${new Date().toLocaleString("fr-FR")}` +
      (r.details.some((d) => d.startApprox)
        ? " • * cycle time approximé (aucune entrée en statut « en cours »)"
        : "");
  }

  function fmtDate(d) {
    return d ? d.toLocaleDateString("fr-FR") : "–";
  }
  function fmtDuration(hours) {
    if (hours == null || isNaN(hours)) return "–";
    if (hours < 24) return `${hours.toFixed(1)} h`;
    return `${(hours / 24).toFixed(1)} j`;
  }
  // Seuils communs à toutes les durées affichées (listes + cartes) :
  // vert ≤ 1 j, ambre 1–2 j, rouge > 2 j.
  function ageInfo(hours) {
    if (hours == null || isNaN(hours)) return null;
    const d = hours / 24;
    if (d <= 1) return { cls: "age-ok", label: "Moins de 1 jour" };
    if (d <= 2) return { cls: "age-warn", label: "Entre 1 et 2 jours" };
    return { cls: "age-bad", label: "Plus de 2 jours" };
  }
  // Seuils du cycle time (mode build), en jours :
  // vert ≤ 2 j, ambre 2–4 j, rouge > 4 j. Mêmes couleurs que le mode run.
  function cycleInfo(days) {
    if (days == null || isNaN(days)) return null;
    if (days <= 2) return { cls: "age-ok", label: "Moins de 2 jours" };
    if (days <= 4) return { cls: "age-warn", label: "Entre 2 et 4 jours" };
    return { cls: "age-bad", label: "Plus de 4 jours" };
  }
  // Cellule de durée avec pastille + infobulle (encodage redondant).
  function durationCell(text, info) {
    if (!info) return `<td>${text}</td>`;
    return (
      `<td class="age ${info.cls}" title="${info.label}">` +
      `<span class="age-dot" aria-hidden="true"></span>${text}</td>`
    );
  }

  function renderRunResult(project, r) {
    hideStatus();
    $("dashboard").classList.remove("hidden");
    showView("run");
    renderComparisonNote(r);

    const last = (arr) => arr[arr.length - 1];
    const curLabel = last(r.weeks).label;

    // Cartes
    $("runOpenValue").textContent = r.openNow;
    $("runOpenNote").textContent =
      r.openAtPrevWeekEnd == null
        ? "non résolus à ce jour — pas de semaine précédente pour comparer"
        : `non résolus à ce jour — vs ${r.openAtPrevWeekEnd} encore ouvert(s) à la fin de la semaine précédente`;
    $("runCloseValue").textContent = r.closedThisWeek;
    $("runCloseNote").textContent =
      r.closedPrevSameElapsed == null
        ? `fermés dans la semaine du ${curLabel} — pas de semaine précédente pour comparer`
        : `fermés dans la semaine du ${curLabel} — vs ${r.closedPrevSameElapsed} sur la même période ` +
          `de la semaine précédente (${r.elapsedHours} h écoulées)` +
          (r.closedPrevWeek == null
            ? ""
            : ` — ${r.closedPrevWeek} sur la semaine précédente entière`);
    $("runCreatedValue").textContent = r.createdThisWeek;
    $("runCreatedNote").textContent =
      r.createdPrevSameElapsed == null
        ? `créés dans la semaine du ${curLabel} — pas de semaine précédente pour comparer`
        : `créés dans la semaine du ${curLabel} — vs ${r.createdPrevSameElapsed} sur la même période ` +
          `de la semaine précédente (${r.elapsedHours} h écoulées)` +
          (r.createdPrevWeek == null
            ? ""
            : ` — ${r.createdPrevWeek} sur la semaine précédente entière`);

    // Temps moyen de résolution des tickets fermés cette semaine. Même code
    // couleur que les colonnes de durée des listes : pastille + infobulle, le
    // texte gardant le contraste normal (jamais d'information par la seule
    // couleur).
    const resolEl = $("runResolValue");
    const resolInfo = ageInfo(r.avgResolutionHours);
    resolEl.className = "metric" + (resolInfo ? ` age ${resolInfo.cls}` : "");
    resolEl.title = resolInfo ? resolInfo.label : "";
    resolEl.innerHTML = resolInfo
      ? `<span class="age-dot" aria-hidden="true"></span>${fmtDuration(r.avgResolutionHours)}`
      : "–";
    $("runResolNote").textContent =
      r.avgResolutionCount === 0
        ? `aucun ticket fermé dans la semaine du ${curLabel}`
        : `moyenne création → fermeture sur ${r.avgResolutionCount} ticket(s) fermé(s) ` +
          `dans la semaine du ${curLabel}` +
          (r.avgResolutionPrevSameElapsed == null
            ? " — pas de semaine précédente pour comparer"
            : ` — vs ${fmtDuration(r.avgResolutionPrevSameElapsed)} sur la même période ` +
              `de la semaine précédente (${r.elapsedHours} h écoulées)`);

    trendBadge("runOpenTrend", r.trends.open);
    trendBadge("runCloseTrend", r.trends.close);
    trendBadge("runCreatedTrend", r.trends.created);
    trendBadge("runResolTrend", r.trends.resolution);

    const labels = r.weeks.map((w) => w.label);
    // Ouverts (créés) et fermés sur un même graphique, semaine par semaine.
    JKDCharts.groupedBarChart($("runFlowChart"), {
      labels,
      series: [
        { values: r.openCount, className: "bar-open", currentClassName: "bar-open-current" },
        { values: r.closeCount, className: "bar-closed", currentClassName: "bar-closed-current" },
      ],
      currentIndex: r.currentIndex,
    });
    // Créations par jour de la semaine : semaine en cours vs semaine précédente.
    // Les jours ouvrés (lun→ven) sont toujours affichés ; samedi et dimanche
    // n'apparaissent que s'ils portent au moins une création (semaine en cours
    // ou semaine précédente).
    const dayNames = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];
    const dayIdx = [0, 1, 2, 3, 4];
    [5, 6].forEach((d) => {
      const cur = r.createdPerDayCurrent[d] || 0;
      const prev = r.createdPerDayPrev ? r.createdPerDayPrev[d] || 0 : 0;
      if (cur > 0 || prev > 0) dayIdx.push(d);
    });
    const pickDays = (arr) => dayIdx.map((d) => arr[d] || 0);
    const daySeries = [];
    if (r.createdPerDayPrev) {
      daySeries.push({ values: pickDays(r.createdPerDayPrev), className: "bar-open" });
    }
    daySeries.push({
      values: pickDays(r.createdPerDayCurrent),
      className: "bar-done-current",
    });
    JKDCharts.groupedBarChart($("runDailyChart"), {
      labels: dayIdx.map((d) => dayNames[d]),
      series: daySeries,
      currentIndex: -1,
    });
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    $("runDailyNote").textContent = r.createdPerDayPrev
      ? `${sum(r.createdPerDayCurrent)} ticket(s) créé(s) cette semaine (${r.elapsedDays} jour(s) écoulé(s)) ` +
        `vs ${sum(r.createdPerDayPrev)} sur toute la semaine précédente.`
      : `${sum(r.createdPerDayCurrent)} ticket(s) créé(s) cette semaine — pas de semaine précédente pour comparer.`;

    // Table ouverts
    const openBody = $("runOpenTable").querySelector("tbody");
    openBody.innerHTML = "";
    // Compteurs d'ancienneté colorés : vert < 1 j, orange 1–2 j, rouge > 2 j.
    // Pastille de couleur + infobulle : l'information n'est jamais portée par
    // la seule couleur, et le texte garde le contraste normal du tableau.
    const ageCell = (hours) => {
      const info = ageInfo(hours);
      if (!info) return `<td>–</td>`;
      const { cls, label } = info;
      return (
        `<td class="age ${cls}" title="${label}">` +
        `<span class="age-dot" aria-hidden="true"></span>${fmtDuration(hours)}` +
        `</td>`
      );
    };
    // Même constitution/mise en forme pour la liste board et la liste backlog.
    const openRow = (t) =>
      `<td><a href="${t.url}" target="_blank" rel="noopener">${t.key}</a></td>` +
      `<td>${escapeHtml(t.summary)}</td>` +
      `<td>${escapeHtml(t.status || "")}</td>` +
      `<td>${escapeHtml(t.priority || "–")}</td>` +
      `<td>${escapeHtml(t.assignee || "— non assigné")}</td>` +
      `<td>${fmtDate(t.created)}</td>` +
      ageCell(t.hoursSinceCreated) +
      ageCell(t.hoursSinceUpdated);
    r.openList.forEach((t) => {
      const tr = document.createElement("tr");
      tr.innerHTML = openRow(t);
      openBody.appendChild(tr);
    });
    $("runOpenCount").textContent = r.openList.length;

    // Table ouverts non planifiés (statuts backlog du run)
    const backlogBody = $("runBacklogTable").querySelector("tbody");
    backlogBody.innerHTML = "";
    (r.backlogList || []).forEach((t) => {
      const tr = document.createElement("tr");
      tr.innerHTML = openRow(t);
      backlogBody.appendChild(tr);
    });
    $("runBacklogCount").textContent = (r.backlogList || []).length;

    // Table fermés (stat équivalente aux ouverts)
    const closedBody = $("runClosedTable").querySelector("tbody");
    closedBody.innerHTML = "";
    r.closedList.forEach((t) => {
      const tr = document.createElement("tr");
      // Date de fermeture = entrée dans le statut de fermeture (changelog) ou
      // date de résolution ; le suffixe ~ signale une date approximée.
      const closedTxt = t.closedAt
        ? fmtDate(t.closedAt) + (t.closedAtApprox ? " ~" : "")
        : "–";
      tr.innerHTML =
        `<td><a href="${t.url}" target="_blank" rel="noopener">${t.key}</a></td>` +
        `<td>${escapeHtml(t.summary)}</td>` +
        `<td>${escapeHtml(t.status || "")}</td>` +
        `<td>${escapeHtml(t.priority || "–")}</td>` +
        `<td>${escapeHtml(t.assignee || "— non assigné")}</td>` +
        `<td>${fmtDate(t.created)}</td>` +
        `<td>${closedTxt}</td>` +
        ageCell(t.hoursOpenToClosed);
      closedBody.appendChild(tr);
    });
    $("runCloseListCount").textContent = r.closedList.length;

    // Table non assignés
    const unBody = $("runUnassignedTable").querySelector("tbody");
    unBody.innerHTML = "";
    r.unassignedList.forEach((t) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td><a href="${t.url}" target="_blank" rel="noopener">${t.key}</a></td>` +
        `<td>${escapeHtml(t.summary)}</td>` +
        `<td>${escapeHtml(t.status || "")}</td>` +
        `<td>${escapeHtml(t.priority || "–")}</td>` +
        `<td>${fmtDate(t.created)}</td>`;
      unBody.appendChild(tr);
    });
    $("runUnassignedCount").textContent = r.unassignedList.length;

    // Table priorité max
    const mpBody = $("runMaxPrioTable").querySelector("tbody");
    mpBody.innerHTML = "";
    r.maxPriorityList.forEach((t) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td><a href="${t.url}" target="_blank" rel="noopener">${t.key}</a></td>` +
        `<td>${escapeHtml(t.summary)}</td>` +
        `<td>${escapeHtml(t.priority || "–")}</td>` +
        `<td>${fmtDate(t.created)}</td>` +
        ageCell(t.hoursToFirstComment) +
        (t.resolved ? ageCell(t.hoursToResolution) : `<td>non résolu</td>`);
      mpBody.appendChild(tr);
    });
    $("runMaxPrioCount").textContent = r.maxPriorityList.length;

    $("runJqlText").textContent = r.jql;
    $("footerInfo").textContent =
      `${project.name} • run • ${r.totalIssues} tickets analysés • ` +
      `mis à jour ${new Date().toLocaleString("fr-FR")}`;
  }

  function renderSignals(r) {
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
    head("sigAddedHead", "Ajoutés au board");
    head("sigBackHead", "Remis en backlog");
    const cell = (v) =>
      v > 0
        ? `<td class="sig-warn">⚠ ${v}</td>`
        : `<td class="sig-zero">0</td>`;
    r.weeks.forEach((w, i) => {
      const tr = document.createElement("tr");
      if (i === r.currentIndex) tr.className = "row-current";
      const wl = w.current ? `${w.label} (en cours)` : w.label;
      tr.innerHTML =
        `<td>${wl}</td>` + cell(r.readyAdded[i]) + cell(r.backlogReturned[i]);
      tbody.appendChild(tr);
    });
    // Synthèse de la semaine en cours (réponses à « y a-t-il eu, combien »).
    const ci = r.currentIndex;
    const added = r.readyAdded[ci];
    const back = r.backlogReturned[ci];
    const parts = [];
    parts.push(
      added > 0
        ? `<span class="badge warn">⚠ ${added} ticket(s) placé(s) sur le board (${r.churnLabel}) cette semaine</span>`
        : `<span class="badge">Aucun ticket placé sur le board (${r.churnLabel}) cette semaine</span>`
    );
    parts.push(
      back > 0
        ? `<span class="badge warn">⚠ ${back} ticket(s) remis en backlog (${r.churnLabel}) cette semaine</span>`
        : `<span class="badge">Aucune remise en backlog (${r.churnLabel}) cette semaine</span>`
    );
    note.innerHTML = parts.join(" ");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }

  // --- Export de la page complète d'indicateurs en image ---------------------

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
    btn.textContent = "… Capture";

    // En-tête visible seulement dans l'image : équipe, mode, date de génération.
    const header = $("exportHeader");
    $("exportTitle").textContent = `Kanban Flow — ${lastRender.project.name}`;
    $("exportSubtitle").textContent =
      `Mode ${lastRender.mode === "run" ? "run" : "build"} • ` +
      `${lastRender.weeksLabel} • généré le ${new Date().toLocaleString("fr-FR")}`;
    header.classList.remove("hidden");

    try {
      const res = await JKDExport.exportNode($("dashboard"), {
        format,
        name: lastRender.project.name,
      });
      const ko = Math.round(res.bytes / 1024);
      setStatus(
        `Image enregistrée : ${res.fileName} (${res.width}×${res.height} px, ${ko} Ko).`
      );
      setTimeout(hideStatus, 6000);
    } catch (e) {
      console.error(e);
      setStatus(`Échec de l'export image : ${e.message}`, "error");
    } finally {
      header.classList.add("hidden");
      btn.textContent = prevLabel;
      btn.disabled = false;
    }
  }

  async function runAnalysis() {
    const id = $("projectSelect").value;
    if (!id) {
      $("dashboard").classList.add("hidden");
      setExportEnabled(false);
      lastRender = null;
      setStatus("Sélectionnez une équipe pour afficher ses indicateurs de flux.");
      return;
    }
    const project = (cfg.projects || []).find((p) => p.id === id);
    if (!project) return;

    if (!cfg.baseUrl || !cfg.email || !cfg.token) {
      setStatus(
        "Configuration incomplète : renseignez l'URL JIRA, l'e-mail et le jeton API dans ⚙ Configuration.",
        "error"
      );
      return;
    }

    $("dashboard").classList.add("hidden");
    setExportEnabled(false);
    lastRender = null;
    setStatus(`Chargement des données pour « ${project.name} »…`, "loading");

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
        const d = r.firstWeekStart.toLocaleDateString("fr-FR");
        setStatus(
          `La date de démarrage du macrocycle (semaine du ${d}) est dans le futur ` +
            "par rapport à la semaine en cours. Aucune donnée à afficher : " +
            "choisissez une date égale ou antérieure à la semaine en cours dans ⚙ Configuration.",
          "error"
        );
        return;
      }
      if (isRun) renderRunResult(project, r);
      else renderResult(project, r);
      const w = r.weeks || [];
      lastRender = {
        project,
        mode: isRun ? "run" : "build",
        weeksLabel: w.length
          ? `semaines du ${w[0].label} au ${w[w.length - 1].label}`
          : "",
      };
      setExportEnabled(true);
    } catch (e) {
      console.error(e);
      let hint = "";
      if (e.status === 401 || e.status === 403) {
        hint = " Vérifiez l'e-mail et le jeton API (Configuration).";
      } else if (e.status === 400) {
        hint = " La requête JQL est peut-être invalide (statuts ou clé projet).";
      } else if (e.status === 404) {
        hint = " URL JIRA ou clé projet introuvable.";
      }
      setStatus(`Erreur : ${e.message}.${hint}`, "error");
    }
  }

  async function init() {
    cfg = await JKDStore.loadConfig();
    populateProjects();

    if (!cfg.baseUrl || !cfg.email || !cfg.token) {
      setStatus(
        "Bienvenue ! Commencez par configurer votre connexion JIRA et vos équipes dans ⚙ Configuration.",
        "error"
      );
    } else if (!cfg.projects || cfg.projects.length === 0) {
      setStatus(
        "Aucune équipe configurée. Ajoutez vos projets dans ⚙ Configuration.",
        "error"
      );
    }

    $("projectSelect").addEventListener("change", runAnalysis);
    $("refreshBtn").addEventListener("click", async () => {
      cfg = await JKDStore.loadConfig();
      runAnalysis();
    });
    $("exportBtn").addEventListener("click", exportImage);
    $("optionsBtn").addEventListener("click", () => api.runtime.openOptionsPage());
  }

  document.addEventListener("DOMContentLoaded", init);
})();
