/* Kanban Flow — background service worker
 * Minimal role: open (or re-focus) the dashboard tab when the extension icon is
 * clicked. Works on Chrome (service worker) and Firefox (event page via
 * background.scripts).
 */
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
