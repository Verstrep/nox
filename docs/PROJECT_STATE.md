# PROJECT_STATE — État réel du projet

> Ce document décrit ce qui existe **réellement** dans le repository, pas ce qui est prévu.
> Il est mis à jour à la fin de chaque tâche.

**Dernière mise à jour** : 4 août 2026, à l'issue de `TASK-002`.

---

## 1. Phase actuelle

**Première fonctionnalité produit livrée.** Le monorepo dispose d'une persistance locale
opérationnelle et d'un premier parcours utilisateur complet : créer un projet, l'associer à un
repository Git local, le retrouver après redémarrage.

Étape correspondante dans la [roadmap](ROADMAP.md) : **étape 2 — gestion locale des projets
(terminée)**. L'étape 3 (documents Markdown) devient l'étape active.

## 2. Tâche active

`TASK-002 — Gestion locale des projets` : **terminée**, en attente de review humaine.

Aucun commit ni push n'a été effectué par Claude Code. Les modifications sont locales et
disponibles pour relecture.

## 3. Éléments terminés

### 3.1 Persistance — `packages/database` (nouveau)

- Prisma 7.9.1, provider SQLite, driver adapter `@prisma/adapter-better-sqlite3`.
- Modèle `Project` : `id`, `name`, `description`, `repositoryPath` (unique), `status`,
  `createdAt`, `updatedAt`.
- Migration initiale versionnée : `prisma/migrations/20260804174608_init/`.
- Base de développement : `data/nox-dev.db`. Le contenu de `data/` est ignoré par Git ; le
  dossier est conservé via `.gitkeep`.
- Chemin de la base résolu depuis la racine du monorepo (`src/paths.ts`), jamais depuis
  `process.cwd()` : le CLI Prisma, les scripts npm et Next.js visent le même fichier.
- Client Prisma généré dans `src/generated/prisma/`, ignoré par Git, régénéré par
  `npm install` (script `prepare`) et par `npm run build`.
- Fonctions d'accès : `listProjects`, `getProjectById`, `findProjectByRepositoryPath`,
  `createProject`, `isUniqueConstraintError`. Le client est passé en paramètre, ce qui rend les
  tests indépendants de la base de développement.

### 3.2 Validation d'un repository — `apps/web/lib/repository-path.ts`

Contrôles effectués, dans cet ordre, exclusivement côté serveur :

1. champ non vide ;
2. chemin absolu ;
3. chemin existant ;
4. chemin pointant vers un dossier ;
5. `git -C <chemin> rev-parse --show-toplevel` réussi ;
6. sortie Git non vide ;
7. unicité de la racine canonique (pré-contrôle applicatif + contrainte `@unique`).

Garanties : `execFile` sans shell, délai maximal de 5 secondes, aucun fichier du repository lu,
aucune commande Git modifiant le repository. Le chemin retenu est la racine retournée par Git,
repassée par `fs.realpathSync.native()` — ce qui normalise la casse réelle sous Windows, les
liens symboliques et les séparateurs.

### 3.3 Interface — `apps/web`

- **`/`** : tableau de bord. Liste les projets lus en base, du plus récent au plus ancien.
  Chaque carte affiche nom, description, statut, chemin du repository, date, et un lien vers le
  projet. État vide conservé quand aucun projet n'existe. Le bouton « Nouveau projet » est
  fonctionnel.
- **`/projects/new`** : formulaire (nom, description facultative, chemin absolu). Erreurs
  affichées sous le champ concerné, bloc distinct pour les erreurs non rattachées à un champ,
  bouton désactivé et libellé modifié pendant la soumission, valeurs conservées après erreur,
  lien de retour au tableau de bord.
- **`/projects/[id]`** : nom, description, statut, chemin canonique, dates de création et de
  modification, indicateur de validation du repository, et quatre sections vides annoncées
  (Conversation, Documents, Tâches, Exécutions) — sans aucune donnée simulée.
- Identifiant inconnu → `notFound()`, servi par `app/not-found.tsx` (HTTP 404).
- Lecture en Server Components via `lib/projects.ts`, qui appelle `connection()` avant chaque
  requête : sans cela, Next.js exécuterait SQLite pendant le build.
- Création par Server Action. Aucun Client Component n'appelle Prisma.

### 3.4 Outillage

- `npm run test` (`node --test`) : 31 tests, 7 suites, aucun framework installé.
- Nouveaux scripts racine : `test`, `db:generate`, `db:migrate`, `db:deploy`, `db:studio`,
  `build:database`.
- `apps/web` passe en `"type": "module"` : supprime l'avertissement
  `MODULE_TYPELESS_PACKAGE_JSON` de Node lors des tests. Build et rendu vérifiés inchangés.

### 3.5 Validations exécutées

| Commande | Résultat |
| --- | --- |
| `npm install` | Succès — 533 paquets, 0 vulnérabilité, aucun avertissement de dépendance de pair |
| `npm run db:generate` | Succès — client Prisma 7.9.1 généré |
| `npm run db:migrate` | Succès — migration `init` créée puis appliquée |
| `npm run db:deploy` | Succès — « No pending migrations to apply » |
| `npm run test` | Succès — 31 tests, 31 passés, 0 échec |
| `npm run lint` | Succès — aucune erreur, aucun avertissement |
| `npm run typecheck` | Succès — les quatre workspaces |
| `npm run build` | Succès — `/` et `/projects/[id]` dynamiques, `/projects/new` et `/_not-found` statiques |
| Test fonctionnel complet | Succès — voir § 3.6 |

### 3.6 Test fonctionnel réellement exécuté

Scénario joué contre le serveur de production (`next start`), en soumettant le vrai formulaire
par POST multipart — le chemin qu'emprunte un navigateur sans JavaScript, donc la Server Action
réelle et non un raccourci vers la couche de données :

| Étape | Résultat |
| --- | --- |
| Repository Git temporaire créé (nom contenant un espace) | ✅ |
| Soumission d'un **sous-dossier** du repository | ✅ HTTP 303 vers `/projects/<id>` |
| Chemin enregistré = racine Git, pas le sous-dossier | ✅ |
| Même repository soumis une seconde fois | ✅ refus métier affiché, pas de redirection |
| Chemin relatif | ✅ refusé |
| Dossier inexistant | ✅ refusé |
| Dossier hors repository Git | ✅ refusé |
| Nom vide | ✅ refusé |
| Projet visible sur le tableau de bord | ✅ |
| Page de détail accessible, chemin et indicateur corrects | ✅ |
| Identifiant inconnu | ✅ HTTP 404 |
| **Serveur arrêté puis redémarré** | ✅ projet toujours présent, toutes les vérifications repassent |

Nettoyage effectué après le test : la ligne créée a été supprimée de `data/nox-dev.db` (la base
est revenue à 0 projet) et le repository temporaire a été effacé. Aucun repository existant n'a
été touché.

## 4. Éléments non commencés

- Édition, suppression, archivage d'un projet et changement de statut
  ([D-027](DECISIONS.md#d-027--ni-édition-ni-suppression-de-projet-dans-task-002)).
- Sélecteur natif de dossier, import automatique, clonage Git, GitHub.
- Documents Markdown éditables depuis l'interface.
- Backlog de tâches : aucun modèle `Task`, aucun écran.
- Runner : aucune exécution de commande, aucun accès Git, aucun flux SSE.
- Intégration Claude Code CLI et intégration OpenAI.
- Suivi des coûts et des limites d'utilisation.
- Authentification, multi-utilisateur, déploiement.

## 5. Blocages connus

**Aucun blocage.** Toutes les validations passent.

## 6. Dette technique et limites

1. **Le serveur web lance un processus Git.** Cela contredit l'intention initiale
   d'ARCHITECTURE.md (« seul le runner touche aux processus »). L'exception est unique, en
   lecture seule, documentée en [§ 5.2 d'ARCHITECTURE.md](ARCHITECTURE.md) et
   [D-023](DECISIONS.md#d-023--validation-git-côté-serveur-dans-appsweb). À déplacer vers
   `apps/runner` au plus tard à l'étape « runner contrôlé ».
2. **Pré-contrôle d'unicité non atomique.** `findProjectByRepositoryPath` puis `createProject`
   ne forment pas une transaction : deux soumissions simultanées peuvent franchir le
   pré-contrôle. La contrainte `@unique` rattrape le cas et l'erreur `P2002` est traduite en
   message métier. Sans conséquence pour un outil mono-utilisateur.
3. **Statut figé à `DRAFT`.** Aucune transition n'est possible tant que les tâches n'existent
   pas. Les cinq statuts de `ProjectStatus` sont affichés comme repère, pas comme filtre actif.
4. **`prisma.config.ts` importe `./src/paths.ts`.** Cela fonctionne car le CLI Prisma transpile
   le TypeScript, mais impose `allowImportingTsExtensions` dans le tsconfig du package — ce qui
   a rendu nécessaire de figer `importFileExtension = "js"` dans le schéma
   ([D-021](DECISIONS.md#d-021--client-prisma-généré-jamais-versionné)). À revérifier lors
   d'une montée de version majeure de Prisma.
5. **Aucun test de rendu React.** Les tests couvrent la validation, la persistance et — via le
   test fonctionnel — le parcours HTTP complet. Les composants eux-mêmes ne sont pas testés
   unitairement ; ce serait une dépendance supplémentaire pour un bénéfice faible à ce stade.
6. **TypeScript figé en 5.9 et ESLint en 9.x**, inchangé depuis TASK-001
   ([D-012](DECISIONS.md#d-012--typescript-59-plutôt-que-7x),
   [D-013](DECISIONS.md#d-013--eslint-9-plutôt-que-10x)).
7. **Node ≥ 22.18 requis** pour `npm run dev:runner` et `npm run test`, qui s'appuient sur le
   type stripping natif.

## 7. Prochaine tâche recommandée

**`TASK-003` — Documents Markdown d'un projet.**

Objectif : lire et modifier depuis NOX les documents Markdown de référence présents dans le
repository d'un projet, en remplissant la section « Documents » aujourd'hui vide de la page
projet.

## 8. État Git

- Aucun commit créé par Claude Code.
- Aucun push effectué.
- Historique Git non modifié.
- Commit de départ : `607cf58` (`chore: scaffold NOX monorepo`), répertoire de travail propre
  avant l'intervention.
- Les modifications de `TASK-002` sont locales, non indexées, disponibles pour review.
