# PROJECT_STATE — État réel du projet

> Ce document décrit ce qui existe **réellement** dans le repository, pas ce qui est prévu.
> Il est mis à jour à la fin de chaque tâche.

**Dernière mise à jour** : 5 août 2026, à l'issue de `TASK-004`.

---

## 1. Phase actuelle

**NOX lit le contenu des projets.** Après avoir su enregistrer un repository et parler au runner,
NOX sait maintenant inventorier et afficher les documents Markdown de référence d'un projet, en
lecture seule.

Étape correspondante dans la [roadmap](ROADMAP.md) : **étape 4 — inventaire et lecture des
documents Markdown (terminée)**. L'étape 5 (création et édition des documents) devient l'étape
active.

## 2. Tâche active

`TASK-004 — Inventaire et lecture des documents Markdown` : **terminée**, en attente de review
humaine.

Aucun commit ni push n'a été effectué par Claude Code. Les modifications sont locales et
disponibles pour relecture.

## 3. Éléments terminés

### 3.1 Contrat partagé — `packages/shared/src/documents.ts` (nouveau)

- `ProjectDocumentSummary`, `ProjectDocumentContent`, requêtes et réponses des deux routes.
- `ProjectDocumentCategory` : `CORE`, `DOCUMENTATION`, `DECISION`, `PLAN`, `TASK`.
- Validateurs légers, sans bibliothèque de schémas.
- 14 nouveaux codes d'erreur ajoutés à `RUNNER_ERROR` (29 au total), toujours déclarés une seule
  fois pour les deux côtés.

### 3.2 API du runner

| Route | Méthode | Auth | Statuts |
| --- | --- | --- | --- |
| `/repositories/documents/list` | `POST` | `Bearer` | `200`, `400`, `401`, `405`, `413`, `415`, `422`, `500` |
| `/repositories/documents/read` | `POST` | `Bearer` | `200`, `400`, `401`, `403`, `404`, `405`, `413`, `415`, `422`, `500` |

Les deux routes réutilisent l'authentification, la limite de corps (32 Kio), l'identifiant de
requête, la sérialisation et la journalisation sûre mises en place à TASK-003. Le préambule
commun (authentifier → lire le corps → valider) a été factorisé dans `server.ts` plutôt que
triplé.

### 3.3 Logique documents — `apps/runner/src/repositories/documents/`

- `constants.ts` — périmètre inspecté, exclusions, limites.
- `categories.ts` — catégorisation et tri, fonctions pures.
- `paths.ts` — normalisation et confinement des chemins.
- `repository-root.ts` — vérification du repository enregistré.
- `list-documents.ts` — inventaire, sans lecture de contenu.
- `read-document.ts` — lecture UTF-8 stricte, taille vérifiée avant lecture.

Aucun de ces modules ne connaît HTTP.

### 3.4 Sécurité des chemins

Vérifications appliquées, dans cet ordre :

1. chemin non vide, sans octet nul ;
2. refus des schémas d'URL — ce qui écarte aussi `C:\...` ;
3. refus des chemins absolus POSIX et Windows ;
4. refus de tout segment `..` ;
5. normalisation en séparateurs `/` ;
6. extension `.md` obligatoire, sans distinction de casse ;
7. emplacement autorisé (racine reconnue ou dossier inspecté) ;
8. `realpath` de la racine **et** du fichier, puis confinement vérifié par `path.relative`.

Les liens ne sont jamais suivis pendant la découverte. À la lecture, ils sont résolus puis le
confinement est vérifié : un lien sortant est rejeté (`DOCUMENT_OUTSIDE_REPOSITORY`).

Aucun chemin absolu ne figure dans une réponse : le contrat ne transporte que des chemins
relatifs, ce que vérifient trois tests distincts.

### 3.5 Client runner et interface

- `listProjectDocuments()` et `readProjectDocument()` ajoutées au client serveur ; le préambule
  commun aux trois appels authentifiés est factorisé.
- `lib/documents.ts` — chargement pour les Server Components, avec `connection()`.
- `/projects/[id]/documents` — liste à gauche, lecteur à droite, sélection portée par l'URL.
- Contenu affiché dans un `<pre>`, sans rendu HTML ni `dangerouslySetInnerHTML`.
- La carte « Documents » de `/projects/[id]` affiche le nombre de documents ou l'indisponibilité
  du runner, et mène à la page. Les trois autres cartes restent « À venir ».
- Une panne du runner ne fait jamais échouer `/projects/[id]` : les données SQLite s'affichent.

### 3.6 Validations exécutées

| Commande | Résultat |
| --- | --- |
| `npm install` | Succès — aucune dépendance ajoutée par TASK-004 |
| `npm run test` | Succès — **207 tests, 39 suites, 0 échec, 1 ignoré** |
| `npm run lint` | Succès — aucune erreur, aucun avertissement |
| `npm run typecheck` | Succès — les quatre workspaces |
| `npm run build` | Succès — `/projects/[id]/documents` rendue à la demande |
| Test fonctionnel complet | Succès — voir § 3.7 |

Le test ignoré est la création d'un lien symbolique **de fichier**, qui exige le mode
développeur sous Windows. Le cas de sécurité équivalent est couvert par des **jonctions**, qui
ne demandent aucun privilège : les scénarios d'évasion s'exécutent donc réellement.

### 3.7 Test fonctionnel réellement exécuté

Repository Git temporaire contenant `README.md`, `CLAUDE.md`, `docs/PROJECT_BRIEF.md`,
`docs/nested/NOTE.md`, `decisions/ADR-001.md`, `tasks/TASK-001.md`, un PNG, un Markdown hors
périmètre (`src/`) et un fichier de 2 Mio.

| Phase | Vérification | Résultat |
| --- | --- | --- |
| API | Inventaire sans jeton → `401` | ✅ |
| API | Inventaire avec jeton → `200`, ordre et catégories conformes | ✅ |
| API | PNG et Markdown hors périmètre absents de l'inventaire | ✅ |
| API | Aucun chemin absolu dans la réponse | ✅ |
| API | `../../secret.md`, `docs/../../secret.md`, `..\..\secret.md` → `400 DOCUMENT_PATH_INVALID` | ✅ |
| API | Chemin absolu → refusé | ✅ |
| API | Document de 2 Mio → `413 DOCUMENT_TOO_LARGE` | ✅ |
| API | `src/HORS_PERIMETRE.md` → `DOCUMENT_NOT_ALLOWED` | ✅ |
| Interface | Enregistrement du repository → `303` | ✅ |
| Interface | Carte Documents : « 7 document(s) » + bouton | ✅ |
| Interface | Liste complète, PNG et hors-périmètre absents | ✅ |
| Interface | Lecture d'un document de **chaque** catégorie, contenu brut correct | ✅ |
| Interface | `# Brief` visible, aucun `<h1>` généré | ✅ |
| Interface | Aucun chemin absolu, aucun jeton dans la page | ✅ |
| Interface | Document absent / traversée / trop volumineux → messages compréhensibles | ✅ |
| **Runner arrêté** | `/projects/[id]` → `200`, données SQLite affichées | ✅ |
| **Runner arrêté** | Carte Documents explique l'indisponibilité | ✅ |
| **Runner arrêté** | Page Documents → `200`, bandeau d'erreur actionnable | ✅ |
| **Runner arrêté** | Ni jeton, ni `ECONNREFUSED` dans la page | ✅ |

Nettoyage : le projet de test a été supprimé de `data/nox-dev.db` et le repository temporaire
effacé. Le projet préexistant de l'utilisateur (`Icon dungeon`) n'a pas été touché. Aucun
repository réel n'a été lu ni modifié.

### 3.8 Vérification d'absence d'accès disque dans le web

Recherche de `node:fs`, `node:path` et `node:child_process` dans `apps/web` : deux occurrences
seulement, toutes deux hors périmètre applicatif —

- `next.config.ts` : chargement du `.env` racine, configuration de Next.js ;
- `lib/runner/integration.test.ts` : création de fixtures temporaires par un test.

Aucun module applicatif n'inspecte de repository.

## 4. Éléments non commencés

- Écriture des documents : création, édition, sauvegarde, suppression, renommage.
- Rendu HTML du Markdown, recherche plein texte, historique, diff.
- Surveillance du système de fichiers, synchronisation temps réel.
- Édition, suppression, archivage d'un projet et changement de statut.
- Backlog de tâches : aucun modèle `Task`, aucun écran.
- Exécution de commandes par le runner, intégration Claude Code CLI.
- Streaming de logs : ni SSE ni WebSocket.
- Intégration OpenAI, suivi des coûts.
- Authentification utilisateur, multi-utilisateur, déploiement.

## 5. Blocages connus

**Aucun blocage.** Toutes les validations passent.

## 6. Dette technique et limites

1. **Périmètre d'inspection figé.** Un projet rangeant sa documentation ailleurs que dans
   `docs/`, `decisions/`, `plans/` ou `tasks/` n'affichera rien. Rendre la liste configurable
   par projet est l'évolution naturelle
   ([D-041](DECISIONS.md#d-041--emplacements-inspectés-limités-pas-de-parcours-complet)).
2. **Au-delà de 500 documents, l'inventaire est refusé** plutôt que tronqué : le contrat ne
   comporte pas de champ « tronqué »
   ([D-044](DECISIONS.md#d-044--limites-explicites--1-mio-500-documents-profondeur-6)).
3. **Ordre de la catégorie `CORE`.** Le tri alphabétique insensible à la casse place
   `docs/ARCHITECTURE.md` avant `README.md` : les documents racine ne sont pas regroupés en
   tête. Conforme au tri demandé, mais un ordre éditorial serait plus lisible
   ([D-043](DECISIONS.md#d-043--tri-par-catégorie-puis-par-chemin-insensible-à-la-casse)).
4. **Aucun cache.** Chaque affichage réinterroge le runner. Le coût est négligeable en local et
   garantit que l'affichage reflète le disque
   ([D-049](DECISIONS.md#d-049--aucune-copie-des-documents-en-base)).
5. **Pas de test de rendu React.** Couverture assurée par les tests unitaires, le test
   d'intégration réel et le test fonctionnel HTTP.
6. **Un test ignoré sous Windows** : lien symbolique de fichier (privilège requis). Le cas
   d'évasion est couvert par jonction.
7. Limites héritées : pré-contrôle d'unicité non atomique, jeton en clair dans `.env`, runner
   unique, indicateur de disponibilité non temps réel, TypeScript 5.9 et ESLint 9 figés,
   Node ≥ 22.18 requis.

## 7. Prochaine tâche recommandée

**`TASK-005` — Création et édition des documents Markdown.**

Objectif : permettre d'écrire depuis NOX les documents Markdown d'un projet — modifier un
document existant et en créer un nouveau dans un emplacement autorisé — en réutilisant le
confinement des chemins déjà en place et en ajoutant les garanties propres à l'écriture.

## 8. État Git

- Aucun commit créé par Claude Code.
- Aucun push effectué.
- Historique Git non modifié.
- Commit de départ : `10f4fba` (`feat: connect web to local runner`), répertoire de travail
  propre avant l'intervention.
- Les modifications de `TASK-004` sont locales, non indexées, disponibles pour review.
