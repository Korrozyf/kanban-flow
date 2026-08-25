/* Kanban Flow — JIRA Cloud REST API v3 client
 * Uses the modern /rest/api/3/search/jql endpoint (POST, nextPageToken).
 * Cross-origin requests go through thanks to the extension's host_permissions.
 */
(function (global) {
  "use strict";

  const TIMEOUT_MS = 20000;

  function normalizeBaseUrl(url) {
    return String(url || "").trim().replace(/\/+$/, "");
  }

  function authHeader(email, token) {
    // btoa handles ASCII; encodeURIComponent+unescape for any UTF-8 characters
    const raw = `${email}:${token}`;
    let b64;
    try {
      b64 = btoa(unescape(encodeURIComponent(raw)));
    } catch (e) {
      b64 = btoa(raw);
    }
    return "Basic " + b64;
  }

  async function fetchJson(url, opts) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, Object.assign({ signal: controller.signal }, opts));
      const text = await res.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch (e) {
        body = text;
      }
      if (!res.ok) {
        const msg =
          (body && body.errorMessages && body.errorMessages.join(" ")) ||
          (body && body.message) ||
          (typeof body === "string" ? body.slice(0, 300) : "") ||
          `HTTP ${res.status}`;
        const err = new Error(`JIRA ${res.status} — ${msg}`);
        err.status = res.status;
        throw err;
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  function makeClient(cfg) {
    const baseUrl = normalizeBaseUrl(cfg.baseUrl);
    const headers = {
      Authorization: authHeader(cfg.email, cfg.token),
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    async function testConnection() {
      const url = `${baseUrl}/rest/api/3/myself`;
      return fetchJson(url, { method: "GET", headers, credentials: "omit" });
    }

    // Paginated search via /search/jql (POST). Retrieves all results.
    async function searchAll(jql, fields, expand) {
      const url = `${baseUrl}/rest/api/3/search/jql`;
      let nextPageToken = undefined;
      const issues = [];
      let guard = 0;
      do {
        const payload = {
          jql,
          fields: fields || ["created", "resolutiondate", "summary", "status"],
          maxResults: 100,
        };
        if (expand) payload.expand = expand;
        if (nextPageToken) payload.nextPageToken = nextPageToken;

        const body = await fetchJson(url, {
          method: "POST",
          headers,
          credentials: "omit",
          body: JSON.stringify(payload),
        });
        if (body && Array.isArray(body.issues)) issues.push(...body.issues);
        nextPageToken = body && body.nextPageToken ? body.nextPageToken : undefined;
        guard += 1;
      } while (nextPageToken && guard < 100);
      return issues;
    }

    // Date of a ticket's FIRST comment (or null if none). Dedicated
    // endpoint, sorted by ascending date.
    async function getFirstCommentDate(issueKey) {
      const url = `${baseUrl}/rest/api/3/issue/${encodeURIComponent(
        issueKey
      )}/comment?maxResults=1&orderBy=created`;
      const body = await fetchJson(url, { method: "GET", headers, credentials: "omit" });
      const list = body && Array.isArray(body.comments) ? body.comments : [];
      if (!list.length || !list[0].created) return null;
      return new Date(list[0].created);
    }

    // Full changelog of a ticket (dedicated endpoint, paginated via startAt/maxResults).
    async function getChangelog(issueKey) {
      const values = [];
      let startAt = 0;
      const maxResults = 100;
      let total = Infinity;
      let guard = 0;
      while (startAt < total && guard < 100) {
        const url = `${baseUrl}/rest/api/3/issue/${encodeURIComponent(
          issueKey
        )}/changelog?startAt=${startAt}&maxResults=${maxResults}`;
        const body = await fetchJson(url, { method: "GET", headers, credentials: "omit" });
        if (body && Array.isArray(body.values)) values.push(...body.values);
        total = body && typeof body.total === "number" ? body.total : values.length;
        startAt += maxResults;
        guard += 1;
        if (!body || !Array.isArray(body.values) || body.values.length === 0) break;
      }
      return values; // [{ created, items: [{field, fromString, toString}] }]
    }

    // List of JIRA priorities, from HIGHEST to lowest (JIRA order).
    // Used to sort ticket lists by descending priority.
    async function getPriorities() {
      const url = `${baseUrl}/rest/api/3/priority`;
      const body = await fetchJson(url, { method: "GET", headers, credentials: "omit" });
      const list = Array.isArray(body) ? body : (body && body.values) || [];
      return list.map((p) => p.name).filter(Boolean);
    }

    // List of JIRA fields (system + custom).
    async function getFields() {
      const url = `${baseUrl}/rest/api/3/field`;
      const body = await fetchJson(url, { method: "GET", headers, credentials: "omit" });
      return Array.isArray(body) ? body : [];
    }

    // Id of the "story points" field. This is a custom field whose id varies
    // from one JIRA site to another (customfield_100xx), and whose name
    // differs between team-managed projects ("Story point estimate") and
    // company-managed projects ("Story Points"). Detected by name.
    async function findStoryPointsField() {
      const fields = await getFields();
      const norm = (s) => String(s || "").trim().toLowerCase();
      const wanted = [
        "story points",
        "story point estimate",
        "points de story",
        "story point",
      ];
      for (const w of wanted) {
        const hit = fields.find((f) => norm(f.name) === w);
        if (hit && hit.id) return hit.id;
      }
      const loose = fields.find((f) => /story\s*point/i.test(f.name || ""));
      return loose && loose.id ? loose.id : null;
    }

    return {
      baseUrl,
      testConnection,
      searchAll,
      getChangelog,
      getFirstCommentDate,
      getPriorities,
      getFields,
      findStoryPointsField,
    };
  }

  global.JKDJira = { makeClient, normalizeBaseUrl };
})(typeof self !== "undefined" ? self : this);
