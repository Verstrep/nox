# PROJECT_STATE — État réel du projet

> Ce document décrit ce qui existe **réellement** dans le repository, pas ce qui est prévu.
> Il est mis à jour à la fin de chaque tâche.

**Dernière mise à jour** : 6 août 2026, à l'issue de `TASK-007`.

---

## 1. Phase actuelle

**NOX sait découper le travail.** Après avoir su enregistrer un projet, parler à un runner
local et maintenir les documents Markdown d'un repository, NOX représente désormais les unités
de travail elles-mêmes : des tâches structurées, numérotées, suivies, et accompagnées du
document que liront les agents.

C'est la première fonctionnalité de NOX qui écrit **des deux côtés** — une ligne dans SQLite et
un fichier dans Git — et la première dont l'état peut diverger entre les deux. Ce risque est
traité explicitement, par quatre états de synchronisation et une reprise idempotente.

Aucune exécution n'est déclenchée : les commandes de validation sont stockées, jamais lancées,
et Claude Code n'est appelé nulle part.

Étape correspondante dans la [roadmap](ROADMAP.md) : **étape 7 — gestion structurée des tâches
(terminée)**. L'étape 8 (runner contrôlé) devient l'étape active.

## 2. Tâche active

`TASK-007 — Gestion structurée des tâches de développement` : **terminée**, en attente de review
humaine.

Aucun commit ni push n'a été effectué par Claude Code. Les modifications sont locales et
disponibles pour relecture.

## 3. Éléments terminés

### 3.1 Contrat partagé — `packages/shared/`

- `src/tasks.ts` : `TASK_PRIORITY` (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`),
  `TASK_DOCUMENT_SYNC_STATUS` (`PENDING`, `SYNCED`, `ERROR`, `CONFLICT`), leurs gardes,
  `taskPriorityRank`, la table des transitions autorisées (`canTransitionTaskStatus`,
  `allowedTaskStatusTransitions`, `RESERVED_TASK_STATUSES`), `formatTaskCode`, `isTaskCode`,
  `taskDocumentPath`, et les types `DevelopmentTaskSummary`, `DevelopmentTaskDetail`,
  `TaskSpecification`.
- `src/task-markdown.ts` : `renderTaskMarkdown`, fonction pure et déterministe.
- `src/task-documents.ts` : contrat de `POST /repositories/tasks/create-document`.
- 4 nouveaux codes d'erreur dans `RUNNER_ERROR` (46 au total) : `TASK_CODE_INVALID`,
  `TASKS_DIRECTORY_NOT_DIRECTORY`, `TASKS_DIRECTORY_SYMLINK_NOT_ALLOWED`,
  `TASKS_DIRECTORY_CREATION_FAILED`.
- `TaskStatus` n'est **pas** redéclaré : il vit dans `statuses.ts` depuis TASK-001.
- Le package a désormais un `tsconfig.build.json` distinct, comme `@nox/database` : les tests
  restent typecheckés sans être émis dans `dist/`.

### 3.2 Modèle de données — `packages/database/`

Migration `20260806081236_add_development_tasks`, appliquée sans perte sur la base de
développement.

| Modèle | Rôle | Contraintes |
| --- | --- | --- |
| `Project.nextTaskSequence` | Compteur de numéros, valeur initiale `1` | Ne recule jamais |
| `Task` | Spécification d'une unité de travail | `@@unique([projectId, sequence])` |
| `TaskAcceptanceCriterion` | Un critère, à sa position | `@@unique([taskId, position])` |
| `TaskDocumentReference` | Un chemin relatif à lire | `@@unique([taskId, position])` |
| `TaskValidationCommand` | Une commande, jamais exécutée | `@@unique([taskId, position])` |

Les trois listes enfant sont supprimées en cascade avec leur tâche. Le code affiché
(`TASK-001`) n'est **pas** stocké : il se dérive de `sequence`, immuable.

Fonctions d'accès (`src/tasks.ts`) : `listTasksByProject`, `getTaskById`, `createTask`,
`updateTaskStatus`, `markTaskDocumentSynced`, `markTaskDocumentError`,
`markTaskDocumentConflict`. Elles retournent des types métier de `@nox/shared` et revalident
chaque chaîne lue en base (`InvalidTaskRecordError`).

### 3.3 Allocation des numéros

`createTask` ouvre une transaction, incrémente `nextTaskSequence` par un ordre SQL atomique et
utilise la valeur réservée. `count() + 1` est explicitement écarté
([D-075](DECISIONS.md#d-075--allocation-transactionnelle-du-numéro)).

Vérifié par un test de **quinze créations concurrentes** : quinze codes uniques, quinze lignes
en base. Un test distinct vérifie qu'un numéro libéré n'est jamais réattribué, et un autre que
deux projets numérotent indépendamment.

### 3.4 Générateur Markdown

`renderTaskMarkdown` produit toujours le même fichier pour les mêmes données. Il normalise ses
propres fins de ligne, ramène titre et entrées de liste à une seule ligne, encadre les chemins
en code inline et les commandes dans un bloc `bash` — en allongeant la clôture autant qu'il le
faut si la valeur contient elle-même des accents graves. Les sections facultatives vides ne
laissent pas de titre orphelin, et le fichier se termine par exactement un saut de ligne.

Il ne contient **ni statut, ni priorité, ni date**
([D-083](DECISIONS.md#d-083--le-statut-et-la-priorité-ne-figurent-pas-dans-le-markdown)) : c'est
ce qui rend la comparaison de l'adoption fiable.

### 3.5 API du runner

`POST /repositories/tasks/create-document`, authentifiée, réponse `201`.

Le corps transporte `repositoryPath`, `taskCode` et `content` — **aucun chemin**. Le runner
valide la forme du code (`TASK-` suivi d'au moins trois chiffres) et compose lui-même
`tasks/<code>.md`.

Enchaînement : validation du code → repository → contenu (demi-caractère Unicode isolé, taille)
→ préparation de `tasks/` → création exclusive → relecture. Le contenu est validé **avant** la
préparation du dossier : une requête mal formée ne laisse pas derrière elle un dossier vide.

### 3.6 Le dossier `tasks/`

Seule création de dossier de tout NOX
([D-081](DECISIONS.md#d-081--le-dossier-tasks-est-la-seule-création-de-dossier-autorisée)).

- `mkdir` sans `recursive` : un dossier, jamais une arborescence.
- Permissions `0o755` — le bit d'exécution est indispensable à un dossier.
- Une création concurrente (`EEXIST`) n'est pas une réussite implicite : la nature de ce qui
  occupe la place est revérifiée après coup.
- Refus si `tasks` est un **fichier** (`TASKS_DIRECTORY_NOT_DIRECTORY`), un **lien ou une
  jonction** (`TASKS_DIRECTORY_SYMLINK_NOT_ALLOWED`), ou si le chemin réel sort du repository.
- Aucun sous-dossier n'est jamais créé.

### 3.7 Synchronisation et reprise

Quatre états, affichés dans le backlog et sur la page de détail : `PENDING`, `SYNCED`, `ERROR`,
`CONFLICT`.

La création d'une tâche se fait en deux étapes dissociées : transaction SQLite d'abord,
écriture du document ensuite. Un échec de la seconde ne remet **jamais** la première en cause,
et la redirection vers la page de détail a lieu dans tous les cas.

`synchronizeTaskDocument` est le seul chemin, pour la première tentative comme pour les
suivantes : création exclusive, puis interprétation de ce que le disque répond. Un fichier dont
le contenu correspond exactement au Markdown attendu est **adopté** sans réécriture ; un contenu
différent produit `CONFLICT`, sans que le fichier soit touché. Aucun bouton de forçage
([D-080](DECISIONS.md#d-080--reprise-idempotente-sans-écrasement)).

### 3.8 Interface

| Page | Contenu |
| --- | --- |
| `/projects/[id]` | Carte Taches : total, prêtes, bloquées, liens vers le backlog et la création |
| `/projects/[id]/tasks` | Backlog filtrable par statut, filtre porté par l'URL |
| `/projects/[id]/tasks/new` | Formulaire complet, protection des modifications non enregistrées |
| `/projects/[id]/tasks/[taskId]` | Détail, transitions, état du document, reprise |

Ordre du backlog : tâches non terminées d'abord, puis priorité décroissante, puis numéro
croissant. Un filtre inconnu est ignoré et la page s'affiche entière — jamais d'exception.

Les transitions sont proposées sous forme d'un bouton par transition autorisée : ce que
l'interface offre correspond exactement à ce que le serveur accepte. La vérification serveur
reste entière (`updateTaskStatus`), et `projectId` sert de **filtre** de recherche — une tâche
d'un autre projet est introuvable, pas « refusée ».

Toutes ces pages lisent SQLite : elles restent consultables runner arrêté.

### 3.9 Validations exécutées

| Commande | Résultat |
| --- | --- |
| `npm install` | ✅ aucune dépendance ajoutée |
| `npm run db:generate` | ✅ client Prisma régénéré |
| `npm run db:migrate` | ✅ migration appliquée, les deux projets existants intacts |
| `npm run test` | ✅ **626 tests, 112 suites, 0 échec, 2 ignorés** |
| `npm run lint` | ✅ exit 0 |
| `npm run typecheck` | ✅ exit 0, 4 workspaces |
| `npm run build` | ✅ exit 0, 9 routes |

Les 2 tests ignorés sont ceux de TASK-005 (liens symboliques de fichier sous Windows,
privilège requis) ; leurs équivalents sont couverts par des jonctions.

### 3.10 Test fonctionnel réellement exécuté

Repository Git temporaire **sans dossier `tasks/`**, runner lancé depuis `dist/`, web lancé en
**mode production**, repository enregistré via le vrai formulaire.

**120 vérifications, toutes passées** (69 + 18 + 33), réparties en trois phases car le runner
doit être arrêté puis redémarré au milieu du scénario.

Couvert : backlog vide, création d'une tâche complète, code `TASK-001`, données et listes
ordonnées en base, création automatique de `tasks/`, contenu du Markdown, ouverture du document
dans le lecteur, transition `DRAFT` → `READY` sans réécriture du fichier (`mtime` inchangé),
refus d'un statut réservé, `TASK-002`, filtres du backlog (dont une valeur inconnue et une
tentative d'injection), statistiques de la page projet.

Puis, **runner arrêté** : deux tâches créées malgré la panne, conservées en base avec
`documentSyncStatus = ERROR`, message sûr, page de détail et backlog toujours complets, aucun
fichier écrit.

Puis, **runner redémarré** : reprise réussie, document créé ; adoption d'un fichier identique
déjà présent, vérifiée par un `mtime` inchangé ; conflit avec un fichier étranger, dont le
contenu et l'horodatage restent intacts, y compris après une seconde tentative.

Vérifications finales : quatre documents exactement dans `tasks/`, aucun fichier temporaire,
aucun dossier supplémentaire, quatre numéros uniques, compteur du projet à 5.

Nettoyage : projet de test supprimé de la base, repository temporaire effacé, runner et web
arrêtés, ports 3000 et 4310 libérés. Les projets `Icon dungeon` et `NOX` sont intacts.

## 4. Éléments non commencés

- Exécution des commandes de validation par le runner.
- Génération et prévisualisation du prompt d'une tâche, lancement de Claude Code CLI.
- Streaming de logs : ni SSE ni WebSocket ; aucun modèle `Run`.
- Modification d'une spécification après création, suppression, renumérotation, duplication,
  dépendances entre tâches.
- Suppression, renommage et déplacement de documents ; création de dossiers hors `tasks/`.
- Aperçu Markdown rendu, recherche plein texte, historique, diff visuel.
- Édition, suppression, archivage d'un projet et changement de son statut.
- Intégration OpenAI, suivi des coûts.
- Authentification utilisateur, multi-utilisateur, déploiement.

## 5. Blocages connus

**Aucun blocage.** Toutes les validations passent.

## 6. Dette technique et limites

1. **La modification manuelle d'un `tasks/TASK-xxx.md` ne met pas à jour la tâche.** La base est
   la source de vérité ; l'interface le rappelle sur chaque page de tâche
   ([D-073](DECISIONS.md#d-073--la-base-est-la-source-de-vérité-pendant-task-007)).
2. **Une spécification ne se modifie pas après création.** Seul le statut change. Corriger une
   faute de frappe dans un objectif impose aujourd'hui de créer une nouvelle tâche.
3. **La comparaison d'adoption est exacte, au caractère près.** Un fichier écrit par NOX puis
   normalisé par un outil tiers — fins de ligne, BOM — sera vu comme différent et produira un
   conflit. C'est le comportement voulu, mais il peut surprendre.
4. **Un trou dans la numérotation est possible** après un échec survenu entre la réservation et
   l'enregistrement ([D-076](DECISIONS.md#d-076--les-trous-de-numérotation-sont-acceptés)).
5. **Aucun dossier ne peut être créé depuis NOX**, à l'exception de `tasks/`.
6. **Une coupure de courant pendant une création** peut laisser un fichier vide ou partiel, sans
   possibilité de nettoyage. Le document étant neuf, aucune donnée antérieure n'est en jeu.
7. **Le remplacement de fichier n'est pas garanti atomique sous Windows** (édition). La garantie
   réelle est « jamais de contenu partiel »
   ([D-056](DECISIONS.md#d-056--écriture-par-fichier-temporaire-et-remplacement)).
8. **`beforeunload` ne couvre pas la navigation interne de Next.js.** Cliquer sur un lien pendant
   une saisie non enregistrée perd le texte sans avertissement.
9. **Les documents créés hors des cinq destinations restent invisibles.** Le périmètre
   d'inspection est figé
   ([D-041](DECISIONS.md#d-041--emplacements-inspectés-limités-pas-de-parcours-complet)).
10. **Au-delà de 500 documents, l'inventaire est refusé** plutôt que tronqué.
11. **Ordre de la catégorie `CORE`** : le tri insensible à la casse place `docs/ARCHITECTURE.md`
    avant `README.md`.
12. **Aucun cache.** Chaque affichage réinterroge le runner.
13. **Pas de test de rendu React.** Couverture assurée par les tests unitaires, le test
    d'intégration réel et les tests fonctionnels HTTP en mode production.
14. **Deux tests ignorés sous Windows** : liens symboliques de fichier (privilège requis).
15. Limites héritées : pré-contrôle d'unicité non atomique, jeton en clair dans `.env`, runner
    unique, indicateur de disponibilité non temps réel, TypeScript 5.9 et ESLint 9 figés,
    Node ≥ 22.18 requis.

## 7. Prochaine tâche recommandée

**`TASK-008` — Préparation et lancement manuel d'une tâche Claude Code.**

Objectif : transformer une tâche `READY` en prompt Claude Code, la lancer explicitement via le
runner, enregistrer son exécution et afficher son résultat, sans orchestration OpenAI
automatique.

## 8. État Git

- Aucun commit créé par Claude Code.
- Aucun push effectué.
- Historique Git non modifié.
- Commit de départ : `f86abb7` (`feat: add secure markdown editing`).
- **Le répertoire de travail n'était pas propre** au démarrage de `TASK-007` : les modifications
  de `TASK-006` n'avaient pas été commitées. Elles ont été laissées intactes ; le diff local
  contient donc les deux tâches.
- Les modifications de `TASK-006` et `TASK-007` sont locales, non indexées, disponibles pour
  review.
