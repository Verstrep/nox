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
