/* Kanban Flow — update checker
 *
 * Compares the installed version (manifest) with the latest GitHub release and
 * caches the result in chrome.storage.local. No credentials are ever sent: the
 * GitHub REST endpoint is public and called with `credentials: "omit"`.
 *
 * The result is deliberately cached, because the anonymous GitHub API is rate
 * limited (60 requests/hour/IP): a background check runs at browser startup and
 * pages reuse the cached answer unless it is older than CACHE_TTL_MS.
 */
(function (global) {
  "use strict";
  const api = typeof browser !== "undefined" ? browser : chrome;

  const REPO = "Korrozyf/kanban-flow";
  const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
  const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;
  const INSTALL_DOC_URL = `https://github.com/${REPO}/blob/main/docs/INSTALLATION.md`;
  const CACHE_KEY = "jkd_update";
  const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
  const REQUEST_TIMEOUT_MS = 10000;

  /* ---------- version helpers ---------- */

  // Accepts "1.27.0" or "v1.27.0"; rejects anything that is not a dotted
  // number, so a malformed tag can never reach the UI.
  function normalizeVersion(raw) {
    const s = String(raw || "").trim().replace(/^v/i, "");
    return /^\d+(\.\d+){0,3}$/.test(s) ? s : "";
  }

  // Returns -1 / 0 / 1 (numeric comparison, missing parts count as 0).
  function compareVersions(a, b) {
    const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
    const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const x = pa[i] || 0;
      const y = pb[i] || 0;
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }

  function currentVersion() {
    try {
      return normalizeVersion(api.runtime.getManifest().version) || "0.0.0";
    } catch (e) {
      return "0.0.0";
    }
  }

  /* ---------- browser detection (which package to download) ---------- */

  function isFirefox() {
    try {
      if (typeof browser !== "undefined" && browser.runtime && browser.runtime.getBrowserInfo) return true;
    } catch (e) {
      /* ignore */
    }
    return /firefox/i.test((global.navigator && global.navigator.userAgent) || "");
  }

  /* ---------- storage helpers ---------- */

  function storageGet(key) {
    return new Promise((resolve, reject) => {
      try {
        const r = api.storage.local.get(key);
        if (r && typeof r.then === "function") {
          r.then(resolve, reject);
          return;
        }
      } catch (e) {
        /* Chrome: callback style */
      }
      api.storage.local.get(key, (res) => resolve(res || {}));
    });
  }

  function storageSet(obj) {
    return new Promise((resolve, reject) => {
      try {
        const r = api.storage.local.set(obj);
        if (r && typeof r.then === "function") {
          r.then(resolve, reject);
          return;
        }
      } catch (e) {
        /* Chrome: callback style */
      }
      api.storage.local.set(obj, () => resolve());
    });
  }

  /* ---------- release fetching ---------- */

  // Only accept asset URLs served by GitHub itself. A release payload is public
  // data, but the download URL ends up in a link the user clicks: pin the host.
  function safeGithubUrl(url) {
    try {
      const u = new URL(String(url));
      if (u.protocol !== "https:") return "";
      const h = u.hostname.toLowerCase();
      if (h === "github.com" || h.endsWith(".github.com")) return u.href;
      return "";
    } catch (e) {
      return "";
    }
  }

  async function fetchLatestRelease() {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS) : null;
    try {
      const res = await fetch(API_URL, {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        headers: { Accept: "application/vnd.github+json" },
        signal: ctrl ? ctrl.signal : undefined,
      });
      if (!res.ok) {
        throw new Error(
          res.status === 403
            ? "GitHub rate limit reached, try again later."
            : `GitHub responded with HTTP ${res.status}.`
        );
      }
      const data = await res.json();
      const latest = normalizeVersion(data && data.tag_name);
      if (!latest) throw new Error("Unreadable release tag.");
      const assets = Array.isArray(data.assets) ? data.assets : [];
      const pick = (ext) => {
        const a = assets.find((x) => String(x && x.name).toLowerCase().endsWith(ext));
        return a ? safeGithubUrl(a.browser_download_url) : "";
      };
      return {
        latest,
        htmlUrl: safeGithubUrl(data.html_url) || RELEASES_URL,
        zipUrl: pick(".zip"),
        xpiUrl: pick(".xpi"),
        publishedAt: typeof data.published_at === "string" ? data.published_at : "",
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /* ---------- public state ---------- */

  function buildState(cached) {
    const current = currentVersion();
    const latest = normalizeVersion(cached && cached.latest);
    const updateAvailable = !!latest && compareVersions(current, latest) < 0;
    return {
      current,
      latest,
      updateAvailable,
      checkedAt: (cached && cached.checkedAt) || 0,
      error: (cached && cached.error) || "",
      htmlUrl: (cached && cached.htmlUrl) || RELEASES_URL,
      zipUrl: (cached && cached.zipUrl) || "",
      xpiUrl: (cached && cached.xpiUrl) || "",
      publishedAt: (cached && cached.publishedAt) || "",
      downloadUrl:
        (isFirefox() ? cached && cached.xpiUrl : cached && cached.zipUrl) ||
        (cached && cached.zipUrl) ||
        "",
      releasesUrl: RELEASES_URL,
      installDocUrl: INSTALL_DOC_URL,
    };
  }

  // Returns the cached state without any network access.
  async function getCachedState() {
    const res = await storageGet(CACHE_KEY);
    return buildState(res && res[CACHE_KEY]);
  }

  /**
   * Returns the update state, querying GitHub when the cache is stale.
   * @param {{force?: boolean}} [opts] force = ignore the cache TTL.
   */
  async function checkForUpdate(opts) {
    const force = !!(opts && opts.force);
    const res = await storageGet(CACHE_KEY);
    const cached = (res && res[CACHE_KEY]) || null;
    const fresh = cached && Date.now() - (cached.checkedAt || 0) < CACHE_TTL_MS;
    if (!force && fresh && !cached.error) return buildState(cached);

    try {
      const info = await fetchLatestRelease();
      const entry = { ...info, checkedAt: Date.now(), error: "" };
      await storageSet({ [CACHE_KEY]: entry });
      return buildState(entry);
    } catch (e) {
      // Keep the last known version so the badge does not flicker off on a
      // transient network error.
      const entry = {
        latest: (cached && cached.latest) || "",
        htmlUrl: (cached && cached.htmlUrl) || RELEASES_URL,
        zipUrl: (cached && cached.zipUrl) || "",
        xpiUrl: (cached && cached.xpiUrl) || "",
        publishedAt: (cached && cached.publishedAt) || "",
        checkedAt: Date.now(),
        error: (e && e.message) || "Version check failed.",
      };
      await storageSet({ [CACHE_KEY]: entry });
      return buildState(entry);
    }
  }

  global.JKDUpdate = {
    REPO,
    RELEASES_URL,
    INSTALL_DOC_URL,
    CACHE_KEY,
    CACHE_TTL_MS,
    currentVersion,
    normalizeVersion,
    compareVersions,
    isFirefox,
    getCachedState,
    checkForUpdate,
  };
})(typeof self !== "undefined" ? self : this);
