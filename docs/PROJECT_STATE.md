# PROJECT_STATE — État réel du projet

> Ce document décrit ce qui existe **réellement** dans le repository, pas ce qui est prévu.
> Il est mis à jour à la fin de chaque tâche.

**Dernière mise à jour** : 6 août 2026, à l'issue de `TASK-009`.

---

## 1. Phase actuelle

**NOX sait défaire ce qu'il a fait.** Jusqu'ici, tout ce que l'outil créait — documents de test,
tâches d'essai — restait à supprimer à la main dans VS Code. C'est la première tâche qui **retire**
quelque chose, et donc la première dont le risque n'est pas de perdre une modification mais de
perdre un fichier entier.

Deux garde-fous portent tout le reste. Une suppression exige la **même révision** qu'une écriture :
on ne supprime pas une version qu'on n'a pas vue. Et une tâche possédant un **historique
d'exécution** n'est jamais supprimable : un run est un fait, pas un brouillon.

L'interface change aussi de registre : les **micro-éléments techniques** — statuts, priorités,
petites actions — passent en anglais et portent désormais les mêmes noms que les valeurs internes,
tandis que tout ce qui explique, avertit ou questionne reste en français.

Étape correspondante dans la [roadmap](ROADMAP.md) : **étape 9 — suppression sécurisée et libellés
d'état (terminée)**. L'étape 10 (streaming et annulation) devient l'étape active, mais elle ne doit
pas commencer avant l'installation de Claude Code et un premier run réel contrôlé.

## 2. Tâche active

`TASK-009 — Suppression sécurisée et libellés d'état en anglais` : **terminée**, en attente de
review humaine.

Aucun commit ni push n'a été effectué par Claude Code. Les modifications sont locales et
disponibles pour relecture.

## 3. Éléments terminés

### 3.1 Contrat partagé — `packages/shared/`

- `src/runs.ts` : états finaux (`FINAL_RUN_STATUSES`, `isFinalRunStatus`), `formatRunCode`,
  `isRunnerRunId`, bornes de tout contenu extérieur (`RUN_LIMITS`, `boundText`, `boundTail`),
  table des transitions **automatisées** (`canAutomateTaskStatusTransition`),
  `taskStatusForRunOutcome`, et les types `DevelopmentRunSummary` / `DevelopmentRunDetail`.
- `src/claude-prompt.ts` : `renderClaudeExecutionPrompt`, pure et déterministe.
- `src/claude-commands.ts` : validation des commandes de validation et construction de la
  politique d'outils.
- `src/claude.ts` : contrat des trois routes Claude Code.
- 18 nouveaux codes d'erreur dans `RUNNER_ERROR` (64 au total).
- Les transitions **manuelles** de `src/tasks.ts` gagnent quatre sorties : `REVIEW → COMPLETED`,
  `REVIEW → READY`, `FAILED → READY`, `FAILED → BLOCKED`. Les trois statuts réservés restent
  sans **entrée** manuelle.

### 3.2 Modèle de données — `packages/database/`

Migration `20260806125516_add_claude_runs`, appliquée sans perte sur la base de développement.

| Élément | Rôle |
| --- | --- |
| `Task.nextRunSequence` | Compteur d'exécutions propre à la tâche, valeur initiale `1` |
| `Run` | Une exécution, avec `@@unique([taskId, sequence])` |

`Run` conserve le **prompt exact** envoyé et son empreinte : la spécification de la tâche pourra
évoluer, le prompt réellement transmis, non. Les champs Claude et Git sont facultatifs — ils
n'existent qu'une fois le processus terminé, et certains ne sont garantis par aucune version.

Fonctions d'accès (`src/runs.ts`) : `createRun`, `getRunById`, `listRunsByTask`,
`markRunRunning`, `completeRun`, `failRun`, `blockRun`, `updateRunFromRunner`, `hasActiveRun`,
`startTaskExecution`, `cancelTaskExecution`.

**Un état final ne redevient jamais actif.** C'est cette règle qui rend l'interrogation
idempotente : une réponse tardive ne peut pas rouvrir une exécution conclue, ni remettre en
`RUNNING` une tâche que l'utilisateur relit déjà. Le run et sa tâche sont mis à jour dans la
même transaction.

### 3.3 Prompt d'exécution

Fonction pure. Il nomme la tâche, impose la lecture de `CLAUDE.md`, d'`AGENTS.md`, du document
de tâche et des documents référencés, énonce l'objectif, le contexte, les critères et le
hors-périmètre, puis les règles — dont l'interdiction de commiter, de pousser et de changer de
branche. Il annonce explicitement les commandes autorisées comme **les seules préautorisées**, et
demande un compte rendu structuré en huit sections.

Il ne contient **ni chemin absolu, ni jeton, ni variable d'environnement, ni statut, ni
priorité**, et **référence** les documents au lieu de les recopier. Son empreinte SHA-256 est
affichée avant lancement et conservée avec l'exécution.

### 3.4 Préflight — `apps/runner/src/claude/preflight.ts`

`POST /claude/preflight`, authentifiée, **strictement en lecture**. Cinq commandes Git via
`execFile` sans shell, aucune écriture, aucun `fetch`.

Refus possibles : `REPOSITORY_DIRTY`, `GIT_DETACHED_HEAD`, `GIT_UPSTREAM_MISSING`,
`GIT_NOT_SYNCHRONIZED`, `GIT_PREFLIGHT_FAILED`, `CLAUDE_NOT_AVAILABLE`. Git est vérifié avant
Claude Code : un repository sale se corrige en trente secondes, une installation manquante non.

L'avance et le retard sont mesurés contre la **référence upstream locale**. L'interface le dit
explicitement plutôt que de laisser croire à une vérification du serveur distant.

### 3.5 Invocation de Claude Code

| Aspect | Choix |
| --- | --- |
| Mode | `-p --output-format json --max-turns <borné>` |
| Prompt | Écrit sur `stdin`, puis l'entrée est fermée |
| `cwd` | Racine canonique du repository, aucun dossier supplémentaire |
| Environnement | Toutes les variables `NOX_*` retirées ; `ANTHROPIC_*` intactes |
| Permissions | `Read`, `Edit`, `Write`, `Glob`, `Grep`, Git en lecture seule, plus une règle **exacte** par commande enregistrée |
| Refus explicites | `git commit/push/reset/checkout/switch/clean/restore/rebase/merge/stash`, `rm`, `rmdir`, `del`, `Remove-Item`, `curl`, `wget` |
| Jamais passé | `--dangerously-skip-permissions`, `--continue`, `--resume`, `--add-dir`, config MCP, modèle imposé, clé d'API |
| Délai | Configurable, borné ; arrêt de l'arbre de processus, puis arrêt forcé |

Sous Windows, un `claude.cmd` est enveloppé dans `cmd.exe /d /s /c` avec une **liste d'arguments
fixe** — aucune concaténation, et le prompt reste hors de la ligne de commande.

Une commande de validation qui ne peut pas être représentée exactement **bloque le lancement**.
Les caractères acceptés forment une liste fermée : opérateurs de chaînage, redirections,
guillemets et virgules sont refusés — la virgule parce qu'elle sépare les règles transmises.

### 3.6 Registre en mémoire

Vingt exécutions terminées conservées, vingt-quatre heures de rétention, **une seule active**
tous projets confondus. Une entrée active n'est jamais supprimée, quels que soient son âge et le
nombre d'entrées. Le premier état final gagne : une fin de processus arrivant après un
dépassement de délai n'efface pas la raison de l'arrêt.

Un redémarrage du runner perd le registre — limite assumée, et **visible** : le web marque
l'exécution bloquée avec `CLAUDE_RUN_NOT_FOUND` et invite à vérifier le repository, sans
prétendre connaître le résultat.

### 3.7 Interrogation et persistance

Le navigateur interroge un Route Handler de Next.js toutes les deux secondes. Il ne parle
**jamais** au runner : le jeton ne quitte pas le serveur. Le Route Handler vérifie la chaîne
projet → tâche → exécution, réconcilie l'état, et ne renvoie que le statut.

Un runner injoignable ne conclut rien — l'exécution continue peut-être. Un runner qui répond
mais ne connaît plus l'exécution conclut, lui : le suivi est perdu et le restera.

### 3.8 Interface

| Page | Contenu |
| --- | --- |
| `/projects/[id]/tasks/[taskId]` | Historique des exécutions, bouton de préparation si `READY` |
| `…/runs/new` | Préconditions, état Git, commandes autorisées, prompt et empreinte, avertissement |
| `…/runs/[runId]` | Statut, métadonnées Claude, compte rendu, état Git, erreur, prompt envoyé |
| `/api/…/runs/[runId]/status` | Route Handler d'interrogation, données publiques uniquement |

Le prompt n'est pas modifiable : ce n'est pas un champ du formulaire. Trois valeurs seulement
sont transmises — projet, tâche, `HEAD` attendu.

### 3.9 Suppression de documents — `TASK-009`

`POST /repositories/documents/delete`, authentifiée. Le contrat exige `expectedRevision` :
supprimer sans révision est refusé **syntaxiquement**, pas seulement à l'exécution.

Le module `delete-document.ts` réutilise `resolveDocumentPath` et le contrôle d'empreinte tels
quels — il n'existe pas de quatrième logique de validation de chemin. Il ajoute quatre refus :
document géré par une tâche, lien symbolique, dossier, révision différente. La suppression est
un `unlink`, jamais un `rmdir`, et l'absence du fichier est **constatée** avant d'annoncer une
réussite.

Les chemins de la forme `tasks/TASK-<chiffres>.md` sont refusés (`DOCUMENT_PROTECTED`), avec une
comparaison insensible à la casse : sous Windows, `Tasks/task-001.MD` désigne le même fichier.
Les autres documents de `tasks/` restent ordinaires.

### 3.10 Suppression du document d'une tâche

`POST /repositories/tasks/delete-document`, authentifiée. Comme à la création, le corps ne porte
**aucun chemin** : le runner compose `tasks/<code>.md` à partir du code, après en avoir vérifié
la forme. C'est la seule route autorisée à toucher aux fichiers que la précédente protège.

| Situation | Réponse |
| --- | --- |
| Document présent, révision correcte | `deleted: true` |
| Document absent, ou dossier `tasks/` absent | `deleted: false, alreadyAbsent: true` — réussite |
| Document présent, révision inconnue | `TASK_DOCUMENT_REVISION_UNKNOWN` (`409`) |
| Document présent, révision différente | `DOCUMENT_DELETE_CONFLICT` (`409`) |

Le dossier `tasks/` n'est ni créé ni supprimé par cette route.

### 3.11 Suppression d'une tâche

`deleteTaskWithoutRuns(db, projectId, taskId)` supprime la tâche et ses trois listes enfant dans
une transaction, après avoir **relu le nombre d'exécutions dans cette transaction** — une
exécution a pu démarrer depuis l'affichage de la page. La relation `Run → Task` passe de
`Cascade` à `Restrict` : même un appel direct à Prisma échoue.

`Project.nextTaskSequence` n'est jamais décrémenté. `TASK-001` supprimée, la suivante est
`TASK-004`.

L'ordre est **runner puis base**. Un runner injoignable ne supprime rien ; un échec en base après
une suppression réussie du fichier est rapporté honnêtement, sans recréer le fichier en silence.

### 3.12 Libellés d'interface

`apps/web/lib/labels.ts` est la seule couche qui traduit une valeur interne. `task-display.ts` et
`run-display.ts` ne gardent que les tons, les URL et les formats.

| Famille | Libellés |
| --- | --- |
| Statut de tâche | `Draft`, `Ready`, `Running`, `Blocked`, `Failed`, `Review`, `Done` |
| Statut d'exécution | `Queued`, `Running`, `Blocked`, `Failed`, `Cancelled`, `Completed` |
| Synchronisation | `Pending`, `Synced`, `Error`, `Conflict` |
| Priorité | `Low`, `Medium`, `High`, `Critical` |
| Transitions | `Mark ready`, `Mark blocked`, `Mark done`, `Back to draft`, `Reopen`, `Approve`, `Retry` |
| Actions compactes | `Edit`, `Save`, `Cancel`, `Delete`, `Delete task`, `Retry`, `New run`, `Run Claude Code` |

Restent en français : navigation, titres, sous-titres, descriptions, formulaires, avertissements,
confirmations, messages d'erreur détaillés. **Aucune valeur interne n'a changé** — un test le
vérifie explicitement.

### 3.13 Interface de suppression

Les deux confirmations sont portées par l'URL (`?confirmDelete=1`) et non par un état de
composant : elles sont rendues par le serveur, fonctionnent sans JavaScript, et « annuler » est
une navigation ordinaire.

- **Document** : bouton `Delete` dans l'en-tête du lecteur, uniquement si le document a été lu
  (donc révision connue et runner disponible) et n'est pas géré par une tâche. La confirmation
  nomme le fichier, affiche son chemin relatif, et avertit en français.
- **Tâche** : section « Supprimer la tâche ». Le bouton disparaît dès qu'une exécution existe, et
  une explication française prend sa place. La confirmation exige de recopier le code exact.

### 3.14 Validations exécutées

| Commande | Résultat |
| --- | --- |
| `npm install` | ✅ aucune dépendance ajoutée |
| `npm run db:generate` | ✅ client Prisma régénéré |
| `npm run db:migrate` | ✅ `20260806182745_restrict_run_deletion` appliquée, données intactes |
| `npm run test` | ✅ **1046 tests, 198 suites, 0 échec, 4 ignorés** |
| `npm run lint` | ✅ exit 0 |
| `npm run typecheck` | ✅ exit 0, 4 workspaces |
| `npm run build` | ✅ exit 0, 12 routes |

Les 4 tests ignorés concernent les liens symboliques **de fichier** sous Windows, qui exigent un
privilège. Les cas d'évasion correspondants restent couverts par des jonctions, qui n'en
demandent aucun.

### 3.15 Test fonctionnel de TASK-009

Repository Git temporaire avec remote `bare` local, base SQLite **isolée**, runner réel et web en
**mode production** — la base de développement n'a jamais été touchée. Aucun appel Claude.

**185 vérifications, toutes passées**, en quatre exécutions.

- **103** : enregistrement du projet ; création puis suppression de `docs/DELETE_ME.md` (disparu
  du disque et de l'inventaire, `docs/` conservé) ; conflit de révision sur `docs/CONFLICT.md`
  modifié hors de NOX, version B intacte, aucun bouton de forçage ; document de tâche protégé —
  bouton absent de l'interface **et** `DOCUMENT_PROTECTED` renvoyé par l'API, y compris avec une
  orthographe différente ; suppression d'une tâche sans exécution avec son Markdown et ses
  enfants ; `TASK-002` après suppression de `TASK-001` ; refus sur une tâche avec exécution ;
  libellés anglais et textes français.
- **5** : préparation d'une tâche supprimable et capture des formulaires avant la panne.
- **12** : runner arrêté — la page ne propose même plus de suppression, et une page ouverte avant
  la panne ne supprime **rien**, ni fichier ni ligne en base.
- **65** : runner redémarré, la suppression aboutit ; puis vérification de chaque libellé
  (`Draft`, `Ready`, `Running`, `Review`, `Done`, `Failed`, `Pending`, `Synced`, `Error`,
  `Conflict`, `Low`, `Medium`, `High`, `Critical`, `Approve`, `Reopen`, `Retry`) et absence de
  tout libellé français de statut sur quatre pages.

À la fin, le repository temporaire : `HEAD` identique à `origin/main`, **un seul commit**,
suppressions et créations laissées non commitées. Nettoyage complet — repository, remote, base et
processus.

### 3.16 Test fonctionnel de TASK-008

Repository Git temporaire **avec un remote `bare` local**, propre et synchronisé. Runner lancé
depuis `dist/` avec un **faux Claude Code** ; web lancé en **mode production**.

**145 vérifications, toutes passées**, en cinq phases.

- **67** : enregistrement, création d'une tâche, passage à `READY`, page de préparation (prompt,
  empreinte, commandes autorisées, état Git, version), lancement, `RUN-001`, métadonnées Claude
  persistées, tâche en `REVIEW`, fichier réellement modifié, `HEAD` inchangé, page de résultat,
  acceptation du travail.
- **49** : limite d'utilisation → `BLOCKED` sans heure inventée ; sortie non JSON → `FAILED` ;
  repository sale → refus avec le run conservé ; branche en avance → refus ; vérification des
  arguments réellement passés.
- **6 + 6** : lancement d'une exécution longue rendant la main en moins de huit secondes, puis
  vérification qu'elle s'est terminée seule et que son résultat a été persisté — **sans qu'aucun
  navigateur ne reste ouvert**.
- **11** : runner redémarré pendant une exécution → run et tâche `BLOCKED`,
  `CLAUDE_RUN_NOT_FOUND`, aucun résultat inventé, page invitant à vérifier le repository.

Vérifié sur les arguments réellement transmis au processus : prompt arrivé par `stdin`, `cwd`
égal à la racine, **aucune variable `NOX_*`**, aucun `--dangerously-skip-permissions`, aucune
clé d'API, `Bash(npm run test)` autorisée, `Bash(git push:*)` refusée.

Nettoyage : projet de test supprimé, repository et remote temporaires effacés, faux Claude
retiré, runner et web arrêtés, ports libérés. Les projets `Icon dungeon` et `NOX` sont intacts,
et la base ne contient aucune exécution.

## 4. Éléments non commencés

- Streaming des événements Claude Code, annulation manuelle d'une exécution.
- Reprise d'une session Claude, prompt correctif automatique.
- Diff complet dans l'interface ; extraction du résultat des validations.
- Suppression d'un projet, d'une exécution, ou d'une tâche possédant un historique.
- Archivage, corbeille, restauration, suppression en masse, renommage, déplacement.
- Modification d'une spécification après création, renumérotation, duplication,
  dépendances entre tâches.
- Plusieurs agents en parallèle, worktrees, plusieurs comptes Claude.
- Commits et push automatiques.
- Intégration OpenAI, suivi des coûts au-delà de ce que Claude Code rapporte.
- Authentification utilisateur, multi-utilisateur, déploiement.

## 5. Blocages connus

**Aucun blocage.** Toutes les validations passent.

⚠️ **Une réserve à connaître** : la syntaxe des arguments de Claude Code n'a **pas** pu être
vérifiée contre un binaire local — `claude` n'est pas installé sur la machine de développement.
Les drapeaux suivent la forme documentée du mode non interactif ; `buildClaudeArguments`,
`formatBashRule` et `probeClaudeVersion` sont isolées pour qu'un écart se corrige en un seul
endroit. Le premier lancement réel le confirmera ou l'infirmera.

## 6. Dette technique et limites

1. **Un redémarrage du runner perd le suivi d'une exécution en cours.** Le registre est en
   mémoire ([D-094](DECISIONS.md#d-094--registre-en-mémoire-limite-assumée)).
2. **Aucun streaming** : l'interrogation dit si c'est fini, pas ce que l'agent écrit
   ([D-095](DECISIONS.md#d-095--interrogation-périodique-plutôt-que-flux-dévénements)).
3. **Aucune annulation manuelle.** Une exécution partie va au bout, ou atteint son délai.
4. **Une seule exécution active**, tous projets confondus.
5. **Le résultat des commandes de validation n'est pas extrait** : il figure dans le compte rendu
   de l'agent, en texte libre. NOX ne l'interprète pas.
6. **Le diff complet n'est pas affiché** — seuls les fichiers modifiés et `git diff --stat`.
7. **Les arguments de Claude Code n'ont pas été vérifiés contre un binaire local** (voir § 5).
8. **La détection de limite d'utilisation est heuristique.** Prudente par construction : en cas
   de doute elle retourne une erreur générique
   ([D-106](DECISIONS.md#d-106--détection-prudente-des-limites-dutilisation)).
9. **La modification manuelle d'un `tasks/TASK-xxx.md` ne met pas à jour la tâche.**
10. **Une spécification ne se modifie pas après création.** Seul le statut change.
11. **Une tâche possédant un historique d'exécution ne peut pas être supprimée**, et aucun
    archivage n'existe encore
    ([D-115](DECISIONS.md#d-115--une-tâche-possédant-un-historique-nest-pas-supprimable)).
12. **La suppression n'est pas atomique entre le disque et SQLite.** Un échec en base après
    suppression réussie du fichier laisse une tâche sans document — état visible, signalé, et
    reprenable d'un second clic
    ([D-118](DECISIONS.md#d-118--le-fichier-est-supprimé-avant-la-tâche-en-base)).
13. **Une fenêtre de concurrence résiduelle subsiste** entre le dernier contrôle de nature et
    l'`unlink` : Node n'expose pas de suppression conditionnée à un descripteur déjà ouvert. Elle
    est bornée dans ses conséquences — `unlink` ne suit jamais un lien, donc un lien apparu
    entre-temps serait retiré à la place du document, jamais sa cible — et n'est pas couverte par
    un test, faute de pouvoir provoquer la course de façon déterministe.
14. **Aucune suppression de projet, ni d'exécution.** Aucun forçage, aucune suppression
    récursive, aucune corbeille, aucune restauration.
15. **Un trou dans la numérotation** des tâches et des exécutions est possible après un échec
    survenu entre la réservation et l'enregistrement — et désormais aussi après une suppression,
    ce qui est voulu ([D-117](DECISIONS.md#d-117--le-numéro-dune-tâche-supprimée-reste-réservé)).
16. **Aucun dossier ne peut être créé ni supprimé depuis NOX**, à l'exception de la création de
    `tasks/`.
17. **`beforeunload` ne couvre pas la navigation interne de Next.js.**
18. **Le périmètre d'inspection des documents est figé** ; 500 documents maximum.
19. **Pas de test de rendu React.** Couverture assurée par les tests unitaires, le test
    d'intégration réel et les tests fonctionnels HTTP en mode production.
20. **Quatre tests ignorés sous Windows** : liens symboliques de fichier (privilège requis). Les
    cas d'évasion correspondants restent couverts par des jonctions.
21. Limites héritées : remplacement non atomique sous Windows à l'édition, aucun cache, jeton en
    clair dans `.env`, TypeScript 5.9 et ESLint 9 figés, Node ≥ 22.18 requis.

## 7. Prochaine tâche recommandée

**`TASK-010` — Streaming des événements et annulation d'une exécution Claude.**

Objectif : afficher progressivement les événements de Claude Code et permettre à l'utilisateur
d'interrompre proprement une exécution active, sans ajouter encore l'orchestration OpenAI.

⚠️ **À ne pas commencer avant** l'installation de Claude Code et la validation d'un premier run
réel contrôlé. Streamer et annuler des événements dont on n'a jamais vu la forme réelle
reviendrait à empiler des suppositions sur celles de TASK-008.

## 8. État Git

- Aucun commit créé par Claude Code.
- Aucun push effectué.
- Historique Git non modifié.
- Commit de départ : `bf7f948` (`feat: add manual Claude Code execution`), contenant bien
  `TASK-008`.
- **Répertoire de travail propre** au démarrage de `TASK-009`.
- Les modifications de `TASK-009` sont locales, non indexées, disponibles pour review.
