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
  TASK-005, seule la **modification d'un document Markdown existant** est autorisée : ni
  création, ni suppression, ni renommage, ni déplacement sans instruction dédiée.
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
- Les échanges web ↔ runner suivent le contrat de `@nox/shared` : ne jamais redéclarer un code
  d'erreur dans `apps/web` ou `apps/runner`.
- `packages/shared` n'importe ni Node, ni React, ni aucune dépendance runtime ;
- `packages/database` n'importe ni React ni Next.js, et concentre tout accès à la base ;
- aucun Client Component n'appelle Prisma ni le client runner.

Le client Prisma et les dossiers `dist/` sont générés : ne jamais les modifier à la main, et ne
jamais les versionner.

Les sources de `apps/runner` importent leurs voisins avec l'extension `.ts` : le mode
développement exécute le TypeScript directement, sans transpileur.
