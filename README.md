# Kanban Flow — Tableau de bord Scrum Master (JIRA Cloud)

Extension de navigateur (Chrome + Firefox) qui se connecte à **JIRA Cloud** et affiche,
équipe par équipe, les indicateurs de flux Kanban utiles à l'accompagnement d'un Scrum
Master : **throughput**, **lead time**, **cycle time** et leurs **tendances**.

## Fonctionnalités

- **Deux types de Kanban par équipe** : chaque projet est configuré en mode **Build**
  (flux : throughput engagé / réalisé, lead & cycle time, ajouts au board / remises en
  backlog) ou en mode **Run** (support : tickets ouverts, fermés, créés, temps moyen de
  résolution, listes non assignés / priorité max). Voir la section « Mode Run » plus bas.
- **Sélection d'équipe / projet** via un menu déroulant (multi-équipes).
- **Date de démarrage du macrocycle** (première semaine) configurable : on affiche la
  semaine en cours + jusqu'à **3 semaines complètes précédentes**, sans jamais remonter
  avant cette date.
  - Date dans le futur → message d'erreur et aucun affichage.
  - Date = semaine en cours → pas de comparaison (aucune semaine complète précédente).
- **Throughput réalisé** de la semaine en cours (lundi → dimanche) + semaines précédentes
  (barres). La **semaine en cours (incomplète)** est affichée en **jaune** pour la
  distinguer nettement des semaines complètes.
- **Throughput engagé** : nombre de tickets présents dans un **statut du board pendant
  le créneau « engagé »** (par défaut lundi 0h→12h, **configurable**) — c'est un
  instantané (snapshot) sur ce créneau, pas un comptage de transitions. Il est affiché
  **dans le même graphique que le throughput réalisé** (barres groupées : engagé en
  violet, réalisé en bleu) + carte + tendance.
- **Code couleur de la semaine en cours** : dans les **graphiques** (barres, courbes)
  et le tableau de signaux, les données de la **semaine en cours** sont en tons
  **chauds** — réalisé en **jaune**, engagé en **ambre**, courbes en jaune pointillé —
  tandis que les **semaines complètes** restent en **bleu / violet**. Sur les
  **cartes** de haut de page (**build et run**), le chiffre reste en couleur de texte
  normale (le jaune est réservé aux alertes) : l'appartenance à la semaine en cours
  est portée par le badge « en cours » et la bordure de la carte.
- **Story points (option par équipe)** : si l'option *« Suivre les story points »* est
  activée pour une équipe build, le tableau de bord ajoute une **carte** « Story points
  livrés » (semaine en cours), un **graphique par semaine** sous le throughput et une
  **colonne « Story points »** dans la liste des tickets terminés (avant lead / cycle
  time). Le champ JIRA correspondant est détecté automatiquement, ou forçable dans la
  configuration.
- **Mise en page des graphiques (build)** : le throughput occupe toute la largeur ;
  lead time et cycle time sont côte à côte en dessous.
- **Liste des tickets terminés cette semaine** : la colonne *Cycle (j)* porte une
  **pastille colorée + infobulle** — vert ≤ 2 jours, ambre 2–4 jours, rouge > 4 jours.
- **Signaux de flux par semaine** : nombre de tickets **ajoutés au board** (entrée dans
  un statut du board **depuis n'importe quel autre statut**) et de tickets **remis en
  backlog**, comptés pendant le **créneau « ajouts / retraits »** (par défaut lundi 12h →
  vendredi fin de journée, **configurable**), avec une alerte ⚠ quand il y en a. La
  semaine en cours est mise en avant (ligne jaune) et une synthèse indique s'il y a eu
  des ajouts / remises et combien.
- **Créneaux de comptage configurables** (réglage global) : jour et heures du créneau
  « engagé » et du créneau « ajouts / retraits ». Les libellés affichés dans le tableau
  de bord suivent automatiquement les valeurs choisies.
- **Tendances = semaine en cours comparée à la semaine précédente** (cartes de haut de
  page, build comme run).
- **Export / import de la configuration** en JSON (jeton API exclu par défaut) pour ne
  rien ressaisir après une réinstallation — voir « Mettre à jour l'extension ».
- **Export du tableau de bord en image** (PNG ou JPG) : bouton `🖼 Exporter l'image`
  dans la barre du haut. La capture couvre **toute la page** d'indicateurs (pas
  seulement la zone visible), listes de tickets **dépliées**, avec un en-tête
  équipe / mode / période / date de génération. Résolution ×2 (lisible en réunion ou
  dans un compte-rendu). Le fichier est enregistré dans le dossier de téléchargement du
  navigateur sous `kanban-flow_<équipe>_<date>_<heure>.png|jpg`.
- **Lead time** par semaine et **cycle time** par semaine (courbes, médiane ou moyenne).
- **Tendances** (hausse / stable / baisse) de chaque indicateur, avec code couleur :
  vert = amélioration, rouge = dégradation, bleu = stable.
- **Statuts configurables par équipe** : vous définissez précisément quels statuts JIRA
  marquent le *début du travail* (cycle time) et la *fin* (throughput / lead / cycle).
- Liste repliable des tickets terminés **dans la semaine en cours** + JQL utilisée (transparence des calculs).
- 100 % local : identifiants et jeton stockés dans le navigateur, aucun serveur tiers.

## Définition des indicateurs

Pour chaque ticket terminé dans la fenêtre analysée :

| Indicateur   | Calcul |
|--------------|--------|
| **Throughput réalisé** | Nombre de tickets entrés dans un statut « Terminé » pendant la semaine (lun→dim). |
| **Throughput engagé** | Nombre de tickets **dans un statut du board pendant le créneau « engagé »** (par défaut lundi 0h→12h, configurable) — instantané reconstruit depuis l'historique (le ticket compte s'il a été sur le board à un instant quelconque de ce créneau), pas un comptage de transitions. Affiché dans le même graphique que le réalisé. |
| **Ajoutés au board** | Nombre de tickets **placés dans un statut du board** (depuis n'importe quel autre statut) pendant le **créneau « ajouts / retraits »** (par défaut lundi 12h → vendredi fin de journée, configurable) de la même semaine (ajout de périmètre en cours de semaine). |
| **Remis en backlog** | Nombre de tickets **placés en statut « Backlog » / « To do »** (depuis n'importe quel autre statut) pendant le même **créneau « ajouts / retraits »** (par défaut lundi 12h → vendredi fin de journée, configurable). |
| **Story points livrés** | Somme des story points des tickets **terminés pendant la semaine** (option à activer par équipe). Tickets non estimés exclus de la somme. |
| **Lead time**  | `date de fin − date de création` (jours). |
| **Cycle time** | `date de fin − 1ʳᵉ entrée dans un statut « En cours »` (jours). |

- **Date de fin** = dernière transition vers un de vos statuts « Terminé ».
- **Date de début** = première transition vers un de vos statuts « En cours »
  (si aucune, le cycle time est approximé sur la création — signalé par `*`).
- **Bornage au macrocycle** : si la date de création (lead time) ou la 1ʳᵉ mise en
  cours (cycle time) est **antérieure à la date de démarrage du macrocycle**, on
  utilise cette date de démarrage à la place. Le temps écoulé avant le début du
  macrocycle n'est donc jamais compté.
- L'agrégation hebdomadaire est la **médiane** par défaut (plus robuste aux valeurs
  extrêmes), configurable en moyenne.
- **Tendance** = comparaison de la semaine en cours à la semaine précédente ; en-deçà
  du seuil « stable » (10 % par défaut), la tendance est considérée stable.

## Mode Run (Kanban de support / run)

Pour un projet configuré en **mode Run**, on n'analyse pas le flux de livraison mais la
gestion d'un flux de tickets de support. Les tickets concernés sont identifiés par un ou
plusieurs **labels** (configurables par équipe). Semaines du **lundi 00:00 au dimanche
23:59** ; dans les graphiques la semaine en cours est en tons chauds. Comme en mode
build, les **cartes** de haut de page affichent leur chiffre en couleur de texte
normale, avec le badge « en cours » et la bordure de carte pour marquer la semaine
courante. Indicateurs :

| Indicateur | Calcul |
|------------|--------|
| **Tickets ouverts** | Nombre de tickets dont la **date de création** tombe dans la semaine considérée (quel que soit leur statut) + deux **listes** : « **ouverts dans le board** » (statut hors backlog) et « **ouverts non planifiés (backlog)** » (statut listé dans les *Statuts « Backlog » du run*). Les deux listes ont la même structure : lien JIRA, priorité, assigné, **temps depuis l'ouverture** et **temps depuis la dernière action** — signalés par une **pastille de couleur** (vert 0–1 j, ambre 1–2 j, rouge > 2 j) avec infobulle. Un ticket **résolu** ou dans l'un des **statuts de fermeture** configurés n'apparaît dans aucune des deux. La **carte KPI** compte l'ensemble des ouverts (board + backlog). |
| **Tickets fermés** *(stat équivalente aux ouverts)* | Nombre de tickets dont la **date de fermeture** (date d’entrée dans le statut de fermeture lue dans le changelog, ou date de résolution) tombe dans la semaine considérée + **liste** des tickets **fermés pendant la semaine en cours** (lien JIRA, date de création, date de fermeture et durée **ouverture → fermeture** avec le même code couleur). Affiché **sur le même graphique** que les ouverts (barres groupées). La carte de haut de page compte les fermetures **de la semaine en cours**, comparées aux fermetures de la semaine précédente **sur la même durée écoulée** (ex. mardi 14h → du lundi 00:00 au mardi 14h de la semaine précédente). |
| **Tickets créés par jour** | Graphique des créations **par jour de la semaine** : semaine en cours comparée à la semaine précédente. Les jours ouvrés (lun→ven) sont toujours affichés ; **samedi et dimanche n'apparaissent que s'ils portent au moins une création** (semaine en cours ou précédente). |
| **Tickets créés** | Nombre de tickets **créés pendant la semaine en cours**, comparé aux créations de la semaine précédente sur la **même durée écoulée** (ex. mardi 14h → du lundi 00:00 au mardi 14h de la semaine précédente). La note affiche aussi le total de la semaine précédente entière. |
| **Temps moyen de résolution** | Moyenne du délai `création → fermeture` des tickets **fermés pendant la semaine en cours**. Pastille de couleur selon les mêmes seuils que les listes (vert ≤ 1 j, ambre ≤ 2 j, rouge > 2 j) ; tendance comparée à la moyenne de la semaine précédente sur la **même durée écoulée** (plus court = meilleur). |
| **Non assignés** | **Liste** (instantané actuel) des tickets ouverts **sans assigné**, avec lien vers leur page JIRA. |
| **Priorité maximale** | **Liste** (instantané) des tickets dont la priorité fait partie des valeurs « max » configurées, triée par **priorité décroissante puis création croissante**, avec **date de création**, **délai création → premier commentaire** et **délai création → résolution**. Ces deux délais utilisent le même code couleur que les compteurs d'ancienneté (pastille verte ≤ 1 j, ambre ≤ 2 j, rouge > 2 j). |

- Les priorités « max » sont configurables par équipe (ex. `Highest, Blocker`).
- Les **statuts de fermeture** (ex. `Done, Closed, Résolu`) sont configurables par équipe : un ticket qui s'y trouve est exclu des indicateurs, comme un ticket résolu.
- La **date de fermeture** est lue dans le **changelog** (dernière entrée dans un statut de fermeture) ; à défaut la date de résolution ; en dernier recours « maintenant », signalé par un `~` dans la colonne « Fermé le ». C'est ce qui permet de dater correctement un ticket clos sans résolution (ex. `Cancelled`).
- Les **statuts « Backlog » du run** sont également configurables : ils distinguent les tickets ouverts **non planifiés** de ceux **pris en charge sur le board**.
- Les tendances comparent la **semaine en cours** à la **semaine précédente** (cartes de haut de page, build comme run). La carte « Tickets ouverts » du run compare le **stock actuel** au stock encore ouvert **à la fin de la semaine précédente**.
- **Aucun cumul entre semaines** : chaque indicateur hebdomadaire ne compte que les éléments dont l'événement de référence (création, fermeture, transition, fin de ticket) tombe dans les bornes `[lundi 00:00, lundi suivant 00:00[` de la semaine concernée.
- Le premier commentaire est lu via `GET /rest/api/3/issue/{clé}/comment` (trié par date).

### Exclusivité des comptages

Règle générale : **un ticket compté sur une semaine (ou un jour) ne peut pas être compté
ailleurs pour le même indicateur.** Chaque élément est rattaché à **une seule** semaine,
celle qui contient son *événement de référence* :

| Indicateur | Événement de référence |
| --- | --- |
| Throughput réalisé, story points, lead time, cycle time | date de **fin** du ticket |
| Ajouts au board, remises en backlog | date de la **transition** de statut |
| Tickets ouverts (par semaine, run) | date de **création** |
| Tickets fermés, temps moyen de résolution (run) | date de **fermeture** |
| Créations par jour (run) | date de **création**, rattachée à un seul jour |

Les bornes sont **semi-ouvertes** : `[lundi 00:00, lundi suivant 00:00[`. Un ticket terminé
le lundi à 00:00 pile appartient à la semaine qui **commence**, jamais à celle qui finit.
Les semaines sont contiguës : ni trou, ni chevauchement. Les découpages en jours et les
créneaux configurables sont calculés en **jours calendaires**, pas en tranches de 24 h :
les semaines de changement d'heure (167 h ou 169 h) ne provoquent donc ni double comptage
ni heure perdue.

Trois indicateurs ne sont **volontairement pas** exclusifs, parce qu'ils mesurent un
**stock** ou des **transitions**, pas un flux de tickets :

- **Throughput engagé** — photo du board au créneau du lundi. Un ticket resté sur le board
  trois semaines est compté les trois semaines : c'est la question posée (« combien de
  tickets étaient engagés ce lundi ? »).
- **Tickets ouverts (carte du haut, run)** — stock actuel de tickets non résolus, comparé au
  stock encore ouvert à la fin de la semaine précédente.
- **Ajouts au board / remises en backlog** — on compte des *transitions*. Un ticket qui fait
  l'aller-retour dans la même semaine est compté des deux côtés : c'est le signal de churn
  recherché.

À cela s'ajoutent les **bases de comparaison « à durée écoulée égale »** (fermés, créations,
temps moyen de résolution) : elles portent sur la semaine précédente tronquée à la même
durée écoulée, et ne sont pas des indicateurs hebdomadaires mais des points de repère.

## Installation

Les paquets prêts à installer sont publiés dans les **[Releases](../../releases)** du
dépôt : `kanban-flow-<version>.zip` pour Chrome/Edge, `kanban-flow-<version>.xpi` pour
Firefox. Guide pas à pas destiné aux utilisateurs :
**[docs/INSTALLATION.md](docs/INSTALLATION.md)**.

### Chrome / Edge / Chromium
1. Décompressez le `.zip` dans un dossier que vous conservez (ou clonez le dépôt).
2. `chrome://extensions/`
3. Activez le **Mode développeur** (en haut à droite).
4. **Charger l'extension non empaquetée** → sélectionnez ce dossier.
5. Cliquez sur l'icône 📊 pour ouvrir le tableau de bord.

### Firefox (121+)
1. `about:debugging#/runtime/this-firefox`
2. **Charger un module complémentaire temporaire…** → sélectionnez le fichier
   `manifest.json` du dossier (ou le `.xpi`).
3. Cliquez sur l'icône 📊.

> Chargement temporaire = effacé au redémarrage de Firefox. Pour une installation
> permanente **et une mise à jour automatique**, l'extension doit être signée par Mozilla
> (AMO, gratuit) — procédure dans [docs/PUBLICATION.md](docs/PUBLICATION.md).

### Construire les paquets soi-même

```bash
./tools/build.sh      # → dist/kanban-flow-<version>.zip et .xpi
```

La version est lue dans `manifest.json`. Pousser une étiquette `vX.Y.Z` déclenche le
workflow GitHub Actions qui construit les paquets et crée la release avec les notes du
`CHANGELOG.md` (voir [docs/PUBLICATION.md](docs/PUBLICATION.md)).

## Mettre à jour l'extension sans rien ressaisir

La configuration (connexion JIRA, équipes, statuts) est stockée **dans le navigateur**
via `chrome.storage.local`. Elle est perdue si l'extension est supprimée puis
réinstallée — et systématiquement sur un **module temporaire Firefox**, effacé à
chaque redémarrage. D'où l'export/import.

### Procédure de mise à jour
1. ⚙ Configuration → section **4. Sauvegarde de la configuration** → **⬇ Exporter la
   configuration** → un fichier `kanban-flow-config_AAAA-MM-JJ.json` est téléchargé.
2. Installez la nouvelle version (Chrome : *Recharger* suffit si le dossier est le même,
   la config est alors conservée ; Firefox temporaire : rechargez le module).
3. ⚙ Configuration → **⬆ Importer une configuration** → sélectionnez le fichier.
   La config est appliquée **et enregistrée** immédiatement.

### À propos du jeton API
- Il n'est **pas** exporté par défaut (c'est un secret équivalent à un mot de passe).
  Cochez « Inclure le jeton API dans l'export » si vous voulez un fichier autonome —
  dans ce cas, traitez le fichier comme un mot de passe.
- À l'import, un fichier **sans** jeton ne supprime jamais celui déjà enregistré :
  vous ne le ressaisissez que si l'extension a réellement été réinstallée à neuf.

### Partager la config à un collègue
Exportez **sans** le jeton et transmettez le fichier : votre collègue importe, ajoute
son propre e-mail et son propre jeton API, et démarre avec les mêmes équipes, statuts
et réglages. Le format est validé à l'import (`app`, `formatVersion`), les statuts sont
nettoyés et un fichier étranger ou corrompu est refusé avec un message explicite.

## Obtenir un jeton API JIRA Cloud

L'extension s'authentifie auprès de JIRA Cloud en **Basic Auth** : votre e-mail
Atlassian + un **jeton API** (API token). Le jeton remplace le mot de passe (les
mots de passe de compte ne sont pas acceptés par l'API REST de JIRA Cloud) et ne
transite jamais par un serveur tiers : il est stocké uniquement dans le navigateur.

Marche à suivre (~1 minute) :

1. Connectez-vous à votre compte Atlassian, puis ouvrez la page de gestion des jetons :
   **<https://id.atlassian.com/manage-profile/security/api-tokens>**
   (ou : avatar en haut à droite de JIRA → **Gérer le compte / Manage account** →
   onglet **Sécurité / Security** → **Créer et gérer les jetons API / Create and
   manage API tokens**).
2. Cliquez sur **Créer un jeton API / Create API token**.
3. Donnez-lui un **libellé** explicite (ex. `Kanban Flow – dashboard Scrum Master`).
   Si un choix de type est proposé, prenez un jeton **classique** (sans portée /
   *scopes*) ; définissez éventuellement une date d'expiration.
4. Cliquez **Créer / Create**, puis **Copier / Copy** : le jeton n'est affiché
   **qu'une seule fois**. Conservez-le le temps de le coller dans l'extension.
5. Notez aussi :
   - l'**URL de votre site** JIRA : `https://votre-domaine.atlassian.net` ;
   - l'**e-mail** du compte Atlassian associé au jeton.

> Sécurité : traitez ce jeton comme un mot de passe. Vous pouvez le **révoquer** à
> tout moment depuis la même page si besoin. Les droits du jeton sont ceux de votre
> compte : vous devez avoir accès en lecture aux projets de vos équipes.

## Configuration

1. Ouvrez ⚙ **Configuration** (bouton dans le tableau de bord).
2. **Connexion JIRA Cloud** :
   - URL du site : `https://votre-domaine.atlassian.net`
   - E-mail Atlassian (celui du compte ayant créé le jeton)
   - Jeton API : celui obtenu à la section **« Obtenir un jeton API JIRA Cloud »**
     ci-dessus (<https://id.atlassian.com/manage-profile/security/api-tokens>)
   - Cliquez **Tester la connexion**.
3. **Réglages des indicateurs** : date de démarrage du macrocycle, agrégation
   (médiane/moyenne), seuil de stabilité, **champ JIRA des story points** (optionnel,
   vide = détection automatique) et **créneaux de comptage du mode Build** (créneau
   « engagé » et créneau « ajouts / retraits » : jour + heures).
4. **Équipes / Projets** : pour chacune de vos 2 équipes, saisissez le nom, la clé de
   projet JIRA, et les **statuts exacts** de votre workflow (séparés par des virgules,
   casse ignorée) :
   - **Type de Kanban** : **Build** ou **Run** ;
   - En mode **Build** : « En cours » (début du cycle time) et « Terminé » (throughput
     réalisé / lead / cycle) ; « Statuts du board » (throughput engagé / ajouts au board) et
     « Backlog » (remises en backlog). Les statuts du board / Backlog sont optionnels :
     sans eux, le throughput engagé et les signaux de flux ne sont pas affichés.
     Case « **Suivre les story points de cette équipe** » pour activer la carte, le
     graphique et la colonne de story points.
   - En mode **Run** : les **labels** identifiant les tickets de run, la/les
     **priorité(s) maximale(s)** (ex. `Highest, Blocker`), les **statuts de
     fermeture** (ex. `Done, Closed`) pour exclure les tickets clos des stats, et les
     **statuts « Backlog » du run** (tickets ouverts non planifiés).
5. **Enregistrer**, puis retournez au tableau de bord et choisissez une équipe.
6. **Sauvegarde de la configuration** : exportez-la dans un fichier JSON (voir
   « Mettre à jour l'extension sans rien ressaisir ») — à faire dès que la config est
   au point, et avant chaque mise à jour.

## Détails techniques

- Manifest V3, compatible Chrome et Firefox (`background.service_worker` /
  `background.scripts`).
- API JIRA : endpoint moderne `POST /rest/api/3/search/jql` (pagination
  `nextPageToken`), + `/rest/api/3/issue/{key}/changelog` en repli si le changelog est
  tronqué, `GET /rest/api/3/priority` (ordre des priorités du site),
  `GET /rest/api/3/field` (détection du champ story points) et
  `GET /rest/api/3/issue/{key}/comment` (premier commentaire, mode Run).
  Authentification **Basic** (e-mail + jeton API).
- Les requêtes cross-origin vers `*.atlassian.net` passent grâce aux
  `host_permissions` de l'extension (contournement propre du CORS, impossible pour une
  simple page web).
- Graphiques SVG maison, **aucun appel réseau à un tiers**.
- Export image : `html2canvas` 1.4.1 (MIT) **vendorisé** dans
  `lib/html2canvas.min.js` — la rasterisation est 100 % locale, aucune donnée ne quitte
  le navigateur. Avant la capture, `lib/export-image.js` recopie en attributs inline les
  styles calculés des `<svg>` (nos barres tirent leur couleur de classes CSS, or
  html2canvas sérialise chaque SVG sans la feuille de style) puis restaure l'état
  initial ; les `<details>` repliés sont ouverts le temps de la capture. Le
  téléchargement passe par un `Blob` + lien `download` : **aucune permission
  supplémentaire** n'est requise.
- Permissions demandées : `storage` uniquement + host `https://*.atlassian.net/*`.

## Structure

```
jira-kanban-dashboard/
├── manifest.json
├── background.js          # ouvre/refocalise l'onglet du dashboard
├── dashboard.html/.css/.js
├── options.html/.css/.js  # configuration (connexion, réglages, équipes)
├── lib/
│   ├── store.js           # config dans chrome.storage.local + export/import JSON
│   ├── jira.js            # client REST JIRA Cloud
│   ├── metrics.js         # moteur build (throughput/lead/cycle/signaux/story points)
│   │                     # + moteur run (ouverts/fermés/créés/résolution), semaines lun→dim
│   ├── charts.js          # graphiques SVG
│   ├── export-image.js    # capture de la page en PNG/JPG (inline des styles SVG)
│   └── html2canvas.min.js # html2canvas 1.4.1 (MIT), vendorisé — rasterisation locale
├── icons/
├── tools/
│   └── build.sh           # construit dist/*.zip (Chrome) et dist/*.xpi (Firefox)
├── docs/
│   ├── INSTALLATION.md    # guide utilisateur : installer, configurer, mettre à jour
│   ├── PUBLICATION.md     # guide mainteneur : releases + options d'auto-update
│   └── updates.json       # modèle de manifeste de mise à jour Firefox (auto-hébergé)
├── .github/workflows/
│   └── release.yml        # build + release GitHub sur étiquette vX.Y.Z
├── CHANGELOG.md           # journal des versions (semver)
├── LICENSE                # MIT
├── THIRD-PARTY.md         # bibliothèques tierces embarquées
└── README.md
```

## Licence

[MIT](LICENSE). Bibliothèques tierces embarquées : voir [THIRD-PARTY.md](THIRD-PARTY.md) (html2canvas 1.4.1, MIT, © Niklas von Hertzen).

## Contribuer / signaler un problème

Ouvrez une **Issue** sur le dépôt en précisant le navigateur, la version de l'extension
(visible dans `chrome://extensions`) et le message d'erreur exact.
**Ne collez jamais votre jeton API JIRA** dans une issue ou un export de configuration
partagé.
