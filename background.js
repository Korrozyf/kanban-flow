/* Kanban Flow — background service worker
 * Rôle minimal : ouvrir (ou refocaliser) l'onglet du tableau de bord
 * quand on clique sur l'icône de l'extension. Compatible Chrome (service
 * worker) et Firefox (event page via background.scripts).
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
    /* tabs.query peut échouer si la permission tabs n'est pas là ; on ouvre quand même */
  }
  await api.tabs.create({ url: DASHBOARD_URL });
}

api.action.onClicked.addListener(openDashboard);
