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

## 🟢 3. Documents Markdown

**Étape active.**

**Objectif** : lire et écrire les documents de référence depuis NOX.

- Lecture des fichiers Markdown du repository d'un projet.
- Édition et sauvegarde depuis l'interface.
- Rendu lisible dans le tableau de bord.

**Fin d'étape** : `PROJECT_BRIEF.md` d'un projet est modifiable depuis NOX.

---

## ⬜ 4. Gestion des tâches

**Objectif** : structurer le travail en tâches vérifiables.

- Modèle de tâche : objectif, périmètre, hors-périmètre, critères d'acceptation, validations.
- Backlog ordonné, transitions de `TaskStatus`.
- Génération et prévisualisation du prompt d'une tâche.

**Fin d'étape** : une tâche complète est rédigeable dans NOX et son prompt est prévisualisable.

---

## ⬜ 5. Runner contrôlé

**Objectif** : piloter le runner local depuis l'interface.

- Détection de la disponibilité du runner (`/health`).
- Endpoints d'exécution de commandes déclarées.
- Diffusion des logs en Server-Sent Events.

**Fin d'étape** : l'interface affiche en direct la sortie d'une commande lancée par le runner.

---

## ⬜ 6. Intégration Claude Code

**Objectif** : envoyer une tâche au CLI et récupérer son compte rendu.

- Lancement de Claude Code par le runner dans le repository du projet.
- Flux de logs rattaché à une exécution.
- Annulation d'une exécution en cours.

**Fin d'étape** : une tâche rédigée dans NOX modifie réellement un repository, sans copier-coller.

---

## ⬜ 7. Git et validations

**Objectif** : rendre le résultat relisible.

- `git status`, liste des fichiers modifiés, diff consultable.
- Exécution du lint, du typecheck et du build après une exécution.
- Distinction explicite entre échec et commande non lancée.

**Fin d'étape** : la review d'une tâche se fait entièrement dans NOX.

---

## ⬜ 8. Orchestrateur OpenAI

**Objectif** : discuter du besoin dans NOX.

- Une conversation persistée par projet.
- Documents du projet fournis comme contexte.
- Proposition de tâches et de mises à jour de documents, validées par l'utilisateur.
- Suivi indicatif des coûts.

**Fin d'étape** : le découpage d'un besoin se fait dans NOX plutôt que dans un onglet séparé.

---

## ⬜ 9. Test sur un petit projet réel

**Objectif** : confronter NOX à un usage réel.

- Piloter un projet secondaire de bout en bout avec NOX.
- Relever les frictions et les manques.
- Corriger avant d'ajouter la moindre fonctionnalité avancée.

**Fin d'étape** : un projet réel a été mené sans repasser par un flux manuel.

---

## ⬜ 10. Fonctionnalités avancées

**Objectif** : améliorer l'usage une fois la V1 éprouvée.

- Suivi fin des coûts OpenAI et des limites d'utilisation Claude.
- Historique et comparaison des exécutions.
- Modèles de tâches réutilisables.
- Éléments listés hors périmètre dans [V1_SCOPE.md](V1_SCOPE.md), si le besoin se confirme.

**Aucun élément de cette étape ne doit être anticipé avant l'étape 9.**
