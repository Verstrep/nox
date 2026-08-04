# DECISIONS — NOX

Journal des décisions structurantes. Chaque entrée indique la décision, sa justification et,
si utile, ce qu'elle écarte.

Une décision consignée ici n'est pas rediscutée sans raison nouvelle. Si elle est révisée,
l'entrée est mise à jour et la raison du changement est écrite.

---

## Décisions produit

### D-001 — Nom de code : NOX

**Décision.** Le projet s'appelle NOX.

**Justification.** Nom court, sans ambiguïté avec un produit existant du domaine, utilisable
comme préfixe de packages (`@nox/web`, `@nox/runner`, `@nox/shared`) et de variables
d'environnement (`NOX_RUNNER_PORT`).

### D-002 — Travail découpé en petites tâches

**Décision.** Le développement avance par tâches numérotées (`TASK-001`, `TASK-002`, …),
chacune avec un objectif, un périmètre fermé et des critères d'acceptation.

**Justification.** Une grosse tâche produit un diff que personne ne relit sérieusement, et
rend impossible d'identifier ce qui a cassé. Le découpage garde la review humaine faisable et
maintient le repository dans un état stable entre deux étapes.

### D-003 — Documentation Markdown versionnée avec Git

**Décision.** Les documents de référence sont des fichiers Markdown du repository.

**Justification.** La documentation est la mémoire du projet entre deux sessions IA : un
modèle oublie, un fichier non. Le Markdown est lisible par un humain comme par un modèle, sans
format propriétaire, et Git rend son évolution traçable et réversible.

---

## Décisions de processus

### D-004 — Aucun push automatique

**Décision.** Ni NOX ni Claude Code ne pousse vers un dépôt distant. Jamais.

**Justification.** Le push est l'action la plus difficile à annuler proprement. Elle reste
sous contrôle humain exclusif.

### D-005 — Commit et push humain avant chaque nouveau prompt Claude

**Décision.** L'utilisateur valide, commit et push l'état obtenu avant de lancer la tâche
suivante.

**Justification.** Garantit un point de retour propre avant chaque intervention automatisée, et
rend le diff de chaque tâche lisible isolément. Sans cela, deux tâches se mélangent dans un même
diff et la review devient inexploitable.

---

## Décisions techniques

### D-006 — Monorepo avec les workspaces npm natifs

**Décision.** Un seul repository, avec les workspaces npm. Ni Turborepo, ni Nx, ni pnpm.

**Justification.** Trois workspaces et un graphe de dépendances trivial ne justifient pas un
orchestrateur de build. npm est déjà installé, et les workspaces natifs suffisent au partage de
`packages/shared`. Un outil de monorepo pourra être ajouté si le temps de build devient un
problème mesuré — pas avant.

### D-007 — Next.js (App Router) pour l'interface

**Décision.** `apps/web` est une application Next.js utilisant l'App Router.

**Justification.** Fournit l'interface, le routage et les Route Handlers de la future API dans
un seul workspace. Évite d'avoir à maintenir séparément un front et un serveur d'API pour un
outil local.

### D-008 — Node.js + TypeScript pour le runner

**Décision.** `apps/runner` est un process Node.js distinct, écrit en TypeScript, s'appuyant
uniquement sur les modules natifs pour le serveur HTTP.

**Justification.** Le runner devra lancer des processus enfants de longue durée et diffuser
leurs logs. Sa durée de vie ne doit pas dépendre du cycle de rendu de Next.js, et il doit
pouvoir être redémarré sans toucher à l'interface. Le module `node:http` couvre entièrement le
besoin actuel : ajouter un framework HTTP serait une dépendance sans contrepartie.

### D-009 — Aucune base de données pendant TASK-001

**Décision.** Ni Prisma, ni PostgreSQL, ni SQLite dans le socle initial.

**Justification.** Le modèle de données n'est pas encore stable. Choisir un ORM et un schéma
maintenant reviendrait à figer des décisions sur des besoins non validés. La persistance sera
introduite à l'étape 2 de la [roadmap](ROADMAP.md), avec un modèle issu d'un besoin réel.

### D-010 — Aucune intégration IA pendant TASK-001

**Décision.** Ni OpenAI, ni Claude Code CLI dans le socle initial.

**Justification.** L'intégration IA introduit des secrets, des coûts et des appels réseau non
déterministes. Le socle doit d'abord être validable de bout en bout (lint, typecheck, build)
sans aucune de ces variables.

### D-011 — Statuts métier en objets constants, pas en `enum`

**Décision.** Les statuts de `packages/shared` sont des objets `as const` ; les types union et
les listes de valeurs en sont **dérivés**, jamais réécrits à la main.

**Justification.** Trois avantages concrets sur `enum` : les valeurs restent du JavaScript
ordinaire (donc sérialisables et comparables à des chaînes venues du réseau) ; la syntaxe est
effaçable, donc compatible avec `isolatedModules` et avec le type stripping natif de Node ; et
la dérivation supprime toute possibilité de divergence entre la constante et le type.

### D-012 — TypeScript 5.9 plutôt que 7.x

**Décision.** La version de TypeScript est fixée à `~5.9.3`.

**Justification.** TypeScript 7 est disponible en version stable, mais `typescript-eslint@8`
— embarqué par `eslint-config-next@16` — déclare `typescript >=4.8.4 <6.1.0`. Installer
TypeScript 7 provoque un conflit de dépendances de pair et rend l'analyse typée non supportée.
La consigne étant d'utiliser des versions **mutuellement compatibles**, la 5.9 est la version
stable la plus récente qui satisfait toute la chaîne d'outillage. À revoir quand
`typescript-eslint` supportera la 7.x.

### D-013 — ESLint 9 plutôt que 10.x

**Décision.** La version d'ESLint est fixée à `^9.39.5`.

**Justification.** Même raisonnement : avec ESLint 10, `eslint-plugin-import`,
`eslint-plugin-react` et `eslint-plugin-jsx-a11y` (dépendances de `eslint-config-next`)
déclarent un pair maximal `^9` et npm affiche des avertissements `ERESOLVE`. ESLint 9 satisfait
l'ensemble de la chaîne sans dérogation.

### D-014 — Une seule configuration ESLint à la racine

**Décision.** Un unique `eslint.config.mjs` racine couvre les trois workspaces ; les règles
Next.js et React sont restreintes à `apps/web` par le champ `files`.

**Justification.** La configuration plate d'ESLint permet de cibler par chemin. Dupliquer une
configuration par workspace créerait trois fichiers à maintenir en cohérence pour un bénéfice
nul. Note : l'entrée `next/typescript` de `eslint-config-next` est écartée car elle redéclare
le plugin `@typescript-eslint`, déjà fourni par `typescript-eslint`, ce que la configuration
plate refuse.

### D-015 — Type stripping natif de Node plutôt que `tsx`

**Décision.** Le mode développement du runner est `node --watch src/index.ts`, sans dépendance
d'exécution TypeScript. Le champ `engines` exige Node `>=22.18.0`.

**Justification.** Node exécute nativement les fichiers TypeScript depuis la 22.18 / 23.6. Le
runner n'utilise que de la syntaxe effaçable — conséquence directe de [D-011](#d-011--statuts-métier-en-objets-constants-pas-en-enum).
Ajouter `tsx` reviendrait à installer une dépendance pour une capacité déjà présente dans le
runtime, ce que les règles de [CLAUDE.md](../CLAUDE.md) interdisent.

### D-016 — `packages/shared` compilé vers `dist/`

**Décision.** Le package partagé est compilé par `tsc` et exposé via `exports` pointant vers
`dist/`. Un script `prepare` le construit automatiquement après `npm install`, et les scripts
`dev:*`, `build` et `typecheck` le reconstruisent avant les workspaces consommateurs.

**Justification.** Le runner l'importe à l'exécution comme du JavaScript réel : consommer les
sources TypeScript imposerait soit une configuration de transpilation côté web, soit une
résolution de chemins divergente entre les deux consommateurs. Compiler une fois donne un
contrat identique pour l'application web et pour le runner.

### D-017 — `apps/web/AGENTS.md` et `apps/web/CLAUDE.md` sont versionnés

**Décision.** Les fichiers `apps/web/AGENTS.md` et `apps/web/CLAUDE.md` sont conservés dans le
repository, bien qu'ils n'aient pas été écrits à la main.

**Justification.** Ils sont générés automatiquement par `next dev` (Next.js 16) et signalent
aux agents de code que cette version de Next comporte des changements de rupture par rapport à
leurs données d'entraînement, en les renvoyant vers `node_modules/next/dist/docs/`. Next les
recrée à chaque démarrage : les ignorer produirait une modification non versionnée permanente.
Leur contenu est utile aux sessions futures et ne contredit pas la [CLAUDE.md](../CLAUDE.md)
racine, qui reste la référence pour les règles de projet.

---

## Décisions de TASK-002 — persistance et projets locaux

### D-018 — Prisma comme couche d'accès aux données

**Décision.** L'accès à la base passe par Prisma ORM (7.9.1), isolé dans `packages/database`.

**Justification.** Trois besoins concrets : un schéma déclaratif qui reste lisible quand les
modèles `Task`, `Run`, `Message` et `ProjectDocument` s'ajouteront ; des migrations versionnées
dans Git, cohérentes avec [D-003](#d-003--documentation-markdown-versionnée-avec-git) ; et un
client typé qui rend les requêtes vérifiables par `tsc` plutôt qu'à l'exécution. Écrire du SQL
à la main aurait suffi pour un seul modèle, mais aurait imposé de construire à la main un
système de migrations — soit précisément la partie que Prisma résout bien.

### D-019 — SQLite comme persistance locale de la V1

**Décision.** Le provider est SQLite, via le driver adapter `@prisma/adapter-better-sqlite3`
(obligatoire depuis Prisma 7).

**Justification.** NOX est un outil personnel qui s'exécute sur la machine de développement.
SQLite ne demande ni serveur, ni conteneur, ni configuration : `npm install` suffit à obtenir
une base fonctionnelle. PostgreSQL apporterait de la concurrence d'écriture et des types riches
dont aucun besoin actuel ne dépend, au prix d'une dépendance d'infrastructure. Ce choix est
réversible : Prisma abstrait le provider, et seul `packages/database` connaît SQLite.

**Limite acceptée.** SQLite n'a pas d'enum natif : `Project.status` est stocké en `TEXT` et
validé dans la couche applicative (voir [D-022](#d-022--statut-stocké-en-texte-validé-par-noxshared)).

### D-020 — Base de développement à la racine, dans `data/`

**Décision.** Le fichier SQLite est `<racine du monorepo>/data/nox-dev.db`. Le chemin est résolu
par `packages/database/src/paths.ts`, qui remonte l'arborescence jusqu'au `package.json` dont le
`name` vaut `nox`. `NOX_DATABASE_URL` permet de viser une autre base.

**Justification.** Le CLI Prisma s'exécute avec `packages/database` comme répertoire courant,
Next.js avec `apps/web`, les scripts npm depuis la racine. Un chemin relatif produirait donc
trois bases différentes selon la commande. L'ancrage sur un marqueur de racine donne le même
fichier absolu dans tous les cas, et l'échec est explicite (exception) plutôt que silencieux.
`data/` à la racine reste visible et facile à supprimer pour repartir de zéro ; le dossier est
versionné (via `.gitkeep`), son contenu ne l'est pas.

### D-021 — Client Prisma généré, jamais versionné

**Décision.** Le générateur `prisma-client` émet dans `packages/database/src/generated/prisma`,
dossier ignoré par Git. `npm install` le régénère via le script `prepare`, et `npm run build`
le régénère avant de compiler.

**Justification.** Le client est un artefact dérivé du schéma : le versionner créerait un
second point de vérité, sujet à divergence silencieuse. Le générer sous `src/` — et non à côté —
le fait compiler par le même `tsc` que le reste du package : Prisma 7 émet du TypeScript, pas du
JavaScript, et un dossier hors `rootDir` ne serait pas émis dans `dist/`.

**Piège rencontré.** Le générateur déduit l'extension de ses imports du tsconfig le plus proche
et bascule sur `.ts` dès que `allowImportingTsExtensions` est actif. `tsc` ne réécrivant pas ces
extensions, le `dist/` produit était inexécutable. L'option `importFileExtension = "js"` est
donc figée explicitement dans le schéma.

### D-022 — Statut stocké en texte, validé par `@nox/shared`

**Décision.** `Project.status` est une colonne `TEXT`. Aucun enum n'est déclaré dans le schéma
Prisma. La valeur est validée par `isProjectStatus` lors de chaque lecture, dans
`packages/database/src/projects.ts`.

**Justification.** Les statuts sont déjà définis une seule fois dans `@nox/shared`
([D-011](#d-011--statuts-métier-en-objets-constants-pas-en-enum)). Les redéclarer en enum Prisma
créerait un doublon à maintenir — et SQLite ne les supporte de toute façon pas. Une ligne dont
le statut est inconnu lève `InvalidProjectRecordError` : c'est une corruption de données, pas
une erreur utilisateur, et elle doit être visible plutôt que masquée par un repli silencieux.

### D-023 — Validation Git côté serveur, dans `apps/web`

**Décision.** Le chemin saisi est validé exclusivement côté serveur, par
`apps/web/lib/repository-path.ts`, qui exécute `git -C <chemin> rev-parse --show-toplevel` via
`execFile` (jamais un shell), avec un délai maximal de 5 secondes.

**Justification.** Le navigateur ne peut pas savoir si un chemin existe sur la machine, et une
validation cliente serait de toute façon contournable. `execFile` reçoit un tableau d'arguments :
la valeur utilisateur ne peut pas être interprétée comme une commande. Aucun fichier du
repository n'est lu, et aucune commande Git modifiant le repository n'est lancée.

**Écart assumé.** [ARCHITECTURE.md](ARCHITECTURE.md) posait « l'application web ne lance aucun
processus système ». Cette frontière est franchie ici, sur instruction explicite de TASK-002 et
pour un seul cas, en lecture seule. Le document a été mis à jour en conséquence : la
responsabilité reviendra à `apps/runner` quand NOX séparera réellement l'interface de la machine
d'exécution.

### D-024 — Stockage du chemin canonique retourné par Git

**Décision.** NOX enregistre la racine retournée par `git rev-parse --show-toplevel`, repassée
par `fs.realpathSync.native()`, et non la chaîne saisie par l'utilisateur.

**Justification.** Un même repository peut être désigné de plusieurs façons : sous-dossier,
casse différente (`d:\projets` / `D:\Projets`), séparateurs mixtes, lien symbolique. Sans
canonicalisation, la contrainte d'unicité serait contournable et le même repository pourrait
être enregistré plusieurs fois. `realpath.native` est ce qui résout la casse réelle sous
Windows ; c'est ce qui permet à la contrainte `@unique` de suffire, sans comparaison en mémoire.

### D-025 — Server Action plutôt que Route Handler

**Décision.** La création passe par une Server Action (`app/projects/new/actions.ts`) consommée
par `useActionState`, et non par un Route Handler appelé en `fetch`.

**Justification.** Un Route Handler aurait imposé d'écrire à la main la sérialisation de la
requête, la gestion du `pending`, la redirection et le retour d'erreurs par champ. La Server
Action fournit tout cela, reste soumise à la même validation serveur, et fonctionne même sans
JavaScript — ce qui a d'ailleurs permis de tester le formulaire réel en HTTP. Un Route Handler
redeviendra pertinent le jour où un client non-navigateur devra créer des projets.

### D-026 — Client Prisma mis en cache sur `globalThis`

**Décision.** `getDatabaseClient()` mémorise l'instance sous un `Symbol.for` global.
`createDatabaseClient(url)` reste disponible pour créer un client explicite (tests).

**Justification.** En développement, Next.js recharge les modules serveur à chaque modification.
Sans cache, chaque rechargement ouvrirait une connexion SQLite supplémentaire jusqu'à épuiser
les descripteurs de fichiers. Le cache est porté par `globalThis` parce qu'il survit au
rechargement de module, contrairement à une variable de module.

### D-027 — Ni édition ni suppression de projet dans TASK-002

**Décision.** Un projet peut être créé, listé et consulté. Il ne peut être ni modifié, ni
supprimé, ni archivé.

**Justification.** Périmètre explicitement fermé par TASK-002. Ces opérations soulèvent des
questions qui n'ont pas encore de réponse : que devient une tâche en cours si le chemin du
repository change ? faut-il supprimer les exécutions passées avec le projet ? Y répondre avant
que `Task` et `Run` n'existent reviendrait à décider à l'aveugle. La contrepartie assumée :
retirer un projet mal saisi demande aujourd'hui de passer par Prisma Studio.

### D-028 — Tests avec le test runner natif de Node

**Décision.** `npm run test` lance `node --test`. Aucun framework de test n'est installé.

**Justification.** Node fournit le runner, les assertions et le reporter. Vitest ou Jest
apporteraient surtout du mocking de modules et une intégration navigateur, dont aucun test
actuel n'a besoin. Les fichiers `.ts` sont exécutés directement grâce au type stripping natif,
dans la continuité de [D-015](#d-015--type-stripping-natif-de-node-plutôt-que-tsx).

Les tests de persistance visent une base SQLite temporaire, construite en rejouant les vraies
migrations du projet : la base de développement n'est jamais touchée, et les migrations sont
elles-mêmes vérifiées au passage.
