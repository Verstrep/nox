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

## 🟢 6. Création de documents Markdown

**Étape active.**

**Objectif** : créer un nouveau document depuis NOX, sans jamais écraser un fichier existant.

- Validation d'un chemin qui n'existe pas encore, dans un emplacement autorisé.
- Refus d'écrasement d'un fichier déjà présent.
- Réutilisation du confinement et de l'écriture sûre de l'étape 5.

**Fin d'étape** : un document de référence manquant peut être créé depuis NOX.

---

## ⬜ 7. Gestion des tâches

**Objectif** : structurer le travail en tâches vérifiables.

- Modèle de tâche : objectif, périmètre, hors-périmètre, critères d'acceptation, validations.
- Backlog ordonné, transitions de `TaskStatus`.
- Génération et prévisualisation du prompt d'une tâche.

**Fin d'étape** : une tâche complète est rédigeable dans NOX et son prompt est prévisualisable.

---

## ⬜ 8. Runner contrôlé

**Objectif** : piloter le runner local depuis l'interface.

- ~~Détection de la disponibilité du runner (`/health`)~~ — fait à l'étape 3.
- Endpoints d'exécution de commandes déclarées.
- Diffusion des logs en Server-Sent Events.

**Fin d'étape** : l'interface affiche en direct la sortie d'une commande lancée par le runner.

---

## ⬜ 9. Intégration Claude Code

**Objectif** : envoyer une tâche au CLI et récupérer son compte rendu.

- Lancement de Claude Code par le runner dans le repository du projet.
- Flux de logs rattaché à une exécution.
- Annulation d'une exécution en cours.

**Fin d'étape** : une tâche rédigée dans NOX modifie réellement un repository, sans copier-coller.

---

## ⬜ 10. Git et validations

**Objectif** : rendre le résultat relisible.

- `git status`, liste des fichiers modifiés, diff consultable.
- Exécution du lint, du typecheck et du build après une exécution.
- Distinction explicite entre échec et commande non lancée.

**Fin d'étape** : la review d'une tâche se fait entièrement dans NOX.

---

## ⬜ 11. Orchestrateur OpenAI

**Objectif** : discuter du besoin dans NOX.

- Une conversation persistée par projet.
- Documents du projet fournis comme contexte.
- Proposition de tâches et de mises à jour de documents, validées par l'utilisateur.
- Suivi indicatif des coûts.

**Fin d'étape** : le découpage d'un besoin se fait dans NOX plutôt que dans un onglet séparé.

---

## ⬜ 12. Test sur un petit projet réel

**Objectif** : confronter NOX à un usage réel.

- Piloter un projet secondaire de bout en bout avec NOX.
- Relever les frictions et les manques.
- Corriger avant d'ajouter la moindre fonctionnalité avancée.

**Fin d'étape** : un projet réel a été mené sans repasser par un flux manuel.

---

## ⬜ 13. Fonctionnalités avancées

**Objectif** : améliorer l'usage une fois la V1 éprouvée.

- Suivi fin des coûts OpenAI et des limites d'utilisation Claude.
- Historique et comparaison des exécutions.
- Modèles de tâches réutilisables.
- Éléments listés hors périmètre dans [V1_SCOPE.md](V1_SCOPE.md), si le besoin se confirme.

**Aucun élément de cette étape ne doit être anticipé avant l'étape 12.**
