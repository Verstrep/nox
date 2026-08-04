# NOX

**Orchestration du développement assisté par IA.**

NOX est une application personnelle qui relie la conception d'un projet à son implémentation.
Elle permet de formaliser un besoin dans des documents Markdown, de le découper en petites
tâches, d'envoyer ces tâches à Claude Code, d'exécuter les validations et de relire le résultat
— sans copier-coller manuel entre la conversation de conception et l'agent d'implémentation.

> ⚠️ **Projet en cours de développement.** Le socle technique est en place ; les
> fonctionnalités décrites ci-dessus ne sont pas encore implémentées.

## État actuel

Dernière étape terminée : **TASK-003 — connexion web ↔ runner**.

| Élément | État |
| --- | --- |
| Monorepo npm workspaces | ✅ fonctionnel |
| Persistance locale (Prisma + SQLite) | ✅ fonctionnelle |
| Création / liste / consultation d'un projet | ✅ fonctionnelles |
| API HTTP locale du runner, authentifiée | ✅ fonctionnelle |
| Validation d'un repository Git par le runner | ✅ fonctionnelle |
| Indicateur de disponibilité du runner | ✅ fonctionnel |
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

## Configuration : le jeton du runner

NOX est composé de **deux processus** : l'application web et le runner local. Le runner exécute
Git sur votre machine ; l'application web l'appelle en HTTP sur la boucle locale. Cet appel est
authentifié par un jeton partagé, **obligatoire**.

Créez le fichier de configuration à partir de l'exemple :

```powershell
Copy-Item .env.example .env
```

Générez ensuite un jeton et collez-le dans `.env` :

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Variante PowerShell native, si vous préférez ne pas passer par Node :

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RNGCryptoServiceProvider]::new().GetBytes($bytes)
($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
```

Le `.env` doit alors contenir :

```env
NOX_RUNNER_HOST=127.0.0.1
NOX_RUNNER_PORT=4310
NOX_RUNNER_URL=http://127.0.0.1:4310
NOX_RUNNER_TOKEN=<votre-jeton-genere>
```

Points importants :

- **Le runner et l'application web doivent utiliser exactement la même valeur.** Un seul `.env`,
  à la racine, est lu par les deux — il n'y a rien à synchroniser tant que vous ne le dupliquez
  pas.
- **Le runner refuse de démarrer sans jeton.** Il n'en génère jamais automatiquement : une
  valeur différente à chaque lancement empêcherait le web de s'y connecter.
- **Le runner refuse d'écouter ailleurs que sur la boucle locale.** Il exécute des commandes sur
  votre machine ; l'exposer au réseau reviendrait à offrir cette capacité à quiconque l'atteint.
- Le fichier `.env` n'est pas versionné. Ne partagez jamais la valeur réelle de votre jeton.

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
| `npm run runner:health` | Vérifie que le runner est joignable |

## Lancer l'application web

```powershell
npm run dev:web
```

Puis ouvrir <http://localhost:3000>. Le tableau de bord liste les projets enregistrés en base.
Les sections « Socle en place » et « Prochaines grandes étapes » restent des repères statiques
sur l'avancement du produit.

## Créer un premier projet

1. Démarrer le runner : `npm run dev:runner` (premier terminal).
2. Démarrer l'application : `npm run dev:web` (second terminal).
3. Ouvrir <http://localhost:3000>. L'en-tête doit afficher **Runner disponible**.
4. Cliquer sur **Nouveau projet**.
5. Renseigner un nom, éventuellement une description, et le **chemin absolu** d'un repository
   Git déjà présent sur cette machine — par exemple `D:\Projets\mon-projet`.
6. Valider. Le runner vérifie le chemin, puis l'application redirige vers la page du projet.

Ce qui se passe à la validation :

- l'application web appelle `POST /repositories/resolve` sur le runner ;
- le runner exécute `git -C <chemin> rev-parse --show-toplevel`, en lecture seule ;
- la **racine** du repository est enregistrée, pas le chemin saisi — un sous-dossier est donc
  accepté et ramené à sa racine ;
- sont refusés : chemin relatif, inexistant, pointant vers un fichier, hors repository Git, ou
  déjà enregistré.

NOX ne clone rien, ne lit aucun fichier du repository et n'exécute aucune commande qui le
modifierait. Seul le chemin est stocké.

**Sans runner démarré**, l'interface reste utilisable : la liste des projets et les pages projet
s'affichent normalement, et le formulaire reste accessible. Seule la soumission échoue, avec un
message indiquant qu'il faut démarrer le runner.

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
[nox-runner] Routes sensibles protegees par NOX_RUNNER_TOKEN.
```

Le port est configurable ; l'hôte doit rester une adresse de boucle locale :

```powershell
$env:NOX_RUNNER_PORT = "4400"
npm run dev:runner
```

Le runner s'arrête proprement sur `Ctrl+C` (`SIGINT`) ou sur `SIGTERM`.

L'application web et le runner tournent en parallèle, dans deux terminaux. Ils ne sont pas
lancés ensemble : le runner peut être redémarré sans toucher au web, et inversement.

## API du runner

| Route | Méthode | Authentification | Rôle |
| --- | --- | --- | --- |
| `/health` | `GET`, `HEAD` | aucune | Sonde de disponibilité |
| `/repositories/resolve` | `POST` | `Bearer` obligatoire | Racine Git d'un chemin local |

### Tester `/health`

Le plus simple :

```powershell
npm run runner:health
```

Ou directement :

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

### Tester la route protégée

`/repositories/resolve` exige le jeton. En PowerShell, en le lisant depuis `.env` pour ne jamais
l'afficher à l'écran :

```powershell
$token = (Select-String -Path .env -Pattern '^NOX_RUNNER_TOKEN=(.*)$').Matches.Groups[1].Value
$body = @{ repositoryPath = "D:\Projets\mon-projet" } | ConvertTo-Json

Invoke-RestMethod -Method Post http://127.0.0.1:4310/repositories/resolve `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" -Body $body
```

Réponse attendue — un sous-dossier est ramené à la racine du repository :

```json
{
  "ok": true,
  "repository": { "canonicalPath": "D:\\Projets\\mon-projet" }
}
```

Sans jeton, la réponse est un `401` :

```powershell
try {
  Invoke-RestMethod -Method Post http://127.0.0.1:4310/repositories/resolve `
    -ContentType "application/json" -Body '{"repositoryPath":"D:\\Projets\\mon-projet"}'
} catch { $_.ErrorDetails.Message }
```

```json
{ "ok": false, "error": { "code": "UNAUTHORIZED" } }
```

Toutes les erreurs suivent cette forme : un code stable, jamais de message technique ni de trace
d'exception. Une route inconnue renvoie `404` avec `ROUTE_NOT_FOUND`.

## Erreurs fréquentes

| Symptôme | Cause probable | Correction |
| --- | --- | --- |
| L'interface affiche « Runner indisponible » | Le runner n'est pas démarré | `npm run dev:runner` dans un second terminal |
| La création échoue avec « le runner local ne répond pas » | Idem, ou port différent | Vérifier avec `npm run runner:health` |
| Le runner répond `401` à l'application web | `NOX_RUNNER_TOKEN` différent entre les deux | Un seul `.env` à la racine ; redémarrer les deux processus après modification |
| `NOX_RUNNER_TOKEN est absent` au démarrage du runner | Jeton non défini | Voir « Configuration : le jeton du runner » |
| `NOX_RUNNER_HOST ... n'est pas une adresse de boucle locale` | Hôte non autorisé en V1 | Remettre `127.0.0.1` |
| `Le port 4310 est deja utilise` | Un autre runner tourne déjà | L'arrêter, ou définir `NOX_RUNNER_PORT` **et** `NOX_RUNNER_URL` |
| `GIT_NOT_AVAILABLE` / « Git est introuvable » | Git absent du `PATH` du runner | Installer Git, puis redémarrer le runner |

Après toute modification du `.env`, **redémarrez les deux processus** : les variables sont lues
au démarrage.

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
│   │   ├── lib/
│   │   │   ├── runner/         Client HTTP du runner (serveur uniquement)
│   │   │   └── ...             Validation métier et lecture des données
│   │   └── public/             Fichiers statiques
│   │
│   └── runner/                 Runner local Node.js
│       └── src/
│           ├── index.ts        Démarrage et arrêt propre
│           ├── config.ts       Configuration validée au démarrage
│           ├── server.ts       Routage HTTP
│           ├── http/           Authentification, corps JSON, réponses
│           └── repositories/   Résolution Git (execFile, sans shell)
│
├── packages/
│   ├── shared/                 Types et constantes partagés (@nox/shared)
│   │   ├── src/statuses.ts     ProjectStatus, TaskStatus, RunStatus
│   │   └── src/runner.ts       Contrat HTTP web ↔ runner
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
