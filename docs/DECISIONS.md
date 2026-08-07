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

---

## Décisions de TASK-003 — connexion web ↔ runner

### D-029 — HTTP local plutôt qu'un autre canal

**Décision.** L'application web et le runner communiquent par HTTP sur la boucle locale,
requête/réponse JSON, sans framework HTTP.

**Justification.** Le runner est déjà un serveur `node:http`. HTTP donne des statuts, des
en-têtes et un modèle d'erreur que tout le monde comprend, se teste avec `fetch` sans outillage,
et se diagnostique avec PowerShell. Les alternatives coûtaient plus cher pour rien : un socket
Unix / named pipe complique le code Windows et l'inspection manuelle ; un module partagé
appelé en direct annulerait la séparation de processus qui est précisément le but
([D-008](#d-008--nodejs--typescript-pour-le-runner)).

### D-030 — Contrat partagé dans `@nox/shared`

**Décision.** Les formes de messages et **tous** les codes d'erreur du runner sont déclarés une
seule fois, dans `packages/shared/src/runner.ts`. Le runner les produit, le web les consomme.

**Justification.** Deux listes de codes à maintenir en parallèle divergent toujours : un code
ajouté côté runner et oublié côté web deviendrait un message générique silencieux. La source
unique rend l'oubli visible à la compilation — `describeRunnerFailure` utilise un
`Record<RunnerErrorCode, string>`, donc un code non traduit casse le typecheck.

Corollaire : le contrat ne transporte **que des codes**, jamais de texte destiné à
l'utilisateur. La formulation vit dans `apps/web/lib/runner/errors.ts`, seule couche qui connaît
la langue de l'interface.

### D-031 — Authentification par jeton partagé

**Décision.** Les routes sensibles exigent `Authorization: Bearer <NOX_RUNNER_TOKEN>`. Le jeton
est comparé avec `crypto.timingSafeEqual` après contrôle de longueur. Le runner **refuse de
démarrer** sans jeton et n'en génère jamais automatiquement.

**Justification.** Le runner exécute des commandes locales : tout processus de la machine peut
atteindre `127.0.0.1:4310`, y compris du code hostile exécuté par un autre programme. Le jeton
est ce qui distingue l'application web de n'importe quel autre appelant local.

Pourquoi pas de génération automatique : le web doit pouvoir utiliser la même valeur d'un
démarrage à l'autre. Un jeton régénéré à chaque lancement casserait la configuration à chaque
redémarrage.

Pourquoi un échec au démarrage plutôt qu'un repli : un runner sans jeton ne peut rien faire
d'utile. Démarrer quand même produirait un runner qui répond `/health` mais échoue sur tout le
reste — un mode de panne bien plus déroutant qu'un message clair au lancement, qui indique
d'ailleurs la commande pour générer un jeton.

### D-032 — Écoute restreinte à la boucle locale

**Décision.** `NOX_RUNNER_HOST` doit désigner une adresse de boucle locale (`127.0.0.0/8`,
`::1`, `localhost`). Toute autre valeur empêche le démarrage.

**Justification.** Un runner joignable depuis le réseau est une exécution de commandes offerte à
quiconque atteint la machine — le jeton ne serait plus qu'une couche unique devant une capacité
totale. En V1, cette configuration n'a aucun usage légitime : refuser vaut mieux qu'avertir.

### D-033 — `/health` publique en local, routes sensibles authentifiées

**Décision.** `GET /health` ne demande pas de jeton. `POST /repositories/resolve` et toute route
sensible future l'exigent.

**Justification.** L'indicateur de disponibilité doit pouvoir répondre « runner indisponible »
plutôt que « jeton incorrect » quand la configuration est absente — sinon le diagnostic est
brouillé au moment où l'utilisateur en a le plus besoin. La contrepartie est nulle :
`/health` ne renvoie que le nom du service, un statut et une version. Aucun chemin local,
aucune variable d'environnement, aucun repository connu, aucune version de Git — c'est vérifié
par un test.

### D-034 — Le runner valide la machine, le web valide le métier

**Décision.** Le runner répond aux questions qui dépendent du système de fichiers (le chemin
existe-t-il, est-ce un dossier, quelle est la racine Git). Le web garde les règles métier : nom
obligatoire, longueur de description, unicité en base.

**Justification.** Chaque validation vit là où se trouve l'information nécessaire. Le runner
n'a pas accès à la base, le web n'a pas accès au disque. Une exception pragmatique : le web
vérifie encore que le champ chemin n'est pas vide, uniquement pour éviter d'annoncer « runner
indisponible » à quelqu'un qui a simplement laissé le champ vide.

### D-035 — Client runner strictement serveur

**Décision.** `apps/web/lib/runner/` n'est importé que par des Server Components et des Server
Actions. Aucune variable n'est préfixée `NEXT_PUBLIC_`, et `config.ts` lève une erreur si le
module est évalué avec un `window` défini.

**Justification.** Une variable `NEXT_PUBLIC_*` est inlinée dans le bundle navigateur : le jeton
serait lisible par n'importe qui ouvre les outils de développement. Le garde-fou runtime rend
l'erreur immédiate et explicite si un futur refactor tire ce module dans un Client Component,
au lieu de la laisser passer silencieusement.

Le client expose exactement deux opérations, `checkRunnerHealth` et `resolveRepositoryPath` :
un client HTTP générique aurait été une abstraction sans second usage.

### D-036 — Indicateur de disponibilité sans sondage navigateur

**Décision.** L'état du runner est calculé au rendu serveur, affiché sur le tableau de bord et
sur la page de création. Aucun rafraîchissement automatique côté navigateur.

**Justification.** Un sondage périodique générerait du trafic permanent pour une information que
l'utilisateur regarde au chargement. L'état est réévalué à chaque navigation, ce qui suffit.
Point important : l'indicateur ne **bloque jamais** l'interface — la liste des projets, les
pages projet et le formulaire restent accessibles runner arrêté. C'est à la soumission que
l'utilisateur reçoit un message expliquant qu'il faut le démarrer.

L'indicateur appelle `connection()` : sans cela, Next.js préaffichait son état au moment du
build, et la page `/projects/new` aurait affiché « Runner indisponible » à jamais.

### D-037 — Pas de SSE ni de WebSocket dans TASK-003

**Décision.** La communication reste strictement requête/réponse.

**Justification.** Aucune opération actuelle ne produit de flux : résoudre un chemin prend
quelques millisecondes. SSE deviendra nécessaire quand le runner diffusera les logs de Claude
Code, pas avant. L'introduire maintenant ajouterait une gestion de connexions persistantes sans
rien à y faire passer.

### D-038 — Sources du runner importées avec l'extension `.ts`

**Décision.** Les imports relatifs de `apps/runner/src` portent l'extension `.ts`. La compilation
utilise `rewriteRelativeImportExtensions`, qui les réécrit en `.js` à l'émission.

**Justification.** Le mode développement du runner est `node --watch src/index.ts`, sans
transpileur ([D-015](#d-015--type-stripping-natif-de-node-plutôt-que-tsx)). Node ne remappe pas
un import `./config.js` vers `./config.ts` : tant que le runner tenait dans un seul fichier la
question ne se posait pas, mais le découpage de TASK-003 l'a rendue bloquante. Les extensions
`.ts` font fonctionner à la fois l'exécution directe, les tests et le build.

### D-039 — Un seul `.env` à la racine, chargé explicitement

**Décision.** Le fichier `.env` reste unique, à la racine du monorepo. Le runner et Prisma le
chargent via `process.loadEnvFile`; l'application web le charge depuis `apps/web/next.config.ts`.

**Justification.** Next.js ne lit les `.env` que depuis le dossier de l'application : sans ce
chargement explicite, il aurait fallu dupliquer le jeton dans `apps/web/.env` et à la racine —
deux fichiers à garder synchronisés pour une valeur qui doit justement être identique des deux
côtés. `process.loadEnvFile` est fourni par Node, ne coûte aucune dépendance, et **n'écrase pas**
les variables déjà définies dans le shell (vérifié).

---

## Décisions de TASK-004 — inventaire et lecture des documents

### D-040 — Lecture seule stricte

**Décision.** TASK-004 n'ajoute aucune écriture : ni création, ni modification, ni suppression,
ni renommage. Le runner n'ouvre aucun fichier en écriture.

**Justification.** L'écriture dans un repository de l'utilisateur est irréversible et engage des
questions que la lecture ne pose pas : que faire d'un fichier modifié entre-temps, faut-il un
verrou, comment gérer un échec à mi-parcours. Séparer la lecture de l'écriture permet de valider
d'abord le confinement des chemins — la partie la plus délicate — sur des opérations qui ne
peuvent rien casser. Un test vérifie explicitement qu'aucun fichier n'apparaît ni ne disparaît
après une série de lectures, y compris refusées.

### D-041 — Emplacements inspectés limités, pas de parcours complet

**Décision.** NOX inspecte trois fichiers à la racine (`README.md`, `CLAUDE.md`, `AGENTS.md`)
puis, récursivement, `docs/`, `decisions/`, `plans/` et `tasks/`. Le reste du repository n'est
jamais parcouru.

**Justification.** Un parcours complet serait lent sur un vrai projet, et surtout inutile : la
quasi-totalité des `.md` d'un repository appartient à des dépendances, des gabarits ou des
changelogs. Restreindre le périmètre rend l'inventaire rapide, prévisible et pertinent. C'est
aussi une réduction de surface : un dossier non parcouru est un dossier qui ne peut pas fuiter.

**Conséquence assumée.** Un projet qui range sa documentation ailleurs (par exemple
`documentation/`) n'affichera rien. Rendre la liste configurable par projet est une évolution
naturelle, volontairement repoussée faute de besoin constaté.

**Autres Markdown de la racine ignorés.** `CHANGELOG.md`, `CONTRIBUTING.md`, `LICENSE.md` et
consorts sont du bruit dans un outil de pilotage : ils ne sont pas listés.

### D-042 — Documents principaux reconnus par une liste explicite

**Décision.** La catégorie `CORE` provient d'une liste de chemins connus
(`apps/runner/src/repositories/documents/constants.ts`), comparée sans distinction de casse.
Les autres catégories découlent du dossier de premier niveau.

**Justification.** La catégorisation est déduite du **chemin seul** : aucune analyse de contenu,
aucune heuristique sur les titres, aucune IA. Un fichier déplacé change de catégorie de façon
prévisible, et la fonction reste pure et testable. Le prix à payer est une liste à tenir à jour,
ce qui est acceptable : elle décrit une convention documentaire, pas un format ouvert.

### D-043 — Tri par catégorie puis par chemin, insensible à la casse

**Décision.** Les documents sont triés par catégorie (`CORE`, `DOCUMENTATION`, `DECISION`,
`PLAN`, `TASK`), puis par chemin via `localeCompare` en français avec `sensitivity: "base"`.

**Justification.** Le tri est stable et indépendant de l'ordre du système de fichiers. La
comparaison locale place `étude` entre `analyse` et `zebre`, là où un tri par point de code la
rejetterait après `zebre`.

**Conséquence à connaître.** Comme la comparaison ignore la casse, `docs/ARCHITECTURE.md`
précède `README.md` à l'intérieur de la catégorie `CORE` : les documents racine ne sont donc pas
regroupés en tête. C'est le tri alphabétique par chemin demandé, appliqué littéralement. Si la
lisibilité en souffre à l'usage, trier `CORE` selon l'ordre éditorial de la liste serait une
alternative simple.

### D-044 — Limites explicites : 1 Mio, 500 documents, profondeur 6

**Décision.** Un document lisible pèse au plus 1 Mio, l'inventaire s'arrête au-delà de 500
documents, et le parcours ne descend pas sous 6 niveaux dans un dossier inspecté.

**Justification.** Ces trois limites bornent la mémoire et le temps de réponse du runner face à
un repository inhabituel. La taille est vérifiée **avant** la lecture, par `stat` : un fichier de
plusieurs gigaoctets n'est jamais chargé, même partiellement. 1 Mio représente environ 500 pages
de texte — un document de référence qui dépasse cette taille relève de l'éditeur, pas d'un
lecteur intégré.

**Conséquence assumée.** Dépasser 500 documents renvoie `TOO_MANY_DOCUMENTS` et rend
l'inventaire indisponible, plutôt que d'en afficher une partie silencieusement. Une liste
tronquée sans le dire serait plus trompeuse qu'une erreur explicite ; le contrat ne comporte pas
de champ « tronqué ».

### D-045 — Confinement vérifié après résolution réelle des chemins

**Décision.** Un chemin de document est d'abord filtré syntaxiquement (relatif, sans `..`, sans
schéma d'URL, extension `.md`, emplacement autorisé), puis les deux chemins — racine et fichier —
sont passés par `realpath` avant d'être comparés avec `path.relative`.

**Justification.** Le filtre syntaxique seul ne suffit pas : il ne voit pas les liens
symboliques. Un lien parfaitement bien formé placé dans `docs/` peut pointer n'importe où sur le
disque ; seule la résolution réelle le révèle.

`path.relative` plutôt qu'une comparaison de préfixe de chaîne : `startsWith` accepterait
`C:\repo-public` comme étant « dans » `C:\repo`. `path.relative` gère correctement les
séparateurs, les volumes distincts et la casse Windows. Un test couvre précisément ce piège.

### D-046 — Liens symboliques jamais suivis pendant la découverte

**Décision.** L'inventaire ignore toute entrée signalée comme lien par `readdir({ withFileTypes: true })`,
qu'elle pointe à l'intérieur ou à l'extérieur du repository. La lecture, elle, les résout puis
vérifie le confinement.

**Justification.** Ne pas suivre les liens pendant le parcours élimine d'un coup trois problèmes :
la sortie du repository, les boucles infinies, et les doublons quand un raccourci interne fait
apparaître deux fois le même fichier. Pour la lecture d'un document précis, résoudre puis
vérifier est plus utile : un lien interne légitime reste lisible.

**Vérification.** Les tests emploient des **jonctions** Windows plutôt que des liens
symboliques : elles ne demandent aucun privilège, alors qu'un lien symbolique exige le mode
développeur. Les cas de sécurité s'exécutent donc réellement au lieu d'être systématiquement
ignorés.

### D-047 — Contenu brut, aucun rendu Markdown

**Décision.** Le contenu est affiché tel quel dans un `<pre>`. Aucun moteur Markdown n'est
installé, et `dangerouslySetInnerHTML` n'est utilisé nulle part.

**Justification.** Deux raisons, dans cet ordre. D'abord la sécurité : le texte vient d'un
fichier du disque, le convertir en HTML pour l'injecter ouvrirait une injection dans
l'interface — React échappe tout ce qu'il insère comme texte, ce qui rend l'affichage brut sûr
par construction. Ensuite le périmètre : un rendu correct demande un moteur, un plan
d'assainissement et une feuille de style. Rien de tout cela n'est nécessaire pour relire un
document de référence.

### D-048 — Sélection du document portée par l'URL

**Décision.** Le document ouvert est indiqué par `?path=<chemin relatif encodé>`, et non par un
état React.

**Justification.** L'URL reste partageable, le bouton « précédent » du navigateur fonctionne, et
un rechargement conserve le document affiché. La page est un Server Component : lire la sélection
dans l'URL permet de rendre le contenu côté serveur, sans état client à hydrater.

### D-049 — Aucune copie des documents en base

**Décision.** Ni le contenu, ni la liste des documents ne sont écrits dans SQLite. Chaque
affichage interroge le runner.

**Justification.** Une copie en base créerait un second point de vérité à resynchroniser : un
fichier modifié dans l'éditeur rendrait aussitôt le cache faux, sans moyen simple de le savoir
sans surveiller le système de fichiers — explicitement hors périmètre. Interroger le runner à
chaque affichage coûte quelques millisecondes en local et garantit que ce qui est affiché est ce
qui est sur le disque.

### D-050 — Codes `REPOSITORY_*` distincts des codes `PATH_*`

**Décision.** Les routes documents utilisent `REPOSITORY_NOT_FOUND` et
`REPOSITORY_NOT_DIRECTORY`, distincts des `PATH_NOT_FOUND` / `PATH_NOT_DIRECTORY` employés par
`/repositories/resolve`.

**Justification.** Les deux familles décrivent des situations différentes du point de vue de
l'utilisateur. `PATH_NOT_FOUND` survient pendant la création d'un projet : c'est une faute de
frappe, et le message invite à corriger la saisie. `REPOSITORY_NOT_FOUND` survient sur un projet
déjà enregistré : le repository a été déplacé ou supprimé, et le message doit le dire. Un code
unique aurait forcé un message vague dans les deux cas.

### D-051 — L'édition ne porte que sur des documents existants

**Décision.** `POST /repositories/documents/update` remplace le contenu d'un fichier déjà
présent. Un document absent produit `DOCUMENT_NOT_FOUND` ; il n'est jamais créé implicitement.

**Justification.** Créer et modifier sont deux opérations aux risques différents. Modifier
demande de ne pas écraser une version concurrente ; créer demande de valider un chemin qui
n'existe pas encore, de refuser d'écraser un fichier existant et de décider quels emplacements
acceptent un nouveau fichier. Les mélanger aurait produit une route au comportement double,
difficile à raisonner et à tester. La création fera l'objet d'une tâche dédiée.

### D-052 — La révision est une empreinte SHA-256 du contenu binaire

**Décision.** Chaque lecture renvoie `revision`, empreinte SHA-256 hexadécimale des octets réels
du fichier. Elle n'est calculée ni sur `updatedAt`, ni sur `size`, ni sur le texte décodé.

**Justification.** L'horodatage et la taille sont les deux indicateurs qui viennent d'abord à
l'esprit, et tous deux se trompent : deux écritures dans la même seconde peuvent partager un
`mtime`, et une correction à taille constante — un mot remplacé par un autre de même longueur —
passerait totalement inaperçue. Une empreinte du contenu ne se laisse tromper par aucun des deux.
SHA-256 n'est pas retenu pour une propriété cryptographique — la révision n'est pas un secret et
peut circuler jusqu'au navigateur — mais parce qu'il ne collisionne pas par accident, ce qu'un
CRC ne garantit pas.

### D-053 — Contrôle de concurrence optimiste, pas de verrou

**Décision.** L'écriture est acceptée si la révision attendue correspond à l'état du disque au
moment d'écrire, et refusée avec `DOCUMENT_CONFLICT` sinon. Aucun fichier n'est verrouillé
pendant l'édition.

**Justification.** Un verrou poserait plus de problèmes qu'il n'en résout dans ce contexte : il
faudrait le libérer si l'onglet est fermé, le forcer si NOX plante, et il gênerait l'éditeur de
code que l'utilisateur a ouvert en parallèle — usage normal, pas accident. Le contrôle optimiste
n'empêche rien tant qu'il n'y a pas de conflit réel, et signale clairement les cas où il y en a
un. Il reste une fenêtre théorique entre la relecture et le remplacement ; elle se compte en
millisecondes sur un outil mono-utilisateur local.

### D-054 — Aucun forçage de conflit

**Décision.** En cas de conflit, NOX propose de recharger la version actuelle du fichier. Aucun
bouton « écraser quand même », aucune fusion automatique.

**Justification.** Un bouton de forçage transforme une protection en formalité : confronté à un
message qui bloque, l'utilisateur clique. Or personne ne peut décider d'écraser sans avoir vu ce
qui a changé — et NOX n'affiche pas encore de diff. Une fusion automatique serait pire : elle
produirait un fichier que personne n'a écrit. Recharger fait perdre au plus quelques minutes de
saisie, que l'utilisateur peut copier avant ; écraser peut faire perdre le travail d'un autre
outil, sans trace.

### D-055 — Refus d'écrire dans un lien symbolique

**Décision.** Si le chemin visé est lui-même un lien symbolique — ou une jonction Windows —
l'écriture est refusée avec `DOCUMENT_SYMLINK_NOT_WRITABLE`, même lorsque la cible reste dans le
repository. La lecture, elle, continue de suivre les liens confinés.

**Justification.** Lecture et écriture n'ont pas les mêmes conséquences. Lire à travers un lien
confiné affiche un contenu du repository : sans surprise. Écrire à travers ce même lien modifie
un fichier dont le nom n'est pas celui que l'utilisateur a cliqué. NOX doit pouvoir répondre sans
ambiguïté à la question « quel fichier vient d'être modifié ? ». Le contrôle porte sur le chemin
**avant** résolution — `absolutePath`, déjà passé par `realpath`, ne peut par construction plus
signaler aucun lien.

### D-056 — Écriture par fichier temporaire et remplacement

**Décision.** Le contenu est écrit dans un fichier temporaire du même dossier, nommé
`.nox-<aléatoire>.tmp`, synchronisé sur le disque, puis renommé sur la cible. Le temporaire est
supprimé en cas d'échec.

**Justification.** Écrire directement dans le fichier cible le tronque avant de le remplir : une
coupure dans cette fenêtre laisse un document mutilé, et NOX n'a aucune copie pour le
reconstituer. Le temporaire vit dans le même dossier parce qu'un renommage entre volumes n'est
pas un renommage mais une copie suivie d'une suppression — ce qui rouvrirait exactement la
fenêtre à fermer. Son nom ne se termine pas par `.md`, si bien qu'un temporaire survivant à un
arrêt brutal n'apparaît jamais dans l'inventaire.

**Garantie réelle sous Windows.** `fs.rename` s'appuie sur `MoveFileEx` avec
`MOVEFILE_REPLACE_EXISTING`. Sur un même volume NTFS, un lecteur voit l'ancien contenu ou le
nouveau, jamais un mélange — mais Windows ne documente pas l'opération comme atomique au sens
strict, et elle échoue au lieu d'attendre si un autre processus tient la cible ouverte sans
partage de suppression. La garantie offerte est donc « jamais de contenu partiel », pas
« écriture atomique certifiée ». Obtenir la seconde demanderait `ReplaceFileW` via une dépendance
native, ce qui n'apporterait rien de décisif à un outil local mono-utilisateur.

### D-057 — UTF-8 conservé, BOM préservé, fins de ligne alignées sur le fichier

**Décision.** Trois règles pour le contenu écrit :

1. **UTF-8 sans BOM ajouté.** NOX n'ajoute jamais de BOM. Un BOM déjà présent est en revanche
   **conservé** : le décodage de lecture utilise `ignoreBOM: true`, ce qui le maintient dans le
   contenu et le fait donc revenir tel quel à l'enregistrement.
2. **Fins de ligne alignées sur le document existant.** Le contenu reçu est ramené en LF, puis la
   convention majoritaire du fichier sur le disque lui est réappliquée.
3. **Aucun caractère de fin de fichier ajouté ni retiré.** Si l'utilisateur supprime le saut de
   ligne final, il est supprimé.

**Justification.** La règle 2 corrige un problème qui vient du navigateur : la spécification HTML
impose qu'un `<textarea>` soit soumis en CRLF, quel que soit le texte affiché. Sans correction,
enregistrer un fichier écrit en LF réécrirait toutes ses lignes en CRLF — un diff de plusieurs
centaines de lignes pour une correction de trois mots. C'est le seul endroit où le contenu écrit
s'écarte de la chaîne soumise, et cet écart existe précisément pour rester fidèle à l'intention.
La règle 1 suit la même logique : perdre un BOM en silence serait une modification que personne
n'a demandée.

### D-058 — Aucune sauvegarde automatique

**Décision.** L'enregistrement est déclenché par un clic explicite. Aucune écriture périodique,
aucune écriture à la perte du focus.

**Justification.** NOX écrit dans un repository Git qu'un éditeur de code observe en parallèle.
Une sauvegarde automatique produirait des écritures que l'utilisateur n'a pas demandées, des
conflits avec son éditeur, et un `git status` bruyant. La protection contre la perte accidentelle
est assurée autrement : confirmation à l'annulation et `beforeunload`, tous deux inactifs tant
que le texte n'a pas changé.

### D-059 — Aucun brouillon persisté

**Décision.** Le texte en cours d'édition vit dans l'état React du formulaire. Il n'est écrit ni
en base, ni dans `localStorage`, ni dans un fichier temporaire de brouillon.

**Justification.** Un brouillon crée un second point de vérité, avec toutes les questions qui
suivent : quand l'effacer, que faire s'il diverge du fichier, que présenter à la réouverture.
C'est une fonctionnalité à part entière, pas un détail d'implémentation. La conservation du texte
en cas d'erreur — voir D-060 — couvre le besoin réel sans rien persister.

### D-060 — Le texte saisi survit à toute erreur contrôlée

**Décision.** Tout échec d'enregistrement renvoie le texte soumis dans l'état du formulaire :
conflit de révision, runner arrêté, document trop volumineux, lien symbolique, panne d'écriture.

**Justification.** Une erreur ne doit jamais coûter à l'utilisateur ce qu'il vient d'écrire.
C'est particulièrement vrai du conflit, seul cas où NOX refuse une action parfaitement légitime :
lui faire perdre son texte par-dessus le marché rendrait la protection plus coûteuse que le
risque dont elle protège.

### D-061 — La création est une opération distincte de l'édition

**Décision.** `POST /repositories/documents/create` est une route séparée, servie par un module
séparé (`create-document.ts`), avec sa propre primitive d'écriture (`create-new-file.ts`).

**Justification.** Les deux opérations écrivent, mais elles protègent de choses opposées.
L'édition remplace un fichier existant sans jamais le laisser partiel : elle passe par un
temporaire, puis écrase la cible. La création refuse au contraire d'écraser quoi que ce soit.
Réutiliser le remplacement pour créer aurait littéralement inversé la garantie principale. Une
route unique aurait par ailleurs eu deux comportements selon l'existence du fichier — exactement
le genre de fonction qu'on n'arrive plus à raisonner six mois plus tard.

### D-062 — Création par ouverture exclusive, jamais par vérification préalable

**Décision.** Le fichier est créé avec `open(path, "wx")` : le système d'exploitation le crée
**et** échoue s'il existe déjà, en une seule opération indivisible. Un contrôle d'existence
préalable subsiste, mais uniquement pour produire un meilleur message.

**Justification.** Le motif `exists()` puis `writeFile()` ne garantit rien : entre les deux
appels, un `git pull`, un éditeur ou un autre onglet peut créer le fichier, qui serait alors
écrasé sans que personne ne le sache. La fenêtre est étroite, la perte est totale. `wx` supprime
la fenêtre au lieu de la réduire — et le coût est nul, puisque c'est le comportement natif de
l'appel système.

### D-063 — Aucun écrasement, aucune option pour en demander un

**Décision.** Un fichier déjà présent produit `DOCUMENT_ALREADY_EXISTS`. Aucune option
« remplacer », aucun paramètre `force`.

**Justification.** Un document existant a une histoire dans Git ; l'écraser depuis un formulaire
de création la remplacerait par un commit unique où tout a disparu d'un coup. L'utilisateur qui
voulait vraiment changer ce fichier dispose déjà de l'éditeur, qui lui montre le contenu actuel
avant qu'il n'écrive. L'interface propose donc d'ouvrir le document existant — c'est le chemin
correct, pas une consolation.

### D-064 — Les dossiers parents doivent exister ; NOX n'en crée aucun

**Décision.** Chaque segment intermédiaire doit exister et être un vrai dossier. Un parent
manquant produit `DOCUMENT_PARENT_NOT_FOUND` ; aucun `mkdir` n'est jamais exécuté.

**Justification.** Créer les dossiers manquants transformerait une faute de frappe en
arborescence permanente : `docs/guiides/NOTE.md` créerait `docs/guiides/`, que rien n'effacerait
ensuite. La structure d'un repository est une décision de projet, pas un effet de bord d'un
champ de saisie. Refuser coûte un dossier à créer à la main, une fois ; accepter coûte un
nettoyage à chaque erreur de frappe.

### D-065 — Refus des dossiers parents qui sont des liens

**Décision.** Si un parent est un lien symbolique ou une jonction Windows, la création est
refusée avec `DOCUMENT_PARENT_SYMLINK_NOT_ALLOWED`, même si sa cible reste dans le repository.

**Justification.** Même raisonnement que pour l'écriture dans un lien
([D-055](#d-055--refus-décrire-dans-un-lien-symbolique)), appliqué un cran plus haut : écrire à
travers un lien de dossier déposerait le fichier ailleurs que là où l'utilisateur croit le
ranger, et le `git status` qui suit serait incompréhensible. NOX doit pouvoir répondre sans
ambiguïté à « où ce fichier vient-il d'apparaître ? ».

### D-066 — Emplacements de création limités à ceux que NOX inventorie

**Décision.** La création n'est possible qu'aux emplacements déjà inspectés : `README.md`,
`CLAUDE.md`, `AGENTS.md` à la racine, puis `docs/`, `decisions/`, `plans/`, `tasks/`. La
validation réutilise `normalizeDocumentPath`, sans seconde logique.

**Justification.** Créer un document invisible dans l'inventaire serait une impasse : NOX ne
saurait plus ni l'afficher, ni le rouvrir. Limiter la création à ce que la lecture couvre garde
les deux moitiés de la fonctionnalité cohérentes. La racine reste une liste fermée pour la même
raison qu'à la lecture : elle n'est pas un dossier de documentation, et y autoriser n'importe
quel `.md` la transformerait en fourre-tout.

### D-067 — Noms validés pour rester portables, et jamais transformés

**Décision.** Un segment est refusé s'il contient `< > : " | ? *` ou un caractère de contrôle,
s'il porte un nom réservé de Windows (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`),
ou s'il se termine par un espace ou un point. Espaces internes, tirets, underscores, accents et
parenthèses restent acceptés. Aucun nom n'est corrigé automatiquement.

**Justification.** Un document versionné avec Git finira cloné ailleurs ; un nom impossible à
créer sur un autre système rendrait ce clone inutilisable. Windows tronque en outre
silencieusement les espaces et points finaux, si bien que le fichier créé ne porterait pas le nom
demandé. Ces règles s'appliquent **uniquement à la création** : refuser de *lire* un fichier
existant sous prétexte que son nom est peu portable n'aiderait personne. Et rien n'est corrigé en
silence, car l'utilisateur doit reconnaître le fichier qu'il vient de créer.

### D-068 — Le chemin final est reconstruit côté serveur

**Décision.** Le formulaire envoie une destination — une valeur parmi cinq — et un nom relatif.
La Server Action valide la destination, en déduit le préfixe et recompose le chemin. Le préfixe
affiché à côté du champ n'est pas un champ de formulaire.

**Justification.** C'est la même règle que pour le chemin du repository, appliquée un cran plus
bas : ce que le navigateur peut modifier, il faut supposer qu'il le modifiera. Une destination
falsifiée ne correspond à aucune entrée connue et ne produit aucun chemin ; un préfixe falsifié
n'est même pas lu. La prévisualisation affichée utilise la même fonction, mais le serveur la
recalcule sans jamais consulter ce qui était à l'écran.

### D-069 — Aucun modèle, aucun contenu généré

**Décision.** Le contenu initial est celui que l'utilisateur saisit, éventuellement vide. NOX ne
pré-remplit aucun squelette et ne génère rien.

**Justification.** Un modèle est une opinion sur la forme d'un document, et cette opinion vit
déjà dans les documents existants du projet, que l'utilisateur peut copier. Générer du contenu
par IA à ce stade poserait en outre la question de la validation d'un texte que personne n'a
écrit — un sujet à part entière, sans rapport avec la création d'un fichier.

### D-070 — Limite des Server Actions alignée sur celle du runner

**Décision.** `serverActions.bodySizeLimit` est porté à 4 Mo dans `next.config.ts`, valeur
identique à la limite de corps des routes d'écriture du runner.

**Justification.** La limite par défaut de Next.js est de 1 Mo, juste en dessous du 1 Mio
qu'accepte le runner. Un document de taille légitime échouait donc avec une erreur 500 opaque au
lieu du message « taille maximale » prévu — défaut constaté pendant le test fonctionnel de
TASK-006, et présent depuis TASK-005. Les deux bornes disent désormais la même chose, et c'est le
runner — seul à voir les octets réels — qui tranche.

### D-071 — La tâche structurée vit en base, pas dans un fichier

**Décision.** Titre, objectif, contexte, hors-périmètre, priorité, statut, critères
d'acceptation, documents à lire et commandes de validation sont stockés dans SQLite. Le fichier
Markdown en est un export.

**Justification.** Le fichier seul ne saurait pas répondre aux questions que le backlog pose :
combien de tâches sont prêtes, laquelle vient ensuite, laquelle est bloquée. Il faudrait relire
et reparser tous les fichiers à chaque affichage, en espérant qu'aucun n'ait été édité dans un
format inattendu. La base répond en une requête et garantit la forme. À l'inverse, la base seule
ne serait lisible ni par Git, ni par un agent : d'où les deux, avec un sens de circulation
unique.

### D-072 — Un document Markdown associé à chaque tâche

**Décision.** Chaque tâche possède un fichier `tasks/<code>.md`, écrit dans le repository.

**Justification.** C'est le format que Claude Code lira, et le seul qui survive à la fermeture
d'une session. Le versionner avec Git rend l'évolution d'une spécification traçable et
réversible, exactement comme le reste de la documentation du projet. Une tâche qui n'existerait
que dans une base locale ne serait ni relisible en revue, ni transmissible.

### D-073 — La base est la source de vérité pendant TASK-007

**Décision.** L'édition manuelle du fichier `tasks/<code>.md` ne met pas à jour la tâche NOX.
L'interface l'affiche explicitement sur chaque page de tâche.

**Justification.** Une synchronisation bidirectionnelle demanderait de reparser le Markdown,
donc de figer un format d'analyse, de gérer les modifications concurrentes des deux côtés et de
trancher qui gagne en cas de conflit — un sujet entier, qui n'a rien à voir avec la création
d'une tâche. Le sens unique est la limite honnête à ce stade ; la cacher serait pire que
l'avoir.

### D-074 — Nom de fichier stable, sans le titre

**Décision.** Le document d'une tâche est `tasks/TASK-001.md`, jamais
`tasks/TASK-001-ajouter-la-gestion-des-projets.md`.

**Justification.** Le titre évoluera — c'est une phrase, pas un identifiant. Un nom de fichier
qui en dépendrait obligerait à renommer, donc à casser les liens existants et à salir
l'historique Git d'un `rename` pour une correction de formulation. S'y ajoutent les caractères
impossibles à porter d'un système à l'autre. Un code court et prévisible évite les quatre
problèmes d'un coup.

### D-075 — Allocation transactionnelle du numéro

**Décision.** Le numéro vient de `Project.nextTaskSequence`, incrémenté par un ordre SQL
atomique dans la transaction de création. `count() + 1` est explicitement écarté.

**Justification.** `count() + 1` est faux de deux façons : deux créations simultanées lisent le
même total et reçoivent le même numéro, et un numéro déjà utilisé est réattribué dès qu'une
tâche disparaît. La contrainte d'unicité `projectId + sequence` reste le dernier filet, mais un
filet n'est pas une garantie — le compteur en est une. Vérifié par un test de quinze créations
concurrentes.

### D-076 — Les trous de numérotation sont acceptés

**Décision.** Un échec après réservation laisse un numéro inutilisé. NOX ne cherche pas à le
récupérer.

**Justification.** Un code de tâche circule : dans un message de commit, dans un log,
dans une conversation. Le réattribuer ferait désigner deux travaux différents par la même
référence, et cette confusion n'apparaîtrait que des semaines plus tard, au moment de relire
l'historique. Un trou, lui, se remarque immédiatement et ne gêne personne.

### D-077 — Listes enfant normalisées, ordonnées par position

**Décision.** Critères, documents et commandes sont trois tables reliées à `Task`, chacune avec
une `position` entière et une contrainte d'unicité `(taskId, position)`.

**Justification.** Les stocker en JSON dans une colonne rendrait impossible toute requête
ultérieure — compter les tâches sans critère, retrouver celles qui référencent un document
donné — et laisserait la validation de forme entièrement à la couche applicative. La `position`
est explicite parce que l'ordre fait partie de la spécification : un agent traitera les critères
dans l'ordre où ils apparaissent, et le laisser au hasard de SQLite changerait la tâche d'une
lecture à l'autre.

### D-078 — Transitions manuelles limitées et centralisées

**Décision.** Huit transitions sont autorisées, déclarées dans une table unique de
`@nox/shared`. `RUNNING`, `FAILED` et `REVIEW` ne sont ni atteignables, ni quittables à la main.

**Justification.** Ces trois statuts décrivent le résultat d'une exécution de Claude Code, que
NOX ne sait pas encore déclencher. Les rendre sélectionnables permettrait d'annoncer un état que
rien n'a produit, et de mettre le backlog en désaccord avec la réalité. La table est unique
parce que le formulaire s'en sert pour construire ses boutons et la couche données pour vérifier
ce qu'elle reçoit : ce que l'interface propose est exactement ce que le serveur accepte, et une
requête falsifiée repasse par la même fonction.

### D-079 — Quatre états de synchronisation explicites

**Décision.** `PENDING`, `SYNCED`, `ERROR` et `CONFLICT` décrivent l'état du document d'une
tâche, affichés dans le backlog et sur la page de détail.

**Justification.** La tâche et son fichier peuvent diverger, et NOX doit pouvoir le dire. Un
simple booléen « synchronisé » confondrait trois situations aux réponses opposées : le document
n'a pas encore été créé, sa création a échoué et il faut réessayer, ou un fichier différent
occupe la place et c'est à l'utilisateur de trancher. Nommer chacune permet d'afficher l'action
qui convient plutôt qu'un message générique.

### D-080 — Reprise idempotente, sans écrasement

**Décision.** La reprise tente toujours la création exclusive. Un fichier existant dont le
contenu correspond exactement au Markdown attendu est **adopté** ; un contenu différent produit
`CONFLICT`, sans modification du fichier et sans option de forçage.

**Justification.** Le cas de l'adoption n'a rien d'exotique : il se produit dès qu'une création
aboutit sur le disque mais que l'enregistrement de son succès échoue — navigateur fermé,
processus arrêté. Refuser d'adopter ce fichier obligerait à le supprimer à la main pour sortir
d'une situation où tout est pourtant correct. À l'inverse, écraser un fichier différent
détruirait le travail de quelqu'un d'autre sans que personne ne l'ait vu. La comparaison est
possible parce que le générateur est déterministe : c'est ce qui rend la distinction fiable
plutôt qu'approximative. Enfin, il n'existe pas de chemin « première fois » et de chemin
« reprise » : les deux appellent la même fonction, donc le second est aussi testé que le premier.

### D-081 — Le dossier `tasks/` est la seule création de dossier autorisée

**Décision.** La route des documents de tâche crée `tasks/` à la racine du repository s'il
manque, sans `recursive`, et refuse ce nom s'il est occupé par un fichier ou par un lien.
Aucune autre route ne crée de dossier.

**Justification.** L'interdiction posée par TASK-006 protège d'une faute de frappe transformée
en arborescence permanente. Ce risque n'existe pas ici : l'emplacement d'un document de tâche
n'est pas au choix de l'utilisateur, il vaut toujours `tasks/<code>.md`, et le nom du dossier
est une constante du code. Exiger que `tasks/` soit créé à la main avant la première tâche
serait un obstacle sans contrepartie. Les trois refus restent entiers, pour la même raison
qu'ailleurs : NOX ne renomme rien, ne supprime rien, et n'écrit pas au travers d'un lien.

### D-082 — Le web n'envoie aucun chemin pour un document de tâche

**Décision.** La requête transporte un `taskCode`, pas un `documentPath`. Le runner valide sa
forme (`TASK-` suivi d'au moins trois chiffres) et compose lui-même `tasks/<code>.md`.

**Justification.** C'est la même règle que pour la création d'un document ordinaire, poussée un
cran plus loin : là-bas le web recomposait un chemin à partir d'une destination validée, ici il
n'y a plus de chemin du tout. Un code au format strict ne peut contenir ni séparateur, ni
remontée, ni caractère non portable — la validation du chemin se réduit donc à la validation du
code, et il n'existe aucune surface pour un chemin falsifié.

### D-083 — Le statut et la priorité ne figurent pas dans le Markdown

**Décision.** Le document généré ne contient ni statut, ni priorité, ni date, ni identifiant
technique. Un changement de statut ne réécrit pas le fichier.

**Justification.** Ces valeurs changent sans que la spécification change. Les inscrire
obligerait à réécrire le fichier à chaque clic et remplirait l'historique Git de modifications
qui n'apprennent rien — au point de rendre inutilisable le seul historique qui compte, celui de
la spécification. C'est aussi ce qui rend la comparaison de l'adoption fiable : un document
figé peut être comparé, un document qui bouge avec l'état de la base ne le peut pas.

### D-084 — Les commandes de validation sont stockées, jamais exécutées

**Décision.** Les commandes sont du texte enregistré avec la tâche. NOX ne les interprète pas,
ne les découpe pas et ne les lance pas.

**Justification.** Exécuter une chaîne saisie dans un formulaire est exactement ce que le
runner existe pour empêcher tant qu'aucune tâche ne l'autorise. Les stocker maintenant permet à
la spécification d'être complète — l'agent saura quoi lancer — sans ouvrir le droit de le faire.
Ce droit relèvera d'une tâche dédiée, avec ses propres garanties.

### D-085 — Claude Code est lancé en CLI, avec l'authentification existante

**Décision.** NOX lance l'exécutable `claude` déjà installé sur la machine. Il ne demande, ne
stocke et ne transmet aucune clé d'API Anthropic, et n'utilise aucun SDK.

**Justification.** L'utilisateur a déjà une authentification qui fonctionne — abonnement ou clé
— et elle vit dans Claude Code, pas dans NOX. Lui en redemander une créerait un second secret à
gérer, à faire tourner et à ne pas laisser fuiter, pour un bénéfice nul. Le CLI apporte en prime
tout ce qu'un SDK obligerait à réimplémenter : la boucle d'agent, les outils de fichiers, la
gestion du contexte. NOX n'a qu'à décider *quand* lancer et *avec quelles permissions*.

### D-086 — Mode non interactif, sortie JSON

**Décision.** L'invocation utilise `-p --output-format json`, avec un nombre de tours borné.

**Justification.** Un serveur ne peut pas répondre à des questions posées dans un terminal :
tout mode qui attendrait une saisie bloquerait indéfiniment. La sortie JSON est ce qui distingue
un résultat exploitable d'un texte à deviner — c'est elle qui permet d'enregistrer une durée, un
nombre de tours et un identifiant de session sans les extraire à coups d'expressions régulières.

### D-087 — Le prompt part par l'entrée standard

**Décision.** Le prompt est écrit sur `stdin`, puis l'entrée est fermée. Il n'apparaît dans
aucun argument.

**Justification.** Un prompt fait des milliers de caractères. Le mettre sur une ligne de
commande l'exposerait à toutes les limites de longueur du système et à tous les problèmes
d'échappement — et rendrait sa fuite triviale dans un `ps`. `stdin` n'a ni l'une, ni les autres.

### D-088 — Le prompt est déterministe et régénéré côté serveur

**Décision.** `renderClaudeExecutionPrompt` est une fonction pure. Le prompt affiché sur la page
de préparation et celui envoyé au processus sont produits par le même appel, et la Server Action
le **régénère** à partir de la tâche en base plutôt que de reprendre ce que le navigateur
renvoie. Son empreinte SHA-256 est conservée avec l'exécution.

**Justification.** Une exécution doit être reproductible : un prompt qui varierait rendrait
impossible de comprendre, six mois plus tard, pourquoi deux passages sur la même tâche ont donné
des résultats différents. Régénérer côté serveur ferme par ailleurs la seule porte par laquelle
un formulaire altéré pourrait dicter ses instructions à l'agent.

### D-089 — Le prompt référence les documents, il ne les recopie pas

**Décision.** Le prompt cite les chemins des documents à lire ; il n'en embarque pas le contenu.

**Justification.** L'agent sait lire des fichiers — c'est même sa première capacité. Recopier la
documentation coûterait des jetons à chaque exécution et, pire, figerait une version : le prompt
deviendrait faux dès la première modification d'un document, sans que rien ne le signale.

### D-090 — Préflight Git obligatoire avant tout lancement

**Décision.** Aucune exécution ne démarre sans une vérification préalable, en lecture seule, de
l'état du repository et de la disponibilité de Claude Code.

**Justification.** Toute la valeur du résultat tient à une question : « qu'est-ce que l'agent a
changé ? ». Elle n'a de réponse que si l'état de départ est connu. Vérifier après coup ne
servirait à rien — le mélange serait déjà fait.

### D-091 — L'upstream comparé est la référence locale

**Décision.** `ahead` et `behind` sont calculés contre `@{upstream}` tel que la machine le
connaît. Aucun `fetch` n'est fait, et l'interface le dit explicitement.

**Justification.** Un `fetch` serait une opération réseau et une modification du repository, ni
l'une ni l'autre demandées par l'utilisateur. Reste à choisir entre annoncer une fraîcheur qu'on
ne peut pas garantir et dire exactement ce qu'on sait : la seconde option est la seule honnête,
et l'écrire dans l'interface vaut mieux que de laisser croire à une vérification qui n'a pas eu
lieu.

### D-092 — Un repository sale ou désynchronisé bloque le lancement

**Décision.** Modifications non commitées, `HEAD` détaché, upstream absent, branche en avance ou
en retard : chacun de ces états refuse le lancement, avec son propre message.

**Justification.** Ce sont les quatre façons de rendre la relecture impossible. Un refus coûte
trente secondes à l'utilisateur ; un lancement dans ces conditions coûte une session entière à
démêler ce qui vient de qui. Le message nomme la cause précise plutôt qu'un « repository non
conforme » qui obligerait à chercher.

### D-093 — Une seule exécution active, dans le runner

**Décision.** Le runner refuse un second lancement tant qu'une exécution est active, tous
projets confondus. La contrainte est vérifiée là, et pas dans le web.

**Justification.** Deux Claude Code simultanés se marcheraient dessus dès qu'ils toucheraient au
même repository, et rendraient toute relecture impossible même sur des repositories différents —
un humain ne relit pas deux diffs en parallèle. La vérification appartient au runner parce que
lui seul voit les processus réels ; le web pourrait croire qu'il n'y en a aucun alors qu'un
onglet oublié en a lancé un.

### D-094 — Registre en mémoire, limite assumée

**Décision.** Les exécutions vivent dans un registre en mémoire du runner : vingt entrées
terminées, vingt-quatre heures de rétention, et une entrée active jamais supprimée. Un
redémarrage perd le suivi.

**Justification.** Persister l'état d'un processus reviendrait à écrire en base depuis le
runner, ce que toute l'architecture interdit depuis TASK-003. La limite est réelle mais bornée :
elle ne concerne qu'une exécution en cours, et le web sait la reconnaître. Il la traite alors
comme ce qu'elle est — un suivi perdu — et le dit, plutôt que de deviner une issue.

### D-095 — Interrogation périodique plutôt que flux d'événements

**Décision.** Le navigateur interroge un Route Handler toutes les deux secondes. Ni SSE, ni
WebSocket pendant TASK-008.

**Justification.** La question à laquelle le navigateur a besoin de répondre est binaire : est-ce
fini ? Une interrogation toutes les deux secondes y répond, coûte une requête locale, et se
raccroche toute seule après une coupure. Un flux d'événements apporterait le détail token par
token — utile, mais c'est une autre fonctionnalité, avec sa reconnexion, son tampon et son
ordonnancement. Elle mérite sa propre tâche.

### D-096 — Le navigateur ne parle jamais au runner

**Décision.** L'interrogation passe par un Route Handler de Next.js, qui appelle le runner côté
serveur.

**Justification.** Le jeton partagé ne doit pas quitter le serveur — règle posée à TASK-003 et
jamais assouplie depuis. Un appel direct depuis le navigateur obligerait à l'y exposer, ou à
ouvrir une route non authentifiée sur un processus qui lance des commandes.

### D-097 — Permissions explicites, calculées, jamais reçues

**Décision.** Les outils autorisés sont une liste fermée — lecture, recherche, modification,
création, Git en lecture seule — plus **une règle exacte par commande de validation
enregistrée**. Les commandes destructrices sont refusées nommément en défense supplémentaire.
Rien de tout cela ne vient du navigateur.

**Justification.** C'est le cœur de la sécurité de TASK-008. Un agent hérite des droits qu'on
lui donne : lui donner `Bash` sans restriction reviendrait à lui donner la machine. Une règle
*exacte* plutôt qu'un préfixe évite qu'autoriser `npm run test` autorise aussi tout ce qui
commence pareil. Et les refus nominatifs couvrent le cas où une version future de Claude Code
élargirait ses autorisations par défaut.

### D-098 — Une commande qui ne peut pas être représentée exactement bloque le lancement

**Décision.** Les caractères acceptés dans une commande de validation forment une liste fermée.
Opérateurs de chaînage, redirections, substitution, guillemets et virgules sont refusés — et le
refus **empêche le lancement** au lieu d'élargir les permissions.

**Justification.** Une liste d'interdits se contourne : il suffit d'un opérateur auquel personne
n'a pensé. Une liste d'autorisés se trompe dans l'autre sens — elle refuse une commande légitime
— et cette erreur-là se répare en une seconde, sans conséquence. La virgule mérite une mention :
c'est elle qui sépare les règles transmises au processus, donc l'accepter permettrait d'en
fabriquer une de plus.

### D-099 — `--dangerously-skip-permissions` n'est jamais passé

**Décision.** Ce drapeau n'apparaît nulle part dans le code, et un test vérifie son absence des
arguments réellement construits.

**Justification.** Il annulerait d'un coup tout le travail de D-097 et D-098. Le test existe
parce qu'une protection dont personne ne vérifie la présence finit par disparaître dans un
« juste pour déboguer » que plus personne ne retire.

### D-100 — L'environnement du processus enfant est nettoyé de toutes les variables NOX

**Décision.** Toute variable commençant par `NOX_` est retirée avant le lancement. Les variables
`ANTHROPIC_*`, elles, sont laissées intactes.

**Justification.** Le runner connaît son propre jeton et l'URL de sa base ; un agent qui peut les
lire peut appeler le runner lui-même. Le filtre porte sur le préfixe entier plutôt que sur une
liste nominative parce qu'une variable ajoutée plus tard serait sinon transmise par oubli — et
l'oubli irait dans le mauvais sens. Les variables Anthropic sont épargnées pour la raison
inverse : NOX n'en ajoute aucune, mais celle qui existe appartient à la configuration de
l'utilisateur, et la retirer casserait une authentification qui marchait.

### D-101 — Sous Windows, le processus est terminé avec ses descendants

**Décision.** Au dépassement du délai, l'arrêt passe par `taskkill /T` sous Windows, et par
`SIGTERM` puis `SIGKILL` ailleurs. Seul un identifiant de processus créé par NOX est visé.

**Justification.** Sous Windows, `claude` est généralement un `claude.cmd` lancé par `cmd.exe`,
qui lance à son tour le vrai programme. Un signal envoyé à l'enveloppe la termine et laisse le
programme tourner : le délai maximal n'aurait alors aucun effet. Constaté pendant les tests — un
délai de 0,5 seconde produisait une attente de soixante.

### D-102 — Aucun test ne lance le vrai Claude Code

**Décision.** Les tests automatisés et le test fonctionnel utilisent un faux Claude Code : un
script Node qui imite le contrat de l'outil et enregistre ce qu'il a reçu.

**Justification.** Lancer le vrai consommerait du quota à chaque exécution de la suite, la
rendrait dépendante du réseau, et donnerait des résultats non reproductibles. Le faux permet en
prime de provoquer à volonté ce que le vrai ne produit qu'accidentellement : une limite
d'utilisation, une sortie illisible, un dépassement de délai, un commit interdit.

### D-103 — Transitions automatisées séparées des transitions manuelles

**Décision.** Deux tables distinctes : l'une pour ce que l'utilisateur peut cliquer, l'autre
pour ce qu'une exécution peut poser. `READY → RUNNING` et `RUNNING → REVIEW / FAILED / BLOCKED`
n'appartiennent qu'à la seconde.

**Justification.** Les deux répondent à des questions différentes — « a-t-il le droit de
cliquer ici » et « ce résultat justifie-t-il ce statut ». Une table unique rendrait `RUNNING`
sélectionnable à la main, ce que TASK-007 interdit explicitement, et permettrait d'annoncer un
travail en cours qu'aucun processus ne fait.

### D-104 — Une réussite mène à `REVIEW`, jamais à `COMPLETED`

**Décision.** Une exécution réussie fait passer la tâche en relecture. Seul l'utilisateur la
marque terminée, et ce geste ne crée aucun commit.

**Justification.** Un résultat de Claude Code est un travail à relire, pas un travail validé.
Passer directement à « terminée » ferait de l'outil son propre juge, et retirerait de la boucle
la seule personne qui puisse dire si le besoin est réellement satisfait.

### D-105 — NOX constate l'état Git, il ne le répare pas

**Décision.** Aucun `reset`, `restore`, `checkout` ou `clean` automatique, quelle que soit
l'issue. Une violation — commit créé, branche changée — est signalée, et le repository est laissé
tel quel.

**Justification.** Réparer automatiquement détruirait précisément ce que l'utilisateur doit
relire pour comprendre ce qui s'est passé. Un commit interdit reste un commit interdit ; le
supprimer sans le montrer serait échanger un problème visible contre un problème invisible.

### D-106 — Détection prudente des limites d'utilisation

**Décision.** Une limite Claude n'est annoncée que si le sous-type JSON l'affirme, ou si le
texte contient à la fois un marqueur de limite et un mot qui le rattache à Claude. En cas de
doute, une erreur générique est retournée. Aucune heure de réinitialisation n'est jamais
déduite.

**Justification.** Annoncer à tort « limite atteinte » enverrait l'utilisateur attendre une
réinitialisation qui n'a pas lieu d'être, alors qu'une erreur générique le renvoie simplement aux
logs. Le double critère évite le faux positif le plus probable : un compte rendu qui parle du
*rate limit* implémenté dans le code de l'utilisateur. Et une heure inventée serait pire
qu'aucune.

### D-107 — La suppression exige une révision, comme l'écriture

**Décision.** `POST /repositories/documents/delete` reçoit `expectedRevision` et refuse de
supprimer si l'empreinte du disque diffère. Le contrat n'accepte même pas syntaxiquement une
révision absente ou nulle.

**Justification.** Supprimer sans révision, c'est supprimer un fichier que l'utilisateur n'a pas
vu. C'est le pire cas de cette opération : contrairement à une écriture refusée, il ne reste rien
à reporter. Le mécanisme existait déjà pour l'édition ; l'étendre coûtait une ligne, et ne pas
l'étendre aurait fait de la suppression la seule écriture non protégée.

### D-108 — Aucune suppression forcée, aucun bouton pour en demander une

**Décision.** Un conflit de suppression se règle en rechargeant. Il n'existe ni paramètre de
forçage, ni bouton « supprimer quand même ».

**Justification.** Même raison qu'en [D-054](#d-054--aucun-forçage-de-conflit) : personne ne peut
décider de supprimer une version qu'il n'a pas vue. Un bouton de forçage transformerait un
garde-fou en formalité — on clique sans lire, précisément parce que le bouton est là.

### D-109 — Un code d'erreur distinct pour le conflit de suppression

**Décision.** `DOCUMENT_DELETE_CONFLICT` existe à côté de `DOCUMENT_CONFLICT`, malgré une cause
identique sur le disque.

**Justification.** Un code se traduit par un seul message. Après un refus d'écriture,
l'utilisateur a un texte à reporter ; après un refus de suppression, il n'a rien à sauver —
seulement une version qu'il doit relire avant de décider. Le geste attendu n'est pas le même, la
phrase non plus. Réutiliser le code aurait obligé l'interface à distinguer les deux cas
autrement, ce qui revenait au même en moins lisible.

### D-110 — Aucun dossier n'est supprimé, jamais

**Décision.** La suppression appelle `unlink`, et rien d'autre. Aucun `rmdir`, aucune suppression
récursive, aucun nettoyage d'un dossier parent devenu vide.

**Justification.** `docs/` appartient à la structure du repository, pas au document qui s'y
trouvait. Un dossier vide ne gêne personne ; un dossier supprimé parce qu'il « semblait inutile »
se remarque au prochain `git status`, et pas dans le bon sens. C'est le pendant exact de
[D-064](#d-064--les-dossiers-parents-doivent-exister--nox-nen-crée-aucun) : NOX ne crée aucun
dossier, il n'en supprime aucun non plus.

### D-111 — Les documents `tasks/TASK-xxx.md` sont protégés, dans le runner

**Décision.** La route générique de suppression refuse tout chemin de la forme
`tasks/TASK-<au moins trois chiffres>.md`, quelle que soit la révision fournie. La comparaison
est faite sur le chemin en minuscules.

**Justification.** Ces fichiers ont un propriétaire : la tâche correspondante en base. Les
supprimer depuis la page Documents laisserait une tâche sans artefact, sans que rien ne
l'enregistre. La protection vit dans le runner et non dans l'interface, parce qu'une interface se
contourne. Et la comparaison ignore la casse parce que sous Windows `Tasks/task-001.MD` désigne
le même fichier : une protection sensible à la casse se contournerait par une faute de frappe
volontaire.

Le contrôle porte sur la **forme du chemin**, pas sur l'existence d'une tâche : il vaut donc
aussi pour un `tasks/TASK-999.md` orphelin, dont NOX ne peut pas savoir s'il précède une tâche à
venir ou en suit une disparue.

### D-112 — Une route dédiée pour le document d'une tâche

**Décision.** `POST /repositories/tasks/delete-document` reçoit un **code de tâche**, jamais un
chemin, et compose `tasks/<code>.md` elle-même.

**Justification.** Symétrique de
[D-081](#d-081--le-dossier-tasks-est-la-seule-création-de-dossier-autorisée), et pour la même
raison : c'est la seule route autorisée à toucher aux fichiers que la route générique protège.
Lui confier ce droit n'est acceptable que parce qu'aucun chemin arbitraire n'a de prise sur elle.
Fusionner les deux routes aurait donné une route dont les garanties dépendent d'un drapeau —
exactement ce qu'il ne faut pas pour du code qui supprime sur disque.

### D-113 — Un document absent est une réussite idempotente

**Décision.** Supprimer le document d'une tâche qui n'en a pas retourne
`{ deleted: false, alreadyAbsent: true }`, et non une erreur. Un dossier `tasks/` absent produit
la même réponse, sans être créé.

**Justification.** Une tâche dont la synchronisation a échoué n'a jamais eu de fichier : exiger sa
présence la rendrait indestructible. Le résultat visé est « plus rien à ce chemin », pas « un
fichier de moins ». C'est aussi ce qui rend la reprise possible après un échec en base : relancer
la suppression repasse cette étape sans redemander le fichier.

### D-114 — Un document présent sans révision connue bloque la suppression

**Décision.** Si la tâche n'a pas de révision mais qu'un fichier occupe `tasks/<code>.md`, la
suppression est refusée (`TASK_DOCUMENT_REVISION_UNKNOWN`).

**Justification.** Ce n'est pas un conflit — il n'y a rien qui diffère — c'est une impossibilité
de prouver l'appartenance. NOX n'a jamais écrit ce fichier ; supprimer sur cette base reviendrait
à deviner. Le refus renvoie l'utilisateur vers la seule chose utile : ouvrir le fichier, ou
relancer la synchronisation pour que NOX en connaisse enfin la révision.

### D-115 — Une tâche possédant un historique n'est pas supprimable

**Décision.** `deleteTaskWithoutRuns` refuse dès qu'un run existe, quel que soit son statut —
`QUEUED`, `RUNNING`, `BLOCKED`, `FAILED`, `CANCELLED` ou `COMPLETED`. Aucun run n'est jamais
supprimé.

**Justification.** Une exécution est un fait : elle a consommé du quota, modifié un repository et
produit un compte rendu. Supprimer la tâche emporterait ce compte rendu, ou laisserait des
exécutions orphelines. L'archivage répondra à ce besoin ; la suppression n'en est pas le
brouillon. La règle porte sur l'existence d'un historique, jamais sur son résultat : une
exécution annulée a tout de même eu lieu.

### D-116 — La contrainte double la règle métier

**Décision.** La relation `Run → Task` passe de `Cascade` à `Restrict`, alors que les trois
tables enfant de `Task` restent en `Cascade`.

**Justification.** Un critère d'acceptation n'a aucun sens sans sa tâche ; une exécution, si. La
règle métier produit un message utile, la contrainte tient même si quelqu'un l'ignore et appelle
Prisma directement. Ce n'est pas une redondance : ce sont deux niveaux de défense contre la même
perte, et le second ne dépend d'aucune discipline.

### D-117 — Le numéro d'une tâche supprimée reste réservé

**Décision.** `Project.nextTaskSequence` n'est jamais décrémenté par une suppression.

**Justification.** Prolongement direct de
[D-076](#d-076--les-trous-de-numérotation-sont-acceptés). `TASK-001` a pu circuler dans un
commit, un log ou une conversation ; le réattribuer ferait désigner deux travaux différents par
le même identifiant. Un trou se remarque et ne gêne personne.

### D-118 — Le fichier est supprimé avant la tâche en base

**Décision.** L'ordre est `runner → SQLite`, jamais l'inverse. Un runner injoignable laisse la
base intacte.

**Justification.** L'opération traverse deux systèmes sans transaction commune : l'un échouera un
jour entre les deux étapes, et le choix se résume à quelle incohérence on préfère. Base d'abord
laisse un document orphelin que plus rien ne désigne et qu'aucune reprise ne retrouve. Fichier
d'abord laisse une tâche dont le document a disparu — visible, signalée, et reprenable d'un
second clic grâce à [D-113](#d-113--un-document-absent-est-une-réussite-idempotente). Le second
cas se répare, le premier se découvre des mois plus tard.

Un échec en base après suppression réussie du fichier est rapporté honnêtement. NOX ne recrée
surtout pas le fichier en silence : sa révision différerait de celle enregistrée, et le contrôle
suivant échouerait sans que personne comprenne pourquoi.

### D-119 — La confirmation exige de recopier le code de la tâche

**Décision.** Le bouton final de « Delete task » reste inactif tant que l'utilisateur n'a pas
saisi exactement `TASK-001`. La Server Action vérifie le code de son côté.

**Justification.** Recopier demande de lire ce qu'on supprime, ce qu'un « Êtes-vous sûr ? »
n'obtient de personne. Le verrou côté navigateur est une **commodité** : sans JavaScript le
bouton reste actif, et c'est le serveur qui refuse. C'est aussi pourquoi la vérification arrive
**après** celles de l'historique et du statut — apprendre à quelqu'un qu'il a mal recopié un code
avant de lui dire que la suppression était de toute façon impossible le ferait travailler pour
rien.

### D-120 — Les confirmations sont portées par l'URL, pas par un état de composant

**Décision.** `?confirmDelete=1` ouvre la confirmation, sur la page Documents comme sur celle
d'une tâche. Les boutons qui l'ouvrent et la ferment sont des liens.

**Justification.** Le formulaire est alors rendu par le serveur : il fonctionne sans JavaScript,
« revenir en arrière » est une navigation ordinaire, et l'état de l'interface reste partageable.
Un état local aurait aussi rendu la confirmation invisible à tout test qui ne fait que lire du
HTML — ce qui est précisément ce que fait le test fonctionnel de cette tâche.

### D-121 — L'anglais est limité aux micro-éléments techniques

**Décision.** Passent en anglais les badges de statut, de synchronisation et de priorité, ainsi
que les petites actions compactes (`Edit`, `Save`, `Cancel`, `Delete`, `Retry`, `Approve`,
`Mark ready`, `New run`, `Run Claude Code`). Tout le reste — navigation, titres, descriptions,
avertissements, formulaires, messages d'erreur — reste en français.

**Justification.** Ces étiquettes se lisent d'un coup d'œil, sont courtes, et portent les mêmes
noms que les valeurs internes qu'elles désignent : `READY` s'affiche `Ready`, ce qui rend
l'interface et la base immédiatement rapprochables. Les phrases, elles, doivent rester dans la
langue où l'utilisateur pense la nuance. D'où des mélanges assumés — « État de la tâche : Ready »,
« Priorité : High » — qui sont un choix, pas un oubli de traduction.

`COMPLETED` s'affiche `Done` pour les tâches et `Completed` pour les exécutions : la page d'une
tâche montre les deux côte à côte, et deux pastilles identiques pour « travail accepté » et
« processus terminé » se confondraient.

### D-122 — Un seul module traduit les valeurs internes

**Décision.** `apps/web/lib/labels.ts` contient les cinq fonctions de libellé et les seules tables
de correspondance. `task-display.ts` et `run-display.ts` ne gardent que les tons, les URL et les
formats.

**Justification.** Un second mapping, même minuscule, même dans un composant isolé, finirait par
diverger — et deux pages diraient alors deux choses différentes du même enregistrement. Un ton est
une décision d'affichage propre à un type d'objet ; un libellé est une traduction, et il n'en
existe qu'une par valeur.

Les tables sont déclarées en `Record<Status, …>` : un statut ajouté plus tard ne peut pas passer
inaperçu. Pour les transitions, dont la plupart des paires n'existent pas, l'exhaustivité est
obtenue par un test qui parcourt `allowedTaskStatusTransitions` et exige un libellé explicite
pour chacune.

### D-123 — Les valeurs internes ne changent pas

**Décision.** Aucun identifiant de statut, de priorité ou de synchronisation n'est renommé.
TASK-009 ne touche qu'à l'affichage.

**Justification.** Ces chaînes vivent en base, dans les contrats web ↔ runner, dans les
transitions et dans les documents Markdown déjà générés. Les renommer aurait demandé une
migration de données pour un bénéfice purement cosmétique. Un test le vérifie explicitement, pour
que la prochaine session ne confonde pas « traduire » et « renommer ».

### D-124 — Sortie `stream-json`, avec `--verbose`, sans messages partiels

**Décision.** Claude Code est lancé avec `--output-format stream-json --verbose`.
`--include-partial-messages` n'est pas passé. `--verbose` accompagne `stream-json`, et lui seul :
le format `json` ne l'exige pas et ne le reçoit pas.

**Justification.** `--verbose` n'est pas un choix de confort, c'est une **précondition du
binaire**. Avec `-p`, Claude Code `2.1.223` refuse de démarrer sans lui :

```text
Error: When using --print, --output-format=stream-json requires --verbose
```

`--max-turns`, lui, est bien reconnu par l'analyseur d'arguments bien qu'il n'apparaisse plus dans
`--help`.

`--include-partial-messages` produirait un événement par fragment de token : plusieurs milliers
d'entrées pour un run de deux minutes, dont aucune n'apprendrait plus que le message complet qui
les suit. Un événement par message ou par action suffit à suivre le travail.

**Retour d'expérience — un probe qui n'emprunte pas le vrai chemin ne prouve rien.** La première
version de cette décision affirmait l'inverse : que `stream-json` était accepté **sans**
`--verbose`. Elle s'appuyait sur un probe écrit pendant TASK-010 :

```bash
printf '' | ANTHROPIC_BASE_URL=http://127.0.0.1:1 claude -p --output-format stream-json
```

Ce probe alimentait `stdin` avec une entrée **vide**. Le binaire s'arrêtait alors plus tôt, sur
`Error: Input must be provided either through stdin or as a prompt argument when using --print`,
**sans jamais atteindre** la vérification de `--verbose`. L'absence d'erreur a été lue comme une
acceptation ; ce n'était qu'un arrêt antérieur. Le premier run réel, lui, envoie un vrai prompt,
franchit ce contrôle, et bute sur le suivant.

La leçon vaut au-delà de ce drapeau : **un probe qui court-circuite une étape ne dit rien des
étapes suivantes**, et son silence n'est pas une preuve. Le comportement réel fait autorité. Le
probe corrigé — même commande avec un `stdin` non vide — reproduit fidèlement l'erreur, sans
lancer la moindre requête puisque `ANTHROPIC_BASE_URL` ne mène nulle part.

**Ce que cela écarte.** Un affichage caractère par caractère, façon terminal. NOX affiche des
actions, pas un flux de frappe.

### D-125 — Un parser NDJSON incrémental, et non un découpage par chunk

**Décision.** `stdout` passe par un tampon de lignes dédié : reste incomplet conservé, `\r\n` et
`\n` équivalents, ligne démesurée abandonnée et signalée, dernière ligne sans terminateur rendue
au `flush`.

**Justification.** `stdout` n'est pas une suite de lignes : c'est une suite d'octets qui arrivent
quand le système le décide. Une ligne JSON de 40 Kio peut arriver en douze morceaux, et trois
lignes courtes dans un seul. Traiter chaque `chunk` comme une ligne produirait des JSON coupés au
milieu et des événements perdus — silencieusement, ce qui est le pire.

Le `flush` final n'est pas un détail : beaucoup de programmes n'écrivent pas de retour à la ligne
après leur dernière ligne, et c'est justement le `result` qui serait perdu.

### D-126 — Aucun événement brut ne quitte le runner

**Décision.** Les lignes de `stream-json` ne sont jamais transmises au navigateur, ni telles
quelles, ni résumées. Le runner produit un `ClaudeRunEvent` fermé dont il décide chaque champ.

**Justification.** Une ligne de `stream-json` contient le contenu intégral des fichiers lus, les
entrées et sorties de chaque outil, et les chemins absolus de la machine. Un type fermé, sans
champ libre, rend la règle vérifiable : il n'existe aucun chemin par lequel un fragment d'origine
puisse ressortir. Le contrat partagé revalide chaque événement à chaque frontière — réponse du
runner, ligne relue en base, charge reçue par le navigateur —, et une réponse dont un seul
élément est hors contrat est rejetée entière.

### D-127 — Le raisonnement interne n'a aucune représentation

**Décision.** Les blocs `thinking`, `redacted_thinking`, `reasoning`, `analysis` et tout bloc
portant une `signature` sont ignorés avant d'être lus. Aucun `ClaudeRunEventKind` ne les
représente.

**Justification.** Ce n'est pas un oubli dans l'énumération : c'est le point. Ils ne sont ni
stockés, ni journalisés, ni résumés, ni comptés comme message visible. NOX n'affiche même pas
« Claude réfléchit » — un tel événement serait déjà une information sur un contenu qui ne doit pas
sortir.

La liste des blocs affichables est **fermée** (`text`, `tool_use`) plutôt qu'une liste
d'exclusions. Une liste d'exclusions laisse passer tout ce qu'on n'a pas prévu, et c'est
précisément ce qu'on n'a pas prévu qui est dangereux. Des tests vérifient l'absence d'un faux bloc
`thinking` dans le registre, dans SQLite, dans l'API, dans le HTML et dans le flux SSE.

### D-128 — Une commande n'est affichée que si elle est exactement autorisée

**Décision.** Un appel `Bash` n'est reproduit que s'il correspond mot pour mot à une commande de
validation enregistrée ou à une commande Git en lecture seule. Sinon : « Running an allowed
command ».

**Justification.** La correspondance est stricte parce que l'approximation ne protège de rien :
`npm run test -- --grep MOT_DE_PASSE` n'est pas `npm run test`, et l'afficher exposerait un
argument que personne n'a validé. NOX ne cherche pas à distinguer les cas douteux — il n'affiche
que ce qu'il a lui-même autorisé.

Même logique pour les résultats d'outils : seule l'issue est transmise, jamais la sortie. Un
`tool_result` porte le fichier lu en entier.

### D-129 — Sanitation centralisée, appliquée à toutes les chaînes

**Décision.** Toute chaîne publique passe par un unique nettoyeur : chemins du repository rendus
relatifs, chemins extérieurs masqués, valeurs et noms des variables `NOX_*` retirés, caractères de
contrôle et marques de direction supprimés, taille bornée.

**Justification.** Une fonction de sanitation qu'on applique au cas par cas finit toujours par
être oubliée une fois, et c'est cette fois-là qui compte. Le filtre des secrets porte sur le
préfixe `NOX_` entier plutôt que sur une liste nominative : une variable ajoutée plus tard serait
sinon exposée par oubli, et l'oubli irait dans le mauvais sens.

Les accents, idéogrammes et emoji sont préservés. Un nettoyage qui réduirait tout à l'ASCII
rendrait la moitié des messages illisibles pour un gain de sécurité nul.

### D-130 — Les événements sont bornés, et la troncature est explicite

**Décision.** 2 000 événements ordinaires par exécution, 64 réservés à l'essentiel, 4 Kio par
détail, 2 Mio de texte total, 1 Mio par ligne. Ces valeurs sont constantes et non configurables.
Au-delà, un unique événement `TRUNCATED` est ajouté, puis seuls les statuts, les erreurs et le
résultat final continuent de passer.

**Justification.** Une exécution de deux minutes produit des centaines de lignes ; une exécution
qui part en boucle en produit des centaines de milliers. Ce ne sont pas des réglages de confort :
elles protègent la mémoire du runner, la base et le temps de rendu de la page. Une limite de
sécurité qu'on peut desserrer par variable d'environnement n'en est plus une — d'où l'absence de
variable dans `.env.example`.

Le runner **continue de lire `stdout`** après la troncature. Cesser de lire remplirait le tampon
du système et figerait Claude Code au milieu d'une édition, ce qui serait bien pire qu'une
timeline incomplète.

### D-131 — `RunEvent` en SQLite, sans compteur dénormalisé

**Décision.** Les événements sont persistés dans une table `RunEvent`, avec `runId + sequence`
unique. `Run` gagne un seul champ : `cancellationRequestedAt`.

**Justification.** Le registre du runner est en mémoire : un redémarrage l'efface. Sans cette
table, rouvrir la page d'une exécution passée n'afficherait plus rien de ce qui s'est passé
pendant qu'elle tournait.

`lastEventSequence` sur `Run` a été écarté : il se dérive du `MAX(sequence)` des `RunEvent`, et un
compteur dénormalisé finirait par diverger des lignes qu'il prétend décrire — l'inverse de
l'idempotence recherchée. `cancelledAt` aussi : `finishedAt` avec `status = CANCELLED` dit
exactement la même chose. `cancellationRequestedAt` est le seul des trois qui enregistre un fait
qu'aucune autre colonne ne porte — un humain a décidé d'interrompre.

La relation est en `Cascade`, contrairement à `Run → Task` qui est en `Restrict` : un événement
n'a aucun sens sans son exécution, et la suppression d'une exécution n'existe nulle part dans NOX.

### D-132 — Idempotence par contrainte, pas par confiance

**Décision.** L'insertion filtre les numéros déjà connus dans une transaction, tente l'insertion
groupée, et repasse ligne par ligne si une écriture concurrente a levé la contrainte d'unicité.

**Justification.** `createMany({ skipDuplicates })` aurait été le moyen naturel, mais SQLite ne le
supporte pas sous Prisma. Le chemin lent n'est emprunté que dans le cas concurrent réel.

C'est la contrainte `runId + sequence` qui rend l'insertion idempotente, pas la prudence de
l'appelant : le flux SSE peut rejouer un lot après une reconnexion, deux onglets peuvent persister
les mêmes événements, un rafraîchissement peut tout redemander — aucun de ces cas ne crée de
doublon, sans que personne ait à s'en soucier.

### D-133 — SSE plutôt qu'un WebSocket, avec du polling côté serveur

**Décision.** Le navigateur reçoit les événements par `text/event-stream` depuis un Route Handler
de Next.js, qui interroge le runner côté serveur.

**Justification.** Le flux est à sens unique : le serveur envoie, le navigateur écoute. Un
WebSocket apporterait un canal montant sans usage, une poignée de main à gérer et un protocole de
plus à sécuriser. SSE tient dans un `GET`, traverse les mêmes contrôles d'accès que le reste, et
se reconnecte tout seul.

Le runner, lui, ne pousse rien : son registre est interrogé. La boucle du Route Handler transforme
cette interrogation en flux — c'est du polling côté serveur, mais le navigateur reçoit bien du
temps réel sans ouvrir une requête par seconde. L'écart de complexité avec un vrai canal poussé ne
se justifierait pas pour un outil local à une seule exécution active.

Le navigateur ne parle toujours jamais au runner : le jeton ne quitte pas le serveur.

### D-134 — La persistance précède l'envoi au navigateur

**Décision.** Le flux SSE écrit en base **avant** de pousser au navigateur.

**Justification.** Un événement affiché mais non enregistré disparaîtrait au premier
rafraîchissement, et l'utilisateur croirait avoir mal lu. L'insertion étant idempotente, l'ordre
inverse n'apporterait qu'un affichage imperceptiblement plus rapide contre une incohérence
visible.

### D-135 — Rattrapage des événements à la réouverture de la page

**Décision.** Ouvrir la page d'une exécution récupère du registre tout ce que la base ignore, y
compris pour une exécution déjà terminée.

**Justification.** Découvert par le test fonctionnel. Le flux SSE ne tourne que tant qu'un onglet
est ouvert ; fermer la page pendant une exécution — ce que NOX encourage explicitement — laisse le
runner produire des dizaines d'événements que personne ne lit. Sans rattrapage, rouvrir la page
après coup affichait une timeline qui s'arrêtait au milieu, alors que le runner avait tout gardé
pendant vingt-quatre heures.

Le cas d'une exécution terminée est précisément celui qui en avait le plus besoin : c'est celui où
le flux ne se rouvrira jamais.

### D-136 — Reprise par curseur, jamais par décalage

**Décision.** La reprise utilise `Last-Event-ID` en SSE et `afterSequence` au premier appel, tous
deux comparés à un `sequence` strictement croissant attribué par le runner.

**Justification.** Un décalage se décalerait justement dès qu'un événement s'intercalerait. Le
numéro est produit par le runner et jamais repris de Claude Code : un numéro venu du processus
observé pourrait reculer, se répéter, ou être choisi.

### D-137 — Le polling de statut reste, en repli

**Décision.** `RunPoller` n'est pas supprimé. Le flux SSE le complète ; il ne le remplace pas.

**Justification.** Si le flux échoue — proxy, extension, coupure —, l'utilisateur doit tout de
même apprendre que son exécution s'est terminée. La timeline affiche alors un avertissement discret
et un bouton `Reconnect`, et le polling continue d'assurer le minimum : savoir *si* c'est fini.

### D-138 — Un statut `CANCELLING`, non final

**Décision.** `RUN_STATUS` gagne `CANCELLING`, entre `RUNNING` et les états finaux. La tâche reste
`RUNNING` pendant ce temps.

**Justification.** Sans lui, un clic sur « Cancel run » ne changerait rien à l'écran pendant tout
le délai de grâce, et l'utilisateur cliquerait une seconde fois. Une demande d'arrêt n'est pas un
arrêt constaté : tant que le processus n'a pas fermé, il peut encore écrire dans le repository, et
le traiter comme terminé reviendrait à cesser de le surveiller au moment précis où il faut le
surveiller.

Aucune valeur existante n'a été renommée, conformément à D-123.

### D-139 — Une seule implémentation de l'arrêt de l'arbre

**Décision.** L'annulation appelle exactement la fonction d'arrêt écrite pour le délai maximal de
TASK-008. Aucune seconde logique Windows n'est introduite.

**Justification.** Deux implémentations d'un arrêt de processus divergeraient, et c'est celle qui
n'est pas testée qui tournerait le jour où ça compte. Le registre expose `kill(runId)` ; aucun
identifiant de processus ne circule, et le PID reste dans la fermeture de la fonction d'arrêt,
hors d'atteinte du navigateur.

Si le processus ne ferme pas, NOX ne fait pas semblant : passé un délai, l'exécution est `BLOCKED`
avec `CLAUDE_CANCEL_FAILED`, et le message dit que le processus peut encore vivre. Annoncer
`CANCELLED` pour un processus toujours en train d'écrire serait la pire des réponses.

### D-140 — Le premier état final gagne

**Décision.** Un run `COMPLETED` ne devient jamais `CANCELLED`, et réciproquement. `CANCELLING`
n'étant pas final, une annulation demandée pendant qu'un processus conclut proprement — résultat
complet, code de sortie nul, aucune erreur — laisse le run `COMPLETED`.

**Justification.** L'annulation est alors arrivée trop tard, et le dire autrement effacerait un
résultat réel. Dans tous les autres cas, l'annulation a bien interrompu quelque chose.

Corollaire : un processus tué rend presque toujours une sortie incomplète et un code non nul. Les
diagnostics « sortie illisible » et « échec du processus » sont donc court-circuités quand un
arrêt a été demandé — les signaler pour une interruption volontaire serait trompeur.

### D-141 — Git est capturé après l'arrêt, et rien n'est restauré

**Décision.** L'état Git est relu après toute fin, annulation comprise. Aucun `reset`, aucun
`restore`, aucune suppression de fichier.

**Justification.** Claude Code a pu écrire la moitié d'un fichier avant de mourir. Ce travail
partiel est exactement ce que l'utilisateur doit pouvoir relire pour décider quoi en faire ;
restaurer le détruirait. C'est le prolongement direct de la règle de TASK-008 : NOX constate, il ne
répare pas.

Une **violation Git reste prioritaire**, y compris après une annulation : le run est `FAILED` avec
`GIT_POLICY_VIOLATION` même si un arrêt avait été demandé. L'utilisateur doit apprendre d'abord
qu'un commit interdit existe, et ensuite seulement que le processus a été interrompu.

### D-142 — Un run annulé bloque la tâche

**Décision.** `Run = CANCELLED` fait passer la tâche à `BLOCKED`, jamais à `READY`.

**Justification.** Passer directement à `READY` masquerait l'état partiel du repository et
inviterait à relancer sur un socle inconnu. `BLOCKED → READY` reste une transition manuelle, prise
après avoir regardé `git status` et `git diff` — et NOX le dit en toutes lettres sur la page du
run.

### D-143 — Les confirmations d'annulation vivent dans l'URL

**Décision.** « Cancel run » ouvre une confirmation portée par `?confirmCancel=1`, comme les
suppressions de TASK-009.

**Justification.** Le formulaire est rendu par le serveur : il fonctionne sans JavaScript, « Keep
running » est une navigation ordinaire, et le test fonctionnel peut le vérifier en ne lisant que
du HTML. En `CANCELLING`, plus rien n'est proposé — ni bouton grisé, ni lien — et une explication
française prend la place : un bouton inactif sans raison visible se lit comme une panne.

### D-144 — Aucun vrai Claude Code dans les tests automatisés

**Décision.** Le faux Claude est étendu avec six modes `stream-json` : session complète, session
lente avec processus enfant, flux hostile (bloc `thinking`, chemin absolu, secret, caractères de
contrôle), flux abîmé (JSON invalide, tableau, primitive, CRLF, ligne coupée, dernière ligne sans
terminateur), sortie énorme, flux sans résultat.

**Justification.** Aucun test ne doit consommer de quota, dépendre du réseau ou devenir
non reproductible. Le processus enfant du mode lent n'est pas décoratif : il prouve que l'arrêt
descend bien l'arbre, ce qu'un test sur le seul parent ne montrerait pas.

La course entre la fin et l'annulation est testée avec un lanceur **contrôlable** — les tests
décident quand les morceaux de `stdout` arrivent et quand le processus ferme. Avec un vrai
processus, cette course ne serait jamais déterministe.
