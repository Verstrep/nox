# NOX

**Orchestration du développement assisté par IA.**

NOX est une application personnelle qui relie la conception d'un projet à son implémentation.
Elle permet de formaliser un besoin dans des documents Markdown, de le découper en petites
tâches, d'envoyer ces tâches à Claude Code, d'exécuter les validations et de relire le résultat
— sans copier-coller manuel entre la conversation de conception et l'agent d'implémentation.

> ⚠️ **Projet en cours de développement.** Le socle technique est en place ; les
> fonctionnalités décrites ci-dessus ne sont pas encore implémentées.

## État actuel

Étape terminée : **TASK-001 — socle monorepo**.

| Élément | État |
| --- | --- |
| Monorepo npm workspaces | ✅ fonctionnel |
| Application web (page d'accueil statique) | ✅ fonctionnelle |
| Runner local avec `GET /health` | ✅ fonctionnel |
| Package partagé `@nox/shared` | ✅ consommé par le web et le runner |
| Lint / typecheck / build | ✅ passent |
| Persistance, API, intégration IA | ⬜ non commencées |

Détail complet : [docs/PROJECT_STATE.md](docs/PROJECT_STATE.md).

## Prérequis

- **Node.js ≥ 22.18.0** — requis pour l'exécution native des fichiers TypeScript par le runner
  en mode développement (`node --watch src/index.ts`).
- **npm ≥ 10** — les workspaces natifs sont utilisés.
- **Git**.

Vérifier les versions installées :

```powershell
node --version
npm --version
```

## Installation

```powershell
git clone <url-du-repository> nox
cd nox
npm install
```

`npm install` compile automatiquement `packages/shared` via le script `prepare` : les autres
workspaces le consomment depuis `packages/shared/dist`.

Optionnel — créer un fichier de configuration local à partir de l'exemple :

```powershell
Copy-Item .env.example .env
```

Le fichier `.env` n'est pas versionné et ne doit contenir aucun secret partagé.

## Commandes disponibles

Toutes les commandes se lancent depuis la racine du repository.

| Commande | Effet |
| --- | --- |
| `npm run dev:web` | Démarre l'application web sur `http://localhost:3000` |
| `npm run dev:runner` | Démarre le runner en mode surveillé sur `http://127.0.0.1:4310` |
| `npm run start:runner` | Démarre le runner compilé (nécessite `npm run build` au préalable) |
| `npm run build` | Compile `@nox/shared`, `@nox/runner` puis `@nox/web` |
| `npm run build:shared` | Compile uniquement le package partagé |
| `npm run lint` | Analyse ESLint de l'ensemble du repository |
| `npm run typecheck` | Vérifie le typage des trois workspaces |

## Lancer l'application web

```powershell
npm run dev:web
```

Puis ouvrir <http://localhost:3000>. La page d'accueil présente le futur tableau de bord :
indicateur d'initialisation, section « Projets » vide, état du socle et prochaines étapes.
Toutes les données affichées sont statiques à ce stade.

## Lancer le runner

Dans un second terminal :

```powershell
npm run dev:runner
```

Sortie attendue :

```text
[nox-runner] v0.1.0 - etat RUNNING
[nox-runner] En ecoute sur http://127.0.0.1:4310
[nox-runner] Sonde de sante : http://127.0.0.1:4310/health
```

Le port et l'interface d'écoute sont configurables :

```powershell
$env:NOX_RUNNER_PORT = "4400"
npm run dev:runner
```

Le runner s'arrête proprement sur `Ctrl+C` (`SIGINT`) ou sur `SIGTERM`.

## Tester le endpoint `/health`

Avec PowerShell :

```powershell
Invoke-RestMethod http://127.0.0.1:4310/health | ConvertTo-Json
```

Réponse attendue :

```json
{
  "service": "nox-runner",
  "status": "ok",
  "version": "0.1.0"
}
```

Toute autre route renvoie un `404` au format JSON :

```powershell
try { Invoke-RestMethod http://127.0.0.1:4310/inconnu } catch { $_.ErrorDetails.Message }
```

```json
{
  "service": "nox-runner",
  "status": "not_found",
  "error": "Route inconnue : GET /inconnu"
}
```

## Structure du repository

```text
NOX/
├── apps/
│   ├── web/                  Application Next.js (App Router, Tailwind CSS)
│   │   ├── app/              Layout, page d'accueil, styles globaux
│   │   ├── components/       Composants d'interface réutilisables
│   │   └── public/           Fichiers statiques
│   │
│   └── runner/               Runner local Node.js
│       └── src/index.ts      Serveur HTTP natif, GET /health
│
├── packages/
│   └── shared/               Types et constantes partagés (@nox/shared)
│       └── src/statuses.ts   ProjectStatus, TaskStatus, RunStatus
│
├── docs/                     Documentation de référence
├── CLAUDE.md                 Règles permanentes des sessions Claude Code
├── eslint.config.mjs         Configuration ESLint unique du monorepo
├── tsconfig.base.json        Configuration TypeScript commune (mode strict)
└── package.json              Workspaces et scripts racine
```

## Documentation

| Document | Contenu |
| --- | --- |
| [docs/PROJECT_BRIEF.md](docs/PROJECT_BRIEF.md) | Problème, vision, rôles et flux cible |
| [docs/V1_SCOPE.md](docs/V1_SCOPE.md) | Périmètre de la V1 et exclusions |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Découpage technique et responsabilités |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Étapes ordonnées jusqu'à la V1 |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Décisions prises et justifications |
| [docs/PROJECT_STATE.md](docs/PROJECT_STATE.md) | État réel du projet à l'instant T |
| [CLAUDE.md](CLAUDE.md) | Règles permanentes des sessions Claude Code |

## Développement

Le projet avance par petites tâches successives. Avant chaque nouvelle tâche, l'état validé est
commité et poussé manuellement — NOX et Claude Code ne poussent jamais vers un dépôt distant.

Avant de considérer une tâche terminée :

```powershell
npm run lint
npm run typecheck
npm run build
```
