# PROJECT_STATE — État réel du projet

> Ce document décrit ce qui existe **réellement** dans le repository, pas ce qui est prévu.
> Il est mis à jour à la fin de chaque tâche.

**Dernière mise à jour** : 4 août 2026, à l'issue de `TASK-001`.

---

## 1. Phase actuelle

**Socle technique posé.** Le repository est un monorepo npm fonctionnel, typé en mode strict
et validable de bout en bout. Aucune fonctionnalité produit n'est implémentée : il n'y a ni
persistance, ni API, ni intégration IA.

Étape correspondante dans la [roadmap](ROADMAP.md) : **étape 1 — socle monorepo (terminée)**.

## 2. Tâche active

`TASK-001 — Initialisation du socle` : **terminée**, en attente de review humaine.

Aucun commit ni push n'a été effectué par Claude Code. Les modifications sont locales et
disponibles pour relecture.

## 3. Éléments terminés

### 3.1 Workspace racine

- Workspaces npm : `apps/*` et `packages/*`, avec `private: true`.
- `engines.node` : `>=22.18.0`.
- Configuration TypeScript commune (`tsconfig.base.json`) en mode strict, complétée par
  `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`
  et `isolatedModules`.
- Configuration ESLint unique à la racine (`eslint.config.mjs`), avec analyse typée.
- `.gitignore` couvrant Node, Next.js, les sorties de build et les fichiers d'environnement.
- `.env.example` sans aucune valeur réelle.
- Scripts racine : `dev:web`, `dev:runner`, `start:runner`, `build`, `build:shared`, `lint`,
  `typecheck`.

### 3.2 `apps/web`

- Next.js 16 avec App Router, React 19, TypeScript strict, Tailwind CSS 4.
- Page d'accueil statique (`app/page.tsx`) : identité NOX et version, indicateur
  « Système en phase d'initialisation », section « Projets » vide avec bouton
  « Nouveau projet » désactivé, section « Socle en place », section
  « Prochaines grandes étapes ».
- Trois composants d'interface : `StatusBadge`, `SectionCard`, `EmptyState`.
- Thème sombre, sobre, responsive (grille passant à une colonne sur petit écran).
- Aucune donnée dynamique, aucune API, aucun formulaire fonctionnel.
- `apps/web/AGENTS.md` et `apps/web/CLAUDE.md` sont générés par `next dev` et conservés dans le
  repository (voir [D-017](DECISIONS.md#d-017--appswebagentsmd-et-appswebclaudemd-sont-versionnés)).

### 3.3 `apps/runner`

- Serveur HTTP basé uniquement sur `node:http`.
- Écoute par défaut sur `127.0.0.1:4310`.
- `NOX_RUNNER_PORT` et `NOX_RUNNER_HOST` permettent de changer le point d'écoute ; une valeur
  de port invalide déclenche un avertissement et un repli sur `4310`.
- `GET /health` → `200` avec `{ "service": "nox-runner", "status": "ok", "version": "0.1.0" }`.
- Toute autre route → `404` JSON avec la méthode et le chemin demandés.
- Arrêt propre sur `SIGINT` et `SIGTERM`, protégé contre les signaux répétés.
- Message d'erreur explicite si le port est déjà occupé (`EADDRINUSE`).

### 3.4 `packages/shared`

- `ProjectStatus`, `TaskStatus`, `RunStatus` définis comme objets constants ; types union et
  listes de valeurs **dérivés** de ces objets, sans duplication.
- `createStatusGuard()` — fabrique générique de gardes de type — et les trois gardes
  `isProjectStatus`, `isTaskStatus`, `isRunStatus`.
- Constante `NOX_VERSION`.
- Compilé vers `dist/` avec déclarations de types, exposé via le champ `exports`.

### 3.5 Liaison entre workspaces — vérifiée

Le package partagé est réellement consommé par les deux applications :

- `apps/runner` importe `NOX_VERSION` (renvoyé par `/health`) et `RUN_STATUS` / `RunStatus`
  (état de cycle de vie du runner, tracé dans les logs).
- `apps/web` importe `NOX_VERSION`, `PROJECT_STATUS`, `PROJECT_STATUSES` et le type
  `ProjectStatus`, affichés sur la page d'accueil.

La liaison a été confirmée à l'exécution : le HTML rendu par le serveur de développement
contient bien les valeurs issues de `PROJECT_STATUSES`, et la réponse `/health` contient la
version issue de `@nox/shared`.

### 3.6 Documentation

- `docs/PROJECT_BRIEF.md`, `docs/V1_SCOPE.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`,
  `docs/DECISIONS.md`, `docs/PROJECT_STATE.md`.
- `CLAUDE.md` à la racine — règles permanentes des sessions Claude Code.
- `README.md` réécrit : installation, commandes, lancement, test de `/health`, structure.

### 3.7 Validations exécutées

| Commande | Résultat |
| --- | --- |
| `npm install` | Succès — 368 paquets, 0 vulnérabilité, aucun avertissement de dépendance de pair |
| `npm run lint` | Succès — aucune erreur, aucun avertissement |
| `npm run typecheck` | Succès — les trois workspaces |
| `npm run build` | Succès — `@nox/shared`, `@nox/runner`, puis `@nox/web` (routes `/` et `/_not-found` en statique) |
| `GET /health` | `200` — payload conforme |
| `GET /` et `GET /unknown` | `404` JSON |
| `NOX_RUNNER_PORT=4311` | Port personnalisé pris en compte |
| Arrêt sur `SIGINT` | Serveur fermé proprement, port libéré |
| Runner depuis les sources TypeScript | `node src/index.ts` fonctionne sans transpileur tiers |
| Page d'accueil (`npm run dev:web`) | Rendue sur `http://localhost:3000`, contenu et CSS Tailwind conformes |

## 4. Éléments non commencés

- Persistance : aucune base de données, aucun stockage local.
- API : aucun Route Handler dans `apps/web`.
- Gestion des projets : aucune création, aucun enregistrement de chemin de repository.
- Documents Markdown : non éditables depuis l'interface.
- Backlog de tâches : aucun modèle, aucun écran.
- Runner : aucune exécution de commande système, aucun accès Git, aucun flux SSE.
- Intégration Claude Code CLI : absente.
- Intégration OpenAI et orchestrateur conversationnel : absents.
- Suivi des coûts et des limites d'utilisation : absent.
- Tests automatisés : aucun framework de test installé (hors périmètre de TASK-001).

## 5. Blocages connus

**Aucun blocage.** Toutes les validations passent.

Points de vigilance, sans impact fonctionnel actuel :

1. **TypeScript figé en 5.9.** La 7.x est stable mais incompatible avec `typescript-eslint@8`,
   embarqué par `eslint-config-next@16`. Voir [D-012](DECISIONS.md#d-012--typescript-59-plutôt-que-7x).
2. **ESLint figé en 9.x.** Les plugins de `eslint-config-next` déclarent un pair maximal `^9`.
   Voir [D-013](DECISIONS.md#d-013--eslint-9-plutôt-que-10x).
3. **Node ≥ 22.18 requis** pour `npm run dev:runner`, qui s'appuie sur le type stripping natif.
   Le mode compilé (`npm run build` puis `npm run start:runner`) n'a pas cette contrainte.
4. **Arrêt sur signal vérifié en déclenchant `SIGINT` dans le processus.** Windows ne permet pas
   de délivrer un vrai `SIGINT` via `process.kill` : la remise du signal par le système
   d'exploitation reste à confirmer manuellement avec `Ctrl+C`.

## 6. Prochaine tâche envisagée

**`TASK-002` — Gestion locale des projets.**

Objectif : permettre de créer un projet NOX depuis l'interface, de lui associer le chemin d'un
repository Git local, et de faire survivre cet état à un redémarrage du serveur.

Cela implique de trancher la solution de persistance et de consigner ce choix dans
[DECISIONS.md](DECISIONS.md).

## 7. État Git

- Aucun commit créé par Claude Code.
- Aucun push effectué.
- Historique Git non modifié.
- Les modifications de `TASK-001` sont locales, non indexées, disponibles pour review.
