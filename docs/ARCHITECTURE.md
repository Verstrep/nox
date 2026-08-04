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

Cette contrainte a un but précis : **une seule frontière touche au système de fichiers et aux
processus** — le runner. Tout ce qui est risqué est concentré à un seul endroit.

## 2. Structure du monorepo

```text
NOX/
├── apps/
│   ├── web/        Interface + API + orchestration (Next.js)
│   └── runner/     Exécution locale (Node.js)
├── packages/
│   └── shared/     Types et constantes partagés
└── docs/           Documentation de référence
```

## 3. Responsabilités

### 3.1 `apps/web` — interface et orchestration

**Aujourd'hui** : une page d'accueil statique, sans API ni données.

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

### 3.4 Future couche de base de données

Absente à ce stade — décision assumée pour TASK-001.

**À terme** :

- Persistance des projets, documents, tâches, conversations, exécutions et logs.
- Cible pressentie : Prisma sur PostgreSQL, ou SQLite si l'usage reste strictement local.
- Accès réservé à `apps/web`. Le runner reste sans état : il exécute et rapporte.

Le choix définitif sera consigné dans [DECISIONS.md](DECISIONS.md) au moment où il sera pris.

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

## 5. Frontières à ne pas franchir

| Interdit | Pourquoi |
| --- | --- |
| L'application web lance un processus système | Concentre l'exécution dans le runner, seul étage audité pour cela. |
| Le runner appelle un fournisseur de modèle | Le runner exécute ; il ne décide pas. |
| `packages/shared` importe Node ou React | Doit rester consommable par les deux environnements. |
| Le runner écrit en base | Le runner reste sans état, donc redémarrable à tout moment. |
| Un composant React contient de la logique métier | Rend la logique intestable et non réutilisable. |
