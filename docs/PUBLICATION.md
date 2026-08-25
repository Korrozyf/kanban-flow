# Publier une version (pour le mainteneur)

Ce document décrit le cycle de publication du dépôt et les options réelles pour la
**mise à jour automatique** chez les utilisateurs.

---

## 1. Publier une nouvelle version

Le versionnage est sémantique (`MAJEUR.MINEUR.CORRECTIF`, voir en-tête de
`CHANGELOG.md`). `manifest.json` est la **seule source de vérité** de la version.

```bash
# 1. Faire les modifications, puis mettre à jour la version
#    → manifest.json ("version") ET CHANGELOG.md (nouvelle section "## x.y.z")

# 2. Vérifier que le paquet se construit
./tools/build.sh

# 3. Committer
git add -A
git commit -m "1.25.0 — <résumé court>"
git push

# 4. Étiqueter et pousser l'étiquette : c'est ce qui déclenche la publication
git tag v1.25.0
git push origin v1.25.0
```

Le workflow `.github/workflows/release.yml` prend alors le relais :

1. il **refuse** de publier si l'étiquette ne correspond pas à la version du manifest ;
2. il contrôle la syntaxe de tous les fichiers JS ;
3. il construit `kanban-flow-<version>.zip` (Chrome) et `.xpi` (Firefox) ;
4. il crée la **release GitHub** avec les notes extraites de la section correspondante du
   `CHANGELOG.md` et les deux paquets en pièces jointes.

Suivi de l'exécution : onglet **Actions** du dépôt.

---

## 2. Mise à jour automatique : ce qui est réellement possible

GitHub distribue et versionne, mais **ne met pas à jour une extension tout seul**. Voici
les trois scénarios, du plus simple au plus confortable pour l'utilisateur.

### Scénario A — GitHub seul (état actuel, aucun compte à créer)

- L'utilisateur télécharge le paquet et l'installe (voir `docs/INSTALLATION.md`).
- Mise à jour = retélécharger + recharger. Configuration conservée dans Chrome.
- Il peut s'abonner aux releases (**Watch → Releases**) pour être averti.

C'est suffisant pour quelques utilisateurs internes.

### Scénario B — Firefox avec mise à jour automatique (gratuit)

Firefox accepte l'auto-hébergement, à condition que le `.xpi` soit **signé par Mozilla**.

1. Créez un compte sur <https://addons.mozilla.org> → *Developer Hub*.
2. Soumettez le `.xpi` en mode **« On your own site » (unlisted)** : l'extension n'est pas
   publiée dans la galerie publique, Mozilla se contente de la signer.
3. Récupérez le `.xpi` signé et joignez-le à la release GitHub.
4. Ajoutez dans `manifest.json` l'adresse du manifeste de mise à jour :

```json
"browser_specific_settings": {
  "gecko": {
    "id": "kanban-flow@scrum-master.local",
    "strict_min_version": "121.0",
    "update_url": "https://raw.githubusercontent.com/<utilisateur>/<dépôt>/main/docs/updates.json"
  }
}
```

5. Tenez à jour `docs/updates.json` (modèle fourni dans ce dossier) à chaque release :
   Firefox l'interroge périodiquement et installe la nouvelle version automatiquement.

Le flux peut être automatisé plus tard avec l'API AMO (`web-ext sign`) dans le workflow,
en stockant les clés `AMO_JWT_ISSUER` / `AMO_JWT_SECRET` dans les *Secrets* du dépôt.

### Scénario C — Chrome avec mise à jour automatique (5 $ une fois)

Chrome **bloque** les extensions auto-hébergées sous Windows et macOS (sauf stratégie
d'entreprise). La seule voie praticable est le **Chrome Web Store** en visibilité
**« Non répertoriée » (unlisted)** :

1. Compte développeur sur <https://chrome.google.com/webstore/devconsole> (frais d'accès
   unique de 5 $).
2. Téléverser `kanban-flow-<version>.zip`, visibilité *Non répertoriée* : seuls les
   détenteurs du lien peuvent installer.
3. Chrome met alors à jour automatiquement chez tous les utilisateurs. Chaque nouvelle
   version passe par une revue (généralement quelques heures à quelques jours).

Ce dépôt reste la source du code et des notes de version dans les trois scénarios.

---

## 3. Points de vigilance

- **Ne jamais committer de jeton API JIRA.** `.gitignore` exclut déjà les exports de
  configuration (`*kanban-flow-config*.json`, `config-*.json`) ; vérifiez malgré tout vos
  diffs avant de committer.
- **Une étiquette = une version du manifest.** Le workflow échoue sinon, volontairement.
- **Toujours ajouter une section au `CHANGELOG.md`** : elle sert de notes de version
  publiées automatiquement.
- **Relire le `README.md` et les aides contextuelles de `options.html`** dès qu'une règle
  de calcul change : c'est la documentation qui vieillit le plus vite.
