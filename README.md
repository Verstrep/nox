# NOX

**Orchestration du développement assisté par IA.**

NOX est une application personnelle qui relie la conception d'un projet à son implémentation.
On y formalise un besoin dans des documents Markdown, on le découpe en petites tâches, on
envoie ces tâches à Claude Code, on relit ce qui a changé, et on demande une correction —
sans copier-coller manuel entre la conversation de conception et l'agent d'implémentation.

C'est un outil **local** et **mono-utilisateur** : une machine, un repository à la fois, une
base SQLite dans le dossier du projet.

> **Ce README est la porte d'entrée.** Il explique quoi installer, comment configurer et
> comment lancer. Le détail de ce que NOX sait faire est dans
> [docs/PROJECT_STATE.md](docs/PROJECT_STATE.md), son fonctionnement interne dans
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), et la suite envisagée dans
> [docs/ROADMAP.md](docs/ROADMAP.md).

---

## Ce que NOX permet aujourd'hui

| Capacité | Ce qu'on peut faire |
| --- | --- |
| **Projets** | Créer un projet, l'associer à un repository Git local, voir sa branche et l'état de son dossier de travail |
| **Documents** | Inventorier, lire, créer, modifier et supprimer les Markdown du repository, avec contrôle de révision |
| **Tâches** | Écrire une tâche structurée, la suivre dans un backlog, et obtenir son document `tasks/TASK-xxx.md` |
| **Exécution** | Lancer Claude Code sur une tâche, suivre son activité en direct, l'interrompre |
| **Review** | Relire un instantané Git immuable de ce qui a changé, avec le verdict des validations |
| **Correction** | Écrire un feedback et reprendre la session Claude exactement là où elle s'était arrêtée |
| **Architecte** | Une conversation durable par projet : concevoir, décider, préparer la suite — sans donner le moindre outil au modèle |
| **Review Architecte** | Faire relire une exécution terminée et obtenir une recommandation motivée |
| **Workflow guidé** | Savoir, sur la page d'une tâche, quelle est l'étape courante et ce qui a du sens ensuite |
| **Mémoire projet** | Enregistrer décisions, contraintes, conventions et connaissances durables, et les faire suivre à l'Architecte |
| **Project plan** | Tenir le Project Brief et le Living V1 Plan du projet, à la main ou en appliquant une proposition relue de l'Architecte |
| **V1 Backlog** | Générer le backlog des tâches restantes, le relire, le réordonner, et créer les tâches en un lot |
| **Bootstrap** | Préparer le repository et sa documentation fondamentale avec `TASK-000`, construite sans appel à une IA |
| **Dépendances** | Dire qu'une tâche en attend une autre, et modifier une tâche tant qu'elle n'a jamais été exécutée |
| **Tableau de bord** | Voir d'un coup d'œil quels projets existent et où en est chacun, sans ouvrir une seule tâche |
| **Cycle de vie** | Renommer un projet, ou le supprimer de NOX — le repository, son code et son `.git` restent intacts |
| **File d'exécution** | Inscrire plusieurs tâches prêtes et laisser NOX les lancer une à une, sur une autorisation explicite |
| **Validation autonome** | Dire avant l'exécution quels critères une commande peut prouver, et laisser NOX obtenir lui-même cette preuve |
| **Correction pilotée** | Repartir d'un échec que NOX a constaté, sans recopier un seul log — et, sous file active, le laisser reprendre au plus deux fois |
| **Livraison Git** | Choisir, projet par projet, ce que NOX a le droit d'écrire : rien, un commit, ou un commit puis un push vers l'upstream existant |
| **Plusieurs projets** | Faire avancer plusieurs repositories en même temps, chacun avec sa file, ses validations et sa politique Git |
| **Replanification** | Faire évoluer le plan des tâches futures depuis la conversation Architecte, et l'appliquer d'un seul geste avec le Project Plan |

**Ce que NOX ne fait pas** : aucun lancement automatique, aucune boucle autonome entre les deux
modèles, aucun résumé silencieux, aucune estimation de coût — et, tant que la politique de
livraison du projet reste `Manual`, aucun commit et aucun push. Les limites de chaque capacité
sont détaillées dans [docs/PROJECT_STATE.md](docs/PROJECT_STATE.md).

## Architecture en un coup d'œil

```text
Navigateur
    ↓
Next.js  (interface, orchestration, persistance)
    ├── SQLite                 base locale
    ├── OpenAI Architect       conception et relecture
    └── HTTP local authentifié
             ↓
        Runner NOX             seule frontière avec la machine
             ↓
        Git · fichiers · Claude Code CLI
```

**Deux processus séparés**, lancés dans deux terminaux : l'application web et le runner. Le
runner est le seul à toucher au disque, à Git et aux processus ; l'application web ne lance
rien et ne lit aucun fichier de projet. Le détail est dans
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Prérequis

- **Node.js ≥ 22.18.0** — requis pour l'exécution native des fichiers TypeScript par le runner
  en mode développement.
- **npm ≥ 10** — les workspaces natifs sont utilisés.
- **Git**.

```powershell
node --version
npm --version
```

## Installation

```powershell
git clone <url-du-repository> nox
cd nox
npm install
npm run db:migrate
```

`npm install` déclenche le script `prepare`, qui compile `packages/shared` et génère le client
Prisma. Les deux sont des artefacts dérivés : ils ne sont pas versionnés. `npm run db:migrate`
crée la base locale.

## Configuration : le jeton du runner

Le runner exécute Git sur votre machine ; l'application web l'appelle en HTTP sur la boucle
locale. Cet appel est authentifié par un jeton partagé, **obligatoire**.

Créez le fichier de configuration à partir de l'exemple :

```powershell
Copy-Item .env.example .env
```

Générez un jeton et collez-le dans `.env` :

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

- **Le runner et l'application web utilisent exactement la même valeur.** Un seul `.env`, à la
  racine, est lu par les deux — il n'y a rien à synchroniser tant que vous ne le dupliquez pas.
- **Le runner refuse de démarrer sans jeton**, et n'en génère jamais automatiquement : une
  valeur différente à chaque lancement empêcherait le web de s'y connecter.
- **Le runner refuse d'écouter ailleurs que sur la boucle locale.** Il exécute des commandes sur
  votre machine ; l'exposer au réseau reviendrait à offrir cette capacité à quiconque l'atteint.
- Le fichier `.env` n'est pas versionné. Ne partagez jamais la valeur réelle de votre jeton.

## Configuration : l'Architecte OpenAI

L'Architecte est **facultatif**. Sans lui, NOX fonctionne : vous écrivez vos tâches à la main.
Avec lui, vous décrivez une intention et il propose une tâche structurée que vous relisez avant
de la créer.

Une variable obligatoire, et une facultative :

```env
NOX_OPENAI_API_KEY=<votre-cle-openai>
NOX_ARCHITECT_MODEL=                     # facultatif
```

Points importants :

- **La clé s'appelle `NOX_OPENAI_API_KEY`, et pas `OPENAI_API_KEY`.** Ce n'est pas un détail :
  le runner retire de l'environnement de Claude Code **toutes** les variables commençant par
  `NOX_`. Nommée ainsi, la clé est hors de portée de l'agent par construction, sans qu'aucune
  règle supplémentaire ait à être écrite — ni oubliée.
- **Le modèle par défaut est `gpt-5.6-sol`, avec un effort de raisonnement `high`.** C'est le
  modèle des décisions d'architecture de NOX : conversation projet, replanification, backlog de
  V1 et analyse de review. Il est nommé à un seul endroit,
  [apps/web/lib/architect/config.ts](apps/web/lib/architect/config.ts).
- **`NOX_ARCHITECT_MODEL` reste lue, et reste prioritaire.** Configurer un modèle est une
  décision, et NOX ne la reprend pas. Il ne demande alors aucun effort de raisonnement : il ne
  connaît pas les capacités d'un modèle qu'il n'a pas choisi, et un paramètre inconnu ferait
  échouer l'appel.
- **Aucune URL de base configurable.** NOX envoie du contexte projet ; pouvoir rediriger cet
  envoi vers une adresse arbitraire ouvrirait un canal d'exfiltration pour un gain nul.
- **Redémarrez l'application web** après modification : ces variables sont lues au démarrage.
- La clé n'atteint jamais le navigateur, n'est jamais écrite en base, et n'apparaît dans aucun
  message d'erreur.

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

**Mettre à jour une base existante.** Après avoir récupéré des migrations écrites ailleurs, la
base locale est en retard sur le schéma, et Prisma le signale par une erreur au premier accès —
« the column … does not exist ». Rien ne l'applique automatiquement : ni `npm run dev:web`, ni
`npm run build`, ni le démarrage du serveur.

```powershell
npm run db:deploy
```

Cette commande applique uniquement les migrations en attente. Elle ne supprime rien, ne recrée
rien, et laisse les données en place.

> Les commandes `npx prisma …` lancées depuis la racine échouent sur `datasource.url is required` :
> la configuration Prisma vit dans `packages/database/prisma.config.ts`, et Prisma 7 la cherche
> dans le répertoire courant — `--schema` ne suffit pas à la trouver. Les scripts npm s'exécutent
> dans le bon workspace.

**Repartir d'une base vide.** Il n'existe volontairement aucune commande qui supprime la base :
l'opération est manuelle.

```powershell
Remove-Item data\nox-dev.db
npm run db:migrate
```

> Cette commande supprime **uniquement** la base locale de développement. Elle ne touche à aucun
> repository, ni au code, ni aux migrations.

## Commandes

Toutes les commandes se lancent depuis la racine du repository.

| Commande | Effet |
| --- | --- |
| `npm run dev:web` | Démarre l'application web sur `http://localhost:3000` |
| `npm run dev:runner` | Démarre le runner en mode surveillé sur `http://127.0.0.1:4310` |
| `npm run start:runner` | Démarre le runner compilé (nécessite `npm run build`) |
| `npm run runner:health` | Vérifie que le runner est joignable |
| `npm run build` | Génère le client Prisma puis compile tous les workspaces |
| `npm run build:shared` | Compile uniquement le package partagé |
| `npm run build:database` | Compile uniquement le package d'accès aux données |
| `npm run test` | Lance les tests (`node --test`) |
| `npm run lint` | Analyse ESLint de l'ensemble du repository |
| `npm run typecheck` | Vérifie le typage de tous les workspaces |
| `npm run db:migrate` | Crée la base locale et applique les migrations |
| `npm run db:deploy` | Applique les migrations existantes à la base en place, sans rien supprimer |
| `npm run db:generate` | Régénère le client Prisma |
| `npm run db:studio` | Ouvre Prisma Studio |

## Lancer NOX

Deux terminaux. Ils ne sont pas lancés ensemble : le runner peut être redémarré sans toucher au
web, et inversement.

```powershell
# Terminal 1
npm run dev:runner
```

Sortie attendue :

```text
[nox-runner] v0.1.0 - etat RUNNING
[nox-runner] En ecoute sur http://127.0.0.1:4310
[nox-runner] Sonde de sante : http://127.0.0.1:4310/health
[nox-runner] Routes sensibles protegees par NOX_RUNNER_TOKEN.
```

```powershell
# Terminal 2
npm run dev:web
```

Puis ouvrir <http://localhost:3000>.

Le port du runner est configurable ; l'hôte doit rester une adresse de boucle locale. Changer
le port suppose de modifier `NOX_RUNNER_PORT` **et** `NOX_RUNNER_URL`. Le runner s'arrête
proprement sur `Ctrl+C`.

## Le parcours, en bref

```text
Créer un projet          nom, description, chemin du repository Git
        ↓  (et, plus tard, on y revient : Project change → Review → Apply)
Documents                lire et écrire les Markdown du projet
        ↓
Architect  (facultatif)  la conversation durable du projet
        ↓
Backlog                  la tâche existe en DRAFT, on la passe en Ready
        ↓
Run Claude Code          préflight, aperçu du prompt, lancement explicite
        ↓
Timeline                 l'activité en direct, interruptible
        ↓
Review changes           l'instantané Git, les validations, le diff
        ↓
Approve  ·  Request changes  ·  Analyze with Architect
```

Sur la page d'une tâche, le bloc **Development workflow** dit en permanence où l'on en est et ce
qui a du sens ensuite. Il ne décide de rien : chaque action reste un clic sur la surface où la
décision se prend déjà.

La conversation Architecte d'un projet **ne se ferme pas**. Créer une tâche depuis une
proposition n'y met pas fin : on y revient pour préparer la suivante, revenir sur une décision
ou préparer une V2. L'ouvrir ne coûte aucun appel.

C'est aussi de là que le projet **évolue**. Quand une exigence change, on le dit dans la
conversation : l'Architecte peut proposer un changement de projet qui porte le Project Plan, le
plan des tâches futures, ou les deux. Il se relit sur une page, se corrige, et s'applique d'un
seul geste — `Apply project change`. Ce qui a déjà tourné n'est jamais réécrit.

Deux points à retenir avant un premier lancement :

- **Le repository doit être propre.** Commitez avant de lancer : sans état de départ connu, il
  devient impossible de dire ce que l'agent a changé. Faut-il aussi **pousser** ? Cela dépend de
  la politique de livraison du projet. En `Manual` et en `Auto commit + push`, oui. En
  `Auto commit`, non : NOX commite lui-même et ne pousse pas, votre branche locale prend donc
  naturellement de l'avance, et cela n'arrête rien.
- **Une réussite ne vaut pas validation.** Une exécution réussie place la tâche en `Review`,
  jamais directement en `Done`. Une seule exception, écrite dans le contrat de la tâche avant son
  lancement : si **tous** ses critères sont automatisés et que **toutes** les commandes que NOX
  exécute lui-même passent, la tâche est marquée `Done` sans clic. Dans tous les autres cas, la
  relecture reste humaine — et elle ne montre que les critères qui la demandent.
- **Ce que Claude Code raconte n'est pas une preuve.** « J'ai lancé `npm test` » est affiché, et
  conservé. Ce qui soutient un critère est ce que **NOX** a lancé, après coup, dans le même
  repository.
- **Une correction repart d'un constat, pas d'un récit.** Quand une preuve échoue, le critère, la
  commande, son code de sortie et ses sorties partent avec la reprise : vous n'avez rien à
  recopier. Démarrer une file autorise en plus NOX à reprendre **au plus deux fois** par tâche ;
  au-delà, la main vous revient, et l'écran le dit.
- **NOX n'écrit dans Git que ce qu'il a validé, et seulement si vous l'y avez autorisé.** La
  politique de livraison d'un projet vaut `Manual` par défaut. Si vous choisissez un mode
  automatique, NOX commite le travail validé — et le pousse, si c'est le mode retenu — à la seule
  condition que le repository y corresponde encore exactement. Sinon il refuse, et il le dit. Il
  ne change jamais de branche, ne force jamais un push, et ne réconcilie jamais un historique.
- **Plusieurs projets avancent en même temps, un même repository jamais deux fois.** Chaque
  projet garde sa file, ses autorisations et sa politique Git ; deux repositories différents
  travaillent en parallèle, et un incident dans l'un n'arrête pas l'autre. Démarrer une file
  n'en démarre aucune autre.

## Convention de langue de l'interface

NOX est une interface **française**. Une exception, volontairement étroite : les
**micro-éléments techniques** s'affichent en anglais.

| En anglais | En français |
| --- | --- |
| Badges de statut : `Draft`, `Ready`, `Running`, `Review`, `Done` | Navigation, titres et sous-titres |
| Badges de synchronisation : `Pending`, `Synced`, `Error`, `Conflict` | Descriptions et textes explicatifs |
| Badges de priorité : `Low`, `Medium`, `High`, `Critical` | Libellés et aides des formulaires |
| Actions compactes : `Edit`, `Save`, `Cancel`, `Delete`, `Retry` | Avertissements et confirmations |
| Transitions : `Mark ready`, `Approve`, `Reopen`, `New run` | Messages d'erreur détaillés |

Ces étiquettes se lisent d'un coup d'œil et portent les mêmes noms que les valeurs internes
qu'elles désignent : `READY` en base s'affiche `Ready`. Les phrases, elles, restent dans la
langue où l'on pense la nuance. **Aucune valeur interne n'est traduite** : les statuts stockés,
les contrats web ↔ runner et les documents Markdown déjà générés sont inchangés.

## API du runner

Vingt-trois routes, dont **une seule publique**. Toutes les autres exigent
`Authorization: Bearer <NOX_RUNNER_TOKEN>`.

| Route | Rôle |
| --- | --- |
| `GET`, `HEAD` `/health` | Sonde de disponibilité — sans authentification |
| `POST /repositories/resolve` | Racine Git d'un chemin local |
| `POST /repositories/inspect` | Inventaire en lecture seule d'un repository, sans lire aucun contenu |
| `POST /repositories/documents/list` | Inventaire des Markdown reconnus |
| `POST /repositories/documents/read` | Contenu et révision d'un document autorisé |
| `POST /repositories/documents/update` | Remplace un document, après contrôle de révision |
| `POST /repositories/documents/create` | Crée un document (`201`), sans jamais écraser |
| `POST /repositories/documents/delete` | Supprime un document, après contrôle de révision |
| `POST /repositories/tasks/create-document` | Crée `tasks/<code>.md` (`201`), en créant `tasks/` s'il manque |
| `POST /repositories/tasks/delete-document` | Supprime `tasks/<code>.md` |
| `POST /repositories/tasks/delete-project-documents` | Retire les documents de tâches d'un projet supprimé, et rapporte leur révision |
| `POST /repositories/validations/run` | Exécute une commande de validation enregistrée, sans interprète de commandes |
| `POST /repositories/validations/state` | Empreinte de l'état suivi, avant et après un lot de validations |
| `POST /claude/preflight` | Vérifie l'état Git et la présence de Claude Code, en lecture seule |
| `POST /claude/runs/start` | Lance Claude Code (`202`), sans attendre la fin |
| `POST /claude/runs/status` | État d'une exécution, depuis le registre en mémoire |
| `POST /claude/runs/events` | Événements publics postérieurs à un curseur |
| `POST /claude/runs/cancel` | Enregistre un arrêt (`202`) |
| `POST /claude/runs/review` | Relit l'instantané de review capturé à la fin de l'exécution |
| `POST /claude/corrections/preflight` | Vérifie qu'une reprise ciblée est possible |
| `POST /repositories/delivery/inspect` | État Git d'une livraison candidate, en lecture seule |
| `POST /repositories/delivery/commit` | Crée le commit d'une livraison validée, sur les chemins exacts du candidat |
| `POST /repositories/delivery/push` | Pousse vers l'upstream déjà configuré, jamais en forçant |

**Tester la sonde :**

```powershell
npm run runner:health
```

```json
{ "service": "nox-runner", "status": "ok", "version": "0.1.0" }
```

**Tester une route protégée**, en lisant le jeton depuis `.env` pour ne jamais l'afficher :

```powershell
$token = (Select-String -Path .env -Pattern '^NOX_RUNNER_TOKEN=(.*)$').Matches.Groups[1].Value
$body = @{ repositoryPath = "D:\Projets\mon-projet" } | ConvertTo-Json

Invoke-RestMethod -Method Post http://127.0.0.1:4310/repositories/resolve `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" -Body $body
```

Sans jeton, la réponse est un `401` :

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
| Le runner répond `401` à l'application web | `NOX_RUNNER_TOKEN` différent entre les deux | Un seul `.env` à la racine ; redémarrer les deux processus |
| `NOX_RUNNER_TOKEN est absent` au démarrage | Jeton non défini | Voir « Configuration : le jeton du runner » |
| `NOX_RUNNER_HOST ... n'est pas une adresse de boucle locale` | Hôte non autorisé | Remettre `127.0.0.1` |
| `Le port 4310 est deja utilise` | Un autre runner tourne déjà | L'arrêter, ou définir `NOX_RUNNER_PORT` **et** `NOX_RUNNER_URL` |
| `GIT_NOT_AVAILABLE` / « Git est introuvable » | Git absent du `PATH` du runner | Installer Git, puis redémarrer le runner |
| L'Architecte refuse de générer | `NOX_OPENAI_API_KEY` absente | La définir, puis redémarrer l'application web |

Après toute modification du `.env`, **redémarrez les deux processus** : les variables sont lues
au démarrage.

## Structure du repository

```text
NOX/
├── apps/
│   ├── web/                Application Next.js (App Router, Tailwind CSS)
│   │   ├── app/            Pages, Server Actions, Route Handlers du flux d'un run
│   │   ├── components/     Composants d'interface réutilisables
│   │   └── lib/            Logique métier hors React
│   │       ├── architect/  Architecte OpenAI — serveur uniquement
│   │       ├── backlog/    Planification initiale du backlog de V1
│   │       ├── replan/     Changement de projet et replanification du travail futur
│   │       ├── runner/     Client HTTP du runner — serveur uniquement
│   │       └── ...         Tâches, exécutions, review, workflow, mémoire, libellés
│   │
│   └── runner/             Runner local Node.js
│       ├── fixtures/       Faux Claude Code, pour les tests uniquement
│       └── src/
│           ├── config.ts   Configuration validée au démarrage
│           ├── server.ts   Routage HTTP
│           ├── http/       Authentification, corps JSON, réponses
│           ├── claude/     Préflight, lancement, registre, flux, validations
│           └── repositories/  Git, documents, tâches, confinement des chemins
│
├── packages/
│   ├── shared/             Contrat commun (@nox/shared) — sans dépendance runtime
│   └── database/           Accès aux données (@nox/database) — Prisma + SQLite
│
├── data/                   Base SQLite locale (contenu non versionné)
├── docs/                   Documentation de référence
├── tasks/                  Documents Markdown des tâches, créés par NOX
├── scripts/                Outillage local
├── CLAUDE.md               Règles opérationnelles des sessions Claude Code
├── eslint.config.mjs       Configuration ESLint unique du monorepo
├── tsconfig.base.json      Configuration TypeScript commune (mode strict)
└── package.json            Workspaces et scripts racine
```

## Documentation

Chaque document a un rôle, et un seul. Une information peut être citée ailleurs ; elle n'est
détaillée qu'à un endroit.

| Document | Rôle |
| --- | --- |
| [docs/PROJECT_BRIEF.md](docs/PROJECT_BRIEF.md) | Pourquoi NOX existe et où il va |
| [docs/V1_SCOPE.md](docs/V1_SCOPE.md) | Cible produit : acquis, V1 visée, hors périmètre |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Comment NOX fonctionne aujourd'hui |
| [docs/PROJECT_STATE.md](docs/PROJECT_STATE.md) | Ce que NOX sait faire aujourd'hui, et ses limites |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Pourquoi certains choix ont été faits |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Ce qui est envisagé ensuite |
| [CLAUDE.md](CLAUDE.md) | Règles opérationnelles des sessions Claude Code |

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
