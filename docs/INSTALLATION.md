# Installation and updates (for users)

Kanban Flow is a browser extension. It works in **Chrome / Edge** and in **Firefox**.
Everything happens inside your browser: your JIRA credentials and your settings stay on
your machine, nothing is sent anywhere else.

> **About this project** — Kanban Flow is built and maintained by a Kanban facilitator,
> not a professional software developer. The code is written with the help of an AI coding
> agent, then reviewed and tested by the maintainer against real team needs. Expect
> pragmatic, purpose-built code rather than production-grade engineering: read it,
> question it, and open an issue if something looks wrong.

---

## 1. Download the latest version

Go to the **Releases** page of the repository and grab the file for the most recent
version:

| Browser | File to download |
|---|---|
| Chrome / Edge | `kanban-flow-<version>.zip` |
| Firefox | `kanban-flow-<version>.xpi` |

---

## 2. Install in Chrome or Edge

1. Unzip the `.zip` into a folder you will **keep** (for example
   `Documents\kanban-flow`). If you delete that folder, the extension disappears.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the unzipped folder.
5. The Kanban Flow icon appears in the toolbar. Pin it if you like.

> Chrome shows a "Disable developer mode extensions" banner on every start-up. That is
> expected for an extension installed outside the store: close the banner, the extension
> stays active.

## 3. Install in Firefox

Two cases, depending on how the version was published.

**a) The `.xpi` is signed** (recommended, see `docs/PUBLICATION.md`):

1. Open the `.xpi` file from Firefox (drag it into a window, or press `Ctrl+O`).
2. Confirm the installation. The extension is **permanent** and updates itself.

**b) The `.xpi` is not signed** — temporary installation, valid until Firefox is closed:

1. Open `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on…** then select the `.xpi` (or the `manifest.json` inside the
   unzipped folder).
3. After every Firefox restart you have to do it again **and re-import your settings**
   (see §5).

---

## 4. First-time setup

1. Right-click the icon → **Options** (or the ⚙ button in the dashboard).
2. Fill in:
   - **JIRA URL**: `https://your-company.atlassian.net`
   - **E-mail**: your Atlassian sign-in address
   - **API token**: create one at
     <https://id.atlassian.com/manage-profile/security/api-tokens> → *Create API token*.
     The token is stored locally in your browser.
3. Add your teams (JIRA project key, Build or Run mode, exact status names).
4. **Save**, then open the dashboard.

Every setting is documented in the [README](../README.md).

---

## 5. Back up / restore your settings

Use the **"Settings backup"** section of the options page:

- **Export** produces a JSON file. By default the **API token is not included**
  (tick the checkbox to add it — in that case, treat the file like a password).
- **Import** restores that file. An import without a token keeps the token already in
  place.

Export right after your initial setup: it saves you from re-entering everything after a
reinstall or a machine change.

---

## 6. Update

### If you installed a signed `.xpi` in Firefox

Nothing to do: Firefox checks for new versions and updates automatically.

### Otherwise (Chrome, or unsigned Firefox)

1. Download the new package from **Releases**.
2. **Chrome**: unzip it **over** the existing folder (replacing the files), then go to
   `chrome://extensions` → **↻** button on the Kanban Flow card. Your settings are
   preserved: they are stored by the browser, not in the folder.
3. **Temporary Firefox**: reload the add-on and re-import your settings.

### Get notified of new versions

On the project's GitHub page: **Watch** → **Custom** → tick **Releases**. You will get an
e-mail for every publication.

What changes in each version is listed in [CHANGELOG.md](../CHANGELOG.md).

---

## 7. Troubleshooting

- **No data / 401 error**: invalid or expired API token, regenerate it.
- **403 or 404 error**: the JIRA URL or the project key is wrong.
- **Counters stuck at 0**: the status names you entered must match the JIRA ones
  **exactly** (the comparison ignores case and surrounding spaces, but not typos).
- Anything else: open an **Issue** on the repository, stating your browser, the extension
  version and the error message (**never paste your API token**).
