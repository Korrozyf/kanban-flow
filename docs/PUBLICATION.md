# Publishing a version (for the maintainer)

This document describes the repository's release cycle and the real options for
**automatic updates** on the users' side.

---

## 1. Publish a new version

Versioning is semantic (`MAJOR.MINOR.PATCH`, see the header of `CHANGELOG.md`).
`manifest.json` is the **single source of truth** for the version.

```bash
# 1. Make the changes, then bump the version
#    → manifest.json ("version") AND CHANGELOG.md (new "## x.y.z" section)

# 2. Check that the package builds
./tools/build.sh

# 3. Commit
git add -A
git commit -m "1.25.0 — <short summary>"
git push

# 4. Tag and push the tag: this is what triggers the publication
git tag v1.25.0
git push origin v1.25.0
```

The `.github/workflows/release.yml` workflow then takes over:

1. it **refuses** to publish if the tag does not match the manifest version;
2. it syntax-checks every JS file;
3. it builds `kanban-flow-<version>.zip` (Chrome) and `.xpi` (Firefox);
4. it creates the **GitHub release** with the notes extracted from the matching section of
   `CHANGELOG.md` and both packages attached.

For supply-chain safety, every third-party GitHub Action is pinned to an immutable
commit SHA (with its release number kept in a comment). Review and update both when
upgrading an action; do not replace the SHA with a moving `@vN` tag.

Follow the run in the repository's **Actions** tab.

---

## 2. Automatic updates: what is actually possible

GitHub distributes and versions, but **does not update an extension on its own**. Here are
the three scenarios, from the simplest to the most comfortable for the user.

### Scenario A — GitHub only (current state, no account needed)

- The user downloads the package and installs it (see `docs/INSTALLATION.md`).
- Updating = download again + reload. Settings are preserved in Chrome.
- They can subscribe to releases (**Watch → Releases**) to be notified.

That is good enough for a handful of internal users.

### Scenario B — Firefox with automatic updates (free)

Firefox allows self-hosting, provided the `.xpi` is **signed by Mozilla**.

1. Create an account on <https://addons.mozilla.org> → *Developer Hub*.
2. Submit the `.xpi` in **"On your own site" (unlisted)** mode: the extension is not
   published in the public gallery, Mozilla merely signs it.
3. Download the signed `.xpi` and attach it to the GitHub release.
4. Add the update manifest URL to `manifest.json`:

```json
"browser_specific_settings": {
  "gecko": {
    "id": "kanban-flow@kanban-flow.local",
    "strict_min_version": "121.0",
    "update_url": "https://raw.githubusercontent.com/<user>/<repo>/main/docs/updates.json"
  }
}
```

5. Keep `docs/updates.json` up to date (template provided in this folder) for every
   release: Firefox polls it periodically and installs the new version automatically.

The flow can be automated later with the AMO API (`web-ext sign`) inside the workflow, by
storing the `AMO_JWT_ISSUER` / `AMO_JWT_SECRET` keys in the repository *Secrets*.

### Scenario C — Chrome with automatic updates (one-off $5)

Chrome **blocks** self-hosted extensions on Windows and macOS (unless an enterprise policy
is in place). The only practical route is the **Chrome Web Store** with **"Unlisted"**
visibility:

1. Developer account at <https://chrome.google.com/webstore/devconsole> (one-off $5
   registration fee).
2. Upload `kanban-flow-<version>.zip` with *Unlisted* visibility: only people holding the
   link can install it.
3. Chrome then updates every user automatically. Each new version goes through a review
   (usually a few hours to a few days).

This repository remains the source of the code and of the release notes in all three
scenarios.

---

## 3. Things to watch out for

- **Never commit a JIRA API token.** `.gitignore` already excludes settings exports
  (`*kanban-flow-config*.json`, `config-*.json`); review your diffs before committing
  anyway.
- **One tag = one manifest version.** The workflow fails otherwise, on purpose.
- **Always add a `CHANGELOG.md` section**: it is used as the automatically published
  release notes.
- **Re-read `README.md` and the inline hints in `options.html`** whenever a calculation
  rule changes: documentation is what ages fastest.
