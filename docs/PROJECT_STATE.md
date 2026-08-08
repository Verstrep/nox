# PROJECT_STATE — État réel du projet

> Ce document décrit ce qui existe **réellement** dans le repository, pas ce qui est prévu.
> Il est mis à jour à la fin de chaque tâche.

**Dernière mise à jour** : 8 août 2026, à l'issue de `TASK-011 corrective`.

---

## 1. Phase actuelle

**NOX montre maintenant ce que l'agent a produit, et pas seulement ce qu'il a fait.** TASK-010
avait donné la timeline — les actions, en direct. TASK-011 donne la review : le diff détaillé
fichier par fichier, l'état réel de chaque commande de validation, et deux boutons pour trancher.

Ce que cette étape apporte de structurant, c'est une notion de **temps**. Jusqu'ici tout ce que
NOX affichait décrivait le présent du disque. Une review, non : elle est capturée au moment précis
où l'exécution se termine, et ne bouge plus. L'utilisateur peut relire, corriger, éditer — la
review continue de dire ce que l'agent avait produit ce jour-là. Un `git diff` recalculé à
l'affichage aurait été plus simple à écrire, et faux dès la deuxième lecture.

Second apport : les **validations structurées**. `npm run test` passé, `npm run lint` jamais
lancé — ce sont deux informations différentes, et la seconde compte autant que la première. NOX ne
relance aucune commande pour combler le tableau : ce serait remplacer l'histoire réelle du run par
une reconstitution.

Enfin, `Approve` et `Reopen` : la décision revient à l'humain, et aucun des deux ne touche à Git.

Étape correspondante dans la [roadmap](ROADMAP.md) : **étape 11 — review Git intégrée et
validations structurées (terminée)**. L'étape 12 (feedback de review et reprise ciblée d'une
session Claude) devient l'étape active.

## 2. Tâche active

`TASK-011 — Review Git intégrée et validations structurées` : **terminée**, en attente de review
humaine, **corrective incluse**.

Le premier run réel a révélé un défaut de corrélation : une validation exécutée restait `NOT_RUN`
parce que Claude Code préfixe ses commandes Bash de `cd "<répertoire>" &&`. Corrigé, testé, et
consigné au § 3.29 bis.

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

### 3.17 Invocation en `stream-json` — `TASK-010`

`buildClaudeArguments` produit désormais :

```text
claude -p --output-format stream-json --verbose --max-turns <n> --allowedTools … --disallowedTools …
```

`--verbose` est une **précondition du binaire**, pas un confort : avec `-p`, Claude Code `2.1.223`
refuse `stream-json` sans lui et s'arrête sur
`When using --print, --output-format=stream-json requires --verbose`. Il accompagne donc le format
`stream-json`, et lui seul. `--max-turns` est reconnu par l'analyseur d'arguments bien qu'il
n'apparaisse plus dans `--help`. `--include-partial-messages` n'est pas passé.

> **Retour d'expérience à ne pas reperdre.** La première version de TASK-010 affirmait le
> contraire, sur la foi d'un probe qui alimentait `stdin` avec une entrée **vide** : le binaire
> s'arrêtait alors sur `Input must be provided…`, **avant** d'atteindre la vérification de
> `--verbose`, et ce silence a été lu comme une acceptation. Le premier run réel a échoué
> immédiatement. Un probe qui court-circuite une étape ne dit rien des étapes suivantes ; le
> comportement réel fait autorité. Détail dans [DECISIONS.md](DECISIONS.md) § D-124.

Tout le reste est inchangé : prompt par `stdin`, `cwd` canonique, environnement nettoyé des
variables `NOX_*`, permissions calculées, aucun `--dangerously-skip-permissions`.

En mode streaming, le lanceur **n'accumule plus `stdout`** : la sortie peut dépasser plusieurs
mégaoctets, et la borner en mémoire insérerait une marque de troncature au milieu du flux — donc
potentiellement au milieu de la ligne du résultat final.

### 3.18 Parser NDJSON — `apps/runner/src/claude/stream/`

| Fichier | Rôle |
| --- | --- |
| `line-buffer.ts` | Découpage en lignes : reste incomplet, `\r\n`, ligne démesurée jetée, `flush` final |
| `parse-event.ts` | Une ligne, un objet JSON ; tableaux et primitives refusés |
| `normalize-event.ts` | Traduction en événements publics ; blocs de raisonnement ignorés |
| `sanitize-event.ts` | Chemins relatifs, chemins extérieurs masqués, secrets retirés, taille bornée |
| `collector.ts` | Chaîne complète, coalescence des répétitions, ligne `result` mise de côté |

Le résultat final est relu par `parseClaudeOutput` — le parser de TASK-008, **inchangé** — qui
reçoit la ligne `result` plutôt que la sortie entière.

### 3.19 Événements publics

Neuf types : `STATUS`, `ASSISTANT_MESSAGE`, `TOOL_STARTED`, `TOOL_COMPLETED`, `VALIDATION`,
`WARNING`, `ERROR`, `RESULT`, `TRUNCATED`. Aucun ne représente le raisonnement interne.

| Borne | Valeur |
| --- | --- |
| Événements ordinaires par exécution | 2 000 |
| Marge réservée à l'essentiel | 64 |
| Détail | 4 Kio |
| Volume total normalisé | 2 Mio |
| Ligne NDJSON | 1 Mio |
| Événements par réponse | 200 |

Constantes, non configurables : `.env.example` n'a gagné aucune variable.

### 3.20 Persistance et flux

- Table `RunEvent` (`runId + sequence` unique), migration `20260806235745_add_run_events`.
- `Run.cancellationRequestedAt` — seul champ ajouté ; ni `lastEventSequence`, ni `cancelledAt`.
- `appendRunEvents`, `listRunEvents`, `getLastRunEventSequence`, `countRunEvents`,
  `markRunCancelling` dans `@nox/database`.
- Routes runner `POST /claude/runs/events` et `POST /claude/runs/cancel` (`202`).
- Route Handler SSE `GET /api/projects/…/runs/[runId]/events` : historique d'abord, direct
  ensuite, battement de cœur, fermeture sur état final ou sur `AbortSignal`.
- **Rattrapage à l'ouverture de la page** : tout ce que le runner sait et que la base ignore est
  récupéré, y compris pour une exécution terminée.

### 3.21 Annulation

`RUN_STATUS` gagne `CANCELLING`, non final. La tâche reste `RUNNING` pendant l'arrêt.

L'arrêt réutilise l'unique implémentation de TASK-008 — demande polie, cinq secondes de grâce,
puis `taskkill /T /F` sur le seul PID créé par NOX. Si le processus ne ferme pas, l'exécution est
`BLOCKED` avec `CLAUDE_CANCEL_FAILED`.

Ordre des diagnostics à la fin : démarrage impossible → délai maximal → limite d'utilisation →
**violation Git** → annulation demandée → sortie illisible → code de retour → réussite. Une
annulation ne l'emporte que si l'exécution n'a pas eu le temps de réussir proprement.

Résultat : `Run = CANCELLED`, `Task = BLOCKED`, état Git capturé, **rien de restauré**.

### 3.22 Interface

- Section « Activité Claude Code » : timeline horodatée, compteur d'événements, défilement
  automatique qui s'arrête dès que l'utilisateur remonte, lignes atteignables au clavier, type
  d'événement annoncé aux lecteurs d'écran, `role="alert"` sur les erreurs.
- Avertissement discret et bouton `Reconnect` si le flux tombe ; le polling de statut reste en
  repli.
- `Cancel run` pendant `QUEUED` et `RUNNING`, confirmation portée par `?confirmCancel=1`,
  avertissement français, boutons `Keep running` / `Cancel run`.
- En `CANCELLING` : aucun bouton, une explication à la place.
- Après annulation : message renvoyant vers `git status` et `git diff`, et rappel explicite que
  NOX n'a exécuté ni `git reset`, ni `git restore`.

### 3.23 Validations exécutées — `TASK-010`

| Commande | Résultat |
| --- | --- |
| `npm install` | ✅ aucune dépendance ajoutée |
| `npm run db:generate` | ✅ client régénéré |
| `npm run db:migrate` | ✅ `20260806235745_add_run_events` appliquée, données intactes |
| `npm run test` | ✅ **1 298 tests, 232 suites, 1 294 succès, 0 échec, 4 ignorés** |
| `npm run lint` | ✅ |
| `npm run typecheck` | ✅ 4 workspaces |
| `npm run build` | ✅ 13 routes |

### 3.24 Test fonctionnel de TASK-010

Repository Git temporaire avec remote `bare` local, base SQLite **isolée**, runner réel sur le
port 4319, web en **mode production** sur le port 3009, Claude Code remplacé par la fixture
`fake-claude.mjs`. **Aucune requête Claude réelle.**

**114 vérifications, toutes passées**, en dix sections :

1. Run lent : en-têtes SSE, `Started`, `Claude Code ready`, lectures, numéros strictement
   croissants, aucun champ hors contrat, persistance pendant le flux.
2. Fermeture du flux : l'exécution continue sans lecteur ; la reconnexion renvoie l'historique
   sans doublon et récupère ce qui a été manqué ; une reprise après curseur ne rejoue rien.
3. Compatibilité TASK-008 : compte rendu, session, durées, tours, coût, code de sortie, branche,
   `HEAD` inchangé, tâche en `REVIEW`, ordre stable, persistance idempotente.
4. Rendu de la page : timeline côté serveur, validation affichée, commande autorisée affichée,
   commande arbitraire masquée, aucun jeton, aucun chemin absolu.
5. Annulation : enfant du faux Claude lancé puis **arrêté avec son parent**, `CANCELLING`
   immédiat, second clic refusé (`CLAUDE_RUN_CANCELLING`), `CANCELLED`, tâche `BLOCKED`, Git
   capturé, aucun commit, annulation tardive refusée (`CLAUDE_RUN_ALREADY_FINISHED`).
6. Course fin / annulation : un seul état final cohérent, qui ne change plus ensuite.
7. Flux hostile : bloc `thinking`, bloc `redacted_thinking`, signature, jeton `NOX_*`, chemin
   `C:\Windows\System32` — **absents de la base, de l'API et du HTML** ; chemin du repository
   rendu relatif.
8. Sortie énorme : troncature signalée, nombre d'événements borné, événement `TRUNCATED` unique,
   résultat final conservé.
9. Redémarrage du runner : exécution `BLOCKED`, message honnête, événements persistés conservés,
   aucun résultat inventé.
10. État final : un seul commit, `HEAD` aligné sur `origin/main`.

> **Réserve de méthode.** Les Server Actions de Next.js ne sont pas rejouables depuis ce
> harnais : leur encodage de progressive enhancement dépend d'un cache de rendu interne. Le script
> appelle donc **les mêmes fonctions serveur** qu'elles appellent, dans le même ordre et avec les
> mêmes garde-fous. Ce qui est réellement exercé de bout en bout : le runner, le processus enfant
> et ses descendants, l'analyse du flux, le registre, la persistance, la route SSE et le rendu des
> pages. Les Server Actions elles-mêmes sont couvertes par le typecheck, le build et les tests
> unitaires de leurs règles (`checkRunCancellation`).

### 3.25 Procédure de vérification manuelle — à exécuter par l'utilisateur

Aucun de ces deux scénarios n'a été exécuté : ils consomment du quota Claude, et c'est à
l'utilisateur de décider quand. Utiliser le repository jetable déjà créé pour le premier run réel.

**Scénario A — streaming complet.** Créer une tâche minuscule mais à plusieurs actions visibles :
lire le README, y ajouter une section, exécuter une commande de validation simple et sûre.
Vérifier : les événements apparaissent progressivement ; les lectures, l'édition et la validation
sont nommées ; les messages assistant s'affichent ; le compte rendu final et les métadonnées
arrivent ; aucun chemin absolu, aucun secret, aucun raisonnement interne n'apparaît.

**Scénario B — annulation.** Créer une tâche plus longue mais sans danger, la lancer, puis cliquer
sur `Cancel run`. Vérifier : `Cancelling` apparaît immédiatement ; le processus s'arrête ; le run
passe `Cancelled` ; la tâche passe `Blocked` ; `git status` et `git diff` montrent l'état laissé ;
aucun commit n'a été créé ; aucun fichier n'a été restauré.

### 3.26 Capture de review — `apps/runner/src/repositories/git-review.ts`

Capture détaillée déclenchée **à la finalisation** d'une exécution, dans tous les cas finaux —
`COMPLETED`, `FAILED`, `BLOCKED`, `CANCELLED`.

| Commande | Ce qu'elle apporte |
| --- | --- |
| `git diff --name-status -z -M -C <headBefore>` | statuts, renommages, copies |
| `git diff --numstat -z -M -C <headBefore>` | additions, suppressions, détection binaire |
| `git ls-files --others --exclude-standard -z` | fichiers **créés**, invisibles pour `git diff` |
| `git diff --no-color -M -C <headBefore> -- :(literal)<path>` | patch d'un fichier suivi |

Toutes en lecture seule, par `execFile` sans shell, sans réseau, sans fichier temporaire. Le
format `-z` est indispensable : les noms de fichiers ont le droit de contenir espaces et
tabulations, qu'une sortie « humaine » utilise comme séparateurs.

Le patch d'un fichier non suivi est **fabriqué** par NOX à partir de son contenu, lu de façon
bornée dès l'appel système. La seule alternative aurait été `git add`, et la review est une
lecture.

Un échec de capture n'altère **jamais** le résultat de Claude Code : le compte rendu, les durées
et l'état Git restent ce qu'ils sont, et seul `reviewErrorCode` est renseigné.

### 3.27 Modèles de review — `RunFileChange` et `RunValidationResult`

Migration `20260807133453_add_run_review`, purement additive : trois `ALTER TABLE ADD COLUMN` sur
`Run` et deux `CREATE TABLE`. Prisma proposait de **reconstruire** `Run` (`DROP` puis `RENAME`) ;
le bloc a été remplacé à la main — cette table porte l'historique réel des exécutions.

`Run` gagne trois colonnes, et seulement trois : `reviewCapturedAt`, `reviewErrorCode`,
`reviewOmittedFiles`. Tout le reste — additions, suppressions, fichiers masqués, patches tronqués —
se dérive des lignes, et un compteur dénormalisé finirait par diverger de ce qu'il prétend décrire.

`reviewCapturedAt` distingue une review **vide** d'une review **absente** : « l'agent n'a rien
modifié » et « NOX ne sait pas » sont deux réponses différentes.

### 3.28 Bornes et masquage

| Borne | Valeur |
| --- | --- |
| Fichiers décrits | 200 |
| Patch par fichier | 256 Kio |
| Patches par exécution | 4 Mio |
| Lignes de diff par exécution | 20 000 |
| Résumé d'une validation | 8 Kio |

Constantes, comme les bornes d'événements de TASK-010. Une limite atteinte ne fait jamais échouer
l'exécution.

Fichiers sensibles : `.env` et ses variantes, `*.pem`, `*.key`, `id_rsa`, `id_ed25519`,
`credentials.json`, `secrets.json` — chemin, type et statistiques visibles, contenu jamais.
`.env.example` et `.env.sample` sont exclus nommément. La règle est appliquée **deux fois** : à la
capture, où le patch n'est pas demandé à Git, et à l'écriture en base, qui ne fait pas confiance à
la capture.

Un patch traverse un nettoyage restreint — caractères de contrôle, valeurs `NOX_*` — et **non** le
nettoyeur d'événements : celui-ci réécrit les chemins et écrase les espaces, ce qui produirait un
diff faux.

### 3.29 Validations structurées

Les commandes de la tâche sont **recopiées** dans `RunValidationResult` au lancement, au statut
`NOT_RUN`. Pendant l'exécution, un `tool_use` Bash dont un **segment** correspond mot pour mot à
l'une d'elles la passe en `RUNNING` ; le `tool_result` de même `tool_use_id` la conclut.

| État final | Signification |
| --- | --- |
| `PASSED` | lancée, résultat sans erreur |
| `FAILED` | lancée, résultat en erreur |
| `NOT_RUN` | jamais lancée — une information, pas un trou |
| `UNKNOWN` | lancée, sans issue propre exploitable |

Aucun code de sortie n'est déduit ; aucune sortie n'est analysée pour en extraire un nombre de
tests. NOX ne relance **aucune** commande.

Correctif au passage : `git status` était compté comme une validation par TASK-010. Une commande
Git en lecture seule reste affichable, mais ne porte aucun verdict sur le code — **sauf** si la
tâche l'a justement enregistrée comme validation, voir ci-dessous.

### 3.29 bis Lecture d'une commande Bash — correction du premier run réel

Le premier run réel de TASK-011 a montré que Claude Code 2.1.223 n'envoie jamais une commande nue :

```text
enregistré par la tâche : git diff --check
émis par Claude Code    : cd "D:/Projets/Dev/nox-claude-test" && git diff --check
```

NOX comparait la ligne entière. Résultat : une validation pourtant exécutée restait `NOT_RUN`, et
la timeline affichait « Running an allowed command » jusque pour un simple `git status`.

`apps/runner/src/claude/stream/bash-command.ts` lit désormais la ligne **par segments** : découpage
sur `&&`, retrait du préfixe `cd <chemin>` — jamais affiché —, puis chaque segment restant doit
être exactement autorisé. Toute autre construction (`;`, `|`, `>`, `<`, `` ` ``, `$(`, `&` isolé,
guillemet hors navigation) fait renoncer à la lecture : rien n'est affiché, rien n'est corrélé.

Deux règles en découlent :

- **La liste de la tâche prime sur la classification générique.** `git diff --check` est une
  commande Git en lecture seule *et* une validation, dès lors que l'utilisateur l'a inscrite.
- **Une issue ambiguë n'est pas tranchée.** Une ligne enchaînant deux validations qui échoue les
  laisse `UNKNOWN` ; réussie, elle les marque toutes `PASSED` — avec `&&`, une réussite prouve que
  chacune a tourné. Une commande relancée est représentée par son dernier résultat terminal.

**Forme réelle confirmée** (voir [D-168](DECISIONS.md#d-168--le-comportement-observé-fait-autorité)) :
`tool_use` porte `id`, `name` et `input.command` ; `tool_result` porte `tool_use_id`, `content`,
`is_error`, et **aucun** `exit_code` — le code figure dans le texte (« Exit code 2 »), et NOX ne le
lit pas. Un type `rate_limit_event`, inconnu de TASK-010, existe et reste ignoré.

### 3.30 Page de review — `/projects/[id]/tasks/[taskId]/runs/[runId]/review`

En-tête, résumé factuel, validations, liste de fichiers navigable, diff. Elle lit **SQLite,
jamais le repository**.

`?file=` sélectionne une ligne enregistrée par égalité de chemin ; une valeur inconnue ne
sélectionne rien. La protection n'est pas un filtre mais une absence de chemin de code entre ce
paramètre et un système de fichiers.

Le diff est rendu ligne par ligne par React : pas de `dangerouslySetInnerHTML`, pas de Markdown,
pas d'ANSI, pas de lien automatique, pas d'image, pas de coloration syntaxique. Les signes `+` et
`-` restent dans le texte — la couleur ne se prononce pas.

`Approve` (`REVIEW → COMPLETED`) et `Reopen` (`REVIEW → READY`) ne créent ni commit, ni `git add`,
ni push, et ne restaurent rien.

### 3.31 Validations exécutées — `TASK-011`

| Commande | Résultat |
| --- | --- |
| `npm install` | ✅ aucune dépendance ajoutée |
| `npm run db:generate` | ✅ client régénéré |
| `npm run db:migrate` | ✅ `20260807133453_add_run_review` appliquée, données intactes |
| `npm run test` | ✅ **1 488 tests, 264 suites, 1 484 succès, 0 échec, 4 ignorés** |
| `npm run lint` | ✅ |
| `npm run typecheck` | ✅ 4 workspaces |
| `npm run build` | ✅ 14 routes |

### 3.32 Test fonctionnel de TASK-011

Repository Git temporaire avec remote `bare` local, base SQLite **isolée**, runner réel sur le
port 4321, web en **mode production** sur le port 3011, Claude Code remplacé par la fixture
`fake-claude.mjs` (mode `stream-review`, qui modifie réellement le repository). **Aucune requête
Claude réelle.**

**93 vérifications, toutes passées**, en sept sections :

1. Exécution réussie : fichier modifié, fichier créé, fichier supprimé, binaire et fichier
   sensible tous présents dans la review, avec les bons types de changement et les bons patches.
2. Sécurité du stockage : aucun contenu binaire, aucun contenu sensible, aucun chemin absolu,
   aucun jeton — ni en base, ni dans le HTML.
3. Validations : `npm run test` = `Passed` avec son code de sortie rapporté, `npm run lint` =
   `Not run`, les deux affichées et nommées.
4. Page de review : résumé, patch du nouveau fichier, `<script>alert(1)</script>` **échappé**,
   « Binary file changed », « Sensitive file — content hidden ».
5. Décision : la tâche passe en `REVIEW`, la page propose `Approve` et `Reopen`, `Approve` la
   passe à `Done` **sans créer de commit et sans rien restaurer**, `Reopen` la remet à `Ready`,
   et un statut réservé reste refusé.
6. Immuabilité : après édition manuelle du `README.md` et création d'un fichier, la review
   rechargée est **identique octet pour octet**, et ne mentionne ni l'édition ni le nouveau
   fichier.
7. Robustesse : quatre valeurs `?file=` falsifiées — remontées `..`, chemin absolu Windows,
   chemin absolu du repository, encodage double — toutes refusées proprement, sans lecture disque
   et sans erreur ; `?file=.env` reste masqué.

Plus : une exécution **annulée** dont la review montre le travail partiel et annonce « Partial
changes », et une exécution **legacy** sans instantané qui affiche « Detailed review unavailable
for this legacy run. » sans qu'aucun diff ne soit reconstruit. État final : un seul commit.

> **Réserve de méthode, inchangée depuis TASK-010.** Les Server Actions de Next.js ne sont pas
> rejouables depuis ce harnais. Le script appelle donc **les mêmes fonctions serveur** qu'elles
> appellent — `updateTaskStatus` pour `Approve` et `Reopen`, `seedRunValidations` au lancement —
> dans le même ordre et avec les mêmes garde-fous. Sont réellement exercés de bout en bout : le
> runner, la capture Git sur un vrai repository, le registre, la persistance, le transfert vers la
> base et le rendu des pages.

### 3.33 Procédure de vérification manuelle de TASK-011 — à exécuter par l'utilisateur

Non exécutée : elle consomme du quota Claude. Utiliser le repository `nox-claude-test`.

1. Créer une petite tâche réelle demandant deux ou trois modifications de fichiers.
2. Y ajouter au moins une commande de validation.
3. Lancer Claude Code, laisser l'exécution se terminer.
4. Ouvrir `Review changes`.
5. Comparer la review de NOX avec `git status` et `git diff` dans un terminal.
6. Vérifier que les deux racontent la même chose — mêmes fichiers, mêmes lignes.
7. Vérifier les validations structurées : celle qui a tourné, celle qui n'a pas tourné.
8. Choisir `Approve` ou `Reopen`, puis vérifier que `git log` n'a pas bougé.

## 4. Éléments non commencés

- Reprise d'une session Claude (`--resume`), continuation (`--continue`), message envoyé à une
  session active, approbation interactive d'outils, prompt correctif automatique.
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

✅ **Réserve levée.** La forme réelle des messages `stream-json` de Claude Code `2.1.223` est
désormais **entièrement observée** : `system/init`, `system/api_retry`, `assistant` (blocs `text`
et `tool_use`), `user` (bloc `tool_result`), `result`, plus un `rate_limit_event` inconnu de
TASK-010 et ignoré comme tout type inattendu.

Elle a été établie de deux façons indépendantes, sans consommer de quota : la transcription de
session du premier run réel, et un rejeu du vrai binaire contre un serveur Messages **local**. La
supposition de TASK-010 était juste sur la structure et fausse sur le contenu : une commande Bash
arrive préfixée de `cd "<répertoire>" &&`. Voir le § 3.29 bis pour la correction.

## 6. Dette technique et limites

1. **Un redémarrage du runner perd le suivi d'une exécution en cours.** Le registre est en
   mémoire ([D-094](DECISIONS.md#d-094--registre-en-mémoire-limite-assumée)).
2. **Les événements ne survivent pas à un redémarrage du runner** au-delà de ce qui a déjà été
   persisté. Ce qui a été observé est acquis ; ce qui ne l'avait pas encore été est perdu, et NOX
   ne prétend pas le connaître.
3. **La lecture d'une commande Bash ne comprend qu'une construction : le chainage `&&`.** Tout le
   reste — tuyau, redirection, substitution, point-virgule — fait renoncer à la lecture. Une
   validation lancée derrière une telle ligne restera donc `NOT_RUN`, ce qui est prudent mais
   incomplet. Élargir demanderait un analyseur de shell, et un analyseur approximatif finirait par
   autoriser ce qu'il n'a pas compris
   ([D-165](DECISIONS.md#d-165--une-commande-bash-est-lue-par-segments-jamais-comme-un-bloc)).
4. **Un arrêt peut échouer.** Si le processus ne ferme pas, le run est `BLOCKED` avec
   `CLAUDE_CANCEL_FAILED` et le message dit que le processus peut encore écrire. NOX ne le tue pas
   par son nom, et ne cherche pas ses descendants réattachés ailleurs.
5. **Aucune reprise de session** : un run annulé se relance depuis le début.
6. **Une seule exécution active**, tous projets confondus.
7. **Le résultat des commandes de validation n'est pas analysé** : ni nombre de tests, ni
   couverture, ni diagnostics. Un extrait borné de la sortie est conservé pour la review, et rien
   n'en est déduit. Le code de sortie reste nul dans les faits — le vrai binaire n'en fournit
   aucun ([D-156](DECISIONS.md#d-156--aucun-code-de-sortie-nest-déduit-aucune-sortie-nest-analysée)).
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
21. **Les Server Actions ne sont pas couvertes par un test fonctionnel HTTP** (voir la réserve
    de méthode du § 3.24). Leurs règles le sont par des tests unitaires, leur câblage par le
    build.
22. Limites héritées : remplacement non atomique sous Windows à l'édition, aucun cache, jeton en
    clair dans `.env`, TypeScript 5.9 et ESLint 9 figés, Node ≥ 22.18 requis.

## 7. Prochaine tâche recommandée

**`TASK-012` — Feedback de review et reprise ciblée d'une session Claude.**

Objectif : permettre à l'utilisateur de rejeter une review avec un commentaire, puis de reprendre
la session Claude associée pour appliquer un correctif ciblé, sans orchestration OpenAI
automatique.

C'est la suite naturelle : NOX sait montrer ce que l'agent a fait, puis ce qu'il a produit. Il lui
reste à permettre de **répondre** — sans recopier le contexte à la main, ce qui est exactement le
problème que NOX existe pour supprimer.

## 8. État Git

- Aucun commit créé par Claude Code.
- Aucun push effectué.
- Historique Git non modifié.
- Commit de départ : `625be85` (`feat: add Claude event streaming and cancellation`), contenant
  bien `TASK-010`.
- **Répertoire de travail propre** au démarrage de `TASK-011`, branche `main` alignée sur
  `origin/main`.
- Les modifications de `TASK-011` sont locales, non indexées, disponibles pour review.
