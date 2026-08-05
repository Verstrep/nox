# ARCHITECTURE — NOX

Ce document décrit l'architecture **cible**. Ce qui existe réellement aujourd'hui est décrit
dans [PROJECT_STATE.md](PROJECT_STATE.md).

## 1. Chaîne d'exécution

```text
Navigateur
    ↓
Next.js  (interface, orchestration, persistance métier)
    ↓ HTTP local authentifié
Runner NOX
    ↓
Git et système de fichiers local
    ↓
Claude Code CLI          (à venir)
```

Chaque étage n'appelle que l'étage immédiatement inférieur. Le navigateur ne parle jamais au
runner, l'application web ne parle jamais directement à Claude Code, et le runner ne connaît ni
OpenAI ni la base de données.

Cette contrainte a un but précis : **concentrer en un seul endroit ce qui touche au système de
fichiers et aux processus**. Depuis TASK-003, cet endroit est le runner, sans exception.

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
- Client HTTP du runner (`lib/runner/`), strictement côté serveur, porteur du jeton partagé.
- Indicateur de disponibilité du runner, calculé au rendu (`components/RunnerStatusBadge.tsx`).

`apps/web` ne lance **aucun** processus système et ne lit **aucun** fichier de projet : toute
opération locale passe par le runner.

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

**Aujourd'hui** : API HTTP locale sur `node:http`, sans framework.

- `GET /health` — sonde publique en local, sans authentification.
- `POST /repositories/resolve` — authentifiée, résout la racine Git d'un chemin.
- `POST /repositories/documents/list` — authentifiée, inventorie les Markdown reconnus.
- `POST /repositories/documents/read` — authentifiée, lit un document autorisé et renvoie sa
  révision.
- `POST /repositories/documents/update` — authentifiée, remplace le contenu d'un document
  existant après contrôle de révision.
- Jeton partagé obligatoire (`Authorization: Bearer`), comparaison à temps constant.
- Corps JSON limité à 32 Kio, `Content-Type` vérifié, délai maximal sur corps incomplet.
- Erreurs conformes au contrat partagé de `@nox/shared` : un code, jamais un message ni une
  trace d'exception.

Organisation : `config.ts` (validation au démarrage), `server.ts` (routage, testable sans port
fixe), `http/` (auth, corps, réponses), `repositories/` (logique Git et documents, indépendante
de HTTP).

**À terme** :

- Lancement de Claude Code CLI dans le repository d'un projet.
- Diffusion des logs d'exécution en temps réel.
- Lecture de l'état Git : branche, fichiers modifiés, diff.
- Exécution des commandes de validation déclarées par la tâche (lint, typecheck, build).
- Annulation d'une exécution en cours.

Contraintes permanentes du runner :

- écoute sur la boucle locale uniquement — il **refuse de démarrer** sur toute autre adresse ;
- toute route sensible exige le jeton partagé ;
- n'agit que sur les chemins explicitement enregistrés ;
- n'effectue **jamais** d'opération Git distante ;
- ne réécrit **jamais** l'historique Git ;
- ne journalise jamais le jeton, ni même un fragment.

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

1. **HTTP simple — en place depuis TASK-003.** Requête/réponse JSON, sur la boucle locale,
   authentifiée par un jeton partagé transmis en `Authorization: Bearer`. Le contrat (formes de
   messages et codes d'erreur) vit dans `@nox/shared` : ni le runner ni le web ne le redéclare.
   Suffisant pour la sonde de santé, la résolution d'un repository, l'état Git et le
   déclenchement d'une exécution.
2. **Server-Sent Events (ensuite, hors périmètre de TASK-003).** L'exécution de Claude Code
   produit un flux de sortie long ;
   SSE permet de le streamer vers l'interface sans dépendance supplémentaire et sans la
   complexité bidirectionnelle d'un WebSocket. La communication reste unidirectionnelle
   (runner → web), ce qui correspond exactement au besoin : le web pilote par HTTP, le runner
   diffuse par SSE.

Les WebSockets ne sont pas retenus tant qu'aucun besoin bidirectionnel temps réel n'apparaît.

## 5. Frontières

### 5.1 Frontières à ne pas franchir

| Interdit | Pourquoi |
| --- | --- |
| `apps/web` lance un processus système | Le runner est la seule frontière avec la machine. |
| `apps/web` lit ou écrit un fichier de projet | Même raison : tout passe par le runner. |
| Le navigateur appelle le runner directement | Le jeton ne doit jamais quitter le serveur. |
| Une route sensible du runner sans authentification | Le runner exécute des commandes locales. |
| Le runner écoute hors de la boucle locale | Exposerait l'exécution de commandes au réseau. |
| Le runner appelle un fournisseur de modèle | Le runner exécute ; il ne décide pas. |
| Le runner écrit en base | Le runner reste sans état, donc redémarrable à tout moment. |
| `packages/shared` importe Node ou React | Doit rester consommable par les deux environnements. |
| `packages/database` importe React ou Next | Doit rester utilisable par un script ou un test. |
| Prisma appelé depuis un Client Component | Exposerait la couche données au navigateur. |
| Un composant React contient de la logique métier | Rend la logique intestable et non réutilisable. |

### 5.2 Exception fermée : la validation d'un chemin de repository

TASK-002 avait temporairement placé l'exécution de `git rev-parse --show-toplevel` dans
`apps/web`, faute de canal vers le runner. **Cette exception est close depuis TASK-003.**

- `apps/web/lib/repository-path.ts` a été supprimé, avec ses tests.
- La logique vit désormais dans `apps/runner/src/repositories/resolve-repository.ts`.
- `apps/web` n'importe plus `node:child_process` : il appelle `POST /repositories/resolve`.

Le runner est désormais la frontière unique des opérations locales. Aucune exception n'est
ouverte, et aucune nouvelle ne doit l'être : toute opération sur le système de fichiers ou sur
Git ajoutée par la suite prend la forme d'une route authentifiée du runner.

### 5.3 Lecture des documents Markdown

```text
Page Documents  (/projects/[id]/documents)
      ↓
Client runner serveur  (apps/web/lib/runner/)
      ↓ HTTP local authentifié
Runner NOX
      ↓ lecture seule
Fichiers Markdown du repository
```

Propriétés de cette chaîne :

- **Les contenus restent dans Git.** SQLite ne stocke ni le texte des documents, ni leur liste :
  la base ne connaît que le chemin du repository. Le fichier sur disque est la seule vérité, et
  il n'existe donc aucune copie à resynchroniser.
- **Le runner applique les frontières de sécurité.** Confinement dans le repository, blocage des
  traversées `..`, refus des liens sortants, limites de taille, de nombre et de profondeur.
  Aucune de ces règles n'est dupliquée côté web, qui n'aurait de toute façon pas les moyens de
  les vérifier.
- **Le web ne voit que des chemins relatifs.** Le chemin absolu du repository ne figure dans
  aucune réponse. Le navigateur reçoit `docs/PROJECT_BRIEF.md`, jamais
  `D:\Projets\mon-projet\docs\PROJECT_BRIEF.md`.
- **Aucune interprétation.** Le contenu est renvoyé brut ; le web l'affiche sans le convertir
  en HTML.

### 5.4 Modification d'un document Markdown

```text
Éditeur Markdown
      ↓
Server Action
      ↓
Client runner serveur
      ↓ HTTP authentifié
Runner
      ↓ contrôle de révision + écriture sûre
Document Markdown existant
```

Quatre propriétés font tenir cette chaîne :

- **SQLite ne stocke toujours pas le contenu.** La base ne connaît que le chemin du
  repository ; ni le texte du document, ni sa révision, ni un brouillon n'y sont écrits. Le
  fichier reste la seule vérité, et Git son seul historique.
- **Le runner est seul responsable de l'écriture.** Il applique le même confinement qu'en
  lecture, refuse les liens symboliques, vérifie la taille en octets UTF-8, écrit dans un
  fichier temporaire du même dossier puis remplace la cible. Rien de tout cela n'est dupliqué
  côté web, qui n'a de toute façon aucun accès au disque.
- **La révision empêche les écrasements silencieux.** Chaque lecture renvoie l'empreinte
  SHA-256 des octets du fichier ; l'écriture la renvoie, et le runner refuse d'écrire si le
  disque a changé entre-temps. Un fichier modifié dans un éditeur pendant qu'il est ouvert dans
  NOX produit un conflit explicite, jamais une perte de données.
- **Le chemin absolu vient de la base, jamais du formulaire.** Le navigateur n'envoie que
  l'identifiant du projet et un chemin relatif ; la Server Action relit le repository en base.
  Un champ caché altéré ne peut donc pas diriger l'écriture ailleurs sur la machine.

Ce que cette chaîne ne fait **pas**, volontairement : créer un document, en supprimer un, le
renommer, le déplacer, sauvegarder automatiquement, ou proposer d'écraser un conflit.

### 5.5 Répartition des validations

La distinction est structurante et vaut d'être explicite :

| Question | Qui répond | Pourquoi |
| --- | --- | --- |
| Ce chemin existe-t-il ? Est-ce un repository Git ? Quelle est sa racine ? | **Le runner** | Seul lui voit le système de fichiers de la machine. |
| Quels documents Markdown existent ? Que contient celui-ci ? | **Le runner** | Même raison : le web n'a aucun accès au disque. |
| Ce chemin de document sort-il du repository ? | **Le runner** | Le confinement se vérifie sur les chemins réels, après résolution des liens. |
| Le fichier a-t-il changé depuis son ouverture ? | **Le runner** | Seul lui peut relire les octets réels au moment d'écrire. |
| Le nom est-il renseigné ? La description est-elle trop longue ? | **Le web** | Règles métier, sans rapport avec la machine. |
| Ce repository est-il déjà enregistré ? | **Le web** | Seul lui voit la base ; le runner reste sans état. |

Le runner valide **la machine**. Le web valide **le métier**.
