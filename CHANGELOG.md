# Journal des versions — Kanban Flow

Versionnage sémantique : `MAJEUR.MINEUR.CORRECTIF`.

- **MAJEUR** : rupture de compatibilité (config existante à refaire).
- **MINEUR** : nouvelle fonctionnalité ou changement de règle de calcul.
- **CORRECTIF** : correction de bug, sans changement de règle ni d'écran.

## 1.24.2

### Ajouté
- **Préparation de la publication GitHub.** Le dépôt est désormais autonome et
  partageable :
  - `LICENSE` (MIT) + mention de html2canvas 1.4.1 (MIT) embarqué.
  - `.gitignore` : exclut `dist/`, les archives et surtout **les exports de configuration**
    (`*kanban-flow-config*.json`, `config-*.json`) pour éviter tout jeton API committé
    par accident.
  - `tools/build.sh` : construit `dist/kanban-flow-<version>.zip` (Chrome) et `.xpi`
    (Firefox) à partir de la version lue dans `manifest.json`, après contrôle syntaxique
    de tous les fichiers JS livrés. Remplace l'archivage manuel
    `jira-kanban-dashboard_vX.Y.zip`.
  - `.github/workflows/release.yml` : sur étiquette `vX.Y.Z`, vérifie que l'étiquette
    correspond à la version du manifest, construit les deux paquets et crée la **release
    GitHub** avec les notes extraites de la section correspondante de ce fichier.
  - `docs/INSTALLATION.md` : guide utilisateur (installer sous Chrome et Firefox,
    créer le jeton API, sauvegarder/restaurer la configuration, mettre à jour, être
    averti des nouvelles versions, dépannage).
  - `docs/PUBLICATION.md` : cycle de publication du mainteneur et les trois scénarios
    réels de mise à jour automatique (GitHub seul ; Firefox signé AMO auto-hébergé ;
    Chrome Web Store en visibilité non répertoriée).
  - `docs/updates.json` : modèle de manifeste de mise à jour Firefox.
- **README** : section Installation réécrite autour des Releases, ajout de la
  construction des paquets, de l'arborescence `tools/`/`docs/`/`.github/`, de la licence
  et des consignes de signalement de bug.

### Inchangé
- Aucun changement de comportement, de règle de calcul ou d'écran de l'extension : seuls
  des fichiers de dépôt et de documentation ont été ajoutés.

## 1.24.1

### Corrigé
- **Exclusivité des comptages aux changements d'heure.** Audit de tous les indicateurs
  pour garantir qu'un ticket compté sur une semaine (ou un jour) ne peut pas l'être
  ailleurs pour le même indicateur. Un seul défaut trouvé : les découpages qui
  utilisaient un pas fixe de 24 h au lieu de jours calendaires.
  - Graphique **« créations par jour »** (mode run) : une semaine de changement d'heure
    fait 167 h ou 169 h. En mars, la 8ᵉ borne tombait 1 h *après* le lundi suivant → un
    ticket créé ce lundi entre 00:00 et 01:00 était compté **à la fois** dans le dimanche
    de la semaine N et dans le lundi de la semaine N+1. En octobre, à l'inverse, la
    dernière heure du dimanche (23:00 → 24:00) n'était comptée **nulle part**. Les bornes
    de jour sont désormais calculées en jours calendaires et plafonnées à la fin réelle
    de la semaine.
  - **Nombre de jours écoulés** dans la semaine en cours : même correction (pouvait
    afficher un jour de trop ou de moins la semaine du changement d'heure).
  - **Créneaux configurables** (throughput engagé, ajouts au board / remises en backlog) :
    les bornes étaient des offsets fixes depuis le lundi 00:00 ; elles dérivaient d'1 h si
    le créneau était configuré sur le dimanche. Bornes désormais calendaires.
  - **Bases de comparaison « à durée écoulée égale »** (fermés, créations, temps moyen de
    résolution) : la fenêtre appliquée à la semaine précédente est maintenant plafonnée à
    la fin de cette semaine, pour qu'elle ne puisse jamais mordre sur la semaine en cours.
- Nouveaux utilitaires internes `weekInstant()` / `addDays()` dans `lib/metrics.js`
  (arithmétique de dates en jours calendaires).

### Inchangé (vérifié, exclusivité déjà correcte)
- Rattachement hebdomadaire via `weekIndexOf()` : intervalles `[lundi 00:00, lundi suivant 00:00[`,
  contigus, sans trou ni chevauchement. Un ticket terminé le lundi à 00:00 pile est compté
  dans la semaine qui commence, jamais dans celle qui finit.
- Build : throughput réalisé, story points, lead time, cycle time (bucket unique par
  date de fin) ; ajouts au board / remises en backlog (bucket unique par date de transition).
- Run : tickets ouverts (date de création), tickets fermés (date de fermeture),
  liste et temps moyen de résolution des fermés de la semaine.

### Note de lecture (comptages volontairement non exclusifs)
Trois indicateurs ne sont **pas** des partitions, par construction — c'est voulu et
documenté dans le README :
- **Throughput engagé** : photo du board au créneau du lundi. Un ticket resté sur le board
  plusieurs semaines est compté chaque semaine (c'est un stock, pas un flux).
- **Tickets ouverts (carte du haut)** : stock actuel, comparé au stock de la fin de semaine
  précédente.
- **Ajouts au board / remises en backlog** : on compte des *transitions*, pas des tickets.
  Un aller-retour la même semaine compte des deux côtés (signal de churn assumé).

## 1.24.0

### Ajouté
- **Export du tableau de bord en image** : bouton `🖼 Exporter l'image` + sélecteur de
  format (**PNG** ou **JPG**) dans la barre du haut, actif dès qu'une équipe est affichée.
  - La capture couvre **toute la page d'indicateurs**, y compris la partie hors écran
    (cartes, graphiques, tableaux, note JQL) — pas seulement la zone visible.
  - Les **listes de tickets repliées sont ouvertes** le temps de la capture puis
    refermées : rien n'est tronqué dans l'image.
  - Un **en-tête** propre à l'image est ajouté : équipe, mode (build / run), période
    analysée, date et heure de génération.
  - Résolution **×2** (image nette en réunion ou dans un compte-rendu) ; fond opaque en
    JPG. Nom de fichier : `kanban-flow_<équipe>_<AAAA-MM-JJ>_<HHhMM>.png|jpg`.
  - Fonctionne pour les **deux modes** (build et run) ; seule la vue affichée est capturée.
- `lib/export-image.js` : module d'export (préparation, rasterisation, téléchargement).
- `lib/html2canvas.min.js` : html2canvas 1.4.1 (MIT) **vendorisé**, rasterisation 100 %
  locale — aucune donnée ne quitte le navigateur, **aucune permission supplémentaire**
  (le fichier est produit via un `Blob` et un lien `download`).

### Détails techniques
- Nos graphiques SVG tirent leurs couleurs de classes CSS ; html2canvas sérialise chaque
  `<svg>` **sans** la feuille de style. Les styles calculés (`fill`, `stroke`,
  `font-*`, `text-anchor`, …) sont donc recopiés en inline sur le DOM avant la capture,
  puis retirés — sinon les barres sortiraient noires.
- L'état de la page est restauré dans un `finally` : styles inline supprimés, `<details>`
  refermés, en-tête d'export masqué, bouton réactivé, même en cas d'échec.

## 1.23.1

### Modifié
- **Documentation remise à jour** (aucun changement de comportement) : le README
  décrivait encore plusieurs règles antérieures à la 1.11.
  - **Throughput engagé** : créneau « engagé » configurable (le README annonçait
    « Ready le lundi 0h–12h » en dur).
  - **Ajouts au board / remises en backlog** : entrée depuis *n'importe quel* statut,
    dans le créneau « ajouts / retraits » configurable (le README décrivait encore
    « Backlog → Ready, lundi 12h → vendredi minuit »).
  - **Tendances** : semaine en cours vs semaine précédente (le README annonçait encore
    « uniquement sur les semaines complètes, 2 minimum »).
  - **Mode Run** : la date de fermeture est lue dans le **changelog** (le README
    affirmait l'inverse) ; ajout des **statuts « Backlog » du run**.
  - Ajout des éléments manquants : créneaux configurables, export/import, story points
    dans la procédure de configuration, endpoints `/priority`, `/field`, `/comment`,
    `CHANGELOG.md` dans l'arborescence.
- **Page de configuration** : les deux aides contextuelles des statuts du board et de
  backlog ne mentionnent plus des créneaux codés en dur mais renvoient aux créneaux
  définis en section 2.

## 1.23.0

### Ajouté
- **Build — suivi des story points (option par équipe)** : nouvelle case
  *« Suivre les story points de cette équipe »* dans la configuration du mode Build.
  Quand elle est activée :
  - **carte de haut de page** « Story points livrés » (semaine en cours, même mise en
    forme et même logique de tendance que les autres indicateurs) ;
  - **graphique « Story points livrés par semaine »**, placé sous le throughput, même
    mise en forme (pleine largeur, semaine en cours en jaune) ;
  - **colonne « Story points »** dans la liste des tickets terminés, insérée **avant**
    les colonnes de lead / cycle time.
- **Champ JIRA des story points** (réglage global, optionnel) : laissé vide, le champ
  est **détecté automatiquement** par son nom (« Story Points », « Story point
  estimate »…) via `GET /rest/api/3/field`. Il peut être forcé (ex. `customfield_10016`)
  si votre site utilise un nom inhabituel.
- L'option et le champ sont inclus dans l'**export / import** de configuration.

### Notes
- Story points livrés = **somme** des points des tickets **terminés dans la semaine**
  (même rattachement hebdomadaire que le throughput réalisé, aucun cumul inter-semaines).
- Les tickets **non estimés** sont comptés dans le throughput mais affichent `–` dans la
  colonne et n'entrent pas dans la somme ; la note de la carte indique le nombre de
  tickets estimés.
- Si l'option est activée mais que le champ reste introuvable, la carte l'indique
  explicitement et le reste du tableau de bord fonctionne normalement.

## 1.22.1

### Modifié
- **Run — cartes de haut de page** : les 4 chiffres clés (tickets ouverts, fermés,
  créés, temps moyen de résolution) adoptent le **même style que les cartes du mode
  build** : chiffre en couleur de texte normale au lieu du jaune. Le jaune étant une
  couleur d'avertissement, il est réservé aux alertes et au codage catégoriel des
  graphiques ; l'appartenance à la semaine en cours reste portée par le badge
  « en cours » et la bordure ambrée de la carte (encodage redondant, conforme aux
  recommandations d'accessibilité).
- La règle CSS `#buildView .card-current .metric` devient globale
  (`.card-current .metric`) : les deux modes partagent désormais un seul traitement.
- Sous-titre de la vue run reformulé (il annonçait des chiffres « en jaune »).

## 1.22.0

### Ajouté
- **Mode Run — statuts « Backlog » configurables** : nouveau champ *Statuts « Backlog » du run (tickets non planifiés)* dans la configuration du projet en mode Run. Tout statut non listé est considéré comme étant **dans le board** (à traiter).
- **Mode Run — nouvelle liste « Tickets ouverts non planifiés (backlog) »**, placée sous la liste des ouverts du board, avec la même constitution, le même tri (priorité décroissante puis création croissante) et la même mise en forme (pastilles d'ancienneté + légende).

### Modifié
- La liste **« Tickets ouverts »** du run devient **« Tickets ouverts dans le board »** et **exclut** les tickets dont le statut figure dans les statuts backlog du run.
- La carte KPI **« Tickets ouverts »** reste inchangée : elle compte **tous** les tickets de run ouverts (board + backlog).

## 1.21.0

### Build — présentation des indicateurs et du cycle time
- Les **chiffres des cartes** de haut de page ne sont plus en jaune : le jaune est une couleur d'avertissement, inadaptée à une donnée neutre. Ils passent en couleur de texte normale (contraste maximal) ; l'appartenance à la semaine en cours reste portée par le badge « en cours » et la bordure de la carte (encodage redondant).
- Le graphique **Throughput par semaine** occupe désormais **toute la largeur** de la page.
- Les graphiques **Lead time** et **Cycle time** sont placés **côte à côte** sur la ligne suivante.
- Dans la liste des tickets terminés cette semaine, la colonne **Cycle (j)** reçoit les **pastilles colorées + infobulles** (mêmes couleurs que le mode run) : vert ≤ 2 jours, ambre 2–4 jours, rouge > 4 jours. Légende ajoutée sous la liste.

## 1.20.0

### Run
- **Nouvel indicateur (4ᵉ carte) : « Temps moyen de résolution »** = moyenne
  `création → fermeture` des tickets **fermés pendant la semaine en cours**.
- Même **encodage visuel** que les colonnes de durée des listes : pastille colorée
  (vert ≤ 1 j, ambre ≤ 2 j, rouge > 2 j) + infobulle, texte au contraste normal,
  et légende des seuils sous la carte.
- **Tendance** comparée à la moyenne de la semaine précédente sur la **même durée
  écoulée** (cohérent avec les cartes « fermés » et « créés »).
  Plus court = meilleur (`higherIsBetter = false`).

## 1.19.0

### Run
- **Liste des tickets en priorité maximale** : tri par **priorité décroissante** puis
  **date de création croissante** (avant : date de création décroissante uniquement).
- Les colonnes **« Création → 1er commentaire »** et **« Création → résolution »**
  reprennent les **pastilles colorées + infobulles** des compteurs d'ancienneté
  (vert ≤ 1 j, ambre ≤ 2 j, rouge > 2 j), avec légende sous la liste.
- **Liste des tickets fermés cette semaine** : nouvelle colonne
  **« Ouverture → fermeture »** (durée totale, même code couleur et même légende).

## 1.18.1

### Corrigé
- **Run — lisibilité des compteurs d'ancienneté** : suppression du fond coloré
  (vert/orange/rouge clair) des colonnes « Depuis ouverture » et « Depuis
  dernière action », hérité d'un thème clair et hors charte du tableau de bord
  sombre. Le seuil est désormais indiqué par une **pastille de couleur** devant
  la valeur, avec **infobulle textuelle** (« Plus de 2 jours »…) et une
  **légende** sous la liste. Le texte reste dans la couleur normale du tableau
  pour garantir le contraste ; seul le seuil critique reçoit une emphase en
  gras. Encodage redondant (forme + couleur + texte) conforme aux
  recommandations d'accessibilité : l'information n'est jamais portée par la
  seule couleur.

## 1.18.0

### Modifié (mode Run)
- **Liste des tickets ouverts** : deux nouveaux compteurs — **temps depuis l'ouverture** et **temps depuis la dernière action** (champ `updated`) — colorés **vert** (0–1 jour), **orange** (1–2 jours), **rouge** (> 2 jours).
- **Carte « Variance créations / 24h » remplacée** par **« Tickets créés »** : nombre de tickets créés pendant la semaine en cours, comparé aux créations de la semaine précédente sur la **même durée écoulée** (`createdThisWeek` / `createdPrevSameElapsed`). La variance sur 24h glissantes est supprimée.
- **Cartes supprimées** : « Non assignés (ouverts) » et « Priorité max » (l'information reste dans les listes).
- **Ordre des listes** : priorité maximale, puis non assignés, puis ouverts, puis fermés.
- **Liste des tickets fermés** restreinte aux tickets **fermés pendant la semaine en cours** (avant : tous les tickets fermés de la fenêtre).
- **Liste des tickets ouverts** : tous les tickets non résolus, quelle que soit leur date de création (inchangé, désormais garanti par le JQL).
- `buildRunJql` rapatrie aussi les tickets **résolus pendant la fenêtre** (`resolutiondate >= … AND < …`), pour ne pas manquer un ticket fermé cette semaine mais créé avant la fenêtre.

## 1.17.0

### Modifié
- **Run — tickets créés par jour** : le samedi et le dimanche ne sont affichés sur le graphique que s'ils portent au moins une création (semaine en cours ou semaine précédente). Les jours du lundi au vendredi restent toujours affichés, même à zéro.
- **Run — carte « Tickets fermés »** : la tendance ne compare plus la semaine en cours à la **semaine précédente entière** mais à la **même durée écoulée** de la semaine précédente (nouveau champ `closedPrevSameElapsed`). Exemple : le mardi à 14 h, on compare aux fermetures du lundi 00:00 au mardi 14:00 de la semaine précédente. La note de la carte affiche les deux valeurs (même période et semaine entière).

## 1.16.0

### Modifié
- **Run** : le graphique « Variance des créations » est remplacé par **« Tickets créés par jour »**
  (lundi → dimanche), semaine en cours comparée à la semaine précédente. La carte KPI de variance
  (et son écart-type) est conservée.
- **Run** : la liste des **tickets ouverts** est triée par **priorité décroissante** puis par date de
  création **croissante** (les plus anciens d'abord). La liste des **tickets fermés** est triée par
  priorité décroissante puis par date de fermeture **décroissante**. L'ordre des priorités est lu
  depuis JIRA (`/rest/api/3/priority`), avec un ordre de repli si l'appel échoue.
- **Build** : la carte **Throughput engagé** est désormais affichée **avant** le Throughput réalisé.
- **Build** : la liste de détail n'affiche plus que les tickets **terminés dans la semaine en cours**.
- **Build + Run** : tous les graphiques ont la **même taille** (plus de panneau sur 2 colonnes).
- **Build + Run** : toutes les listes de tickets sont **repliables** (`<details>`), fermées par défaut.

## 1.15.0

### Modifié
- **Build — tendances de haut de page** : la comparaison se fait désormais entre la
  **semaine en cours** et la **semaine précédente** (auparavant : deux dernières
  semaines complètes). Concerne throughput réalisé, engagé, lead time et cycle time.
- **Run — carte « Tickets ouverts »** : la valeur reste le total de tickets de run
  actuellement ouverts ; la tendance compare ce stock au nombre de tickets encore
  ouverts **à la fin de la semaine précédente**.
- **Run — carte « Tickets fermés »** : la valeur devient le nombre de tickets
  **fermés pendant la semaine en cours**, comparé à la semaine précédente.
- **Run — graphiques** : « ouverts par semaine » et « fermés par semaine » sont
  fusionnés en un **seul graphique à barres groupées**.
- Une seule semaine précédente suffit désormais pour afficher une tendance.

### Corrigé
- **Run — variance des créations** : les fenêtres 24 h glissantes de la semaine en
  cours sont bornées à l'instant présent (les heures non écoulées comptaient 0
  création et écrasaient la variance). La comparaison se fait contre la **même
  durée écoulée** de la semaine précédente, et l'indicateur est signalé comme non
  significatif tant que moins de 24 h se sont écoulées. L'écart-type (en tickets)
  est affiché en complément de la variance (en tickets²).

## 1.14.1

### Corrigé
- **Mode Run — colonne « Fermé le »** : la date d'entrée dans le statut de fermeture est désormais lue dans le changelog du ticket, pour **tous** les statuts de fermeture configurés (Done, Cancelled, …). Auparavant, un ticket sans `resolutiondate` (cas typique de « Cancelled ») affichait son statut entre parenthèses au lieu d'une date, et était compté comme fermé « maintenant ».
- Conséquence : la série hebdomadaire « tickets fermés » range désormais ces tickets dans la **bonne semaine**.
- Une date approximée (ticket clos par statut sans trace dans le changelog) est signalée par un suffixe `~`.

## 1.14.0

- **Mode Run — suppression des cumuls entre semaines.** « Tickets ouverts par semaine » et « Tickets fermés par semaine » étaient des **cumuls** (encours / total clos à la fin de chaque semaine), ce qui recomptait les tickets des semaines précédentes.
  - **Tickets ouverts par semaine** = tickets dont la **date de création** tombe dans la semaine, quel que soit leur statut.
  - **Tickets fermés par semaine** = tickets dont la **date de fermeture** tombe dans la semaine.
  - Bornes de semaine `[lundi 00:00, lundi suivant 00:00[`, exclusives : un ticket ne peut être compté que dans une seule semaine.
- Libellés du tableau de bord ajustés (« créés dans la semaine » / « fermés dans la semaine »).
- Audit du mode Build : throughput, lead time, cycle time, engagé, ajouts au board et retours en backlog étaient déjà strictement hebdomadaires — aucune correction nécessaire.

## 1.13.0

- **Nouveau** — Les créneaux de comptage du mode Build sont **configurables** (⚙ Configuration → « 2. Réglages des indicateurs » → *Créneaux de comptage*). Réglage **global**, appliqué à toutes les équipes build :
  - créneau **engagé** : jour + heure de début + heure de fin (défaut : lundi 00:00 → 12:00) ;
  - créneau **ajouts au board / remises en backlog** : jour + heure de début et jour + heure de fin, borne de fin **exclue** (défaut : lundi 12:00 → samedi 00:00, soit vendredi fin de journée).
- Les libellés du tableau de bord (carte engagé, en-têtes du tableau de signaux, légende, synthèse de la semaine) s'adaptent automatiquement aux créneaux configurés.
- Les créneaux sont inclus dans l'export/import de configuration ; toute valeur absente ou invalide retombe sur le comportement historique.
- Aucune reconfiguration nécessaire : les valeurs par défaut reproduisent exactement les règles précédentes.

## 1.12.1

- Renommage des libellés : « Statuts Ready » devient **« Statuts du board (tickets à faire par l'équipe) »**, « Ajoutés en Ready » devient **« Ajoutés au board »**. Clés de configuration inchangées (`readyStatuses` / `backlogStatuses`) : aucune reconfiguration nécessaire.
- Aides contextuelles ajoutées sous les deux champs de statuts, rappelant les créneaux utilisés.
- Règles de calcul **inchangées** : engagé = sur le board lundi 0h→12h ; ajouts au board et remises en backlog = lundi 12h → vendredi fin de journée.

## 1.12.0

- **Nouveau** — Export / import de la configuration (⚙ Configuration → section « 4. Sauvegarde de la configuration ») : simplifie les mises à jour de l'extension et le partage des réglages entre collègues.
  - Export vers un fichier `kanban-flow-config_AAAA-MM-JJ.json` (connexion, réglages, équipes, statuts, labels, priorités).
  - Le **jeton API n'est pas exporté par défaut** (case à cocher explicite) ; à l'import, un fichier sans jeton ne supprime jamais celui déjà enregistré.
  - Validation du fichier à l'import (`app`, `formatVersion`), normalisation des statuts (`trim`), régénération des identifiants manquants, confirmation avant écrasement, puis enregistrement automatique.
- **Documentation** — section « Mettre à jour l'extension sans rien ressaisir » dans le README (procédure de mise à jour, gestion du jeton, partage à un collègue).

## 1.11.0

- **Correction** — « Ajoutés en Ready » : la règle exigeait une transition `Backlog → Ready`, ce qui donnait toujours 0. Désormais toute entrée en statut *Ready* depuis un autre statut est comptée, dans le créneau `[lundi 12:00, samedi 00:00[`.
- **Correction** — « Remis en backlog » : ajout du filtre horaire manquant (même créneau `[lundi 12:00, samedi 00:00[`).
- **Robustesse** — comparaison des noms de statuts en `trim()` + minuscules ; les noms de statuts sont aussi *trimés* avant injection dans le JQL.
- **Requêtes JQL** — bornage des deux côtés (`AFTER … BEFORE …`) dans `buildJql`, `buildChurnJql` et `buildRunJql` via le nouveau paramètre `windowEnd`. Aucun impact sur les chiffres (la fenêtre finit toujours sur la semaine en cours), mais requêtes plus explicites et moins volumineuses.
- **Documentation** — procédure pas-à-pas pour créer un jeton API JIRA Cloud ; libellés du tableau « Signaux de flux » alignés sur les règles réelles.

## 1.10.0

- Mode Run : statistiques de **tickets fermés** en parallèle des tickets ouverts (carte, graphique hebdomadaire, liste avec date de fermeture).

## 1.9.0

- Mode Run : prise en compte des **statuts de fermeture** configurés (les tickets clos par statut sortent des stats d'ouverts).

## 1.8.0

- Nouveau **mode Run** par projet (labels de run, priorités max, statuts de fermeture) : tickets ouverts, variance des créations sur 24 h glissantes, non assignés, priorités maximales avec délais.

## 1.7.0

- Repasse graphique : la semaine en cours est systématiquement distinguée (cartes, barres, courbes, tableau) en tons chauds.

## 1.6.0

- « Ajoutés en Ready » recalé sur le créneau `lundi 12:00 → vendredi minuit`.

## 1.5.0

- Throughput engagé mesuré sur le créneau `lundi 0h → 12h` ; engagé et réalisé fusionnés dans un graphique à barres groupées.

## 1.4.0

- Throughput engagé = instantané du lundi ; définitions ajouts/retraits affinées.

## 1.3.0

- Throughput engagé, signaux de flux (ajouts en Ready, retours en backlog), semaine en cours en jaune.

## 1.2.0

- Lead time et cycle time bornés à la date de démarrage du macrocycle.

## 1.1.0

- Réglage « date de démarrage du macrocycle », gestion des cas futur / semaine courante, tendances sur semaines complètes.

## 1.0.0

- Version initiale : throughput, lead time, cycle time et tendances par équipe.
