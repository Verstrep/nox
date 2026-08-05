# PROJECT_STATE — État réel du projet

> Ce document décrit ce qui existe **réellement** dans le repository, pas ce qui est prévu.
> Il est mis à jour à la fin de chaque tâche.

**Dernière mise à jour** : 5 août 2026, à l'issue de `TASK-005`.

---

## 1. Phase actuelle

**NOX écrit dans les projets.** Après avoir su enregistrer un repository, parler au runner et
lire les documents Markdown, NOX sait maintenant en **modifier** un — sans jamais écraser
silencieusement une version changée entre-temps sur le disque.

Étape correspondante dans la [roadmap](ROADMAP.md) : **étape 5 — édition sécurisée d'un document
existant (terminée)**. L'étape 6 (création de documents) devient l'étape active.

## 2. Tâche active

`TASK-005 — Édition sécurisée d'un document Markdown existant` : **terminée**, en attente de
review humaine.

Aucun commit ni push n'a été effectué par Claude Code. Les modifications sont locales et
disponibles pour relecture.

## 3. Éléments terminés

### 3.1 Contrat partagé — `packages/shared/src/documents.ts`

- `ProjectDocumentRevision` et `isProjectDocumentRevision` : empreinte SHA-256 hexadécimale.
- `ProjectDocumentContent` porte désormais `revision` en plus de `content`.
- `UpdateProjectDocumentRequest` / `UpdateProjectDocumentSuccess`,
  `parseUpdateProjectDocumentRequest`, `isUpdateProjectDocumentSuccess`.
- 7 nouveaux codes d'erreur dans `RUNNER_ERROR` (36 au total) : `DOCUMENT_REVISION_REQUIRED`,
  `DOCUMENT_REVISION_INVALID`, `DOCUMENT_CONFLICT`, `DOCUMENT_CONTENT_INVALID`,
  `DOCUMENT_SYMLINK_NOT_WRITABLE`, `DOCUMENT_TEMPORARY_FILE_FAILED`, `DOCUMENT_WRITE_FAILED`.

Une réponse dont la révision est absente ou mal formée est rejetée par le client : sans elle, la
protection contre les conflits serait inopérante.

### 3.2 API du runner

| Route | Méthode | Auth | Statuts |
| --- | --- | --- | --- |
| `/repositories/documents/list` | `POST` | `Bearer` | `200`, `400`, `401`, `405`, `413`, `415`, `422`, `500` |
| `/repositories/documents/read` | `POST` | `Bearer` | `200`, `400`, `401`, `403`, `404`, `405`, `413`, `415`, `422`, `500` |
| `/repositories/documents/update` | `POST` | `Bearer` | `200`, `400`, `401`, `403`, `404`, `405`, `409`, `413`, `415`, `422`, `500` |

La route d'écriture est la seule dont le corps transporte un document entier : sa limite est de
**4 Mio** au lieu des 32 Kio des routes qui n'échangent que des chemins. Elle reste une limite,
et couvre l'expansion d'un document de 1 Mio une fois encodé en JSON.

### 3.3 Logique d'écriture — `apps/runner/src/repositories/documents/`

- `revisions.ts` — calcul et validation de l'empreinte SHA-256, sans accès au disque.
- `line-endings.ts` — détection et réapplication de la convention du fichier, fonctions pures.
- `safe-write.ts` — temporaire du même dossier, `fsync`, remplacement, nettoyage. Trois points
  d'injection permettent aux tests de faire échouer précisément une étape.
- `update-document.ts` — enchaînement métier, indépendant de HTTP.

`paths.ts` expose désormais `candidatePath`, le chemin **avant** résolution des liens :
`absolutePath`, déjà passé par `realpath`, ne peut par construction plus signaler un lien.

`read-document.ts` renvoie la révision et décode avec `ignoreBOM: true`, ce qui conserve un BOM
existant au lieu de le retirer en silence.

### 3.4 Protection contre les conflits

1. Chaque lecture renvoie l'empreinte SHA-256 des octets du fichier.
2. Le formulaire d'édition la transporte dans un champ caché.
3. À l'écriture, le runner **relit les octets** et recalcule l'empreinte.
4. Si elle diffère de celle attendue → `DOCUMENT_CONFLICT`, `409`, aucune écriture.

L'empreinte porte sur le contenu, jamais sur `mtime` ni sur `size` : une correction à taille
constante — un mot remplacé par un autre de même longueur — échapperait aux deux.

Aucun bouton de forçage n'existe. L'interface propose de recharger la version actuelle, et
conserve le texte saisi.

### 3.5 Sécurité de l'écriture

Contrôles appliqués, dans cet ordre :

1. format de la révision, avant tout accès au disque ;
2. refus d'un contenu contenant un demi-caractère Unicode isolé, inencodable en UTF-8 ;
3. repository existant et réel ;
4. confinement du chemin — **le même code qu'en lecture**, jamais une seconde logique ;
5. `lstat` sur le chemin non résolu : un lien symbolique est refusé, même confiné ;
6. taille du fichier existant vérifiée avant lecture ;
7. comparaison de révision ;
8. taille du nouveau contenu, en octets UTF-8 ;
9. second contrôle de lien, au plus près de l'écriture ;
10. écriture sûre sur le chemin **réel** résolu, qu'un lien créé entre-temps ne détourne pas.

### 3.6 Client runner, Server Action et interface

- `updateProjectDocument()` ajoutée au client serveur, sur le même envoi authentifié que les
  trois autres appels.
- `isDocumentConflict()` distingue le conflit des autres échecs : l'interface propose alors de
  recharger plutôt que de réessayer.
- `lib/document-edit.ts` — logique du formulaire, sans Prisma, sans Next.js, sans React, donc
  directement testable.
- `app/projects/[id]/documents/actions.ts` — Server Action : elle relit le projet en base et
  n'accepte **aucun chemin absolu** du navigateur.
- `DocumentEditor.tsx` — Client Component colocalisé : zone de texte monospace, état de
  soumission, confirmation à l'annulation si le texte a changé, `beforeunload`.
- La page porte deux modes par l'URL : `?path=…` en lecture, `?path=…&edit=1` en édition,
  `?path=…&saved=1` après enregistrement.

Le bouton **Modifier** n'apparaît que si le document a réellement été lu — ce qui couvre d'un
seul test le runner arrêté, le document absent et l'erreur de lecture.

### 3.7 Validations exécutées

| Commande | Résultat |
| --- | --- |
| `npm install` | Succès — aucune dépendance ajoutée par TASK-005 |
| `npm run test` | Succès — **337 tests, 63 suites, 0 échec, 2 ignorés** |
| `npm run lint` | Succès — aucune erreur, aucun avertissement |
| `npm run typecheck` | Succès — les quatre workspaces |
| `npm run build` | Succès — `/projects/[id]/documents` rendue à la demande |
| Test fonctionnel complet | Succès — voir § 3.8 |

Les deux tests ignorés portent sur la création d'un lien symbolique **de fichier**, qui exige le
mode développeur sous Windows — vérifié par sonde : `EPERM`. Les mêmes garanties sont couvertes
par des **jonctions**, qui ne demandent aucun privilège : le refus d'écrire dans un lien et
l'évasion hors du repository sont donc réellement exercés.

### 3.8 Test fonctionnel réellement exécuté

Repository Git temporaire contenant `README.md`, `docs/PROJECT_BRIEF.md`, `docs/OTHER.md` et
`docs/CRLF.md` (volontairement en CRLF). Runner démarré depuis `dist/`, web démarré en **mode
production** (`next start`).

| Phase | Vérification | Résultat |
| --- | --- | --- |
| API | Lecture → révision SHA-256 présente, aucun chemin absolu | ✅ |
| API | Écriture sans jeton → `401`, fichier inchangé | ✅ |
| API | Écriture valide → `200`, nouvelle révision, contenu sur le disque | ✅ |
| API | `docs/OTHER.md` et `README.md` intacts | ✅ |
| API | Relecture : contenu et révision cohérents | ✅ |
| API | Révision périmée → `409 DOCUMENT_CONFLICT`, disque non écrasé | ✅ |
| API | Contenu vide accepté, puis restauré | ✅ |
| API | Fichier CRLF réenregistré en CRLF | ✅ |
| API | Traversées `..`, chemin absolu, `.txt`, hors périmètre, inexistant → refusés | ✅ |
| API | Révision absente / mal formée → `400` avec codes distincts | ✅ |
| API | Contenu > 1 Mio → `413 DOCUMENT_TOO_LARGE`, fichier inchangé | ✅ |
| API | Aucun fichier créé, supprimé, ni temporaire résiduel | ✅ |
| API | Aucune fuite de jeton ni de chemin absolu | ✅ |
| Interface | Enregistrement du repository → `303` | ✅ |
| Interface | Mode lecture : contenu brut, aucun `<h1>` généré, bouton Modifier | ✅ |
| Interface | Mode édition : zone de texte, révision en champ caché, **aucun champ `repositoryPath`** | ✅ |
| Interface | Enregistrement (contenu soumis en CRLF) → fichier écrit en LF | ✅ |
| Interface | Nouveau contenu affiché, message de réussite | ✅ |
| **Conflit réel** | Fichier modifié sur le disque pendant l'édition → refus, message clair | ✅ |
| **Conflit réel** | Texte saisi conservé, modification externe préservée | ✅ |
| Interface | Traversée `../../secret.md` via le formulaire → refus, aucun fichier créé | ✅ |
| Interface | `projectId` inconnu → refus, aucun document touché | ✅ |
| **Runner arrêté** | Page d'édition → `200`, bandeau, aucune zone de texte, aucun jeton | ✅ |
| **Runner arrêté** | Page projet → `200`, données SQLite affichées | ✅ |
| **Runner arrêté** | Enregistrement → message d'indisponibilité, **texte conservé**, fichier intact | ✅ |
| Final | Aucun fichier ajouté, supprimé ou temporaire dans le dépôt de test | ✅ |

Nettoyage : le projet de test a été supprimé de `data/nox-dev.db`, le repository temporaire
effacé, le web et le runner arrêtés. Les projets préexistants de l'utilisateur (`Icon dungeon`,
`NOX`) n'ont pas été touchés. Aucun repository réel n'a été modifié.

## 4. Éléments non commencés

- Création, suppression, renommage et déplacement de documents.
- Aperçu Markdown rendu, recherche plein texte, historique, diff visuel.
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

1. **Le remplacement de fichier n'est pas garanti atomique sous Windows.** La garantie réelle
   est « jamais de contenu partiel » : `MoveFileEx` échoue proprement si un autre processus tient
   la cible ouverte, et le document conserve alors son contenu d'origine
   ([D-056](DECISIONS.md#d-056--écriture-par-fichier-temporaire-et-remplacement)).
2. **Fenêtre de concurrence résiduelle** entre la relecture des octets et le remplacement. Elle
   se compte en millisecondes sur un outil local mono-utilisateur ; la fermer demanderait un
   verrou, écarté pour de bonnes raisons
   ([D-053](DECISIONS.md#d-053--contrôle-de-concurrence-optimiste-pas-de-verrou)).
3. **`beforeunload` ne couvre pas la navigation interne de Next.js.** Cliquer sur un autre
   document dans la liste pendant une édition non enregistrée perd le texte sans avertissement.
   Seuls les boutons Annuler et « Recharger » demandent confirmation.
4. **Les fins de ligne d'un fichier mixte sont uniformisées** vers la convention majoritaire, LF
   à égalité ([D-057](DECISIONS.md#d-057--utf-8-conservé-bom-préservé-fins-de-ligne-alignées-sur-le-fichier)).
5. **Périmètre d'inspection figé.** Un projet rangeant sa documentation ailleurs que dans
   `docs/`, `decisions/`, `plans/` ou `tasks/` n'affichera — et ne modifiera — rien
   ([D-041](DECISIONS.md#d-041--emplacements-inspectés-limités-pas-de-parcours-complet)).
6. **Au-delà de 500 documents, l'inventaire est refusé** plutôt que tronqué
   ([D-044](DECISIONS.md#d-044--limites-explicites--1-mio-500-documents-profondeur-6)).
7. **Ordre de la catégorie `CORE`.** Le tri alphabétique insensible à la casse place
   `docs/ARCHITECTURE.md` avant `README.md`
   ([D-043](DECISIONS.md#d-043--tri-par-catégorie-puis-par-chemin-insensible-à-la-casse)).
8. **Aucun cache.** Chaque affichage réinterroge le runner
   ([D-049](DECISIONS.md#d-049--aucune-copie-des-documents-en-base)).
9. **Pas de test de rendu React.** Couverture assurée par les tests unitaires, le test
   d'intégration réel et le test fonctionnel HTTP en mode production.
10. **Deux tests ignorés sous Windows** : liens symboliques de fichier (privilège requis). Les
    cas équivalents sont couverts par jonctions.
11. Limites héritées : pré-contrôle d'unicité non atomique, jeton en clair dans `.env`, runner
    unique, indicateur de disponibilité non temps réel, TypeScript 5.9 et ESLint 9 figés,
    Node ≥ 22.18 requis.

## 7. Prochaine tâche recommandée

**`TASK-006` — Création de documents Markdown.**

Objectif : permettre de créer depuis NOX un nouveau document Markdown dans un emplacement
autorisé, avec validation d'un chemin qui n'existe pas encore et refus d'écraser un fichier
existant.

## 8. État Git

- Aucun commit créé par Claude Code.
- Aucun push effectué.
- Historique Git non modifié.
- Commit de départ : `1a183f5` (`feat: add markdown document reader`), répertoire de travail
  propre avant l'intervention.
- Les modifications de `TASK-005` sont locales, non indexées, disponibles pour review.
