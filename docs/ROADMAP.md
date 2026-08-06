# ROADMAP — NOX

Roadmap pragmatique vers la V1 définie dans [V1_SCOPE.md](V1_SCOPE.md).

Les étapes sont **ordonnées** : chacune s'appuie sur la précédente. Une étape n'est déclarée
terminée que si le repository est dans un état stable, validé et commitable.

Légende : ✅ terminée · 🟢 active · ⬜ non commencée

---

## ✅ 1. Socle monorepo — `TASK-001`

**Objectif** : disposer d'un repository propre, typé et validable.

- Workspaces npm : `apps/web`, `apps/runner`, `packages/shared`.
- TypeScript strict, ESLint, Tailwind CSS.
- Page d'accueil statique du futur tableau de bord.
- Runner HTTP minimal exposant `GET /health`.
- Documentation initiale et règles permanentes (`CLAUDE.md`).
- Scripts `lint`, `typecheck`, `build` opérationnels à la racine.

**Terminée.** Voir [PROJECT_STATE.md](PROJECT_STATE.md) pour le détail des validations exécutées.
Les scripts `test`, `db:generate`, `db:migrate` et `db:studio` ont été ajoutés à l'étape 2.

---

## ✅ 2. Gestion locale des projets — `TASK-002`

**Objectif** : créer un projet NOX et l'associer à un repository local.

- Persistance locale : Prisma + SQLite, dans `packages/database`
  ([D-018](DECISIONS.md#d-018--prisma-comme-couche-daccès-aux-données),
  [D-019](DECISIONS.md#d-019--sqlite-comme-persistance-locale-de-la-v1)).
- Migration initiale versionnée, modèle `Project`.
- Création, liste et consultation d'un projet depuis l'interface.
- Vérification serveur du chemin d'un repository Git, avec enregistrement de la racine
  canonique retournée par Git.
- Création par Server Action ; lecture en Server Components.

**Fin d'étape atteinte** : un projet créé depuis l'interface survit à un redémarrage du
serveur — vérifié par un test fonctionnel réel, voir [PROJECT_STATE.md](PROJECT_STATE.md).

Hors périmètre volontaire de cette étape : édition, suppression et archivage d'un projet
([D-027](DECISIONS.md#d-027--ni-édition-ni-suppression-de-projet-dans-task-002)).

---

## ✅ 3. Connexion web ↔ runner — `TASK-003`

**Objectif** : établir un canal local sécurisé entre l'application web et le runner, et lui
transférer les opérations locales.

- API HTTP du runner : `GET /health` publique, `POST /repositories/resolve` authentifiée.
- Jeton partagé obligatoire, écoute restreinte à la boucle locale, corps JSON borné.
- Contrat partagé (formes et codes d'erreur) dans `@nox/shared`
  ([D-030](DECISIONS.md#d-030--contrat-partagé-dans-noxshared)).
- Client runner strictement serveur dans `apps/web`, indicateur de disponibilité au rendu.
- Validation Git retirée de `apps/web` et déplacée dans le runner : l'exception ouverte par
  TASK-002 est close ([ARCHITECTURE.md § 5.2](ARCHITECTURE.md)).

**Fin d'étape atteinte** : la création d'un projet passe par le runner, et le tableau de bord
reste consultable runner arrêté — vérifié par un test fonctionnel réel, voir
[PROJECT_STATE.md](PROJECT_STATE.md).

Hors périmètre volontaire : SSE, WebSocket, exécution de commandes arbitraires, runners
multiples ([D-037](DECISIONS.md#d-037--pas-de-sse-ni-de-websocket-dans-task-003)).

---

## ✅ 4. Inventaire et lecture des documents Markdown — `TASK-004`

**Objectif** : inventorier et lire les documents Markdown d'un projet depuis NOX.

- Routes authentifiées `POST /repositories/documents/list` et
  `POST /repositories/documents/read`.
- Périmètre d'inspection restreint et documenté
  ([D-041](DECISIONS.md#d-041--emplacements-inspectés-limités-pas-de-parcours-complet)).
- Catégorisation et tri stables, déduits du chemin seul
  ([D-042](DECISIONS.md#d-042--documents-principaux-reconnus-par-une-liste-explicite)).
- Confinement des chemins vérifié après résolution réelle, liens sortants bloqués
  ([D-045](DECISIONS.md#d-045--confinement-vérifié-après-résolution-réelle-des-chemins)).
- Page `/projects/[id]/documents` : liste, lecteur, sélection portée par l'URL.
- Contenu affiché brut, sans rendu HTML
  ([D-047](DECISIONS.md#d-047--contenu-brut-aucun-rendu-markdown)).

**Fin d'étape atteinte** : les documents d'un repository réel sont inventoriés, classés et
lisibles dans NOX, et la page projet reste accessible runner arrêté — vérifié par un test
fonctionnel réel, voir [PROJECT_STATE.md](PROJECT_STATE.md).

Hors périmètre volontaire : toute écriture, le rendu Markdown, la recherche, l'historique
([D-040](DECISIONS.md#d-040--lecture-seule-stricte)).

---

## ✅ 5. Édition sécurisée d'un document existant — `TASK-005`

**Objectif** : modifier depuis NOX un document Markdown déjà présent, sans jamais écraser une
version modifiée entre-temps sur le disque.

- Route authentifiée `POST /repositories/documents/update`.
- Révision SHA-256 renvoyée à chaque lecture, comparée à chaque écriture
  ([D-052](DECISIONS.md#d-052--la-révision-est-une-empreinte-sha-256-du-contenu-binaire)).
- Contrôle de concurrence optimiste, conflit explicite, aucun forçage
  ([D-053](DECISIONS.md#d-053--contrôle-de-concurrence-optimiste-pas-de-verrou),
  [D-054](DECISIONS.md#d-054--aucun-forçage-de-conflit)).
- Confinement réutilisé tel quel, refus d'écrire dans un lien symbolique
  ([D-055](DECISIONS.md#d-055--refus-décrire-dans-un-lien-symbolique)).
- Écriture par fichier temporaire puis remplacement, sans reste
  ([D-056](DECISIONS.md#d-056--écriture-par-fichier-temporaire-et-remplacement)).
- Modes lecture et édition sur `/projects/[id]/documents`, texte conservé en cas d'erreur.

**Fin d'étape atteinte** : `PROJECT_BRIEF.md` d'un projet est modifiable depuis NOX, et une
modification concurrente est refusée sans perte — vérifié par un test fonctionnel réel, voir
[PROJECT_STATE.md](PROJECT_STATE.md).

Hors périmètre volontaire : création, suppression, renommage, déplacement, brouillons,
sauvegarde automatique, aperçu Markdown, diff
([D-051](DECISIONS.md#d-051--lédition-ne-porte-que-sur-des-documents-existants),
[D-058](DECISIONS.md#d-058--aucune-sauvegarde-automatique)).

---

## ✅ 6. Création de documents Markdown — `TASK-006`

**Objectif** : créer un nouveau document depuis NOX, sans jamais écraser un fichier existant.

- Route authentifiée `POST /repositories/documents/create`, réponse `201`.
- Création par ouverture exclusive, seule garantie de non-écrasement
  ([D-062](DECISIONS.md#d-062--création-par-ouverture-exclusive-jamais-par-vérification-préalable),
  [D-063](DECISIONS.md#d-063--aucun-écrasement-aucune-option-pour-en-demander-un)).
- Dossiers parents obligatoirement existants, réels et non liés
  ([D-064](DECISIONS.md#d-064--les-dossiers-parents-doivent-exister--nox-nen-crée-aucun),
  [D-065](DECISIONS.md#d-065--refus-des-dossiers-parents-qui-sont-des-liens)).
- Noms validés pour rester portables, jamais transformés
  ([D-067](DECISIONS.md#d-067--noms-validés-pour-rester-portables-et-jamais-transformés)).
- Chemin final recomposé côté serveur à partir d'une destination validée
  ([D-068](DECISIONS.md#d-068--le-chemin-final-est-reconstruit-côté-serveur)).
- Page `/projects/[id]/documents/new` : cinq destinations, prévisualisation du chemin,
  contenu initial facultatif.

**Fin d'étape atteinte** : un document de référence manquant est créé depuis NOX, apparaît
aussitôt dans l'inventaire et devient immédiatement modifiable — vérifié par un test fonctionnel
réel, voir [PROJECT_STATE.md](PROJECT_STATE.md).

Hors périmètre volontaire : suppression, renommage, déplacement, création de dossiers, modèles
et génération de contenu
([D-069](DECISIONS.md#d-069--aucun-modèle-aucun-contenu-généré)).

---

## ✅ 7. Gestion structurée des tâches — `TASK-007`

**Objectif** : structurer le travail en tâches vérifiables, et produire l'artefact que liront
les agents.

- Modèles `Task`, `TaskAcceptanceCriterion`, `TaskDocumentReference`, `TaskValidationCommand`.
- Numéro attribué par un compteur transactionnel par projet, jamais réutilisé
  ([D-075](DECISIONS.md#d-075--allocation-transactionnelle-du-numéro),
  [D-076](DECISIONS.md#d-076--les-trous-de-numérotation-sont-acceptés)).
- Backlog filtrable et transitions manuelles centralisées dans une fonction pure
  ([D-078](DECISIONS.md#d-078--transitions-manuelles-limitées-et-centralisées)).
- Générateur Markdown pur et déterministe, sans valeur mutable
  ([D-083](DECISIONS.md#d-083--le-statut-et-la-priorité-ne-figurent-pas-dans-le-markdown)).
- Route authentifiée `POST /repositories/tasks/create-document`, seule autorisée à créer le
  dossier `tasks/` ([D-081](DECISIONS.md#d-081--le-dossier-tasks-est-la-seule-création-de-dossier-autorisée)).
- Synchronisation à quatre états et reprise idempotente, sans écrasement
  ([D-079](DECISIONS.md#d-079--quatre-états-de-synchronisation-explicites),
  [D-080](DECISIONS.md#d-080--reprise-idempotente-sans-écrasement)).
- Pages `/projects/[id]/tasks`, `/tasks/new` et `/tasks/[taskId]`.

**Fin d'étape atteinte** : une tâche complète est rédigeable dans NOX, son document Markdown
apparaît dans le repository, et une panne du runner ne la fait pas perdre — vérifié par un test
fonctionnel réel, voir [PROJECT_STATE.md](PROJECT_STATE.md).

Hors périmètre volontaire : exécution des commandes, lancement de Claude Code, modification
complète d'une spécification après création, suppression, renumérotation, duplication,
dépendances entre tâches
([D-084](DECISIONS.md#d-084--les-commandes-de-validation-sont-stockées-jamais-exécutées)).

La prévisualisation du prompt, initialement prévue ici, appartient à l'étape 8 : elle est
indissociable du lancement qu'elle précède.

---

## ✅ 8. Lancement manuel d'une tâche Claude Code — `TASK-008`

**Objectif** : transformer une tâche `READY` en exécution réelle de Claude Code, déclenchée
explicitement, et en rendre le résultat relisible.

- Modèle `Run`, numéroté par un compteur transactionnel propre à chaque tâche
  ([D-094](DECISIONS.md#d-094--registre-en-mémoire-limite-assumée)).
- Prompt d'exécution pur et déterministe, régénéré côté serveur, avec son empreinte
  ([D-088](DECISIONS.md#d-088--le-prompt-est-déterministe-et-régénéré-côté-serveur)).
- Préflight Git obligatoire, en lecture seule, sans accès réseau
  ([D-090](DECISIONS.md#d-090--préflight-git-obligatoire-avant-tout-lancement),
  [D-091](DECISIONS.md#d-091--lupstream-comparé-est-la-référence-locale)).
- Routes authentifiées `POST /claude/preflight`, `/claude/runs/start` (`202`) et
  `/claude/runs/status`.
- Permissions d'outils explicites, calculées, jamais reçues du navigateur
  ([D-097](DECISIONS.md#d-097--permissions-explicites-calculées-jamais-reçues),
  [D-098](DECISIONS.md#d-098--une-commande-qui-ne-peut-pas-être-représentée-exactement-bloque-le-lancement)).
- Environnement nettoyé de toutes les variables `NOX_*`
  ([D-100](DECISIONS.md#d-100--lenvironnement-du-processus-enfant-est-nettoyé-de-toutes-les-variables-nox)).
- Registre en mémoire, interrogation périodique, résultat persisté
  ([D-095](DECISIONS.md#d-095--interrogation-périodique-plutôt-que-flux-dévénements),
  [D-096](DECISIONS.md#d-096--le-navigateur-ne-parle-jamais-au-runner)).
- Pages `/tasks/[taskId]/runs/new` et `/tasks/[taskId]/runs/[runId]`.

**Fin d'étape atteinte** : une tâche `READY` est lancée depuis NOX, modifie réellement le
repository, et son résultat est relisible sans copier-coller — vérifié par un test fonctionnel
avec un faux Claude Code, voir [PROJECT_STATE.md](PROJECT_STATE.md).

> **Réserve.** Claude Code n'était pas installé sur la machine au moment de cette étape. La
> syntaxe des arguments (`-p`, `--output-format json`, `--max-turns`, `--allowedTools`,
> `--disallowedTools`) et celle des règles d'outils suivent la forme documentée du mode non
> interactif, mais **n'ont pas été vérifiées contre un binaire local**. Aucune requête Claude
> réelle n'a été lancée. `buildClaudeArguments`, `formatBashRule` et `probeClaudeVersion` sont
> isolées pour qu'un écart se corrige à un seul endroit. Le premier run réel reste à faire.

Hors périmètre volontaire : streaming des événements, annulation manuelle, reprise de session,
prompt correctif automatique, exécution automatique d'une autre tâche, plusieurs agents en
parallèle, worktrees, commits automatiques
([D-095](DECISIONS.md#d-095--interrogation-périodique-plutôt-que-flux-dévénements),
[D-105](DECISIONS.md#d-105--nox-constate-létat-git-il-ne-le-répare-pas)).

---

## ✅ 9. Suppression sécurisée et libellés d'état — `TASK-009`

**Objectif** : pouvoir retirer depuis NOX ce qui a été créé pour des essais, sans jamais perdre
un historique, et rendre les états lisibles d'un coup d'œil.

- Route authentifiée `POST /repositories/documents/delete`, avec contrôle de révision
  ([D-107](DECISIONS.md#d-107--la-suppression-exige-une-révision-comme-lécriture),
  [D-108](DECISIONS.md#d-108--aucune-suppression-forcée-aucun-bouton-pour-en-demander-une)).
- Documents `tasks/TASK-xxx.md` protégés **par le runner**, pas seulement par l'interface
  ([D-111](DECISIONS.md#d-111--les-documents-taskstask-xxxmd-sont-protégés-dans-le-runner)).
- Route dédiée `POST /repositories/tasks/delete-document`, qui ne reçoit qu'un code de tâche
  ([D-112](DECISIONS.md#d-112--une-route-dédiée-pour-le-document-dune-tâche),
  [D-113](DECISIONS.md#d-113--un-document-absent-est-une-réussite-idempotente)).
- Aucun dossier supprimé, aucun lien suivi, aucune suppression récursive
  ([D-110](DECISIONS.md#d-110--aucun-dossier-nest-supprimé-jamais)).
- `deleteTaskWithoutRuns` et contrainte `Restrict` de `Run` vers `Task`
  ([D-115](DECISIONS.md#d-115--une-tâche-possédant-un-historique-nest-pas-supprimable),
  [D-116](DECISIONS.md#d-116--la-contrainte-double-la-règle-métier)).
- Fichier supprimé avant la base, numéro jamais réutilisé
  ([D-117](DECISIONS.md#d-117--le-numéro-dune-tâche-supprimée-reste-réservé),
  [D-118](DECISIONS.md#d-118--le-fichier-est-supprimé-avant-la-tâche-en-base)).
- Confirmations portées par l'URL, code de tâche à recopier
  ([D-119](DECISIONS.md#d-119--la-confirmation-exige-de-recopier-le-code-de-la-tâche),
  [D-120](DECISIONS.md#d-120--les-confirmations-sont-portées-par-lurl-pas-par-un-état-de-composant)).
- Libellés anglais limités aux micro-éléments techniques, centralisés dans `lib/labels.ts`
  ([D-121](DECISIONS.md#d-121--langlais-est-limité-aux-micro-éléments-techniques),
  [D-122](DECISIONS.md#d-122--un-seul-module-traduit-les-valeurs-internes),
  [D-123](DECISIONS.md#d-123--les-valeurs-internes-ne-changent-pas)).

**Fin d'étape atteinte** : un document de test se supprime depuis NOX, une modification
concurrente bloque la suppression sans rien perdre, une tâche sans exécution disparaît avec son
Markdown, et une tâche avec historique est conservée — vérifié par un test fonctionnel réel, voir
[PROJECT_STATE.md](PROJECT_STATE.md).

Hors périmètre volontaire : suppression de projet, de run, de tâche avec exécutions, suppression
forcée, récursive ou en masse, corbeille, restauration, archivage, renommage, déplacement.

---

## 🟢 10. Streaming et annulation d'une exécution

**Étape active.**

**Objectif** : suivre une exécution en direct et pouvoir l'interrompre.

- Diffusion progressive des événements Claude Code en Server-Sent Events.
- Bouton d'annulation d'une exécution active, avec arrêt propre du processus.
- Reprise du flux après une coupure du navigateur.

**Prérequis** : cette étape ne doit commencer qu'**après** l'installation de Claude Code et la
validation d'un premier run réel contrôlé. Streamer et annuler des événements dont on n'a jamais
vu la forme réelle reviendrait à empiler des suppositions sur celles de l'étape 8.

**Fin d'étape** : l'interface affiche en direct la progression d'une exécution, et permet de
l'interrompre sans laisser de processus orphelin.

---

## ⬜ 11. Git et validations

**Objectif** : rendre le résultat relisible.

- ~~`git status`, liste des fichiers modifiés~~ — fait à l'étape 8.
- Diff complet consultable dans l'interface.
- Résultat des commandes de validation, exécutées par Claude Code, extrait de son compte rendu.
- Distinction explicite entre échec et commande non lancée.

**Fin d'étape** : la review d'une tâche se fait entièrement dans NOX.

---

## ⬜ 12. Orchestrateur OpenAI

**Objectif** : discuter du besoin dans NOX.

- Une conversation persistée par projet.
- Documents du projet fournis comme contexte.
- Proposition de tâches et de mises à jour de documents, validées par l'utilisateur.
- Suivi indicatif des coûts.

**Fin d'étape** : le découpage d'un besoin se fait dans NOX plutôt que dans un onglet séparé.

---

## ⬜ 13. Test sur un petit projet réel

**Objectif** : confronter NOX à un usage réel.

- Piloter un projet secondaire de bout en bout avec NOX.
- Relever les frictions et les manques.
- Corriger avant d'ajouter la moindre fonctionnalité avancée.

**Fin d'étape** : un projet réel a été mené sans repasser par un flux manuel.

---

## ⬜ 14. Fonctionnalités avancées

**Objectif** : améliorer l'usage une fois la V1 éprouvée.

- Suivi fin des coûts OpenAI et des limites d'utilisation Claude.
- Historique et comparaison des exécutions.
- Modèles de tâches réutilisables.
- Éléments listés hors périmètre dans [V1_SCOPE.md](V1_SCOPE.md), si le besoin se confirme.

**Aucun élément de cette étape ne doit être anticipé avant l'étape 13.**
