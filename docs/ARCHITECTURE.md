# ARCHITECTURE — NOX

Ce document décrit l'architecture **cible**. Ce qui existe réellement aujourd'hui est décrit
dans [PROJECT_STATE.md](PROJECT_STATE.md).

## 1. Chaîne d'exécution

```text
Application web NOX
        ↓
API et orchestration
        ↓
Runner local
        ↓
Claude Code CLI
        ↓
Repository Git
```

Chaque étage n'appelle que l'étage immédiatement inférieur. L'application web ne parle jamais
directement à Claude Code, et le runner ne connaît ni OpenAI ni la base de données.

Cette contrainte a un but précis : **concentrer en un seul endroit ce qui touche au système de
fichiers et aux processus**. Voir la section 5 pour l'état réel de cette frontière aujourd'hui.

En parallèle de cette chaîne, l'application web dispose de sa propre persistance :

```text
apps/web
   ↓
packages/database
   ↓
SQLite local
```

Le runner n'apparaît pas dans cette seconde chaîne : il reste sans état.

## 2. Structure du monorepo

```text
NOX/
├── apps/
│   ├── web/        Interface + API + orchestration (Next.js)
│   └── runner/     Exécution locale (Node.js)
├── packages/
│   ├── shared/     Types et constantes partagés
│   └── database/   Accès aux données (Prisma + SQLite)
├── data/           Base SQLite locale (contenu non versionné)
└── docs/           Documentation de référence
```

## 3. Responsabilités

### 3.1 `apps/web` — interface et orchestration

**Aujourd'hui** :

- Tableau de bord listant les projets, page de création, page de détail d'un projet.
- Lecture des données en Server Components, via `lib/projects.ts`.
- Création par Server Action (`app/projects/new/actions.ts`), avec validation serveur.
- Validation d'un chemin de repository Git (`lib/repository-path.ts`) — voir section 5.

**À terme** :

- Rendu de l'interface (projets, documents, backlog, exécutions, diffs, logs).
- Route Handlers de l'App Router pour l'API interne.
- Couche d'orchestration : construction des prompts, appels au modèle orchestrateur,
  transitions d'état des tâches.
- Seul étage autorisé à parler au fournisseur de modèle (OpenAI).
- Seul étage qui écrit en base.

La logique métier doit rester **hors des composants React**. Les composants affichent ; les
modules dédiés décident.

### 3.2 `apps/runner` — exécution locale

**Aujourd'hui** : serveur HTTP natif exposant `GET /health`.

**À terme** :

- Lancement de Claude Code CLI dans le repository d'un projet.
- Diffusion des logs d'exécution en temps réel.
- Lecture de l'état Git : branche, fichiers modifiés, diff.
- Exécution des commandes de validation déclarées par la tâche (lint, typecheck, build).
- Annulation d'une exécution en cours.

Contraintes permanentes du runner :

- écoute sur la boucle locale uniquement ;
- n'agit que sur les chemins explicitement enregistrés ;
- n'effectue **jamais** d'opération Git distante ;
- ne réécrit **jamais** l'historique Git.

Le runner est un process séparé — et non une route de Next.js — pour trois raisons : sa durée
de vie ne dépend pas du cycle de rendu, il peut être redémarré sans toucher à l'interface, et
il isole les processus enfants du serveur web.

### 3.3 `packages/shared` — contrat commun

**Aujourd'hui** : statuts métier (`ProjectStatus`, `TaskStatus`, `RunStatus`), fabrique de
gardes de type, version du socle.

**À terme** : formes des messages échangés entre le web et le runner, types des documents et
des tâches, utilitaires de validation.

Règles : aucune dépendance runtime, aucun accès au système de fichiers ou au réseau, aucun
code spécifique à React ou à Node. Ce package doit rester importable des deux côtés.

### 3.4 `packages/database` — accès aux données

**Aujourd'hui** :

- Schéma Prisma et migrations versionnées (`prisma/`).
- Modèle `Project` uniquement.
- Fabrique du client Prisma (`src/client.ts`), avec cache sur `globalThis` pour survivre au
  rechargement de modules de Next.js en développement.
- Fonctions d'accès concrètes (`src/projects.ts`) : `listProjects`, `getProjectById`,
  `findProjectByRepositoryPath`, `createProject`. Elles reçoivent le client en paramètre, ce qui
  permet aux tests de viser une base temporaire.
- Résolution du chemin de la base (`src/paths.ts`), ancrée sur la racine du monorepo et non sur
  le répertoire courant.

**À terme** : modèles `Task`, `Run`, `Conversation`, `Message`, `ProjectDocument`.

Règles : seul `apps/web` importe ce package. Le runner reste sans état — il exécute et rapporte,
il n'écrit pas en base. Aucun composant React n'appelle Prisma directement.

Le provider est SQLite pour la V1 ; il est isolé derrière ce package et pourra changer sans
toucher à `apps/web`. Voir [D-019](DECISIONS.md#d-019--sqlite-comme-persistance-locale-de-la-v1).

### 3.5 Future couche d'orchestration

Située dans `apps/web`, sous forme de modules sans dépendance à React.

Responsabilités :

- assembler le contexte d'une tâche (documents + historique + état du repository) ;
- construire le prompt d'implémentation et le rendre prévisualisable ;
- piloter la machine à états d'une exécution (`RunStatus`) ;
- interpréter le compte rendu de Claude Code et les résultats de validation ;
- proposer une tâche de correction en cas d'échec.

Principe : l'orchestration **prépare et interprète**, elle ne décide jamais seule de déclencher
une exécution.

## 4. Communication web ↔ runner

Deux étapes prévues :

1. **HTTP simple (aujourd'hui, et pour les premières tâches).** Requête/réponse JSON. Suffisant
   pour la sonde de santé, l'état Git et le déclenchement d'une exécution.
2. **Server-Sent Events (ensuite).** L'exécution de Claude Code produit un flux de sortie long ;
   SSE permet de le streamer vers l'interface sans dépendance supplémentaire et sans la
   complexité bidirectionnelle d'un WebSocket. La communication reste unidirectionnelle
   (runner → web), ce qui correspond exactement au besoin : le web pilote par HTTP, le runner
   diffuse par SSE.

Les WebSockets ne sont pas retenus tant qu'aucun besoin bidirectionnel temps réel n'apparaît.

## 5. Frontières

### 5.1 Frontières à ne pas franchir

| Interdit | Pourquoi |
| --- | --- |
| Le runner appelle un fournisseur de modèle | Le runner exécute ; il ne décide pas. |
| `packages/shared` importe Node ou React | Doit rester consommable par les deux environnements. |
| `packages/database` importe React ou Next | Doit rester utilisable par un script ou un test. |
| Le runner écrit en base | Le runner reste sans état, donc redémarrable à tout moment. |
| Prisma appelé depuis un Client Component | Exposerait la couche données au navigateur. |
| Un composant React contient de la logique métier | Rend la logique intestable et non réutilisable. |

### 5.2 Exception en cours : la validation d'un chemin de repository

L'intention initiale était que **seul le runner** touche au système de fichiers et lance des
processus. Cette frontière est aujourd'hui franchie en un point, et un seul.

`apps/web/lib/repository-path.ts` exécute `git -C <chemin> rev-parse --show-toplevel` depuis le
serveur web local, pour vérifier qu'un chemin saisi appartient bien à un repository Git et en
déduire sa racine.

Ce que fait cette exception :

- lecture seule — aucune commande Git modifiant le repository ;
- aucun fichier du repository n'est lu ni affiché ;
- `execFile` sans shell, donc pas d'interprétation de la saisie utilisateur ;
- délai maximal de 5 secondes.

Pourquoi elle est acceptable aujourd'hui : le serveur web et le runner tournent sur la même
machine, et introduire un aller-retour HTTP vers le runner pour une seule commande en lecture
seule aurait ajouté un couplage et un mode de panne supplémentaires avant que le runner ne sache
faire quoi que ce soit d'autre.

**Quand la déplacer.** Cette responsabilité reviendra à `apps/runner` dès que NOX séparera
réellement l'interface de la machine qui exécute Claude Code — c'est-à-dire au plus tard à
l'étape « runner contrôlé » de la [roadmap](ROADMAP.md), où le runner exposera déjà des
endpoints Git. Le module est volontairement sans dépendance à React ni à Next.js pour rendre ce
déplacement mécanique.
