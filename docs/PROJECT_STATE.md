# PROJECT_STATE — État réel du projet

> Ce document décrit ce qui existe **réellement** dans le repository, pas ce qui est prévu.
> Il est mis à jour à la fin de chaque tâche.

**Dernière mise à jour** : 6 août 2026, à l'issue de `TASK-008`.

---

## 1. Phase actuelle

**NOX lance Claude Code.** La boucle que le projet cherchait à fermer depuis le début l'est
enfin sur son premier maillon : une tâche rédigée dans NOX modifie réellement un repository,
sans qu'aucun prompt ne soit copié-collé.

C'est aussi la première fonctionnalité dont une étape **dure plus longtemps qu'une requête
HTTP**. Le web possède les données métier, le runner possède le processus, et l'interrogation
périodique réconcilie les deux. Fermer le navigateur n'interrompt rien ; redémarrer le runner,
si — et NOX le dit plutôt que de deviner.

Le lancement reste **toujours explicite**. Aucune orchestration automatique, aucun appel OpenAI,
aucune clé d'API Anthropic dans NOX.

Étape correspondante dans la [roadmap](ROADMAP.md) : **étape 8 — lancement manuel d'une tâche
Claude Code (terminée)**. L'étape 9 (streaming et annulation) devient l'étape active.

## 2. Tâche active

`TASK-008 — Préparation et lancement manuel d'une tâche Claude Code` : **terminée**, en attente
de review humaine.

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

### 3.9 Validations exécutées

| Commande | Résultat |
| --- | --- |
| `npm install` | ✅ aucune dépendance ajoutée |
| `npm run db:generate` | ✅ client Prisma régénéré |
| `npm run db:migrate` | ✅ migration appliquée, projets et tâches existants intacts |
| `npm run test` | ✅ **902 tests, 167 suites, 0 échec, 2 ignorés** |
| `npm run lint` | ✅ exit 0 |
| `npm run typecheck` | ✅ exit 0, 4 workspaces |
| `npm run build` | ✅ exit 0, 12 routes |

Les 2 tests ignorés sont ceux de TASK-005 (liens symboliques de fichier sous Windows).

### 3.10 Test fonctionnel réellement exécuté

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
- Modification d'une spécification après création, suppression, renumérotation, duplication,
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
11. **Un trou dans la numérotation** des tâches et des exécutions est possible après un échec
    survenu entre la réservation et l'enregistrement.
12. **Aucun dossier ne peut être créé depuis NOX**, à l'exception de `tasks/`.
13. **`beforeunload` ne couvre pas la navigation interne de Next.js.**
14. **Le périmètre d'inspection des documents est figé** ; 500 documents maximum.
15. **Pas de test de rendu React.** Couverture assurée par les tests unitaires, le test
    d'intégration réel et les tests fonctionnels HTTP en mode production.
16. **Deux tests ignorés sous Windows** : liens symboliques de fichier (privilège requis).
17. Limites héritées : remplacement non atomique sous Windows à l'édition, aucun cache, jeton en
    clair dans `.env`, TypeScript 5.9 et ESLint 9 figés, Node ≥ 22.18 requis.

## 7. Prochaine tâche recommandée

**`TASK-009` — Streaming des événements et annulation d'une exécution Claude.**

Objectif : afficher progressivement les événements de Claude Code et permettre à l'utilisateur
d'interrompre proprement une exécution active, sans ajouter encore l'orchestration OpenAI.

## 8. État Git

- Aucun commit créé par Claude Code.
- Aucun push effectué.
- Historique Git non modifié.
- Commit de départ : `5b95054` (`feat: add markdown creation and structured development tasks`),
  contenant bien `TASK-006` et `TASK-007`.
- **Répertoire de travail propre** au démarrage de `TASK-008`.
- Les modifications de `TASK-008` sont locales, non indexées, disponibles pour review.
