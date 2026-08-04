# NOX

**Orchestration du développement assisté par IA.**

NOX est une application personnelle qui relie la conception d'un projet à son implémentation.
Elle permet de formaliser un besoin dans des documents Markdown, de le découper en petites
tâches, d'envoyer ces tâches à Claude Code, d'exécuter les validations et de relire le résultat
— sans copier-coller manuel entre la conversation de conception et l'agent d'implémentation.

> ⚠️ **Projet en cours de développement.** Le socle technique est en place ; les
> fonctionnalités décrites ci-dessus ne sont pas encore implémentées.

## État actuel

Dernière étape terminée : **TASK-002 — gestion locale des projets**.

| Élément | État |
| --- | --- |
| Monorepo npm workspaces | ✅ fonctionnel |
| Runner local avec `GET /health` | ✅ fonctionnel |
| Package partagé `@nox/shared` | ✅ consommé par le web et le runner |
| Persistance locale (Prisma + SQLite) | ✅ fonctionnelle |
| Création / liste / consultation d'un projet | ✅ fonctionnelles |
| Validation serveur d'un repository Git | ✅ fonctionnelle |
| Édition, suppression, archivage d'un projet | ⬜ non commencées |
| Documents, tâches, exécutions, intégration IA | ⬜ non commencées |
| Tests / lint / typecheck / build | ✅ passent |

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

`npm install` déclenche le script `prepare`, qui compile `packages/shared` et génère le client
Prisma. Les deux sont des artefacts dérivés : ils ne sont pas versionnés.

Il reste ensuite à créer la base locale :

```powershell
npm run db:migrate
```

Optionnel — créer un fichier de configuration local à partir de l'exemple :

```powershell
Copy-Item .env.example .env
```

Le fichier `.env` n'est pas versionné et ne doit contenir aucun secret partagé.

## Base de données locale

NOX stocke ses données dans une base **SQLite** locale, gérée par Prisma.

| | |
| --- | --- |
| Fichier | `data/nox-dev.db`, à la racine du repository |
| Schéma | [packages/database/prisma/schema.prisma](packages/database/prisma/schema.prisma) |
| Migrations | `packages/database/prisma/migrations/` — versionnées dans Git |
| Client généré | `packages/database/src/generated/prisma/` — **non** versionné |

Le chemin du fichier est résolu à partir de la racine du monorepo, pas du répertoire courant :
les commandes Prisma, les scripts npm et l'application Next.js visent donc toujours la même
base. La variable `NOX_DATABASE_URL` permet d'en viser une autre (voir `.env.example`).

### Commandes

```powershell
# Créer la base et appliquer les migrations (première utilisation, ou après un changement de schéma)
npm run db:migrate

# Appliquer les migrations existantes sans en créer de nouvelle
npm run db:deploy

# Régénérer le client Prisma (fait automatiquement par npm install et npm run build)
npm run db:generate

# Explorer et modifier les données dans le navigateur
npm run db:studio
```

### Repartir d'une base vide

Il n'existe volontairement aucune commande qui supprime la base : l'opération est manuelle.

```powershell
Remove-Item data\nox-dev.db
npm run db:migrate
```

> Cette commande supprime **uniquement** la base locale de développement. Elle ne touche à aucun
> repository, ni au code, ni aux migrations.

## Commandes disponibles

Toutes les commandes se lancent depuis la racine du repository.

| Commande | Effet |
| --- | --- |
| `npm run dev:web` | Démarre l'application web sur `http://localhost:3000` |
| `npm run dev:runner` | Démarre le runner en mode surveillé sur `http://127.0.0.1:4310` |
| `npm run start:runner` | Démarre le runner compilé (nécessite `npm run build` au préalable) |
| `npm run build` | Génère le client Prisma puis compile tous les workspaces |
| `npm run build:shared` | Compile uniquement le package partagé |
| `npm run build:database` | Compile uniquement le package d'accès aux données |
| `npm run test` | Lance les tests (`node --test`) |
| `npm run lint` | Analyse ESLint de l'ensemble du repository |
| `npm run typecheck` | Vérifie le typage de tous les workspaces |
| `npm run db:migrate` | Crée la base locale et applique les migrations |
| `npm run db:deploy` | Applique les migrations existantes |
| `npm run db:generate` | Régénère le client Prisma |
| `npm run db:studio` | Ouvre Prisma Studio |

## Lancer l'application web

```powershell
npm run dev:web
```

Puis ouvrir <http://localhost:3000>. Le tableau de bord liste les projets enregistrés en base.
Les sections « Socle en place » et « Prochaines grandes étapes » restent des repères statiques
sur l'avancement du produit.

## Créer un premier projet

1. Démarrer l'application : `npm run dev:web`.
2. Ouvrir <http://localhost:3000> puis cliquer sur **Nouveau projet**.
3. Renseigner un nom, éventuellement une description, et le **chemin absolu** d'un repository
   Git déjà présent sur cette machine — par exemple `D:\Projets\mon-projet`.
4. Valider. NOX vérifie le chemin côté serveur puis redirige vers la page du projet.

Ce que fait NOX à la validation :

- il exécute `git -C <chemin> rev-parse --show-toplevel`, en lecture seule ;
- il enregistre la **racine** du repository, pas le chemin saisi — un sous-dossier est donc
  accepté et ramené à sa racine ;
- il refuse un chemin relatif, inexistant, pointant vers un fichier, hors repository Git, ou
  déjà enregistré.

NOX ne clone rien, ne lit aucun fichier du repository et n'exécute aucune commande qui le
modifierait. Seul le chemin est stocké.

### Limites actuelles de la gestion des projets

| Possible aujourd'hui | Pas encore possible |
| --- | --- |
| Créer un projet | Modifier un projet existant |
| Lister les projets | Supprimer ou archiver un projet |
| Consulter la page d'un projet | Changer son statut |
| | Sélectionner un dossier via une boîte de dialogue |

Le statut d'un projet est toujours `DRAFT` : les transitions viendront avec la gestion des
tâches. Pour retirer un projet créé par erreur, passer par `npm run db:studio`.

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
│   ├── web/                    Application Next.js (App Router, Tailwind CSS)
│   │   ├── app/
│   │   │   ├── page.tsx        Tableau de bord (liste des projets)
│   │   │   └── projects/
│   │   │       ├── new/        Formulaire + Server Action de création
│   │   │       └── [id]/       Page de détail d'un projet
│   │   ├── components/         Composants d'interface réutilisables
│   │   ├── lib/                Validation serveur et lecture des données
│   │   └── public/             Fichiers statiques
│   │
│   └── runner/                 Runner local Node.js
│       └── src/index.ts        Serveur HTTP natif, GET /health
│
├── packages/
│   ├── shared/                 Types et constantes partagés (@nox/shared)
│   │   └── src/statuses.ts     ProjectStatus, TaskStatus, RunStatus
│   │
│   └── database/               Accès aux données (@nox/database)
│       ├── prisma/             Schéma et migrations versionnées
│       ├── src/                Client, chemins, requêtes sur Project
│       └── prisma.config.ts    Configuration du CLI Prisma
│
├── data/                       Base SQLite locale (contenu non versionné)
├── docs/                       Documentation de référence
├── CLAUDE.md                   Règles permanentes des sessions Claude Code
├── eslint.config.mjs           Configuration ESLint unique du monorepo
├── tsconfig.base.json          Configuration TypeScript commune (mode strict)
└── package.json                Workspaces et scripts racine
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
npm run test
npm run lint
npm run typecheck
npm run build
```
