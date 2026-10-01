/* Kanban Flow — settings page */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  let projectRowSeq = 0;
  const durationState = new WeakMap();
  // Analysis-period controls live on the dashboard; Settings preserves their
  // choices and shared start date when saving other configuration.
  let periodPrefs = { buildPeriodMode: "recent", runPeriodMode: "recent" };
  let analysisStartDate = "";

  function parseList(str) {
    return String(str || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const WORKFLOW_CATEGORY_PICKERS = [
    [".p-backlog", ".p-backlog-box", "backlog", "Backlog"],
    [".p-waiting", ".p-waiting-box", "waiting", "Waiting"],
    [".p-wip", ".p-wip-box", "work in progress", "Work in progress"],
    [".p-done", ".p-done-box", "workflow end", "Workflow end"],
  ];
  const STATUS_FLOW_PICKERS = [
    [".p-status-flow-build", ".p-status-flow-build-box"],
    [".p-status-flow-run", ".p-status-flow-run-box"],
  ];
  const WORKFLOW_PICKERS = WORKFLOW_CATEGORY_PICKERS.map(([input, box]) => [input, box])
    .concat(STATUS_FLOW_PICKERS);
  const ISSUE_TYPE_PICKERS = [".p-types", ".p-lead-types", ".p-cycle-types"];

  function addProjectRow(project) {
    const tpl = $("projectTemplate");
    const node = tpl.content.firstElementChild.cloneNode(true);
    const p = project || {
      id: JKDStore.uuid(),
      name: "",
      key: "",
      mode: "build",
      trackStoryPoints: false,
      waitingStatuses: [],
      inProgressStatuses: [],
      doneStatuses: [],
      readyStatuses: [],
      backlogStatuses: [],
      issueTypes: [],
      leadTimeIssueTypes: [],
      leadTimeStartStatus: "",
      leadTimeFallbackEnabled: true,
      leadTimeStatuses: [], // legacy v1.37 status-inclusion filter
      cycleTimeIssueTypes: [],
      cycleTimeStartStatus: "",
      cycleTimeStatuses: [], // legacy v1.37 status-inclusion filter
      runLabels: [],
      maxPriorities: [],
      statusTimeFlow: { build: [], run: [] },
      extraJql: "",
    };
    node.dataset.id = p.id;

    // Template controls need unique label associations once cloned. Link each
    // field's direct label, control and help text without relying on position or
    // placeholder text (WCAG 1.3.1 / 3.3.2).
    const rowPrefix = `project-${++projectRowSeq}`;
    node.querySelectorAll(".field").forEach((field, fieldIndex) => {
      const children = Array.from(field.children);
      const label = children.find(
        (el) => el.tagName === "LABEL" && !el.classList.contains("inline")
      );
      const control = children.find(
        (el) => el.matches && el.matches("input:not([type=checkbox]):not([type=hidden]), select, textarea")
      );
      if (!label) return;
      const fieldId = `${rowPrefix}-field-${fieldIndex}`;
      const group = children.find((el) => el.classList && el.classList.contains("types-box"));
      if (control) {
        control.id = fieldId;
        label.htmlFor = control.id;
        const help = children.find((el) => el.tagName === "SMALL");
        if (help) {
          help.id = `${control.id}-help`;
          control.setAttribute("aria-describedby", help.id);
        }
      } else if (group) {
        label.id = `${fieldId}-label`;
        group.setAttribute("aria-labelledby", label.id);
        const help = children.find((el) => el.tagName === "SMALL");
        if (help) {
          help.id = `${fieldId}-help`;
          group.setAttribute("aria-describedby", help.id);
        }
      }
    });
    const nameInput = node.querySelector(".p-name");
    nameInput.id = `${rowPrefix}-name`;
    node.querySelector(".p-remove").setAttribute(
      "aria-label",
      `Remove team ${p.name || p.key || "entry"}`
    );

    nameInput.value = p.name || "";
    node.querySelector(".p-key").value = p.key || "";
    node.querySelector(".p-jql").value = p.extraJql || "";
    node.querySelector(".p-wip").value = (p.inProgressStatuses || []).join(", ");
    node.querySelector(".p-done").value = (p.doneStatuses || []).join(", ");
    node.querySelector(".p-waiting").value = (p.waitingStatuses || p.readyStatuses || []).join(", ");
    node.querySelector(".p-backlog").value = (p.backlogStatuses || []).join(", ");
    node.querySelector(".p-runlabels").value = (p.runLabels || []).join(", ");
    node.querySelector(".p-maxprio").value = (p.maxPriorities || []).join(", ");
    const statusTimeFlow = p.statusTimeFlow || {};
    node.querySelector(".p-status-flow-build").value = (statusTimeFlow.build || []).join(", ");
    node.querySelector(".p-status-flow-run").value = (statusTimeFlow.run || []).join(", ");
    node.querySelector(".p-storypoints").checked = !!p.trackStoryPoints;
    node.querySelector(".p-types").value = (p.issueTypes || []).join(", ");
    node.querySelector(".p-lead-types").value = (p.leadTimeIssueTypes || []).join(", ");
    node.querySelector(".p-lead-fallback").checked = p.leadTimeFallbackEnabled !== false;
    node.querySelector(".p-cycle-types").value = (p.cycleTimeIssueTypes || []).join(", ");
    node.dataset.initialLeadStartStatus = p.leadTimeStartStatus || "";
    node.dataset.initialCycleStartStatus = p.cycleTimeStartStatus || "";
    // Keep v1.37 status-inclusion filters available to the metrics legacy path
    // without exposing them in the new start-status UI.
    node.dataset.legacyLeadStatuses = (p.leadTimeStatuses || []).join(", ");
    node.dataset.legacyCycleStatuses = (p.cycleTimeStatuses || []).join(", ");
    const workflowRequested = !!(
      (p.waitingStatuses || p.readyStatuses || []).length || (p.inProgressStatuses || []).length ||
      (p.doneStatuses || []).length || (p.backlogStatuses || []).length ||
      (statusTimeFlow.build || []).length || (statusTimeFlow.run || []).length
    );
    durationState.set(node, {
      generation: 0,
      requested: !!(
        (p.issueTypes || []).length || (p.leadTimeIssueTypes || []).length ||
        (p.cycleTimeIssueTypes || []).length || p.leadTimeStartStatus || p.cycleTimeStartStatus
      ),
      workflowRequested,
      workflowLoaded: false,
      workflowError: "",
      projectKey: String(p.key || "").trim(),
      issueTypes: null,
      issueTypesRequest: null,
      statusGroups: null,
      statusGroupsRequest: null,
      timer: null,
      pendingMetrics: new Set(),
      lead: { dirty: false, loaded: false, groups: [], common: [], error: "" },
      cycle: { dirty: false, loaded: false, groups: [], common: [], error: "" },
    });
    wireIssueTypes(node);
    wireDurationFilters(node);
    wireWorkflowSettings(node);

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
        waitingStatuses: parseList(row.querySelector(".p-waiting").value),
        inProgressStatuses: parseList(row.querySelector(".p-wip").value),
        doneStatuses: parseList(row.querySelector(".p-done").value),
        issueTypes: parseList(row.querySelector(".p-types").value),
        leadTimeIssueTypes: parseList(row.querySelector(".p-lead-types").value),
        leadTimeStartStatus: (row.querySelector(".p-lead-start-status").value || row.dataset.initialLeadStartStatus || "").trim(),
        leadTimeFallbackEnabled: row.querySelector(".p-lead-fallback").checked,
        leadTimeStatuses: parseList(row.dataset.legacyLeadStatuses),
        cycleTimeIssueTypes: parseList(row.querySelector(".p-cycle-types").value),
        cycleTimeStartStatus: (row.querySelector(".p-cycle-start-status").value || row.dataset.initialCycleStartStatus || "").trim(),
        cycleTimeStatuses: parseList(row.dataset.legacyCycleStatuses),
        readyStatuses: mergeNames(
          parseList(row.querySelector(".p-waiting").value)
            .concat(parseList(row.querySelector(".p-wip").value), parseList(row.querySelector(".p-done").value))
        ),
        backlogStatuses: parseList(row.querySelector(".p-backlog").value),
        runLabels: parseList(row.querySelector(".p-runlabels").value),
        maxPriorities: parseList(row.querySelector(".p-maxprio").value),
        statusTimeFlow: {
          build: parseList(row.querySelector(".p-status-flow-build").value),
          run: parseList(row.querySelector(".p-status-flow-run").value),
        },
      });
    });
    return projects;
  }

  /* JIRA-backed choices are the sole source for issue-type and status lists.
   * Hidden inputs retain the existing storage shape; only checkboxes edit them. */
  let connectionRevision = 0;

  function choiceMessage(row, selector, text, kind) {
    const msg = row.querySelector(selector);
    if (!msg) return;
    const marker = selector.startsWith(".") ? ` ${selector.slice(1)}` : "";
    msg.className = `test-result choice-status${marker}${kind ? ` ${kind}` : ""}`;
    msg.textContent = text || "";
  }

  function mergeNames(values) {
    const seen = new Set();
    return values.filter((name) => {
      const text = String(name || "").trim();
      const key = text.toLowerCase();
      if (!text || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function categoryOwnerMap(row) {
    const owners = new Map();
    WORKFLOW_CATEGORY_PICKERS.forEach(([inputSelector, , categoryKey, categoryLabel]) => {
      parseList(row.querySelector(inputSelector).value).forEach((name) => {
        const key = normalizedName(name);
        if (key && !owners.has(key)) owners.set(key, { categoryKey, categoryLabel });
      });
    });
    return owners;
  }

  function normalizeWorkflowCategories(row) {
    const seen = new Set();
    const removed = [];
    WORKFLOW_CATEGORY_PICKERS.forEach(([inputSelector]) => {
      const input = row.querySelector(inputSelector);
      const kept = [];
      parseList(input.value).forEach((name) => {
        const key = normalizedName(name);
        if (!key || seen.has(key)) {
          if (key) removed.push(name);
          return;
        }
        seen.add(key);
        kept.push(name);
      });
      input.value = mergeNames(kept).join(", ");
    });
    return removed;
  }

  function setSelectionFromCatalog(input, catalogNames) {
    const byKey = new Map(catalogNames.map((name) => [normalizedName(name), name]));
    const selected = parseList(input.value);
    const kept = [];
    const removed = [];
    selected.forEach((name) => {
      const canonical = byKey.get(normalizedName(name));
      if (canonical) kept.push(canonical);
      else removed.push(name);
    });
    input.value = mergeNames(kept).join(", ");
    return removed;
  }

  function renderProjectPicker(row, inputSelector, boxSelector, names, options) {
    const input = row.querySelector(inputSelector);
    const box = row.querySelector(boxSelector);
    const opts = options || {};
    const selected = new Set(parseList(input.value).map(normalizedName));
    const owners = opts.categoryKey ? categoryOwnerMap(row) : new Map();
    box.replaceChildren();
    box.setAttribute("role", "group");

    if (opts.issueTypes) {
      const allLabel = document.createElement("label");
      allLabel.className = "picker-all";
      const allCheckbox = document.createElement("input");
      allCheckbox.type = "checkbox";
      allCheckbox.checked = selected.size === 0;
      allCheckbox.setAttribute("aria-label", "All issue types");
      allCheckbox.addEventListener("change", () => {
        if (allCheckbox.checked) {
          input.value = "";
        } else if (!box.querySelector('input[data-choice]:checked')) {
          allCheckbox.checked = true;
        }
        input.dispatchEvent(new Event("input", { bubbles: true }));
        renderProjectPicker(row, inputSelector, boxSelector, names, opts);
      });
      allLabel.append(allCheckbox, document.createTextNode("All project issue types"));
      box.appendChild(allLabel);
    }

    names.forEach((name) => {
      const key = normalizedName(name);
      const label = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = name;
      cb.dataset.choice = "true";
      cb.checked = selected.has(key);
      const owner = opts.categoryKey ? owners.get(key) : null;
      if (owner && owner.categoryKey !== opts.categoryKey) {
        cb.disabled = true;
        label.classList.add("choice-disabled");
        label.title = `Already assigned to ${owner.categoryLabel}.`;
      }
      cb.addEventListener("change", () => {
        const checked = new Set(Array.from(box.querySelectorAll('input[data-choice]:checked'))
          .map((el) => normalizedName(el.value)));
        let values;
        if (opts.ordered) {
          const previous = parseList(input.value);
          values = previous.filter((value) => checked.has(normalizedName(value)));
          names.forEach((value) => {
            const valueKey = normalizedName(value);
            if (checked.has(valueKey) && !values.some((item) => normalizedName(item) === valueKey)) {
              values.push(value);
            }
          });
        } else {
          values = names.filter((value) => checked.has(normalizedName(value)));
          if (opts.issueTypes && values.length === names.length) values = [];
        }
        input.value = mergeNames(values).join(", ");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        if (opts.categoryKey) {
          renderWorkflowPickers(row, names);
        } else {
          renderProjectPicker(row, inputSelector, boxSelector, names, opts);
        }
      });
      label.append(cb, document.createTextNode(name));
      box.appendChild(label);
    });
    box.classList.toggle("hidden", !names.length);
  }

  function renderTypeBox(row, names) {
    renderProjectPicker(row, ".p-types", ".p-types-box", names, { issueTypes: true });
  }

  function normalizedName(value) {
    return String(value || "").trim().toLowerCase();
  }

  function selectedStatusGroups(groups, input) {
    const selected = parseList(input.value).map(normalizedName);
    if (!selected.length) return groups.slice();
    const wanted = new Set(selected);
    return groups.filter((group) => wanted.has(normalizedName(group.issueTypeName)));
  }

  function commonStatuses(groups, input) {
    const selectedGroups = selectedStatusGroups(groups, input);
    if (!selectedGroups.length) return [];
    const first = selectedGroups[0].statuses || [];
    const rest = selectedGroups.slice(1).map((group) => new Set(
      (group.statuses || []).map((status) => normalizedName(status.name))
    ));
    return first.filter((status) => {
      const key = normalizedName(status.name);
      return key && rest.every((set) => set.has(key));
    });
  }

  function statusesForSelectedTypes(groups, input) {
    const selectedGroups = selectedStatusGroups(groups, input);
    return mergeNames(selectedGroups.flatMap((group) =>
      (group.statuses || []).map((status) => status.name)
    ));
  }

  function workflowHasSettings(row) {
    return WORKFLOW_PICKERS.some(([inputSelector]) =>
      parseList(row.querySelector(inputSelector).value).length > 0
    );
  }

  function renderWorkflowPickers(row, names) {
    normalizeWorkflowCategories(row);
    WORKFLOW_CATEGORY_PICKERS.forEach(([inputSelector, boxSelector, categoryKey]) => {
      renderProjectPicker(row, inputSelector, boxSelector, names, { categoryKey });
    });
    STATUS_FLOW_PICKERS.forEach(([inputSelector, boxSelector]) => {
      renderProjectPicker(row, inputSelector, boxSelector, names, { ordered: true });
    });
  }

  async function loadWorkflowChoices(row) {
    const state = durationState.get(row);
    state.workflowRequested = true;
    state.workflowError = "";
    const msg = ".p-workflow-status-msg";
    const key = row.querySelector(".p-key").value.trim();
    if (!key) {
      state.workflowLoaded = false;
      state.workflowError = "Enter this team's JIRA project key.";
      choiceMessage(row, msg, state.workflowError, "err");
      return false;
    }
    const types = await loadIssueTypes(row);
    if (!types) {
      state.workflowLoaded = false;
      state.workflowError = row.querySelector(".p-types-msg").textContent ||
        "Issue types could not be loaded. Check the JIRA connection and project key.";
      choiceMessage(row, msg, `Workflow statuses could not be loaded: ${state.workflowError}`, "err");
      return false;
    }
    try {
      const groups = await loadProjectStatusGroups(row);
      if (!groups) throw new Error("The project changed while statuses were loading.");
      const selectedTypes = row.querySelector(".p-types");
      const statuses = statusesForSelectedTypes(groups, selectedTypes);
      if (!statuses.length) {
        const selected = parseList(selectedTypes.value);
        throw new Error(selected.length
          ? `No workflow statuses were returned for the selected issue types: ${selected.join(", ")}.`
          : `No workflow statuses were returned for project ${key}.`);
      }
      state.workflowLoaded = true;
      state.workflowStatuses = statuses;
      const removed = WORKFLOW_PICKERS.flatMap(([inputSelector]) =>
        setSelectionFromCatalog(row.querySelector(inputSelector), statuses)
      );
      const duplicates = normalizeWorkflowCategories(row);
      renderWorkflowPickers(row, statuses);
      const selected = parseList(selectedTypes.value);
      const knownTypes = new Set(groups.map((group) => normalizedName(group.issueTypeName)));
      const unknownTypes = selected.filter((name) => !knownTypes.has(normalizedName(name)));
      state.workflowError = unknownTypes.length
        ? `Workflow status data is missing for issue type(s): ${unknownTypes.join(", ")}.`
        : "";
      if (state.workflowError) state.workflowLoaded = false;
      const warnings = [];
      if (removed.length) warnings.push(`Removed saved status(es) unavailable for the selected project issue types: ${mergeNames(removed).join(", ")}.`);
      if (duplicates.length) warnings.push(`Removed duplicate category assignment(s): ${mergeNames(duplicates).join(", ")}.`);
      choiceMessage(row, msg,
        state.workflowError || `${statuses.length} workflow status(es) loaded for ${key} and the selected issue types.${warnings.length ? ` ${warnings.join(" ")}` : ""}`,
        state.workflowError ? "err" : warnings.length ? "warn" : "ok");
      return !state.workflowError;
    } catch (error) {
      state.workflowLoaded = false;
      state.workflowError = error.message || "Workflow statuses could not be loaded.";
      choiceMessage(row, msg, `Workflow statuses could not be loaded: ${state.workflowError}`, "err");
      return false;
    }
  }

  function requestIsCurrent(row, state, generation, revision, key) {
    return document.contains(row) && state.generation === generation &&
      connectionRevision === revision && row.querySelector(".p-key").value.trim() === key;
  }

  function renderStartStatus(row, metric, statuses, options) {
    const select = row.querySelector(`.p-${metric}-start-status`);
    const state = durationState.get(row)[metric];
    const initialKey = metric === "lead" ? "initialLeadStartStatus" : "initialCycleStartStatus";
    const previous = select.value || row.dataset[initialKey] || "";
    const available = (statuses || []).filter((status) => status.categoryKey !== "done");
    select.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = (options && options.placeholder) ||
      (available.length ? "— Select a start status —" : "No common non-closing status");
    select.appendChild(placeholder);
    available.forEach((status) => {
      const option = document.createElement("option");
      option.value = status.name;
      option.textContent = status.name;
      select.appendChild(option);
    });
    const match = available.find((status) => normalizedName(status.name) === normalizedName(previous));
    select.value = match ? match.name : "";
    select.disabled = !available.length && !(options && options.allowEmpty);
    state.common = statuses || [];
    state.available = available;
    if (previous && !match && !(options && options.preserveSelection)) {
      row.dataset[initialKey] = "";
      // Keep this setting in the strict-validation path; do not silently revert
      // to the legacy calculation when a project/workflow no longer supports it.
      state.dirty = true;
    }
  }

  function metricHasSettings(row, metric) {
    const state = durationState.get(row)[metric];
    const initialKey = metric === "lead" ? "initialLeadStartStatus" : "initialCycleStartStatus";
    return !!(state.dirty || row.dataset[initialKey] ||
      row.querySelector(`.p-${metric}-start-status`).value ||
      parseList(row.querySelector(`.p-${metric}-types`).value).length);
  }

  function metricRequiresValidation(row, metric) {
    const state = durationState.get(row)[metric];
    const initialKey = metric === "lead" ? "initialLeadStartStatus" : "initialCycleStartStatus";
    return !!(state.dirty || row.dataset[initialKey] ||
      row.querySelector(`.p-${metric}-start-status`).value);
  }

  function invalidateProjectChoices(row) {
    const state = durationState.get(row);
    state.generation += 1;
    state.issueTypes = null;
    state.issueTypesRequest = null;
    state.statusGroups = null;
    state.statusGroupsRequest = null;
    state.pendingMetrics.clear();
    state.workflowLoaded = false;
    state.workflowError = "";
    state.workflowStatuses = [];
    row.querySelectorAll(".types-box").forEach((box) => {
      box.replaceChildren();
      box.classList.add("hidden");
    });
    ["lead", "cycle"].forEach((metric) => {
      const metricState = state[metric];
      metricState.loaded = false;
      metricState.groups = [];
      metricState.common = [];
      metricState.error = "";
      renderStartStatus(row, metric, [], {
        preserveSelection: true,
        allowEmpty: true,
        placeholder: "Choices will load automatically",
      });
      choiceMessage(row, `.p-${metric}-statuses-msg`, "", "");
    });
    choiceMessage(row, ".p-types-msg", "", "");
    choiceMessage(row, ".p-workflow-status-msg", "", "");
  }

  async function loadIssueTypes(row) {
    const state = durationState.get(row);
    const key = row.querySelector(".p-key").value.trim();
    const cfg = collectConfig();
    const revision = connectionRevision;
    const generation = state.generation;
    if (!key) {
      choiceMessage(row, ".p-types-msg", "Enter this team's JIRA project key to load available choices.", "err");
      return null;
    }
    if (!cfg.baseUrl || !cfg.email || !cfg.token) {
      choiceMessage(row, ".p-types-msg", "Add the JIRA site URL, e-mail and API token to load project choices.", "err");
      return null;
    }
    if (state.issueTypes && state.issueTypes.key === key && state.issueTypes.revision === revision) {
      return state.issueTypes.names;
    }
    if (state.issueTypesRequest && state.issueTypesRequest.key === key &&
        state.issueTypesRequest.revision === revision) return state.issueTypesRequest.promise;

    choiceMessage(row, ".p-types-msg", `Loading issue types for ${key}…`, "loading");
    const request = { key, revision, promise: null };
    request.promise = (async () => {
      try {
        const names = await JKDJira.makeClient(cfg).getIssueTypes(key);
        if (!requestIsCurrent(row, state, generation, revision, key)) return null;
        if (!names.length) throw new Error(`JIRA returned no issue types for project ${key}.`);
        state.issueTypes = { key, revision, names };
        const removed = ISSUE_TYPE_PICKERS.flatMap((selector) =>
          setSelectionFromCatalog(row.querySelector(selector), names)
        );
        renderTypeBox(row, names);
        renderProjectPicker(row, ".p-lead-types", ".p-lead-types-box", names, { issueTypes: true });
        renderProjectPicker(row, ".p-cycle-types", ".p-cycle-types-box", names, { issueTypes: true });
        const note = removed.length
          ? ` Removed saved selection(s) no longer available in this project: ${mergeNames(removed).join(", ")}.`
          : "";
        choiceMessage(row, ".p-types-msg", `${names.length} issue type(s) loaded for ${key}.${note}`, removed.length ? "warn" : "ok");
        return names;
      } catch (error) {
        if (requestIsCurrent(row, state, generation, revision, key)) {
          choiceMessage(row, ".p-types-msg", `Issue types could not be loaded: ${error.message || "check the JIRA connection and project key."}`, "err");
        }
        return null;
      } finally {
        if (state.issueTypesRequest === request) state.issueTypesRequest = null;
      }
    })();
    state.issueTypesRequest = request;
    return request.promise;
  }

  async function loadProjectStatusGroups(row) {
    const state = durationState.get(row);
    const key = row.querySelector(".p-key").value.trim();
    const cfg = collectConfig();
    const revision = connectionRevision;
    const generation = state.generation;
    if (state.statusGroups && state.statusGroups.key === key && state.statusGroups.revision === revision) {
      return state.statusGroups.groups;
    }
    if (state.statusGroupsRequest && state.statusGroupsRequest.key === key &&
        state.statusGroupsRequest.revision === revision) return state.statusGroupsRequest.promise;
    const request = { key, revision, promise: null };
    request.promise = (async () => {
      try {
        const groups = await JKDJira.makeClient(cfg).getProjectStatusGroups(key);
        if (!requestIsCurrent(row, state, generation, revision, key)) return null;
        if (!groups.length) throw new Error(`JIRA returned no workflow statuses for project ${key}.`);
        state.statusGroups = { key, revision, groups };
        return groups;
      } finally {
        if (state.statusGroupsRequest === request) state.statusGroupsRequest = null;
      }
    })();
    state.statusGroupsRequest = request;
    return request.promise;
  }

  async function loadCommonStatuses(row, metric) {
    const msgSelector = `.p-${metric}-statuses-msg`;
    const input = row.querySelector(`.p-${metric}-types`);
    const key = row.querySelector(".p-key").value.trim();
    const metricState = durationState.get(row)[metric];
    metricState.error = "";
    if (!key) {
      metricState.error = "Enter this team's JIRA project key.";
      choiceMessage(row, msgSelector, metricState.error, "err");
      return false;
    }
    const names = await loadIssueTypes(row);
    if (!names) {
      metricState.loaded = false;
      metricState.error = row.querySelector(".p-types-msg").textContent ||
        "Issue types could not be loaded automatically. Check the JIRA connection and project key.";
      choiceMessage(row, msgSelector, `Workflow choices not loaded: ${metricState.error}`, "err");
      return false;
    }
    choiceMessage(row, msgSelector, `Loading workflow statuses for ${key}…`, "loading");
    try {
      const groups = await loadProjectStatusGroups(row);
      if (!groups) throw new Error("The project changed while choices were loading.");
      const common = commonStatuses(groups, input);
      metricState.loaded = true;
      metricState.groups = groups;
      metricState.error = "";
      renderStartStatus(row, metric, common);
      const selected = parseList(input.value);
      const groupNames = new Set(groups.map((group) => normalizedName(group.issueTypeName)));
      const unknown = selected.filter((name) => !groupNames.has(normalizedName(name)));
      const available = common.filter((status) => status.categoryKey !== "done");
      const doneCount = common.filter((status) => status.categoryKey === "done").length;
      if (unknown.length) {
        choiceMessage(row, msgSelector, `Unknown issue type(s) for ${key}: ${unknown.join(", ")}.`, "err");
        return false;
      }
      if (!available.length) {
        choiceMessage(row, msgSelector,
          doneCount ? "No common non-closing status exists for the selected issue types." :
            "No common status exists for the selected issue types.", "err");
        return false;
      }
      choiceMessage(row, msgSelector,
        `${available.length} common start status(es) loaded${doneCount ? `; ${doneCount} Done status(es) are automatic end boundaries` : ""}.`, "ok");
      return true;
    } catch (error) {
      metricState.loaded = false;
      metricState.error = error.message || "Workflow statuses could not be loaded.";
      renderStartStatus(row, metric, [], {
        preserveSelection: true,
        allowEmpty: true,
        placeholder: "Unable to load statuses",
      });
      choiceMessage(row, msgSelector, `Workflow statuses could not be loaded: ${metricState.error}`, "err");
      return false;
    }
  }

  function scheduleChoiceLoad(row, metrics, delay) {
    const state = durationState.get(row);
    state.requested = true;
    (metrics || []).forEach((metric) => state.pendingMetrics.add(metric));
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(async () => {
      state.timer = null;
      const pendingMetrics = Array.from(state.pendingMetrics);
      state.pendingMetrics.clear();
      const names = await loadIssueTypes(row);
      if (!names) {
        const detail = row.querySelector(".p-types-msg").textContent ||
          "Check the JIRA connection and project key.";
        pendingMetrics.forEach((metric) => {
          const metricState = state[metric];
          metricState.loaded = false;
          metricState.error = detail;
          choiceMessage(row, `.p-${metric}-statuses-msg`, `Workflow choices not loaded: ${detail}`, "err");
        });
        if (state.workflowRequested || workflowHasSettings(row)) {
          state.workflowLoaded = false;
          state.workflowError = detail;
          choiceMessage(row, ".p-workflow-status-msg", `Workflow statuses not loaded: ${detail}`, "err");
        }
        return;
      }
      const tasks = pendingMetrics.map((metric) => loadCommonStatuses(row, metric));
      if (state.workflowRequested || workflowHasSettings(row)) tasks.push(loadWorkflowChoices(row));
      await Promise.all(tasks);
    }, delay == null ? 400 : delay);
  }

  function wireIssueTypes(row) {
    const state = durationState.get(row);
    const keyInput = row.querySelector(".p-key");
    keyInput.addEventListener("input", () => {
      const key = keyInput.value.trim();
      if (key !== state.projectKey) {
        const configuredMetrics = ["lead", "cycle"].filter((metric) => metricRequiresValidation(row, metric));
        state.projectKey = key;
        invalidateProjectChoices(row);
        configuredMetrics.forEach((metric) => { state[metric].dirty = true; });
      }
      state.workflowRequested = !!key;
      const activeMetrics = ["lead", "cycle"].filter((metric) => metricHasSettings(row, metric));
      scheduleChoiceLoad(row, activeMetrics, 500);
    });
    keyInput.addEventListener("blur", () => {
      if (keyInput.value.trim()) {
        state.workflowRequested = true;
        const activeMetrics = ["lead", "cycle"].filter((metric) => metricHasSettings(row, metric));
        scheduleChoiceLoad(row, activeMetrics, 0);
      }
    });
    row.querySelector(".p-types").addEventListener("input", () => {
      state.workflowRequested = true;
      scheduleChoiceLoad(row, [], 400);
    });
    ["lead", "cycle"].forEach((metric) => {
      row.querySelector(`.p-${metric}-types`).addEventListener("input", () => {
        scheduleChoiceLoad(row, [metric], 400);
      });
      row.querySelector(`.p-${metric}-start-status`).addEventListener("focus", () => {
        scheduleChoiceLoad(row, [metric], 0);
      });
    });
    if (keyInput.value.trim()) {
      state.workflowRequested = true;
      const activeMetrics = ["lead", "cycle"].filter((metric) => metricHasSettings(row, metric));
      scheduleChoiceLoad(row, activeMetrics, 0);
    }
  }

  function wireWorkflowSettings(row) {
    const state = durationState.get(row);
    WORKFLOW_PICKERS.forEach(([inputSelector]) => {
      const input = row.querySelector(inputSelector);
      input.addEventListener("input", () => {
        state.workflowRequested = true;
        scheduleChoiceLoad(row, [], 400);
      });
    });
  }

  function wireDurationFilters(row) {
    ["lead", "cycle"].forEach((metric) => {
      const input = row.querySelector(`.p-${metric}-types`);
      const select = row.querySelector(`.p-${metric}-start-status`);
      const state = durationState.get(row)[metric];
      input.addEventListener("input", () => {
        state.dirty = true;
        state.loaded = false;
        state.error = "";
        renderStartStatus(row, metric, [], {
          preserveSelection: true,
          allowEmpty: true,
          placeholder: "Updating common statuses…",
        });
        scheduleChoiceLoad(row, [metric], 400);
      });
      select.addEventListener("change", () => {
        state.dirty = true;
        row.dataset[`initial${metric === "lead" ? "Lead" : "Cycle"}StartStatus`] = select.value;
      });
      const fallback = row.querySelector(`.p-${metric}-fallback`);
      if (fallback) fallback.addEventListener("change", () => { state.dirty = true; });
    });
  }

  function handleConnectionChange() {
    connectionRevision += 1;
    const rows = Array.from($("projectList").querySelectorAll(".project"));
    rows.forEach((row) => {
      const state = durationState.get(row);
      if (!state) return;
      invalidateProjectChoices(row);
      const key = row.querySelector(".p-key").value.trim();
      const activeMetrics = ["lead", "cycle"].filter((metric) => metricHasSettings(row, metric));
      if (key) {
        state.workflowRequested = true;
        scheduleChoiceLoad(row, activeMetrics, 500);
      }
    });
  }

  async function ensureDurationChoices() {
    const rows = Array.from($("projectList").querySelectorAll('.project[data-mode="build"]'));
    await Promise.all(rows.flatMap((row) => ["lead", "cycle"]
      .filter((metric) => metricRequiresValidation(row, metric))
      .map((metric) => loadCommonStatuses(row, metric))));
  }

  async function ensureWorkflowChoices() {
    const rows = Array.from($("projectList").querySelectorAll(".project"));
    await Promise.all(rows
      .filter((row) => {
        const state = durationState.get(row);
        return state && (state.workflowRequested || workflowHasSettings(row));
      })
      .map((row) => loadWorkflowChoices(row)));
  }

  async function ensureIssueTypeChoices() {
    const rows = Array.from($("projectList").querySelectorAll(".project"));
    await Promise.all(rows.filter((row) => ISSUE_TYPE_PICKERS.some((selector) =>
      parseList(row.querySelector(selector).value).length
    )).map((row) => loadIssueTypes(row)));
  }

  function validateProjectChoices() {
    const errors = [];
    let firstControl = null;
    const rows = Array.from($("projectList").querySelectorAll(".project"));
    rows.forEach((row) => {
      const team = row.querySelector(".p-name").value.trim() || row.querySelector(".p-key").value.trim() || "team";
      const state = durationState.get(row);
      ISSUE_TYPE_PICKERS.forEach((selector) => {
        const input = row.querySelector(selector);
        const selected = parseList(input.value);
        if (!selected.length) return;
        const label = selector === ".p-types" ? "Project scope" : selector === ".p-lead-types" ? "Lead Time" : "Cycle Time";
        if (!state || !state.issueTypes) {
          errors.push(`${team} — ${label}: selected issue types could not be verified against JIRA. Check the connection and project key.`);
          firstControl = firstControl || row.querySelector(`${selector}-box input[type="checkbox"]`) || row.querySelector(".p-key");
          return;
        }
        const known = new Set(state.issueTypes.names.map(normalizedName));
        const unknown = selected.filter((name) => !known.has(normalizedName(name)));
        if (unknown.length) {
          errors.push(`${team} — ${label}: unavailable issue type(s): ${unknown.join(", ")}.`);
          firstControl = firstControl || row.querySelector(`${selector}-box input[type="checkbox"]`) || row.querySelector(".p-key");
        }
      });
      if (!workflowHasSettings(row)) return;
      if (!state || !state.workflowLoaded) {
        const detail = state && state.workflowError ? ` (${state.workflowError})` : ". Check the JIRA connection, project key and selected issue types.";
        errors.push(`${team} — Workflow status setup: selected statuses could not be verified from JIRA${detail}`);
        firstControl = firstControl || row.querySelector(".p-waiting-box input[type=checkbox]") || row.querySelector(".p-key");
        return;
      }
      const knownStatuses = new Set((state.workflowStatuses || []).map(normalizedName));
      WORKFLOW_PICKERS.forEach(([selector, boxSelector]) => {
        const selected = parseList(row.querySelector(selector).value);
        const unknown = selected.filter((name) => !knownStatuses.has(normalizedName(name)));
        if (unknown.length) {
          errors.push(`${team} — ${selector.includes("status-flow") ? "Status-time chart" : "Workflow status setup"}: unavailable status(es): ${unknown.join(", ")}.`);
          firstControl = firstControl || row.querySelector(`${boxSelector} input[type=checkbox]`) || row.querySelector(".p-key");
        }
      });
    });
    return { errors, firstControl };
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
    const thresholdText = $("threshold").value.trim();
    const thresholdValue = thresholdText === "" ? NaN : Number(thresholdText);
    return {
      baseUrl: JKDJira.normalizeBaseUrl($("baseUrl").value),
      email: $("email").value.trim(),
      token: $("token").value,
      startDate: analysisStartDate,
      buildPeriodMode: periodPrefs.buildPeriodMode,
      runPeriodMode: periodPrefs.runPeriodMode,
      aggregate: $("aggregate").value,
      stableThresholdPct: Number.isFinite(thresholdValue)
        ? Math.max(0, Math.min(100, Math.trunc(thresholdValue)))
        : 10,
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

  function validateDurationFilters() {
    const errors = [];
    let firstControl = null;
    const rows = Array.from($("projectList").querySelectorAll(".project"));
    rows.forEach((row) => {
      if (row.querySelector(".p-mode").value === "run") return;
      const team = row.querySelector(".p-name").value.trim() || row.querySelector(".p-key").value.trim() || "team";
      const state = durationState.get(row);
      ["lead", "cycle"].forEach((metric) => {
        const label = metric === "lead" ? "Lead Time" : "Cycle Time";
        const input = row.querySelector(`.p-${metric}-types`);
        const select = row.querySelector(`.p-${metric}-start-status`);
        const start = (select.value || row.dataset[`initial${metric === "lead" ? "Lead" : "Cycle"}StartStatus`] || "").trim();
        const active = metricRequiresValidation(row, metric);
        if (!active) return; // untouched legacy configuration: preserve its existing calculation
        if (!state || !state[metric].loaded) {
          const detail = state && state[metric] && state[metric].error;
          errors.push(`${team} — ${label}: JIRA choices could not be loaded automatically${detail ? ` (${detail})` : ". Check the connection, project key and project permissions."}`);
          firstControl = firstControl || (!row.querySelector(".p-key").value.trim()
            ? row.querySelector(".p-key") : $("baseUrl"));
          return;
        }
        const groups = state[metric].groups || [];
        const selected = parseList(input.value);
        const known = new Set(groups.map((group) => normalizedName(group.issueTypeName)));
        const unknown = selected.filter((name) => !known.has(normalizedName(name)));
        if (unknown.length) {
          errors.push(`${team} — ${label}: unknown issue type(s): ${unknown.join(", ")}.`);
          firstControl = firstControl || row.querySelector(`.p-${metric}-types-box input[type="checkbox"]`) || row.querySelector(".p-key");
          return;
        }
        const common = commonStatuses(groups, input);
        const available = common.filter((status) => status.categoryKey !== "done");
        if (!available.length) {
          errors.push(`${team} — ${label}: the selected issue types have no common non-closing status.`);
          firstControl = firstControl || row.querySelector(`.p-${metric}-types-box input[type="checkbox"]`) || row.querySelector(".p-key");
          return;
        }
        if (!start) {
          errors.push(`${team} — ${label}: select a common start status.`);
          firstControl = firstControl || select;
          return;
        }
        if (!available.some((status) => normalizedName(status.name) === normalizedName(start))) {
          errors.push(`${team} — ${label}: “${start}” is not common to the selected issue types.`);
          firstControl = firstControl || select;
        }
      });
    });
    return { errors, firstControl };
  }

  function validateSettings() {
    const checks = [validateProjectChoices(), validateDurationFilters()];
    return {
      errors: checks.flatMap((check) => check.errors),
      firstControl: checks.map((check) => check.firstControl).find(Boolean) || null,
    };
  }

  function showValidationErrors(validation, target) {
    if (!validation.errors.length) return false;
    const res = $(target || "saveResult");
    res.className = "test-result err save-error-list";
    res.setAttribute("role", "alert");
    res.setAttribute("aria-live", "assertive");
    res.replaceChildren();
    const heading = document.createElement("strong");
    heading.textContent = "Settings could not be saved. Resolve these issues:";
    const list = document.createElement("ul");
    validation.errors.forEach((message) => {
      const item = document.createElement("li");
      item.textContent = message;
      list.appendChild(item);
    });
    res.append(heading, list);
    if (validation.firstControl) {
      validation.firstControl.setAttribute("aria-invalid", "true");
      validation.firstControl.focus();
    }
    return true;
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
    document.querySelectorAll('[aria-invalid="true"]').forEach((control) => {
      control.removeAttribute("aria-invalid");
    });
    const res = $("saveResult");
    res.className = "test-result loading";
    res.setAttribute("role", "status");
    res.setAttribute("aria-live", "polite");
    res.textContent = "Checking required JIRA project choices…";
    res.setAttribute("aria-busy", "true");
    await Promise.all([ensureIssueTypeChoices(), ensureWorkflowChoices(), ensureDurationChoices()]);
    res.removeAttribute("aria-busy");
    const validation = validateSettings();
    if (showValidationErrors(validation)) return;
    try {
      const cfg = collectConfig();
      await JKDStore.saveConfig(cfg);
      res.className = "test-result ok";
      res.setAttribute("role", "status");
      res.setAttribute("aria-live", "polite");
      res.textContent = "✓ Saved.";
      setTimeout(() => {
        if (res.classList.contains("ok")) res.textContent = "";
      }, 2500);
    } catch (error) {
      res.className = "test-result err save-error-list";
      res.setAttribute("role", "alert");
      res.setAttribute("aria-live", "assertive");
      res.textContent = `Settings could not be saved: ${error.message || "browser storage is unavailable."}`;
    }
  }

  /* Fills the form from a config (init and import). */
  function applyConfig(cfg) {
    periodPrefs = {
      buildPeriodMode: cfg.buildPeriodMode === "complete" ? "complete" : "recent",
      runPeriodMode: cfg.runPeriodMode === "complete" ? "complete" : "recent",
    };
    $("baseUrl").value = cfg.baseUrl || "";
    $("email").value = cfg.email || "";
    $("token").value = cfg.token || "";
    analysisStartDate = cfg.startDate || cfg.macrocycleStart || "";
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
      await Promise.all([ensureIssueTypeChoices(), ensureWorkflowChoices(), ensureDurationChoices()]);
      const validation = validateSettings();
      if (validation.errors.length) {
        backupMsg(`Settings imported into the form but not saved: ${validation.errors.join("\n")}`, "err");
        if (validation.firstControl) validation.firstControl.focus();
        return;
      }
      await JKDStore.saveConfig(collectConfig());
      const suffix = warnings.length ? " — " + warnings.join(" ") : "";
      backupMsg(`✓ Settings imported and saved (${nb} team(s)).${suffix}`, "ok");
    } catch (e) {
      backupMsg(`✗ ${e.message || "Import failed."}`, "err");
    }
  }

  /* ---------- updates ---------- */

  const api = typeof browser !== "undefined" ? browser : chrome;
  let updateState = null;

  function updateMsg(text, cls) {
    const el = $("updateResult");
    el.textContent = text;
    el.className = "test-result " + (cls || "");
  }

  function renderUpdateState(state) {
    updateState = state || null;
    if (!state) return;
    $("currentVersion").textContent = state.current;
    if (state.htmlUrl) $("releasesLink").href = state.htmlUrl;
    if (state.installDocUrl) $("installDocLink").href = state.installDocUrl;

    const firefox = JKDUpdate.isFirefox();
    $("extensionsUrl").textContent = firefox ? "about:debugging#/runtime/this-firefox" : "chrome://extensions";
    $("reloadLabel").textContent = firefox ? "Reload" : "Reload \u21bb";
    $("stepUnzip").textContent = firefox
      ? "Keep the .xpi file where you can find it."
      : "Unzip it over your existing Kanban Flow folder, replacing the old files.";

    $("updateDotSection").classList.toggle("hidden", !state.updateAvailable);
    $("updatePanel").classList.toggle("hidden", !state.updateAvailable);

    if (state.updateAvailable) {
      updateMsg(`● Version ${state.latest} is available (installed ${state.current}).`, "");
    } else if (state.error) {
      updateMsg(`✗ ${state.error}`, "err");
    } else if (state.latest) {
      updateMsg(`✓ Up to date (latest release: ${state.latest}).`, "ok");
    } else {
      updateMsg("", "");
    }
  }

  // Single network path: ask the background worker so the toolbar badge is
  // refreshed at the same time. Falls back to an in-page check.
  async function requestUpdateState(force) {
    let state = null;
    try {
      const res = await api.runtime.sendMessage({ type: "jkd-update-check", force: !!force });
      if (res && res.ok) state = res.state;
    } catch (e) {
      /* no background listener */
    }
    if (!state) state = await JKDUpdate.checkForUpdate({ force: !!force });
    return state;
  }

  async function checkUpdate(force) {
    if (typeof JKDUpdate === "undefined") return;
    $("currentVersion").textContent = JKDUpdate.currentVersion();
    if (force) updateMsg("Checking\u2026", "");
    try {
      renderUpdateState(await requestUpdateState(force));
    } catch (e) {
      updateMsg(`✗ ${(e && e.message) || "Version check failed."}`, "err");
    }
  }

  // The browser forbids an extension from installing a package by itself, so
  // "Update now" downloads the right asset and reveals the manual steps.
  function startAssistedUpdate() {
    const state = updateState;
    if (!state) return;
    const url = state.downloadUrl || state.htmlUrl || state.releasesUrl;
    $("updateSteps").classList.remove("hidden");
    try {
      window.open(url, "_blank", "noopener");
    } catch (e) {
      updateMsg(`✗ Could not open ${url}`, "err");
      return;
    }
    updateMsg(
      state.downloadUrl
        ? `Downloading ${state.latest}\u2026 then follow the steps below.`
        : "Release page opened \u2014 download the package, then follow the steps below.",
      "ok"
    );
  }

  async function openExtensionsPage() {
    const url = $("extensionsUrl").textContent;
    try {
      await api.tabs.create({ url });
    } catch (e) {
      updateMsg(`✗ Copy this address into a new tab: ${url}`, "err");
    }
  }

  async function init() {
    const cfg = await JKDStore.loadConfig();
    applyConfig(cfg);

    $("addProjectBtn").addEventListener("click", () => addProjectRow());
    ["baseUrl", "email", "token"].forEach((id) => {
      $(id).addEventListener("input", handleConnectionChange);
    });
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
    $("checkUpdateBtn").addEventListener("click", () => checkUpdate(true));
    $("updateNowBtn").addEventListener("click", startAssistedUpdate);
    $("openExtensionsBtn").addEventListener("click", openExtensionsPage);

    checkUpdate(false);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
