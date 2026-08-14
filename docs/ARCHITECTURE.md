# ARCHITECTURE — NOX

> **Rôle de ce document** : comment NOX fonctionne **aujourd'hui** — ses composants, ses flux
> et ses frontières.
>
> Ce que NOX sait faire est décrit dans [PROJECT_STATE.md](PROJECT_STATE.md), pourquoi les
> choix ont été faits dans [DECISIONS.md](DECISIONS.md), et ce qui viendra ensuite dans
> [ROADMAP.md](ROADMAP.md). Les numéros de tâche apparaissent ici uniquement pour dater une
> décision : ils n'organisent pas le document.

---

## 1. Vue d'ensemble

```text
Navigateur
    ↓
Next.js  (interface, orchestration, persistance métier)
    ├── SQLite                 (persistance locale)
    ├── OpenAI Architect       (conception et relecture)
    └── HTTP local authentifié
             ↓
        Runner NOX
             ↓
        Git et système de fichiers local
             ↓
        Claude Code CLI        (implémentation)
```

Chaque étage n'appelle que l'étage immédiatement inférieur. Le navigateur ne parle jamais au
runner, l'application web ne parle jamais directement à Claude Code, et le runner ne connaît ni
OpenAI ni la base de données.

Cette contrainte a un but précis : **concentrer en un seul endroit ce qui touche au système de
fichiers et aux processus**. Cet endroit est le runner, sans exception.

En parallèle de cette chaîne, l'application web dispose de sa propre persistance :

```text
apps/web  →  packages/database  →  SQLite local
```

Le runner n'apparaît pas dans cette seconde chaîne : il reste **sans état**, donc redémarrable
à tout moment.

## 2. Le monorepo

```text
NOX/
├── apps/
│   ├── web/        Interface + orchestration + persistance (Next.js)
│   └── runner/     Exécution locale (Node.js, API HTTP native)
├── packages/
│   ├── shared/     Contrat commun : types, statuts, prompts, projections pures
│   └── database/   Accès aux données (Prisma + SQLite)
├── data/           Base SQLite locale (contenu non versionné)
├── docs/           Documentation de référence
├── scripts/        Outillage local (sonde de santé du runner)
└── tasks/          Documents Markdown des tâches, créés par NOX
```

Workspaces npm natifs, une configuration TypeScript commune (`tsconfig.base.json`), une
configuration ESLint unique (`eslint.config.mjs`).

## 3. Les composants

### 3.1 `apps/web` — interface, orchestration, persistance

Next.js App Router. Les pages sont des Server Components ; les écritures passent par des Server
Actions ; deux Route Handlers servent le flux d'une exécution.

Responsabilités :

- rendre l'interface — projets, documents, backlog, tâches, exécutions, reviews, conversations,
  mémoire ;
- orchestrer : construire les prompts, décider des transitions de statut, appeler le runner ;
- parler au fournisseur de modèle — **seul étage autorisé à le faire** ;
- écrire en base — **seul étage autorisé à le faire**.

`apps/web` ne lance **aucun** processus système et ne lit **aucun** fichier de projet.

La logique métier vit hors des composants React : les composants affichent, les modules de
`lib/` décident. Un module de `lib/` qui n'a besoin ni de la base ni du réseau est écrit pur, et
testé comme tel.

```text
apps/web/lib/
├── architect/        conception, review et tout ce qui parle à OpenAI
├── runner/           client HTTP du runner, strictement côté serveur
├── projects.ts · tasks.ts · runs.ts · documents.ts     lecture métier
├── task-input.ts · task-sync.ts · task-delete.ts       règles de tâche
├── run-prompt.ts · run-events.ts · run-review.ts       règles d'exécution
├── guided-workflow.ts · guided-workflow-display.ts     faits et rendu du guide
├── memory.ts · memory-display.ts                       mémoire projet
└── labels.ts                                           libellés d'interface
```

### 3.2 `apps/runner` — la frontière avec la machine

API HTTP locale sur `node:http`, sans framework. Seize routes, dont **une seule publique** :

| Route | Rôle |
| --- | --- |
| `GET /health` | Sonde publique en local, sans authentification |
| `POST /repositories/resolve` | Résout la racine Git d'un chemin |
| `POST /repositories/documents/list` | Inventorie les Markdown reconnus |
| `POST /repositories/documents/read` | Lit un document autorisé, renvoie sa révision |
| `POST /repositories/documents/update` | Remplace un document après contrôle de révision |
| `POST /repositories/documents/create` | Crée un document par ouverture exclusive |
| `POST /repositories/documents/delete` | Supprime un document après contrôle de révision |
| `POST /repositories/tasks/create-document` | Crée `tasks/<code>.md` — seule route autorisée à créer un dossier, et seulement `tasks/` |
| `POST /repositories/tasks/delete-document` | Supprime `tasks/<code>.md` — seule route autorisée à toucher aux documents que la précédente protège |
| `POST /claude/preflight` | Vérifie **en lecture seule** qu'un lancement est possible |
| `POST /claude/runs/start` | Lance Claude Code, répond `202` sans attendre |
| `POST /claude/runs/status` | État d'une exécution, depuis le registre en mémoire |
| `POST /claude/runs/events` | Événements **publics** postérieurs à un curseur |
| `POST /claude/runs/cancel` | Enregistre un arrêt, passe en `CANCELLING`, répond `202` |
| `POST /claude/runs/review` | Relit l'instantané de review — ne calcule rien |
| `POST /claude/corrections/preflight` | Vérifie qu'une reprise ciblée est possible |

Chaque route sensible exige `Authorization: Bearer <NOX_RUNNER_TOKEN>`, comparé à temps
constant. Corps JSON limité à 32 Kio, `Content-Type` vérifié, délai maximal sur corps
incomplet. Les erreurs suivent le contrat de `@nox/shared` : un code, jamais un message
d'exception, jamais une trace.

```text
apps/runner/src/
├── config.ts          validation au démarrage, refus hors boucle locale
├── server.ts          routage, testable sans port fixe
├── http/              authentification, corps, réponses
├── repositories/      Git et documents, indépendants de HTTP
└── claude/            préflight, lancement, registre, flux, validations
```

Contraintes permanentes :

- écoute sur la boucle locale uniquement — il **refuse de démarrer** sur toute autre adresse ;
- n'agit que sur les chemins explicitement enregistrés ;
- n'effectue **jamais** d'opération Git distante et ne réécrit jamais l'historique ;
- n'appelle aucun fournisseur de modèle ;
- n'écrit dans aucune base ;
- **n'exécute aucune commande de validation** — il les autorise à Claude Code, une par une, et
  observe ce qui a tourné ;
- ne journalise jamais le jeton, ni même un fragment.

Le runner est un processus séparé, et non une route de Next.js, pour trois raisons : sa durée
de vie ne dépend pas du cycle de rendu, il se redémarre sans toucher à l'interface, et il isole
les processus enfants du serveur web.

Ses sources importent leurs voisins avec l'extension `.ts` : le mode développement exécute le
TypeScript directement, sans transpileur.

### 3.3 `packages/shared` — le contrat commun

Statuts métier, formes des messages web ↔ runner, codes d'erreur, prompts, bornes, et
projections pures.

Règles : **aucune dépendance runtime**, aucun accès au système de fichiers ou au réseau, aucun
code spécifique à React ou à Node. Ce package doit rester importable des deux côtés.

C'est pour cette raison que la projection du workflow guidé y vit : un module qui ne peut
importer ni Node, ni Prisma, ni un client HTTP ne peut pas non plus, par accident, déclencher
une exécution ou un appel au fournisseur. La pureté n'y est pas une convention, elle est
structurelle.

### 3.4 `packages/database` — l'accès aux données

Schéma Prisma, migrations versionnées, et fonctions d'accès. Quinze modèles :

```text
Project ─┬─ mainArchitectSessionId  →  la conversation principale
         │
         ├─ Task ─┬─ TaskAcceptanceCriterion
         │        ├─ TaskDocumentReference
         │        ├─ TaskValidationCommand
         │        └─ Run ─┬─ RunEvent
         │                ├─ RunFileChange
         │                ├─ RunValidationResult
         │                ├─ ReviewFeedback
         │                └─ ArchitectRunReview
         ├─ ProjectMemoryEntry
         └─ ArchitectSession ─┬─ ArchitectMessage
                              └─ ArchitectGeneration
```

Les fonctions reçoivent le client en paramètre, ce qui permet aux tests de viser une base
temporaire. Les chaînes lues en base — statuts, priorités, états de synchronisation — sont
revalidées à chaque relecture avec les gardes de `@nox/shared` : une base modifiée à la main ne
propage pas une valeur inconnue jusqu'à l'interface.

Le chemin de la base est ancré sur la racine du monorepo, jamais sur le répertoire courant.

Les migrations sont **additives et écrites à la main** lorsque Prisma proposerait de
reconstruire une table portant des données réelles. Le client généré et les dossiers `dist/`
ne sont jamais modifiés à la main, ni versionnés.

Règles : seul `apps/web` importe ce package ; aucun composant React n'appelle Prisma. Le
provider SQLite est isolé derrière ce package et pourra changer sans toucher à `apps/web`.

### 3.5 L'Architecte OpenAI

Situé dans `apps/web/lib/architect/`, **côté serveur uniquement**. Aucun import OpenAI
n'existe dans un Client Component, et la clé n'atteint jamais le navigateur.

Responsabilités :

- tenir la **conversation locale** : transcript persisté, reconstruit en entier à chaque tour ;
- assembler un **contexte projet contrôlé** — liste fermée de documents, dernières tâches,
  mémoire active ;
- construire un prompt déterministe et le rendre prévisualisable avant tout envoi ;
- calculer l'**empreinte du contexte** et la comparer entre l'aperçu et l'envoi ;
- appeler le fournisseur avec un Structured Output strict ;
- **revalider la réponse** contre les invariants de NOX ;
- persister le tour, ses messages, son manifest et sa consommation ;
- assembler, sur demande, un **bundle de review** issu de l'instantané immuable d'une exécution.

Ce qu'il ne peut pas faire, par construction :

| Il n'a aucun accès à | Pourquoi |
| --- | --- |
| système de fichiers | il ne reçoit que ce que le serveur a assemblé |
| Git | aucune de ses sorties n'atteint une commande |
| runner | il vit dans le web, et n'a aucun client runner |
| Claude Code | les deux modèles ne se parlent jamais |
| outils | l'appel ne déclare **aucun** `tools` |
| réseau arbitraire | aucune URL de base n'est configurable |

**Aucune de ces limites ne repose sur un prompt.** Un texte de contexte peut demander n'importe
quoi ; il n'existe simplement aucun chemin de code par lequel un modèle pourrait agir.

```text
lib/architect/
├── config.ts          variables d'environnement, sans valeur par défaut
├── context.ts         liste fermée, bornes, troncature, manifest        (pur)
├── context-diff.ts    comparaison de deux manifests, faits sûrs         (pur)
├── fingerprint.ts     empreintes de contexte, de tâche et de mémoire    (pur)
├── sanitize.ts        nettoyage de tout ce qui quitte la machine        (pur)
├── transcript.ts      transcript local complet, tel qu'il est stocke     (pur)
├── window.ts          tours recents transmis, tours anciens conserves    (pur)
├── window-display.ts  ce que l'apercu en dit                             (pur)
├── greeting.ts        message d'accueil, texte d'interface               (pur)
├── composer.ts        message d'ouverture figé ou champ éditable         (pur)
├── timeline.ts        messages et événements locaux, entrelacés          (pur)
├── reveal.ts          découpage d'une réponse déjà reçue, durée bornée    (pur)
├── prepare.ts         contexte + transcript + prompt + empreintes       (pur)
├── review-bundle.ts   spécification + diff enregistré + validations     (pur)
├── review-prepare.ts  bundle + prompt de review + empreinte             (pur)
├── review-display.ts  URL, éligibilité, lignes de preview               (pur)
├── review-load.ts     relecture des sources d'une analyse
├── review-service.ts  préparation d'une analyse, puis envoi contrôlé
├── provider.ts        interface étroite + faux fournisseur
├── openai.ts          Responses API, Structured Output strict
├── service.ts         préparation d'un tour, puis envoi contrôlé
├── apply.ts           création de la tâche par le pipeline existant
├── recent-tasks.ts    sélection des tâches envoyées
├── errors.ts          codes traduits en phrases françaises
└── display.ts         URL, statuts de sources, tailles                  (pur)
```

## 4. Communication web ↔ runner

**HTTP simple.** Requête/réponse JSON, sur la boucle locale, authentifiée par un jeton partagé.
Le contrat — formes de messages et codes d'erreur — vit dans `@nox/shared` : ni le runner ni le
web ne le redéclare.

**Server-Sent Events pour le suivi d'une exécution.** Le web expose un flux SSE au navigateur
et interroge le runner par HTTP pour l'alimenter. La communication reste unidirectionnelle —
runner → web — ce qui correspond exactement au besoin : le web pilote par HTTP, le flux
descend. Les WebSockets ne sont pas retenus tant qu'aucun besoin bidirectionnel temps réel
n'apparaît.

Le runner ne connaît pas le navigateur, et le navigateur ne connaît pas le runner.

## 5. Frontières

### 5.1 Frontières structurelles

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

Une seule exception a existé — la validation d'un chemin de repository, temporairement placée
dans `apps/web` faute de canal vers le runner — et elle est **close**. `apps/web` n'importe plus
`node:child_process`. Aucune nouvelle exception ne doit être ouverte : toute opération sur le
système de fichiers ou sur Git prend la forme d'une route authentifiée du runner.

### 5.2 Confinement des chemins

Toute résolution d'un chemin fourni par l'utilisateur suit **exactement** la même séquence,
qu'il s'agisse d'une lecture, d'une écriture ou d'une suppression :

```text
Filtrage syntaxique          relatif, sans "..", extension attendue, emplacement autorisé
        ↓
realpath
        ↓
Vérification du confinement  sur les chemins réels, jamais par comparaison de préfixe
```

Le filtrage syntaxique seul ne suffit pas : seul `realpath` révèle un lien sortant. La
comparaison de préfixe de chaîne ne suffit pas non plus : `repo-autre/` commence par `repo`.

Il n'existe **qu'une** implémentation de cette validation. Une seconde finirait par diverger de
la première, et c'est celle qui aurait oublié un cas qu'on utiliserait.

Les chemins finaux sont reconstruits côté serveur à partir d'une destination validée : le
navigateur n'envoie jamais un chemin complet, ni un préfixe, ni un chemin absolu.

### 5.3 Écritures

Toute écriture dans un repository respecte les mêmes règles :

- **Création par primitive exclusive** (`open` en `wx`). Un enchaînement `exists()` puis
  `writeFile()` n'est jamais une garantie : le fichier peut apparaître entre les deux.
- **Aucun écrasement**, quelles que soient les circonstances.
- **Contrôle de révision** avant toute modification : le runner relit les octets, recalcule
  l'empreinte, et refuse si elle diffère. Un conflit se règle en rechargeant, jamais en
  forçant.
- **Écriture atomique** : fichier temporaire du même dossier, puis remplacement. Aucun document
  ne reste partiellement écrit, et aucun fichier temporaire ne survit.
- **Jamais à travers un lien symbolique**, même si sa cible reste dans le repository :
  l'utilisateur doit savoir quel fichier physique est modifié.
- **Aucun dossier créé**, sauf `tasks/` à la racine, par la route dédiée et par elle seule. Un
  parent manquant est une erreur, pas une invitation.
- **Noms validés pour rester portables** : ni caractère interdit sous Windows, ni nom réservé,
  ni espace ou point final. Le nom saisi n'est jamais transformé en silence.

### 5.4 Secrets

```text
NOX_RUNNER_TOKEN      web → runner, jamais au navigateur, jamais dans un log
NOX_OPENAI_API_KEY    web → OpenAI, jamais ailleurs
```

Le préfixe `NOX_` n'est pas décoratif : **toute variable qui le porte est retirée de
l'environnement du processus Claude Code**, sur le préfixe entier et jamais sur une liste
nominative. Une variable ajoutée plus tard est donc couverte d'office. `OPENAI_API_KEY` serait
transmise telle quelle ; `NOX_OPENAI_API_KEY` ne l'est pas.

Aucune variable `NEXT_PUBLIC_*` ne porte de secret. Une variable manquante est signalée par son
**nom**, jamais par sa valeur. Aucune clé d'API Anthropic n'existe dans NOX : l'authentification
de Claude Code est celle déjà configurée sur le poste.

### 5.5 Ce qui quitte la machine

Deux directions, deux nettoyeurs distincts — et ils ne sont pas interchangeables.

**Claude Code → navigateur.** Tout ce qui remonte passe par la sanitation d'événements : chemins
du repository rendus relatifs, chemins extérieurs masqués, variables `NOX_*` retirées — valeur
**et** nom —, caractères de contrôle supprimés, taille bornée. Le raisonnement interne du
modèle est écarté avant d'être lu, sur une liste de blocs affichables **fermée**.

**NOX → OpenAI.** Tout ce qui part passe par la sanitation de contexte, qui préserve le
Markdown — indentations, lignes vides, blocs de code — parce qu'un document illisible ne rend
service à personne. Les lignes d'en-tête d'un diff ne subissent que le masquage des secrets :
réécrire un chemin dans un diff produirait un diff faux.

Ne sont **jamais** candidats à un envoi : `.env`, le code source, les diffs Git non capturés,
les prompts, les timelines, les sorties de Claude Code, les feedbacks, les coûts. Ce ne sont
pas des filtres — ces éléments n'entrent dans aucun chemin de code menant au fournisseur.

## 6. Les flux

### 6.1 Documents Markdown

```text
Page Documents  →  client runner (serveur)  →  runner  →  fichiers du repository
```

- **Les contenus restent dans Git.** SQLite ne stocke ni le texte des documents, ni leur liste :
  la base ne connaît que le chemin du repository. Il n'existe donc aucune copie à
  resynchroniser.
- **Le runner applique le confinement** — § 5.2 — et le web ne le duplique pas : il n'aurait de
  toute façon pas les moyens de le vérifier.
- **Le web ne voit que des chemins relatifs.** Le navigateur reçoit `docs/PROJECT_BRIEF.md`,
  jamais un chemin absolu.
- **Aucune interprétation.** Le contenu est renvoyé brut, et affiché sans conversion en HTML.

### 6.2 Tâches et leur document

```text
Formulaire  →  Server Action  →  SQLite (transaction)  →  runner  →  tasks/<code>.md
```

Le numéro vient du compteur `Project.nextTaskSequence`, incrémenté de façon atomique — jamais
d'un `count() + 1`, qui réattribuerait un numéro dès qu'une tâche disparaîtrait. Le code
affiché s'en dérive et n'est pas stocké ; le chemin du document est `tasks/<code>.md`, sans le
titre, parce que le titre changera et le chemin non.

Les deux étapes sont **distinctes** : l'enregistrement en base et l'écriture du document. La
seconde peut échouer et être reprise. Une panne du runner ne supprime jamais une tâche — et à
la suppression, l'ordre s'inverse : `runner → SQLite`, parce qu'un document orphelin est
indétectable alors qu'une tâche sans document est visible et reprenable.

Une synchronisation n'écrase jamais un fichier existant : un document identique au Markdown
attendu est adopté, un document différent produit un conflit.

### 6.3 Exécution Claude Code

```text
Page de préparation  →  préflight runner (lecture seule)
        ↓
Server Action  →  prompt régénéré côté serveur  →  runner  →  spawn Claude Code
```

- **Le prompt ne vient jamais du navigateur.** Il est régénéré à partir de la tâche en base, et
  les règles d'outils sont calculées à partir des commandes de validation enregistrées.
- **Le repository doit être propre et synchronisé.** Sans état de départ connu, il devient
  impossible de dire ce que l'agent a changé.
- **Le lancement est toujours explicite.** NOX ne déclenche jamais Claude Code de lui-même, ni
  pour réessayer, ni pour enchaîner une tâche.
- **Une seule exécution active**, tous projets confondus.
- `--dangerously-skip-permissions` n'est jamais passé, sous aucune condition.
- Les secrets `NOX_*` sont retirés de l'environnement de l'enfant — § 5.4.
- **Un résultat de Claude Code ne vaut pas validation humaine** : une exécution réussie fait
  passer la tâche en `REVIEW`, jamais directement en `COMPLETED`.

### 6.4 Suivi en direct et annulation

```text
Claude Code (stream-json)  →  parseur NDJSON  →  normalisation  →  sanitation
        ↓
RunEvent (type fermé)  →  SQLite  →  SSE  →  navigateur
```

- **Aucun événement brut n'atteint le navigateur.** Ce qui circule est un événement dont le
  runner décide chaque champ ; le type est fermé et n'a aucun champ libre.
- **Le raisonnement interne n'est jamais exposé ni persisté.** La liste des blocs affichables
  est fermée, jamais une liste d'exclusions.
- **Une commande n'est affichée que si elle est exactement autorisée.** La ligne est découpée
  sur `&&` en respectant les guillemets, son préfixe `cd <chemin>` est retiré et jamais
  affiché. Un segment non reconnu devient `...` : son existence est dite, jamais son contenu.
  Toute autre construction — `;`, `|`, `>`, `<`, `` ` ``, `$(`, `&` isolé, guillemet non fermé —
  fait renoncer à la ligne entière.
- **Un segment non affichable n'efface pas la validation qui l'accompagne.** L'affichage et la
  reconnaissance des validations sont deux questions distinctes.
- **Une issue ambiguë n'est jamais tranchée.** Un échec n'est imputé à une validation que si
  elle était **seule** sur sa ligne ; sinon l'issue reste `UNKNOWN`. Une réussite, elle, prouve
  que tous les segments d'un chaînage `&&` ont tourné.
- **Les bornes sont des constantes**, jamais des variables d'environnement : une limite de
  sécurité qu'on peut desserrer n'en est plus une. Après troncature, le runner continue de lire
  `stdout` — cesser de lire figerait Claude Code au milieu de son travail.
- **Aucun numéro d'événement ne vient de Claude Code.** La reprise se fait par curseur.
- **Une annulation ne restaure jamais Git.** Le corps ne porte qu'un identifiant d'exécution :
  aucun PID, aucun signal, aucun délai, aucune option de forçage. L'arrêt de l'arbre a une seule
  implémentation.
- **Le premier état final validement enregistré gagne.** `CANCELLING` n'en est pas un. Un run
  annulé bloque la tâche jusqu'à review humaine.

### 6.5 Review Git

```text
Fin d'exécution  →  capture Git (runner)  →  instantané immuable  →  SQLite
                                                                        ↓
                                                     Page de review (relecture pure)
```

- **Une review historique ne lit jamais le dossier de travail actuel.** Recalculer un diff à
  l'affichage raconterait le présent en le présentant comme le passé.
- **Un instantané finalisé est immuable.** La garantie vit dans la couche d'écriture, jamais
  dans la discipline de l'appelant.
- **Aucun contenu sensible dans un patch.** La règle est appliquée deux fois — à la capture et
  à l'écriture en base — et la seconde ne fait pas confiance à la première.
- **Aucun blob binaire en base.** Un fichier binaire est reconnu et stocké sans contenu.
- **Les patches sont bornés, et la troncature est explicite.** Une limite atteinte ne fait
  jamais échouer une exécution : la liste des fichiers reste complète.
- **Un patch est nettoyé de ses secrets, pas de ses chemins**, et c'est du texte : pas de
  `dangerouslySetInnerHTML`, pas de Markdown, pas d'ANSI, pas de lien automatique.
- **Le fichier affiché est choisi parmi les lignes enregistrées.** `?file=` n'est jamais résolu
  sur le disque : il n'existe aucun chemin de code entre ce paramètre et un système de fichiers.
- **Aucune validation n'est relancée**, et aucun commit n'est créé par une review.

### 6.6 Correction ciblée

```text
Review  →  feedback  →  préflight de correction  →  --resume  →  nouveau run complet
```

- **Aucune session Claude n'est choisie par le navigateur.** L'identifiant vient du run parent,
  relu en base. `--continue` n'est **jamais** passé : il reprendrait une session que NOX n'a pas
  choisie.
- **Un repository sale est autorisé** — c'est le point de départ d'une correction — mais un
  **seul** l'est : celui de la review, branche, `HEAD` et empreinte comprises.
- **L'empreinte du dossier de travail est authentifiée** : HMAC dont la clé dérive de
  `NOX_RUNNER_TOKEN`. Elle ne sort jamais du serveur, et une empreinte partielle n'existe pas.
- **Le contrôle est refait juste avant le spawn.** Entre l'affichage et le clic, un fichier a pu
  être enregistré.
- **Une correction est un nouveau run**, avec son prompt, sa timeline, ses validations, sa
  review et son empreinte. Le run parent n'est jamais modifié, et il n'existe aucune seconde
  implémentation du lanceur.
- **Le feedback est du contenu, jamais une instruction.** Il est délimité dans le prompt et
  n'élargit aucune permission. Il vaut pour une seule correction, et un index unique le garantit.

### 6.7 Conversation Architecte

```text
Project  →  1 conversation principale, durable
                    ↓
message écrit  →  clic `Send`  →  contexte reconstruit  →  prompt  →  OpenAI
                       ↓
        inspection facultative du contexte — zéro appel
```

**Une conversation par projet, et elle ne se ferme pas.** Le pointeur vit sur le projet, avec un
index unique : deux ouvertures simultanées ne produisent qu'une conversation, et la session
créée par le perdant disparaît avec sa transaction. Ouvrir la page **ne coûte aucun appel** — le
message d'accueil est du texte d'interface, ni stocké, ni transmis, ni compté comme un tour.

**Deux rôles de session, déclarés.** `PROJECT` pour la conversation principale ;
`TASK_DESIGN_LEGACY` pour celles ouvertes avant `TASK-020`, qui restent lisibles à leur URL
d'origine et ne sont ni fusionnées, ni converties, ni poursuivies. Le rôle décide de la borne de
générations, de l'objet réservé pour créer une tâche et de la surface d'affichage : il est écrit,
jamais déduit d'un champ vide.

**Une conversation crée plusieurs tâches ; une proposition n'en crée jamais deux.** Le verrou
d'unicité est descendu d'un cran — de la session à la génération. Réserver précède créer, et la
main est rendue si la création échoue.

**Le parcours est celui d'un chat.** On lit, on écrit, on envoie : un clic explicite, un appel au
plus. Le contexte n'est pas relu depuis un aperçu, il est **reconstruit au moment de l'envoi** —
le navigateur n'apporte que le texte du message et un compteur de messages, qui sert uniquement à
reconnaître un onglet resté sur un état dépassé. L'inspection du contexte reste offerte, et
n'autorise rien.

Les sessions de conception de tâche gardent leur parcours en deux clics : aperçu obligatoire,
puis envoi. Réécrire leur interaction reviendrait à réécrire l'histoire qu'elles racontent.

**Ce qui n'existe qu'à l'écran.** Pendant un envoi, le fil montre le message soumis et trois
points d'attente ; à l'arrivée, la réponse se révèle par blocs. Rien de tout cela n'est persisté,
transmis ni compté — ce sont des états React, effacés dès que le tour se conclut, dans un sens
comme dans l'autre.

**Ce n'est pas du streaming.** La réponse arrive entière, en un appel, et elle est enregistrée
avant le premier bloc affiché. Aucun protocole, aucune route, aucune option du fournisseur n'a
changé : la révélation est une animation d'affichage, bornée en durée, et elle ne concerne que la
réponse arrivée pendant que la page était ouverte. Un rechargement affiche tout d'un bloc.

**Une tâche créée s'affiche dans le fil, sans y entrer.** L'événement est dérivé de
`ArchitectGeneration.appliedTaskId` et rendu à côté du tour qui l'a proposé. Ce n'est pas un
message : rien n'est écrit dans le transcript, et le fournisseur ne le voit jamais. La tâche se
signalera d'elle-même au tour suivant, par la liste des tâches récentes.

- **La conversation appartient à NOX.** Le transcript vit dans SQLite et est reconstruit à chaque
  tour : ni `previous_response_id`, ni `conversation`, ni mode background, et `store` reste
  `false`. Une conversation doit rester lisible après un changement de modèle, un redémarrage, ou
  la disparition des réponses chez le fournisseur.
- **Le transcript se fenêtre, il ne se refuse plus.** Seuls les tours les plus récents partent ;
  les plus anciens restent en base et restent affichés. Aucun résumé, aucune compression, et
  jamais un tour coupé en deux — une question sans sa réponse produirait un dialogue que personne
  n'a tenu. Ce qui doit survivre à une longue conversation vit dans les documents et dans la
  mémoire projet, relus en entier à chaque tour.
- **L'empreinte comparée couvre le tour**, pas seulement le contexte : contexte projet, messages
  retenus, message en attente. Sans le transcript, un message envoyé depuis un second onglet
  passerait inaperçu — le projet, lui, n'aurait pas bougé.
- **Le contexte est une liste fermée**, fixe et automatique : deux documents de conventions, six
  documents `docs/` nommés, les dix dernières tâches, la mémoire active. Le navigateur ne
  choisit aucun fichier.
- **Chaque tour reconstruit son contexte** à partir du projet actuel. Il n'existe aucun
  « continuer avec l'ancien contexte » : NOX ne conserve que les manifests, et un bouton qui
  prétendrait rejouer un contexte passé serait un mensonge.
- **Un contexte modifié après l'aperçu bloque l'appel — dans le parcours en deux clics.** Aucune
  génération n'est réservée, aucun appel n'est fait, et il n'existe ni `Send anyway`, ni option
  de forçage. Dans une conversation projet la question ne se pose pas : l'envoi construit son
  contexte lui-même, donc il n'y a aucun contexte ancien à confirmer.
- **L'empreinte de contexte n'est pas une primitive de sécurité** : SHA-256 nu, contrairement à
  l'empreinte de dossier de travail du § 6.6, qui est un HMAC parce qu'elle décide d'une
  exécution. Ne jamais confondre les deux.
- **Le Structured Output ne dispense d'aucune validation.** Tailles, énumérations, références
  documentaires et commandes sont revalidées côté serveur.
- **Aucun appel n'est automatique** : ni au chargement, ni au changement d'un champ, ni
  périodiquement, ni après un échec. `maxRetries` vaut zéro.
- **Un message n'entre dans la conversation que si le tour a abouti.** Les deux messages sont
  écrits dans la même transaction que la conclusion de la génération ; un échec n'en écrit
  aucun, et un rafraîchissement ne réémet jamais un appel.
- **Le transcript est borné, jamais résumé.** Au-delà, NOX refuse et invite à ouvrir une
  nouvelle conversation.
- **Aucune tâche n'est créée sans action humaine**, et elle est créée en `DRAFT`. La création
  réutilise le pipeline de tâches existant, sans seconde implémentation.

### 6.8 Review Architecte

```text
Instantané de review (SQLite)  →  bundle borné  →  prompt  →  aperçu  →  clic  →  OpenAI
                                                                            ↓
                                            verdict du fournisseur  +  verdict de NOX
```

- **Elle lit SQLite, jamais le système de fichiers.** Aucun fichier n'est ouvert, aucun
  `git diff` relancé, le runner n'est pas interrogé.
- **Le compte rendu de Claude Code n'est jamais transmis.** Une déclaration de l'agent sur son
  propre travail n'est pas une preuve.
- **Le sort d'un patch absent est toujours dit** — `Content hidden`, `Binary`, `Truncated`,
  `Unavailable`, `Not sent` — jamais un `patch: null` muet. Un modèle à qui l'on ne dit rien
  invente une raison.
- **Les deux verdicts sont persistés séparément.** Écraser celui du fournisseur réécrirait
  l'histoire : on ne saurait plus si l'architecte s'était trompé ou si NOX l'avait corrigé.
- **Une recommandation d'approbation est impossible dès qu'une partie de la review était
  invisible.** La garde est dérivée de la review **enregistrée**, jamais du texte du modèle.
- **Aucune validation configurée n'est pas un échec.** Ne pas déclarer de commande est un choix
  légitime ; en faire un échec fictif apprendrait à ignorer le verdict.
- **Une analyse ne change aucun statut**, ne crée aucun feedback, ne lance aucune correction.
  Un test le vérifie sur la **source** du module.

### 6.9 Workflow guidé

```text
Task.status · Run.status · Run.kind · reviewCapturedAt · analyses · feedbacks · sync
        ↓
deriveGuidedWorkflowState()   pure, déterministe, dans packages/shared
        ↓
Étape courante · Prochaine action · Alternatives · Blocages · Progression
```

- **Il est dérivé, jamais persisté.** Aucune colonne n'existe en base, et aucune ne doit y
  apparaître : une seconde représentation d'une même vérité finit toujours par diverger, et
  c'est celle qui est écrite qu'on croit.
- **Recommander n'autorise rien.** Le guide dit ce qui a du sens ; les Server Actions, les
  transitions et les préflights restent les seules autorités. Un affichage périmé ne contourne
  donc rien.
- **Aucune action guidée ne recopie un formulaire existant.** Chaque action porte un type et des
  identifiants ; son URL est reconstruite côté serveur et mène à la surface où la décision se
  prend déjà.
- **Aucun appel IA pour choisir l'étape.** La dérivation ne lit ni base, ni disque, ni Git,
  n'interroge ni le runner ni un fournisseur, et ne modifie rien. Un test lit la **source** du
  module — ni `await`, ni `async`, ni `fetch`, ni `process.env` — parce qu'une régression y
  serait invisible à l'exécution.
- **Le rendu d'une page de tâche ne déclenche rien.** Les seules sondes autorisées sont les
  préflights **existants**, en lecture seule, et uniquement quand leur réponse sert.
- **Une précondition non vérifiée n'est pas une précondition manquante.** Un refus explicite du
  runner produit un blocage nommé ; une absence de réponse produit « je ne sais pas », jamais
  « le repository a changé ».
- **Une action qui engage une IA est annoncée, et elle seule.** Un avertissement posé partout
  n'avertit plus de rien.

### 6.10 Mémoire projet

```text
Entrées ACTIVE  →  sanitation  →  révisions  →  bundle de contexte  →  aperçu  →  appel
```

- **Rien n'entre sans une action humaine.** Le Structured Output d'un tour ne porte ni
  `memoriesToCreate`, ni `memoriesToUpdate` : une réponse de l'architecte ne peut pas écrire en
  mémoire.
- **Elle vit dans SQLite, jamais dans le repository.** Aucune écriture Git, aucun fichier
  généré, aucune modification de `CLAUDE.md`.
- **Aucune opération de mémoire n'appelle OpenAI, Claude Code ou le runner.** La page fonctionne
  runner arrêté et sans configuration OpenAI ; un test le vérifie sur la source des modules.
- **Seules les entrées `ACTIVE` atteignent l'Architecte, et toutes l'atteignent.** Il n'existe
  pas de troisième état, et aucune troncature silencieuse : une opération qui ferait dépasser le
  budget est refusée à l'**écriture**, avec ses trois sorties.
- **Aucun classement.** Les entrées partent dans l'ordre de leurs codes, jamais selon une
  pertinence calculée ou choisie par un modèle.
- **Sanitisée avant de partir, stockée telle qu'écrite.** Le budget et la révision se mesurent
  sur le texte **envoyé** : une révision doit décrire ce que le fournisseur a reçu.
- **Un changement de mémoire est un changement de contexte** : les entrées actives entrent dans
  l'empreinte du § 6.7.
- **La review Architecte ne reçoit pas la mémoire.** Élargir cette surface demande une décision
  séparée.

## 7. Invariants transverses

Ces règles ne dépendent d'aucun flux. Elles valent partout, et une tâche qui les contredirait
serait un changement d'architecture.

| Invariant | Conséquence pratique |
| --- | --- |
| Une seule implémentation par garantie | Pas de seconde validation de chemin, pas de second lanceur, pas de second nettoyeur pour la même direction |
| Les bornes sont des constantes | Aucune limite de sécurité n'est réglable par variable d'environnement |
| Une troncature est toujours dite | Ni résumé implicite, ni fenêtre glissante, ni suppression silencieuse |
| Le doute reste du doute | « Inconnu » ne devient jamais « échoué », et « pas de réponse » ne devient jamais « refusé » |
| Les statuts internes sont stables | Ils ne changent ni en base, ni dans les contrats, ni dans les documents déjà générés ; seul leur affichage se traduit |
| Les libellés sont centralisés | Un mapping concurrent dans un composant isolé finirait par diverger |
| Un modèle ne décide de rien | Sa sortie est revalidée, et aucune de ses réponses ne change un statut |
| Les tests n'appellent jamais un vrai fournisseur | Ni OpenAI, ni le vrai binaire Claude Code : faux fournisseur et faux Claude, toujours |
