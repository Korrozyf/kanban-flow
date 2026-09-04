/* Kanban Flow — background service worker
 * Two roles:
 *  - open (or re-focus) the dashboard tab when the extension icon is clicked;
 *  - check GitHub for a newer release and show a dot on the extension icon.
 * Works on Chrome (service worker) and Firefox (event page). The build creates
 * a browser-specific manifest: Chrome uses background.service_worker, while
 * Firefox uses background.scripts and loads lib/update.js before this file.
 */
if (typeof JKDUpdate === "undefined" && typeof importScripts === "function") {
  importScripts("lib/update.js"); // Chrome MV3 service worker
}

const api = typeof browser !== "undefined" ? browser : chrome;

const DASHBOARD_URL = api.runtime.getURL("dashboard.html");

async function openDashboard() {
  try {
    const tabs = await api.tabs.query({ url: DASHBOARD_URL });
    if (tabs && tabs.length > 0) {
      await api.tabs.update(tabs[0].id, { active: true });
      if (tabs[0].windowId != null) {
        await api.windows.update(tabs[0].windowId, { focused: true });
      }
      return;
    }
  } catch (e) {
    /* tabs.query can fail when the tabs permission is missing; open anyway */
  }
  await api.tabs.create({ url: DASHBOARD_URL });
}

api.action.onClicked.addListener(openDashboard);

/* ---------- update badge ---------- */

const BASE_TITLE = "Kanban Flow — open the dashboard";

async function applyBadge(state) {
  const on = !!(state && state.updateAvailable);
  try {
    await api.action.setBadgeText({ text: on ? "●" : "" });
    if (api.action.setBadgeBackgroundColor) {
      await api.action.setBadgeBackgroundColor({ color: "#f59e0b" });
    }
    if (api.action.setBadgeTextColor) {
      await api.action.setBadgeTextColor({ color: "#0f1419" });
    }
    await api.action.setTitle({
      title: on
        ? `${BASE_TITLE}\nUpdate available: ${state.latest} (installed ${state.current})`
        : BASE_TITLE,
    });
  } catch (e) {
    /* badge APIs are best-effort; never break the popup action */
  }
}

async function refreshUpdateState(force) {
  if (typeof JKDUpdate === "undefined") return null;
  const state = await JKDUpdate.checkForUpdate({ force: !!force });
  await applyBadge(state);
  return state;
}

api.runtime.onStartup.addListener(() => {
  refreshUpdateState(false);
});
api.runtime.onInstalled.addListener(() => {
  refreshUpdateState(true);
});

// Pages (dashboard, settings) ask the worker to refresh the badge and hand back
// the current state, so the network call lives in a single place.
api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "jkd-update-check") return false;
  refreshUpdateState(!!msg.force)
    .then((state) => sendResponse({ ok: true, state }))
    .catch((e) => sendResponse({ ok: false, error: (e && e.message) || "check failed" }));
  return true; // asynchronous response
});
