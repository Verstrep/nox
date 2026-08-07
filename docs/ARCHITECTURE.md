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
- `POST /repositories/documents/create` — authentifiée, crée un document par ouverture
  exclusive, sans jamais écraser ni créer de dossier.
- `POST /repositories/documents/delete` — authentifiée, supprime **un** document Markdown après
  contrôle de révision. Refuse les documents gérés par une tâche, ne suit aucun lien, et ne
  supprime jamais de dossier.
- `POST /repositories/tasks/create-document` — authentifiée, crée `tasks/<code>.md` à partir
  d'un code de tâche, en créant le dossier `tasks/` s'il manque. Seule route de NOX autorisée
  à créer un dossier, et seulement celui-là.
- `POST /repositories/tasks/delete-document` — authentifiée, supprime `tasks/<code>.md` dérivé
  d'un code de tâche. Seule route autorisée à toucher aux documents que la précédente protège.
  Un document absent est une réussite ; le dossier `tasks/` n'est jamais supprimé.
- `POST /claude/preflight` — authentifiée, vérifie **en lecture seule** qu'un lancement est
  possible : état Git, branche, upstream, avance/retard, disponibilité de Claude Code.
- `POST /claude/runs/start` — authentifiée, lance Claude Code et répond `202` sans attendre
  la fin du processus.
- `POST /claude/runs/status` — authentifiée, retourne l'état d'une exécution depuis le registre
  en mémoire.
- `POST /claude/runs/events` — authentifiée, retourne les événements **publics** postérieurs à
  un curseur. Répond immédiatement, sans attente : c'est le flux SSE du web qui espace les
  appels.
- `POST /claude/runs/cancel` — authentifiée, enregistre une demande d'arrêt, passe l'exécution
  en `CANCELLING` et répond `202`. Le corps ne porte qu'un identifiant d'exécution.
- Jeton partagé obligatoire (`Authorization: Bearer`), comparaison à temps constant.
- Corps JSON limité à 32 Kio, `Content-Type` vérifié, délai maximal sur corps incomplet.
- Erreurs conformes au contrat partagé de `@nox/shared` : un code, jamais un message ni une
  trace d'exception.

Organisation : `config.ts` (validation au démarrage), `server.ts` (routage, testable sans port
fixe), `http/` (auth, corps, réponses), `repositories/` (logique Git et documents, indépendante
de HTTP).

**À terme** :

- Exécution des commandes de validation déclarées par la tâche (lint, typecheck, build).
- Reprise d'une session Claude interrompue.

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
- Modèles `Project`, `Task`, `TaskAcceptanceCriterion`, `TaskDocumentReference`,
  `TaskValidationCommand` et `Run`.
- Fabrique du client Prisma (`src/client.ts`), avec cache sur `globalThis` pour survivre au
  rechargement de modules de Next.js en développement.
- Fonctions d'accès concrètes (`src/projects.ts`, `src/tasks.ts`). Elles reçoivent le client en
  paramètre, ce qui permet aux tests de viser une base temporaire.
- Les chaînes lues en base (`status`, `priority`, `documentSyncStatus`) sont revalidées à
  chaque relecture avec les gardes de `@nox/shared` : une base modifiée à la main ne propage
  pas une valeur inconnue jusqu'à l'interface.
- Résolution du chemin de la base (`src/paths.ts`), ancrée sur la racine du monorepo et non sur
  le répertoire courant.

**À terme** : modèles `Conversation`, `Message`.

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

Ce que cette chaîne ne fait **pas**, volontairement : créer un document, le renommer, le
déplacer, sauvegarder automatiquement, ou proposer d'écraser un conflit. La suppression suit une
chaîne distincte, décrite en § 5.9.

### 5.5 Création d'un document Markdown

```text
Formulaire Nouveau document
        ↓  destination + nom relatif
Server Action
        ↓  reconstruction du chemin relatif
Client runner serveur
        ↓ HTTP authentifié
Runner
        ↓ validation des parents + création exclusive
Nouveau document Markdown
```

La création partage la chaîne de l'édition, mais pas ses garanties — son risque est différent :

- **Le navigateur ne choisit jamais le chemin complet.** Il envoie une destination — une valeur
  parmi cinq — et un nom relatif. La Server Action recompose le chemin à partir de la
  destination qu'elle a elle-même validée. Un préfixe falsifié dans le formulaire n'a aucun
  effet : il n'est pas transmis, donc pas lu.
- **Le runner refuse tout écrasement.** La création passe par une ouverture exclusive : le
  système crée le fichier ou échoue, sans étape intermédiaire exploitable. Un contrôle
  d'existence préalable améliore le message, mais il ne garantit rien — un fichier peut
  apparaître juste après.
- **Aucun dossier n'est créé.** Chaque parent doit exister, être un vrai dossier, ne pas être un
  lien, et rester dans le repository après résolution réelle.
- **Le document ne vit que dans Git.** SQLite ne stocke ni son contenu, ni son chemin, ni sa
  révision. Un document créé apparaît dans l'inventaire parce qu'il est sur le disque, pas parce
  qu'une ligne a été écrite quelque part.

Ce que cette chaîne ne fait **pas**, volontairement : renommer, déplacer, créer un dossier, ou
proposer de remplacer un fichier existant.

### 5.6 Création d'une tâche et de son document

```text
Formulaire de tâche
        ↓
Transaction SQLite
        ↓
Tâche PENDING
        ↓
Générateur Markdown
        ↓
Runner
        ↓
tasks/TASK-xxx.md
        ↓
SYNCED / ERROR / CONFLICT
```

Cette chaîne est la première de NOX à écrire **des deux côtés** : une ligne en base et un
fichier dans Git. Cinq propriétés la rendent tenable.

- **SQLite est la source de vérité structurée.** Le titre, l'objectif, le périmètre, les
  critères, les documents et les commandes vivent en base. C'est d'elle que tout part, et c'est
  elle que l'interface affiche. Pendant TASK-007, modifier le fichier à la main ne met pas la
  base à jour — l'interface le dit explicitement plutôt que de laisser croire l'inverse.
- **Le Markdown est l'artefact versionné destiné aux agents.** Il n'est pas un doublon de
  confort : c'est le format que Claude Code lira, et Git en garde l'historique. Il est produit
  par une fonction pure et déterministe, ce qui permet de le regénérer à l'identique et donc de
  reconnaître un fichier que NOX a lui-même écrit.
- **Ni statut ni priorité n'y figurent.** Ces valeurs changent sans que la spécification
  change. Les inscrire obligerait à réécrire le fichier à chaque clic et remplirait
  l'historique Git de modifications qui n'apprennent rien.
- **Une panne du runner ne fait pas perdre la tâche.** Les deux étapes sont dissociées : la
  transaction en base aboutit d'abord, l'écriture ensuite. Un runner arrêté laisse une tâche
  complète en `ERROR`, reprenable d'un bouton, avec une spécification intacte.
- **Les numéros ne sont jamais réutilisés.** Le compteur `Project.nextTaskSequence` est
  incrémenté de façon atomique et ne recule jamais. Un échec après réservation laisse un trou —
  préférable de loin à un identifiant qui désignerait deux travaux différents dans Git, dans un
  log ou dans une conversation.

La reprise est **idempotente et sans écrasement** : elle tente toujours la création exclusive,
adopte un fichier dont le contenu correspond exactement au Markdown attendu, et signale un
conflit dès qu'il diffère. Aucun forçage n'est proposé.

### 5.7 Lancement d'une exécution Claude Code

```text
Tâche READY
      ↓
Prévisualisation déterministe
      ↓
Préflight runner
      ↓
Run SQLite QUEUED
      ↓
Runner lance Claude Code
      ↓
Registre mémoire
      ↓
Polling Next.js
      ↓
Résultat persisté
      ↓
Task REVIEW / FAILED / BLOCKED
```

C'est la première chaîne de NOX dont une étape **dure plus longtemps qu'une requête HTTP**.
Tout le reste en découle.

- **Le web possède les données métier, le runner possède le processus.** La base connaît le
  prompt, l'historique et les statuts ; elle ne sait rien d'un PID. Le runner sait qu'un
  processus tourne ; il n'écrit dans aucune base. Aucun des deux n'empiète sur l'autre.
- **Le polling réconcilie les deux.** Le navigateur interroge un Route Handler de Next.js
  toutes les deux secondes ; celui-ci demande l'état au runner et le persiste. Le jeton ne
  quitte jamais le serveur, et le navigateur ne voit qu'un statut.
- **Fermer le navigateur n'arrête pas Claude.** Le processus n'est lié à aucune requête : il
  survit à la page qui l'a lancé, et rouvrir celle-ci suffit à récupérer le résultat.
- **Redémarrer le runner perd l'exécution en cours.** Le registre est en mémoire — limite
  assumée pour TASK-008. Le web, ne retrouvant plus une exécution qu'il croyait active, la
  marque bloquée et le dit ; il ne prétend jamais connaître le résultat d'un processus qu'il a
  cessé de suivre.
- **Aucun appel OpenAI, aucune clé d'API Anthropic.** NOX utilise l'authentification déjà
  configurée dans Claude Code, et retire toutes ses propres variables `NOX_*` de
  l'environnement de l'enfant.
- **Un seul run actif**, tous projets confondus. Deux agents simultanés sur la même machine
  rendraient toute relecture impossible.

Le préflight n'est pas une formalité : sans état de départ propre et synchronisé, le `git diff`
de fin mélangerait le travail de l'agent à ce qui traînait déjà. Il compare la branche à la
**référence upstream locale**, sans `fetch` — NOX dit donc ce que Git sait, jamais ce que le
serveur distant contient.

### 5.8 Répartition des validations

La distinction est structurante et vaut d'être explicite :

| Question | Qui répond | Pourquoi |
| --- | --- | --- |
| Ce chemin existe-t-il ? Est-ce un repository Git ? Quelle est sa racine ? | **Le runner** | Seul lui voit le système de fichiers de la machine. |
| Quels documents Markdown existent ? Que contient celui-ci ? | **Le runner** | Même raison : le web n'a aucun accès au disque. |
| Ce chemin de document sort-il du repository ? | **Le runner** | Le confinement se vérifie sur les chemins réels, après résolution des liens. |
| Le fichier a-t-il changé depuis son ouverture ? | **Le runner** | Seul lui peut relire les octets réels au moment d'écrire ou de supprimer. |
| Ce document appartient-il à une tâche ? | **Les deux** | Le runner pour trancher, le web pour ne pas proposer un bouton voué au refus. Une seule fonction, dans `@nox/shared`. |
| Cette tâche possède-t-elle un historique d'exécution ? | **Le web** | Règle métier, tranchée en base — et doublée par une contrainte Prisma. |
| Ce fichier existe-t-il déjà ? Ses dossiers parents existent-ils ? | **Le runner** | Même raison, et seule l'ouverture exclusive fait autorité. |
| Le dossier `tasks/` existe-t-il, et est-ce un vrai dossier ? | **Le runner** | Même raison ; c'est aussi lui qui le crée, s'il manque. |
| Quel est le chemin final d'un nouveau document ? | **Le web** | Il seul connaît la destination choisie ; il la valide et recompose le chemin. |
| Quel est le chemin du document d'une tâche ? | **Le runner** | Il le déduit du code ; le web n'envoie aucun chemin. |
| Quel numéro porte cette tâche ? Cette transition est-elle permise ? | **Le web** | Règles métier, tranchées en base ; le runner reste sans état. |
| Le repository est-il propre, synchronisé, sur une branche ? | **Le runner** | Seul lui peut interroger Git. |
| Claude Code est-il installé, et dans quelle version ? | **Le runner** | Seul lui voit les exécutables de la machine. |
| Cette commande de validation peut-elle être autorisée ? | **Les deux** | Le web pour l'afficher avant lancement, le runner pour trancher. Une seule fonction, dans `@nox/shared`. |
| Cette tâche est-elle lançable ? Quel prompt envoyer ? | **Le web** | Règles métier ; le prompt est régénéré depuis la base, jamais reçu. |
| Le nom est-il renseigné ? La description est-elle trop longue ? | **Le web** | Règles métier, sans rapport avec la machine. |
| Ce repository est-il déjà enregistré ? | **Le web** | Seul lui voit la base ; le runner reste sans état. |

Le runner valide **la machine**. Le web valide **le métier**.


### 5.9 Suppression d'un document Markdown

```text
Delete
   ↓
Server Action
   ↓
Runner
   ↓ contrôle chemin + révision
Suppression du fichier
```

Troisième opération d'écriture de NOX, et la première qui **retire** quelque chose. Son risque
n'est ni celui de l'édition — perdre une modification concurrente — ni celui de la création —
écraser un fichier présent. C'est l'irréversibilité : NOX ne conserve rien de ce qu'il supprime.
Seul Git peut le rendre, et seulement si le fichier y était déjà.

- **Le même confinement, la même révision.** `resolveDocumentPath` et le contrôle d'empreinte
  sont réutilisés tels quels. Il n'existe pas de quatrième logique de validation de chemin, et
  supprimer une version qu'on n'a pas vue est refusé exactement comme l'écraser.
- **Un fichier, jamais un dossier.** L'appel est `unlink`, qui ne peut rien faire d'autre.
  Aucun `rm -rf`, aucun `rmdir`, et aucun parent devenu vide n'est nettoyé : `docs/` appartient
  à la structure du repository, pas au document qui s'y trouvait.
- **Aucun lien suivi.** Un document qui est un lien symbolique est refusé, comme à l'écriture.
- **Aucune suppression n'est annoncée sans avoir été constatée.** Après `unlink`, le runner
  vérifie l'absence du fichier avant de répondre. Une suppression qui n'échoue pas mais ne
  supprime rien est le pire cas : NOX confirmerait un résultat qui n'existe pas.

#### Pourquoi les documents de tâche sont protégés

`tasks/TASK-001.md` n'appartient pas à l'utilisateur de la page Documents : il appartient à une
ligne de la base. Le supprimer là désynchroniserait les deux — une tâche resterait, son artefact
aurait disparu, et rien ne l'aurait enregistré. La route générique refuse donc tout chemin de la
forme `tasks/TASK-<chiffres>.md`, quelle que soit la révision fournie, et **c'est le runner qui
refuse**, pas l'interface. Les autres fichiers de `tasks/` — `tasks/NOTES.md` — restent des
documents ordinaires : personne ne les gère à la place de l'utilisateur.

La comparaison est faite sur le chemin en minuscules. Ce n'est pas une commodité : sous Windows,
`Tasks/task-001.MD` désigne le même fichier, et une comparaison sensible à la casse laisserait
contourner la protection par une simple variation d'orthographe.

#### Limites de concurrence résiduelles

Le dernier contrôle de nature est fait au plus près de l'`unlink`, mais la fenêtre entre les deux
**ne se ferme pas** : Node n'expose pas de suppression conditionnée à un descripteur déjà ouvert,
et Windows n'offre pas d'équivalent portable. Ce qui est garanti, c'est que la fenêtre est bornée
dans ses conséquences — `unlink` ne suit jamais un lien. Un lien créé entre le contrôle et la
suppression verrait donc **le lien** retiré, jamais sa cible. NOX ne prétend pas offrir
davantage, et n'a pas de test pour une course qu'il ne sait pas provoquer de façon déterministe.

### 5.10 Suppression d'une tâche

```text
Delete task
      ↓
Vérification zéro run
      ↓
Suppression sûre du Markdown
      ↓
Transaction SQLite
      ↓
Tâche supprimée
```

#### Pourquoi le fichier est supprimé avant la tâche SQLite

Cette opération traverse deux systèmes qui ne partagent aucune transaction. L'un des deux
échouera un jour entre les deux étapes, et le choix se résume à **quelle incohérence on
préfère** :

| Ordre | Incohérence possible | Réparable ? |
| --- | --- | --- |
| Base d'abord | `tasks/TASK-007.md` orphelin, que plus rien dans NOX ne désigne | Non — aucune reprise ne peut le retrouver |
| Fichier d'abord | Une tâche dont le document a disparu | Oui — d'un second clic |

Le second cas se répare parce que la route de suppression traite un document absent comme une
**réussite idempotente**. Relancer la suppression repasse sans redemander le fichier, et va
jusqu'au bout. Le premier cas, lui, se découvre des mois plus tard.

Un échec en base après une suppression réussie du fichier est donc rapporté honnêtement, avec sa
trace côté serveur. NOX ne recrée surtout pas le fichier en silence : il aurait alors une
révision différente de celle enregistrée, et le prochain contrôle échouerait sans que personne
comprenne pourquoi.

#### Pourquoi une tâche avec exécutions n'est pas supprimable

Une exécution est un fait : elle a consommé du quota, modifié un repository et produit un compte
rendu. Supprimer la tâche emporterait ce compte rendu, ou laisserait des exécutions orphelines —
les deux sont pires que de conserver une tâche dont on n'a plus l'usage. L'archivage répondra à
ce besoin ; la suppression n'en est pas le brouillon.

La règle est vérifiée **dans la transaction**, et pas seulement avant : une exécution a pu
démarrer depuis l'affichage de la page. Elle est doublée par une contrainte `Restrict` de `Run`
vers `Task`, qui tient même si quelqu'un contourne la fonction métier et appelle Prisma
directement. Aucun run n'est jamais supprimé par NOX.

#### Le numéro reste réservé

`Project.nextTaskSequence` n'est jamais décrémenté. `TASK-001` supprimée, la tâche suivante est
`TASK-004` si le compteur en était là. Un trou ne gêne personne ; un identifiant réutilisé
désignerait deux travaux différents dans Git, dans un log et dans une conversation.

#### Une panne du runner ne supprime rien

Si le runner ne répond pas, la base n'est pas touchée et l'interface le dit. L'utilisateur
redémarre le runner et recommence. C'est le pendant exact de la règle de TASK-007 : une panne du
runner ne fait pas perdre une tâche — ici, elle ne la fait pas disparaître à moitié.

### 5.11 Suivi d'une exécution en direct

```text
Claude Code stream-json
        ↓
Parser NDJSON runner
        ↓
Événements normalisés et sanitizés
        ↓
Registre mémoire
        ↓
Route runner events
        ↓
SSE Next.js
        ↓
Timeline navigateur
        ↓
Persistance RunEvent
```

Depuis TASK-010, Claude Code est lancé avec `--output-format stream-json` : la même information
finale qu'avant, précédée de tout ce qui permet de suivre le travail pendant qu'il se fait. Le
dernier message du flux est l'objet `result` que TASK-008 lisait déjà — le parser de TASK-008 est
inchangé, il reçoit simplement cette ligne-là plutôt que la sortie entière.

`--verbose` accompagne obligatoirement `stream-json` : avec `-p`, Claude Code `2.1.223` refuse la
combinaison sans lui (`When using --print, --output-format=stream-json requires --verbose`). Le
format `json` ne le demande pas et ne le reçoit pas.

`--include-partial-messages` n'est **pas** passé : un événement par fragment de token produirait
plusieurs milliers d'entrées pour un run de deux minutes, dont aucune n'apprendrait plus que le
message complet qui les suit.

#### Pourquoi les événements bruts ne sortent jamais du runner

Une ligne de `stream-json` contient tout ce que l'agent manipule : le contenu intégral des
fichiers lus, les entrées et sorties de chaque outil, ses raisonnements intermédiaires, et les
chemins absolus de la machine. Transmettre ces lignes au navigateur — même « juste pour les
afficher » — exposerait par construction tout ce que NOX passe son temps à protéger ailleurs.

Le runner traduit donc chaque message en un événement dont **il décide chaque champ** :

```ts
type ClaudeRunEvent = {
  sequence: number;      // attribué par le runner, jamais repris de Claude
  kind: ClaudeRunEventKind;
  occurredAt: string;    // date produite par le runner
  label: string;         // court, construit par NOX
  detail: string | null; // borné, jamais du JSON
  toolName: string | null;
  isError: boolean;
};
```

Il n'existe aucun champ libre par lequel un fragment d'origine pourrait passer. Le type est fermé,
et le contrat partagé le revalide à chaque frontière : réponse du runner lue par le web, ligne
relue en base, charge reçue par le navigateur.

#### Pourquoi le raisonnement interne est ignoré

Les blocs `thinking`, `redacted_thinking`, `reasoning`, `analysis` et tout bloc portant une
`signature` sont écartés **avant** d'être lus. Ils ne sont ni stockés, ni journalisés, ni résumés,
ni comptés comme message visible. NOX n'affiche même pas « Claude réfléchit » : un tel événement
serait déjà une information sur un contenu qui ne doit pas sortir.

La liste des blocs affichables est **fermée** — `text` et `tool_use`, rien d'autre — plutôt qu'une
liste d'exclusions. Une liste d'exclusions laisse passer tout ce qu'on n'a pas prévu, et c'est
précisément ce qu'on n'a pas prévu qui est dangereux.

#### Ce que dit un événement d'outil, et ce qu'il tait

| Appel | Affiché | Jamais affiché |
| --- | --- | --- |
| `Read` / `Edit` / `Write` | `Reading README.md` | le contenu lu ou écrit |
| `Grep` / `Glob` | `Searching for "renderTaskMarkdown"` | un motif de plus de 120 caractères |
| `Bash` autorisé | `Running npm run test` | l'environnement, le répertoire, les redirections |
| `Bash` autre | `Running an allowed command` | la commande elle-même |
| Outil inconnu | `Using <Nom>` | son entrée, quelle qu'elle soit |
| `tool_result` | `Read completed` · `Validation failed` | la sortie de l'outil |

Une commande n'est reproduite que si elle correspond **exactement** à une commande de validation
enregistrée ou à une commande Git en lecture seule autorisée. `npm run test -- --grep secret`
n'est pas `npm run test`, et l'afficher exposerait un argument que personne n'a validé.

#### Sanitation : une seule fonction, appliquée à toutes les chaînes

Toute chaîne qui finira dans un `label` ou un `detail` passe par le même nettoyeur — pas « toute
chaîne suspecte » : toutes. Il rend relatifs les chemins du repository, masque les chemins
extérieurs, retire les valeurs et les noms des variables `NOX_*`, supprime les caractères de
contrôle et les marques de direction, puis borne la taille. Les accents, idéogrammes et emoji sont
préservés : un nettoyage qui réduirait tout à l'ASCII rendrait la moitié des messages illisibles
pour un gain nul.

#### Bornes et troncature

| Borne | Valeur |
| --- | --- |
| Événements ordinaires par exécution | 2 000 |
| Marge réservée aux statuts, erreurs et résultat | 64 |
| Détail | 4 Kio |
| Volume total normalisé | 2 Mio |
| Ligne NDJSON acceptée | 1 Mio |
| Événements par réponse | 200 |

Ces valeurs sont **constantes** et non configurables : une limite de sécurité qu'on peut desserrer
par variable d'environnement n'en est plus une.

Quand la limite est atteinte, le runner ajoute un unique événement `TRUNCATED` puis cesse
d'enregistrer les événements ordinaires — mais il **continue de lire `stdout`**. Cesser de lire
remplirait le tampon du système et figerait Claude Code au milieu d'une édition, ce qui serait
bien pire qu'une timeline incomplète. Les changements de statut, les erreurs et le résultat final
continuent de passer.

#### Reconnexion, et ce qui survit à quoi

| Événement | Le registre du runner | La table `RunEvent` |
| --- | --- | --- |
| Fermeture de l'onglet | intact | intacte |
| Fin de l'exécution | conservé 24 h | intacte |
| Redémarrage du runner | **perdu** | intacte |

Le registre est la mémoire du direct ; SQLite est la mémoire longue. Le flux SSE fait la jonction :
il lit chez le runner, écrit en base, puis pousse au navigateur — dans cet ordre. Un événement
affiché mais non enregistré disparaîtrait au premier rafraîchissement, et l'utilisateur croirait
avoir mal lu.

La reprise se fait par **curseur**, jamais par décalage : `Last-Event-ID` en SSE, `afterSequence`
au premier appel. Le couple `runId + sequence` étant unique en base, rejouer un lot ne crée aucun
doublon — deux onglets, une reconnexion, un rafraîchissement : aucun de ces cas ne duplique une
ligne.

**Le rattrapage à la réouverture** complète le dispositif. Le flux SSE ne tourne que tant qu'un
onglet est ouvert ; fermer la page pendant une exécution — ce que NOX encourage explicitement —
laisse le runner produire des événements que personne ne lit. À l'ouverture de la page, NOX
récupère donc du registre tout ce que la base ignore, y compris pour une exécution **terminée** :
c'est justement le cas où le flux ne se rouvrira jamais.

Si le runner a redémarré, les événements déjà persistés restent affichés, l'exécution suit le
comportement `BLOCKED` défini par TASK-008, et NOX ne prétend pas connaître ce qui s'est passé
entre-temps.

### 5.12 Annulation d'une exécution

```text
Cancel run
      ↓
Server Action
      ↓
Runner
      ↓
CANCELLING
      ↓
Arrêt contrôlé de l'arbre
      ↓
Git final
      ↓
Run CANCELLED
      ↓
Task BLOCKED
```

#### Ce que le navigateur peut demander

Trois identifiants : projet, tâche, exécution. **Rien d'autre.** Aucun identifiant de processus,
aucun chemin de repository, aucun jeton, aucun signal système, aucune commande `taskkill`, aucun
délai, aucune option de forçage. Le seul pouvoir du formulaire est de désigner une exécution que
NOX connaît déjà ; la manière de l'arrêter appartient entièrement au runner, et le PID reste dans
la fermeture de la fonction d'arrêt, hors d'atteinte.

#### Une seule implémentation de l'arrêt

L'arrêt de l'arbre de processus a été écrit une fois, pour le délai maximal de TASK-008 : demande
polie, délai de grâce de cinq secondes, puis arrêt forcé — et sous Windows un `taskkill /T` qui ne
vise **que** le PID créé par NOX, jamais un processus trouvé par son nom. L'annulation appelle
exactement cette fonction. Deux implémentations d'un arrêt de processus divergeraient, et c'est
celle qui n'est pas testée qui tournerait le jour où ça compte.

#### `CANCELLING` n'est pas un état final

Une demande d'arrêt n'est pas un arrêt constaté. Tant que le processus n'a pas fermé, il peut
encore écrire dans le repository ; le traiter comme terminé reviendrait à cesser de le surveiller
au moment précis où il faut le surveiller. La tâche reste donc `RUNNING` jusqu'à la terminaison
réelle, et aucune autre exécution ne peut démarrer.

Si le processus ne ferme pas, NOX ne fait pas semblant : passé un délai, l'exécution est marquée
`BLOCKED` avec `CLAUDE_CANCEL_FAILED`, et le message dit que le processus peut encore vivre.

#### La course entre la fin et l'annulation

Un clic et une terminaison naturelle peuvent arriver dans la même milliseconde. La règle est
simple : **le premier état final validement enregistré gagne**, et `CANCELLING` n'en est pas un.

- Le processus a rendu un résultat complet, un code de sortie nul et aucune erreur → il a fini son
  travail. L'annulation est arrivée trop tard, le run est `COMPLETED`, et le dire autrement
  effacerait un résultat réel.
- Dans tous les autres cas → le run est `CANCELLED`.
- Un run déjà conclu refuse l'annulation avec `CLAUDE_RUN_ALREADY_FINISHED`, sans rien changer.

Un run tué rend presque toujours une sortie incomplète et un code non nul. Les diagnostics
habituels — sortie illisible, échec du processus — sont donc court-circuités quand un arrêt a été
demandé : signaler « sortie illisible » pour une interruption parfaitement volontaire serait
trompeur.

#### Pourquoi l'annulation ne restaure rien

Claude Code a pu écrire la moitié d'un fichier avant de mourir. NOX capture l'état Git — comme
pour n'importe quelle autre fin — et s'arrête là. Pas de `reset`, pas de `restore`, pas de
`checkout`, aucune suppression de fichier : restaurer détruirait justement le travail partiel que
l'utilisateur doit relire pour décider quoi en faire.

Une **violation Git reste prioritaire**, y compris après une annulation. Si `HEAD` a changé, si la
branche a changé ou si un commit a été créé, le run est `FAILED` avec `GIT_POLICY_VIOLATION` même
si un arrêt avait été demandé : l'utilisateur doit apprendre d'abord qu'un commit interdit existe,
et ensuite seulement que le processus a été interrompu.

Un run annulé fait passer la tâche à `BLOCKED`, jamais à `READY`. Passer directement à `READY`
masquerait l'état partiel du repository ; `BLOCKED → READY` reste une décision humaine, prise
après avoir regardé `git status` et `git diff`.
