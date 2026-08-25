# Installation et mise à jour (pour les utilisateurs)

Kanban Flow est une extension de navigateur. Elle fonctionne dans **Chrome / Edge** et
dans **Firefox**. Tout se passe dans votre navigateur : vos identifiants JIRA et votre
configuration restent sur votre poste, rien n'est envoyé ailleurs.

---

## 1. Télécharger la dernière version

Rendez-vous sur la page **Releases** du dépôt et prenez le fichier de la version la plus
récente :

| Navigateur | Fichier à télécharger |
|---|---|
| Chrome / Edge | `kanban-flow-<version>.zip` |
| Firefox | `kanban-flow-<version>.xpi` |

---

## 2. Installer dans Chrome ou Edge

1. Décompressez le `.zip` dans un dossier que vous **garderez** (par exemple
   `Documents\kanban-flow`). Si vous supprimez ce dossier, l'extension disparaît.
2. Ouvrez `chrome://extensions` (ou `edge://extensions`).
3. Activez **Mode développeur** (interrupteur en haut à droite).
4. Cliquez **Charger l'extension non empaquetée** et sélectionnez le dossier décompressé.
5. L'icône Kanban Flow apparaît dans la barre d'outils. Épinglez-la si vous le souhaitez.

> Chrome affiche un bandeau « Désactivez les extensions en mode développeur » à chaque
> démarrage. C'est normal pour une extension installée hors boutique : cliquez sur la
> croix, l'extension reste active.

## 3. Installer dans Firefox

Deux cas selon la façon dont la version a été publiée.

**a) Le `.xpi` est signé** (recommandé, voir `docs/PUBLICATION.md`) :

1. Ouvrez le fichier `.xpi` depuis Firefox (glissez-le dans une fenêtre, ou
   `Ctrl+O`).
2. Confirmez l'installation. L'extension est **permanente** et se met à jour toute seule.

**b) Le `.xpi` n'est pas signé** — installation temporaire, valable jusqu'à la fermeture
de Firefox :

1. Ouvrez `about:debugging#/runtime/this-firefox`.
2. **Charger un module temporaire…** puis sélectionnez le `.xpi` (ou le `manifest.json`
   du dossier décompressé).
3. À chaque redémarrage de Firefox, il faut recommencer **et réimporter votre
   configuration** (voir §5).

---

## 4. Première configuration

1. Clic droit sur l'icône → **Options** (ou bouton ⚙ dans le tableau de bord).
2. Renseignez :
   - **URL JIRA** : `https://votre-societe.atlassian.net`
   - **E-mail** : votre adresse de connexion Atlassian
   - **Jeton API** : à créer sur
     <https://id.atlassian.com/manage-profile/security/api-tokens> → *Create API token*.
     Le jeton reste stocké localement dans votre navigateur.
3. Ajoutez vos équipes (clé de projet JIRA, mode Build ou Run, noms exacts des statuts).
4. **Enregistrer**, puis ouvrez le tableau de bord.

Le détail de chaque réglage est dans le [README](../README.md).

---

## 5. Sauvegarder / restaurer votre configuration

Section **« Sauvegarde de la configuration »** de la page d'options :

- **Exporter** produit un fichier JSON. Par défaut le **jeton API n'y est pas inclus**
  (case à cocher pour l'ajouter — dans ce cas, traitez le fichier comme un mot de passe).
- **Importer** restaure ce fichier. Un import sans jeton conserve le jeton déjà en place.

Faites un export après votre configuration initiale : cela vous évite de tout ressaisir
en cas de réinstallation ou de changement de poste.

---

## 6. Mettre à jour

### Si vous avez installé un `.xpi` signé dans Firefox

Rien à faire : Firefox vérifie les nouvelles versions et met à jour automatiquement.

### Sinon (Chrome, ou Firefox non signé)

1. Téléchargez le nouveau paquet dans **Releases**.
2. **Chrome** : décompressez-le **par-dessus** le dossier existant (en remplaçant les
   fichiers), puis `chrome://extensions` → bouton **↻** sur la carte Kanban Flow.
   Votre configuration est conservée : elle est stockée par le navigateur, pas dans le
   dossier.
3. **Firefox temporaire** : rechargez le module et réimportez votre configuration.

### Être averti des nouvelles versions

Sur la page GitHub du projet : bouton **Watch** → **Custom** → cochez **Releases**.
Vous recevrez un e-mail à chaque publication.

Le détail de ce qui change à chaque version est dans [CHANGELOG.md](../CHANGELOG.md).

---

## 7. En cas de problème

- **Aucune donnée / erreur 401** : jeton API invalide ou expiré, régénérez-le.
- **Erreur 403 ou 404** : l'URL JIRA ou la clé de projet est erronée.
- **Compteurs à 0** : les noms de statuts saisis doivent correspondre **exactement** à
  ceux de JIRA (la comparaison ignore la casse et les espaces autour, mais pas les
  fautes de frappe).
- Autre : ouvrez une **Issue** sur le dépôt en précisant navigateur, version de
  l'extension et message d'erreur (**sans jamais coller votre jeton API**).
