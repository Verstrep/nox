# PROJECT_STATE — État réel du projet

> Ce document décrit ce qui existe **réellement** dans le repository, pas ce qui est prévu.
> Il est mis à jour à la fin de chaque tâche.

**Dernière mise à jour** : 4 août 2026, à l'issue de `TASK-003`.

---

## 1. Phase actuelle

**L'architecture cible est en place.** L'application web et le runner local sont deux processus
séparés qui communiquent par HTTP authentifié sur la boucle locale. Le runner est désormais la
frontière unique avec la machine : Git ne s'exécute plus nulle part ailleurs.

Étape correspondante dans la [roadmap](ROADMAP.md) : **étape 3 — connexion web ↔ runner
(terminée)**. L'étape 4 (documents Markdown) devient l'étape active.

## 2. Tâche active

`TASK-003 — Connecter le web au runner local` : **terminée**, en attente de review humaine.

Aucun commit ni push n'a été effectué par Claude Code. Les modifications sont locales et
disponibles pour relecture.

## 3. Éléments terminés

### 3.1 Contrat partagé — `packages/shared/src/runner.ts` (nouveau)

- Formes de messages : `RunnerHealthResponse`, `ResolveRepositoryRequest`,
  `ResolveRepositorySuccess`, `RunnerErrorResponse`.
- 15 codes d'erreur stables, déclarés une seule fois et consommés des deux côtés.
- Validateurs légers : `parseResolveRepositoryRequest`, `isRunnerHealthResponse`,
  `isRunnerErrorResponse`, `isResolveRepositorySuccess`. Aucune bibliothèque de schémas.
- Le contrat ne transporte **que des codes** : aucun texte destiné à l'utilisateur.

### 3.2 API du runner — `apps/runner`

| Route | Méthodes | Authentification | Statuts |
| --- | --- | --- | --- |
| `/health` | `GET`, `HEAD` | aucune | `200`, `405` |
| `/repositories/resolve` | `POST` | `Bearer` obligatoire | `200`, `400`, `401`, `405`, `413`, `415`, `422`, `500`, `503`, `504` |
| toute autre | — | — | `404` (`ROUTE_NOT_FOUND`) |

- Configuration validée au démarrage : hôte de boucle locale obligatoire, port entier valide,
  jeton obligatoire. Toute violation empêche le démarrage avec un message actionnable.
- Corps JSON limité à 32 Kio, `Content-Type: application/json` exigé, délai de 5 s sur un corps
  incomplet, lecture interrompue dès dépassement de la limite.
- Identifiant de requête court (`x-request-id`), présent aussi dans les logs.
- Arrêt propre sur `SIGINT` / `SIGTERM`, inchangé depuis TASK-001.

Organisation : `index.ts` (démarrage), `config.ts`, `server.ts` (routage, testable sans port
fixe), `http/{auth,body,responses}.ts`, `repositories/resolve-repository.ts`.

### 3.3 Client runner — `apps/web/lib/runner/` (nouveau)

- `checkRunnerHealth()` et `resolveRepositoryPath()`, rien de plus.
- Strictement serveur : aucune variable `NEXT_PUBLIC_*`, et une erreur immédiate si le module
  est évalué avec un `window` défini.
- Timeout de 8 s via `AbortController`, distinguant dépassement de délai et absence de connexion.
- Toute réponse est validée contre le contrat partagé avant utilisation.
- Échecs typés : `not_configured`, `unreachable`, `timeout`, `unauthorized`,
  `invalid_response`, `runner_error(code)`. `describeRunnerFailure` en donne la formulation
  française — un code non traduit casserait le typecheck.

### 3.4 Migration de la validation Git

Retiré de `apps/web` :

- `lib/repository-path.ts` et `lib/repository-path.test.ts` — **supprimés** ;
- tout appel à `node:child_process` ; `apps/web` n'exécute plus aucun processus.

Déplacé dans `apps/runner/src/repositories/resolve-repository.ts`, à l'identique côté garanties :
`execFile` sans shell, délai maximal, aucune lecture de fichier du repository, aucune commande
Git modifiante, normalisation par `fs.realpathSync.native()`.

Conservé dans `apps/web` : nom obligatoire, longueur de description, champ chemin non vide,
unicité en base, traduction des erreurs Prisma.

L'exception d'architecture ouverte par TASK-002 est **close** — voir
[ARCHITECTURE.md § 5.2](ARCHITECTURE.md).

### 3.5 Interface

- Indicateur **Runner disponible / Runner indisponible**, calculé au rendu serveur, présent sur
  le tableau de bord et sur la page de création. Aucun sondage navigateur.
- Runner arrêté : la liste des projets, les pages projet et le formulaire restent accessibles.
  Seule la soumission échoue, avec un message expliquant qu'il faut démarrer le runner.
- Une panne du runner s'affiche dans le bandeau du formulaire ; une erreur de saisie s'affiche
  sous le champ concerné.

### 3.6 Configuration et outillage

- `.env` unique à la racine, lu par les trois processus : le runner et Prisma via
  `process.loadEnvFile`, l'application web via `apps/web/next.config.ts`. Les variables du shell
  restent prioritaires (comportement vérifié).
- Nouveau script racine `npm run runner:health`.
- `.env.example` documente `NOX_RUNNER_TOKEN` et deux commandes de génération, dont une variante
  PowerShell native testée sur cette machine.

### 3.7 Validations exécutées

| Commande | Résultat |
| --- | --- |
| `npm install` | Succès — aucune dépendance ajoutée par TASK-003 |
| `npm run test` | Succès — **99 tests, 21 suites, 0 échec** |
| `npm run lint` | Succès — aucune erreur, aucun avertissement |
| `npm run typecheck` | Succès — les quatre workspaces |
| `npm run build` | Succès — `/`, `/projects/new` et `/projects/[id]` dynamiques |
| `npm run runner:health` | Succès — détecte correctement runner arrêté et runner démarré |
| Test fonctionnel complet | Succès — voir § 3.8 |

Répartition des tests : 56 pour le runner (configuration, authentification, couche HTTP,
résolution Git), 43 pour le web et la persistance (client runner, intégration réelle
web → runner, validation métier, base SQLite).

### 3.8 Test fonctionnel réellement exécuté

Scénario complet joué contre les serveurs de production (`next start` + runner compilé), le
formulaire étant soumis par POST multipart — le chemin réel de la Server Action.

| Phase | Vérification | Résultat |
| --- | --- | --- |
| API runner | `/health` répond, contrat respecté, aucun jeton divulgué | ✅ |
| API runner | Route protégée sans jeton → `401` | ✅ |
| API runner | Route protégée avec mauvais jeton → `401` | ✅ |
| API runner | Route protégée avec le bon jeton → `200` | ✅ |
| API runner | Sous-dossier ramené à la racine Git | ✅ |
| API runner | Route inconnue → `404` | ✅ |
| Runner démarré | Indicateur « Runner disponible » | ✅ |
| Runner démarré | Aucune page n'expose le jeton | ✅ |
| Runner démarré | Création de projet → `303` vers la page projet | ✅ |
| Runner démarré | Racine Git résolue affichée sur la page projet | ✅ |
| **Runner arrêté** | Tableau de bord → `200`, projets consultables | ✅ |
| **Runner arrêté** | Indicateur « Runner indisponible » | ✅ |
| **Runner arrêté** | Page projet et formulaire → `200` | ✅ |
| **Runner arrêté** | Soumission → message d'indisponibilité, sans jeton ni `ECONNREFUSED` | ✅ |
| **Runner arrêté** | Valeurs du formulaire conservées | ✅ |
| Runner redémarré | Indicateur repasse à « Runner disponible » | ✅ |
| Runner redémarré | Création de projet fonctionne de nouveau | ✅ |
| Runner redémarré | Détection de doublon toujours fonctionnelle | ✅ |

Contrôles de configuration vérifiés séparément au démarrage réel : `NOX_RUNNER_HOST=0.0.0.0`
refusé, `NOX_RUNNER_TOKEN` absent refusé — les deux avec code de sortie `1`.

Nettoyage : les deux projets de test ont été supprimés de `data/nox-dev.db` et les repositories
Git temporaires effacés. Le projet préexistant de l'utilisateur n'a pas été touché. Aucun
repository réel n'a été modifié.

## 4. Éléments non commencés

- Lecture et écriture de fichiers Markdown, liste des documents d'un projet.
- Édition, suppression, archivage d'un projet et changement de statut.
- Backlog de tâches : aucun modèle `Task`, aucun écran.
- Exécution de commandes arbitraires par le runner, intégration Claude Code CLI.
- Streaming de logs : ni SSE ni WebSocket.
- Intégration OpenAI, suivi des coûts et des limites d'utilisation.
- Runners multiples, communication distante, HTTPS.
- Authentification utilisateur, multi-utilisateur, déploiement.

## 5. Blocages connus

**Aucun blocage.** Toutes les validations passent.

## 6. Dette technique et limites

1. **Le jeton est stocké en clair dans `.env`.** C'est le compromis normal pour un outil local :
   un trousseau système ajouterait une dépendance et une complexité de configuration sans
   changer le modèle de menace, puisque le processus doit de toute façon lire le secret.
2. **Le jeton ne tourne pas.** Le changer suppose d'éditer `.env` et de redémarrer les deux
   processus. Acceptable pour un usage personnel ; à revoir si NOX devient partagé.
3. **Un seul runner, une seule URL.** `NOX_RUNNER_URL` est globale : NOX ne sait pas piloter
   plusieurs machines. Explicitement hors périmètre de la V1.
4. **L'indicateur de disponibilité n'est pas temps réel.** Il reflète l'état au chargement de la
   page. Démarrer le runner ne met pas l'onglet à jour tant qu'on ne navigue pas.
5. **Pré-contrôle d'unicité non atomique**, inchangé depuis TASK-002 : la contrainte `@unique`
   reste le filet.
6. **Aucun test de rendu React.** Couverture assurée par les tests unitaires et par le test
   fonctionnel HTTP.
7. **Le test d'intégration importe le runner par chemin relatif.** `apps/web` ne déclare pas
   `@nox/runner` en dépendance — et ne doit pas le faire, la communication devant rester HTTP.
   L'entorse est limitée à ce fichier de test et commentée sur place.
8. **TypeScript figé en 5.9 et ESLint en 9.x**, inchangé depuis TASK-001.
9. **Node ≥ 22.18 requis** pour `npm run dev:runner` et `npm run test` (type stripping natif),
   et pour `--env-file-if-exists` utilisé par `npm run runner:health`.

## 7. Prochaine tâche recommandée

**`TASK-004` — Gestion des documents Markdown d'un projet.**

Objectif : lire et modifier depuis NOX les documents Markdown de référence présents dans le
repository d'un projet, en remplissant la section « Documents » aujourd'hui vide de la page
projet. Les fichiers seront lus et écrits par le runner, via de nouvelles routes authentifiées.

## 8. État Git

- Aucun commit créé par Claude Code.
- Aucun push effectué.
- Historique Git non modifié.
- Commit de départ : `3511209` (`feat: add local project management`), répertoire de travail
  propre avant l'intervention.
- Les modifications de `TASK-003` sont locales, non indexées, disponibles pour review.
- Un fichier `.env` a été créé à la racine pour le test fonctionnel. Il est ignoré par Git et
  contient un jeton aléatoire généré localement.
