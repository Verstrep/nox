# CLAUDE.md — Règles permanentes des sessions Claude Code

Ce fichier définit les règles qui s'appliquent à **toutes** les sessions Claude Code sur le
repository NOX. Il n'est pas propre à une tâche.

En cas de contradiction entre ce fichier et le prompt d'une tâche, le prompt de la tâche
l'emporte sur les préférences, mais **jamais** sur les règles Git et Sécurité ci-dessous.

Contexte du projet : [docs/PROJECT_BRIEF.md](docs/PROJECT_BRIEF.md) ·
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/PROJECT_STATE.md](docs/PROJECT_STATE.md)

---

## 1. Travail par tâche

- **Lire la tâche et les documents référencés avant toute modification.** Ne pas commencer à
  écrire du code sur la base du seul titre de la tâche.
- **Ne travailler que sur le périmètre demandé.** Ce qui est listé hors périmètre est hors
  périmètre, même si l'ajout paraît trivial.
- **Ne pas commencer la tâche suivante.** Même si elle semble évidente, même si le socle est
  déjà en place.
- **Signaler les ambiguïtés réellement bloquantes.** Une ambiguïté est bloquante si deux
  interprétations raisonnables mènent à des implémentations incompatibles.
- **Faire une supposition raisonnable pour les détails mineurs, et la documenter.** Un détail
  mineur ne justifie pas d'interrompre la tâche ; il justifie une ligne dans le compte rendu.
- **Consigner les décisions structurantes** dans [docs/DECISIONS.md](docs/DECISIONS.md), avec
  leur justification.

## 2. Qualité du code

- **TypeScript strict.** `strict: true` est déjà actif dans `tsconfig.base.json` ; ne pas
  l'affaiblir pour faire passer un typage.
- **Éviter `any`.** Utiliser `unknown` et restreindre par garde de type. Un `any` doit être
  exceptionnel et justifié en commentaire.
- **Séparer la logique métier de l'interface.** Les composants React affichent ; la logique
  vit dans des modules qui ne dépendent pas de React.
- **Préférer des fonctions petites et lisibles.** Une fonction qui nécessite un commentaire
  pour expliquer _ce qu'elle fait_ est probablement trop grosse.
- **Éviter les abstractions prématurées.** Deux usages ne font pas un motif. Attendre le
  troisième avant de généraliser.
- **Ne pas ajouter de dépendance sans justification.** Une dépendance doit apporter davantage
  que quelques lignes de code simples, et sa raison d'être doit figurer dans le compte rendu.
- **Ne pas ajouter de fonctionnalité non demandée.** Pas d'écran « bonus », pas d'option
  « pendant qu'on y est ».
- **Maintenir la documentation cohérente avec le code.** Une modification qui invalide un
  document doit mettre ce document à jour dans la même tâche.

## 3. Validation

- **Exécuter le typecheck** : `npm run typecheck`.
- **Exécuter le lint** : `npm run lint`.
- **Exécuter le build lorsque la tâche concerne l'application** : `npm run build`.
- **Ne jamais annoncer qu'une commande réussit sans l'avoir réellement exécutée.** Aucune
  exception. Une commande non lancée est rapportée comme non lancée, pas comme réussie.
- **Rapporter clairement les erreurs non résolues.** Avec le message d'erreur réel, la cause
  identifiée et ce qui a été tenté. Ne jamais masquer un échec, ne jamais le contourner en
  désactivant une règle ou en supprimant un test.

## 4. Git

- **Ne jamais pousser vers un dépôt distant.** Ni `git push`, ni aucune variante.
- **Ne jamais modifier l'historique Git.** Pas de `rebase`, pas d'`amend`, pas de
  `filter-branch`, pas de `push --force`.
- **Ne jamais utiliser `git reset --hard`.**
- **Ne jamais supprimer les modifications existantes de l'utilisateur.** Vérifier `git status`
  avant d'écraser un fichier non versionné.
- **Ne pas créer de commit sauf demande explicite** dans le prompt de la tâche.
- **Rappel de processus** : avant chaque nouveau prompt Claude, l'utilisateur doit valider,
  commit et push l'état précédent. Terminer chaque tâche sur un état commitable, et proposer
  les commandes Git correspondantes sans les exécuter.

## 5. Sécurité

- **Ne jamais lire ou afficher les secrets.** Y compris pour « vérifier » qu'ils sont bien
  définis.
- **Ne jamais inclure le contenu d'un `.env` dans un compte rendu.** Seul `.env.example` est
  versionné, et il ne contient aucune valeur réelle.
- **Ne jamais exécuter de commande destructive sans autorisation explicite.** Suppression
  récursive, réinitialisation, écrasement de fichiers non versionnés : demander d'abord.
- **Ne pas accéder à un dossier extérieur au repository.** Les fichiers temporaires vont dans
  un dossier de travail dédié, pas dans l'arborescence du projet.
- **Le runner écoute sur la boucle locale uniquement.** Ne pas l'exposer sur `0.0.0.0`.

## 6. Repères techniques du repository

| Élément                          | Emplacement                                                              |
| -------------------------------- | ------------------------------------------------------------------------ |
| Application web                  | [apps/web/](apps/web/) — Next.js App Router, Tailwind CSS                |
| Runner local                     | [apps/runner/](apps/runner/) — API HTTP native, port `4310` par défaut   |
| Contrat web ↔ runner             | [packages/shared/src/runner.ts](packages/shared/src/runner.ts)           |
| Client runner (serveur)          | [apps/web/lib/runner/](apps/web/lib/runner/)                             |
| Code partagé                     | [packages/shared/](packages/shared/) — types et statuts, sans dépendance |
| Accès aux données                | [packages/database/](packages/database/) — Prisma + SQLite               |
| Base locale                      | `data/nox-dev.db` — jamais versionnée                                    |
| Configuration TypeScript commune | [tsconfig.base.json](tsconfig.base.json)                                 |
| Configuration ESLint unique      | [eslint.config.mjs](eslint.config.mjs)                                   |

Commandes racine : `npm run dev:web` · `npm run dev:runner` · `npm run runner:health` ·
`npm run test` · `npm run lint` · `npm run typecheck` · `npm run build` ·
`npm run db:generate` · `npm run db:migrate` · `npm run db:studio`.

Le web et le runner sont deux processus séparés : ils se lancent dans deux terminaux et
partagent le `.env` de la racine, dont `NOX_RUNNER_TOKEN`.

Contraintes à respecter (voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)) :

- **`apps/web` ne lance aucun processus système et ne lit aucun fichier de projet.** Toute
  opération Git ou système de fichiers passe par une route du runner. Cette règle est sans
  exception depuis TASK-003.
- **`apps/runner` est la seule frontière avec la machine.** Il n'appelle aucun fournisseur de
  modèle et n'écrit dans aucune base.
- **Le runner n'écoute que sur la boucle locale** (`127.0.0.0/8`, `::1`, `localhost`) pour la
  V1. Il refuse de démarrer sur toute autre adresse.
- **Aucune nouvelle route sensible du runner sans authentification.** `Authorization: Bearer
<NOX_RUNNER_TOKEN>` est obligatoire dès qu'une route touche au disque, à Git ou à un
  processus. Seule `GET /health` est publique en local.
- **Le jeton ne quitte jamais le serveur.** Pas de variable `NEXT_PUBLIC_*`, pas de jeton dans
  une réponse, un message d'erreur ou une ligne de log — même partiellement.
- **Tout accès aux fichiers d'un projet passe par le runner.** `apps/web` n'ouvre, ne liste et
  ne lit aucun fichier de repository.
- **Le web ne reçoit que des chemins relatifs.** Un chemin absolu de la machine ne doit jamais
  figurer dans une réponse du runner, ni atteindre le navigateur.
- **Aucun chemin fourni par l'utilisateur n'est résolu sans contrôle de confinement.** Filtrage
  syntaxique (relatif, sans `..`, extension attendue, emplacement autorisé) **puis** vérification
  après `realpath`, qui seule révèle les liens sortants.
- **Aucun fichier hors du repository ne peut être lu.** Le confinement se vérifie sur les chemins
  réels, jamais par comparaison de préfixe de chaîne.
- **Aucune écriture dans un repository sans tâche qui la demande explicitement.** Depuis
  TASK-009, sont autorisées : la **modification** d'un document Markdown, sa **création**, sa
  **suppression**, ainsi que la création et la suppression du document d'une tâche. Ni
  renommage, ni déplacement, ni suppression de dossier sans instruction dédiée.
- **Toute création de fichier passe par une primitive exclusive** (`open` en `wx`). Un
  enchaînement `exists()` puis `writeFile()` n'est jamais une garantie : le fichier peut
  apparaître entre les deux.
- **Aucune opération de création ne peut écraser un fichier existant**, quelles que soient les
  circonstances.
- **Aucun dossier n'est créé** sans tâche qui le demande. Un parent manquant est une erreur,
  pas une invitation. Seule exception, ouverte par TASK-007 : le dossier `tasks/` à la racine,
  créé par la route des documents de tâche et par elle seule.
- **Les parents d'un chemin de création sont contrôlés et confinés** : chacun doit exister,
  être un vrai dossier, ne pas être un lien, et rester dans le repository.
- **Les noms de fichiers créés sont validés pour rester portables** : ni caractère interdit
  sous Windows, ni nom réservé, ni espace ou point final. Le nom saisi n'est jamais transformé
  en silence.
- **Les chemins finaux sont reconstruits côté serveur** à partir d'une destination validée. Le
  navigateur n'envoie jamais un chemin complet, ni un préfixe.
- **Aucune écriture sans contrôle de confinement.** Une écriture suit exactement le même
  chemin de validation qu'une lecture : filtrage syntaxique, puis vérification après
  `realpath`. Aucune seconde logique de validation de chemin ne doit exister.
- **Aucune modification d'un fichier existant sans contrôle de révision.** Le runner relit les
  octets, recalcule l'empreinte et refuse d'écrire si elle diffère de celle attendue.
- **Aucun forçage silencieux d'un conflit.** Un conflit de révision se règle en rechargeant le
  fichier ; n'ajoutez pas de bouton « écraser » sans tâche qui le demande.
- **Aucune écriture dans un lien symbolique**, même si sa cible reste dans le repository :
  l'utilisateur doit savoir quel fichier physique est modifié.
- **Toute écriture passe par un fichier temporaire du même dossier, puis un remplacement.** Un
  document ne doit jamais rester partiellement écrit, et aucun fichier temporaire ne doit
  survivre — ni en production, ni après les tests.
- **Aucun chemin absolu reçu du navigateur.** Le chemin d'un repository se relit toujours en
  base à partir de l'identifiant du projet, jamais depuis un champ de formulaire.
- **Une tâche possède un code immuable.** `sequence` est fixé à la création et ne change
  jamais ; le code affiché (`TASK-001`) s'en dérive et n'est pas stocké.
- **Le code d'une tâche n'est jamais dérivé d'un comptage.** Il vient du compteur
  `Project.nextTaskSequence`, incrémenté de façon atomique. `count() + 1` réattribuerait un
  numéro dès qu'une tâche disparaîtrait. Un trou dans la numérotation est acceptable ; un
  identifiant réutilisé ne l'est pas.
- **Le document d'une tâche a un chemin stable** : `tasks/<code>.md`, sans le titre. Le titre
  changera ; le chemin, non.
- **Aucun fichier existant n'est écrasé pendant une synchronisation.** Un document identique
  au Markdown attendu est adopté ; un document différent produit un conflit, jamais un
  remplacement, et aucun bouton de forçage n'est ajouté.
- **Une panne du runner ne supprime jamais une tâche.** L'enregistrement en base et l'écriture
  du document sont deux étapes distinctes : la seconde peut échouer et être reprise. Cette règle
  vaut aussi à la suppression : un runner injoignable laisse la base intacte.
- **Aucune suppression sans contrôle de confinement.** Une suppression suit exactement le même
  chemin de validation qu'une lecture ou une écriture : filtrage syntaxique, puis vérification
  après `realpath`. Aucune quatrième logique de validation de chemin ne doit exister.
- **Aucune suppression d'un document existant sans contrôle de révision.** Le runner relit les
  octets, recalcule l'empreinte et refuse de supprimer si elle diffère de celle attendue. Une
  suppression forcée n'existe pas, et aucun bouton ne doit la proposer.
- **Aucun document de tâche supprimé par la route générique.** Les chemins de la forme
  `tasks/TASK-<chiffres>.md` sont refusés par `POST /repositories/documents/delete`, quelle que
  soit la révision fournie. Ils appartiennent à une tâche et se suppriment avec elle. Cette
  protection vit dans le runner, pas seulement dans l'interface.
- **Aucun dossier supprimé par une opération documentaire.** `unlink` uniquement, jamais
  `rmdir`, jamais de suppression récursive, jamais de nettoyage d'un parent devenu vide.
- **Aucune suppression à travers un lien.** Un document qui est un lien symbolique est refusé,
  comme à l'écriture : l'utilisateur doit savoir quel fichier physique disparaît.
- **Aucune tâche possédant un historique d'exécution n'est supprimée.** La règle est vérifiée
  dans la transaction, et doublée par une contrainte `Restrict` de `Run` vers `Task` : même un
  appel direct à Prisma échoue. Aucun run n'est jamais supprimé.
- **Aucun numéro de tâche n'est réutilisé.** `Project.nextTaskSequence` n'est jamais décrémenté
  par une suppression. Un trou dans la numérotation est acceptable ; un identifiant réutilisé
  ne l'est pas.
- **Le fichier d'une tâche est traité avant sa suppression en base.** L'ordre est
  `runner → SQLite`, jamais l'inverse : un document orphelin est indétectable, alors qu'une
  tâche dont le document a disparu est visible et reprenable. Un document absent est traité
  comme une réussite idempotente.
- **Les statuts internes restent stables.** `DRAFT`, `READY`, `COMPLETED`… ne changent ni en
  base, ni dans les contrats, ni dans les documents Markdown déjà générés. Seul leur affichage
  se traduit.
- **Les libellés d'interface sont centralisés** dans `apps/web/lib/labels.ts`, et nulle part
  ailleurs. Un mapping concurrent dans un composant isolé finirait par diverger.
- **Toute transition de statut passe par `canTransitionTaskStatus`.** Les statuts `RUNNING`,
  `FAILED` et `REVIEW` sont réservés aux futures exécutions et ne se posent jamais à la main.
- **Les commandes de validation enregistrées ne sont jamais exécutées par NOX.** Depuis
  TASK-008, elles sont **autorisées** à Claude Code, une par une et à l'identique ; le runner,
  lui, n'en exécute aucune.
- **Toute exécution exige un repository propre et synchronisé.** Sans état de départ connu, il
  devient impossible de dire ce que l'agent a changé.
- **Le lancement d'une exécution est toujours explicite.** NOX ne déclenche jamais Claude Code
  de lui-même, ni pour réessayer, ni pour enchaîner une tâche.
- **Une seule exécution active à la fois**, tous projets confondus, pour la V1.
- **Aucun prompt libre ne vient du navigateur.** Le prompt est régénéré côté serveur à partir de
  la tâche en base ; les règles d'outils sont calculées, jamais reçues.
- **Aucune clé d'API Anthropic dans NOX.** L'authentification est celle déjà configurée dans
  Claude Code. NOX n'en demande pas, n'en stocke pas, n'en transmet pas.
- **`--dangerously-skip-permissions` n'est jamais passé**, sous aucune condition.
- **Les secrets de NOX sont retirés de l'environnement du processus enfant.** Toute variable
  `NOX_*` est supprimée avant le lancement.
- **Aucun commit ni push automatique**, et aucune réparation Git automatique : NOX constate
  l'état laissé sur le disque, il ne le restaure pas.
- **Un résultat de Claude Code ne vaut pas validation humaine.** Une exécution réussie fait
  passer la tâche en `REVIEW`, jamais directement en `COMPLETED`.
- **Seul `tasks/` peut être créé par NOX**, à la racine du repository, par la route dédiée aux
  documents de tâche. Aucun autre dossier, aucun sous-dossier.
- Les échanges web ↔ runner suivent le contrat de `@nox/shared` : ne jamais redéclarer un code
  d'erreur dans `apps/web` ou `apps/runner`.
- `packages/shared` n'importe ni Node, ni React, ni aucune dépendance runtime ;
- `packages/database` n'importe ni React ni Next.js, et concentre tout accès à la base ;
- aucun Client Component n'appelle Prisma ni le client runner.

Le client Prisma et les dossiers `dist/` sont générés : ne jamais les modifier à la main, et ne
jamais les versionner.

Les sources de `apps/runner` importent leurs voisins avec l'extension `.ts` : le mode
développement exécute le TypeScript directement, sans transpileur.
