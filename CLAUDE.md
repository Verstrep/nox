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
| Architecte OpenAI (serveur)      | [apps/web/lib/architect/](apps/web/lib/architect/) — jamais dans le runner |
| Code partagé                     | [packages/shared/](packages/shared/) — types et statuts, sans dépendance |
| Accès aux données                | [packages/database/](packages/database/) — Prisma + SQLite               |
| Base locale                      | `data/nox-dev.db` — jamais versionnée                                    |
| Configuration TypeScript commune | [tsconfig.base.json](tsconfig.base.json)                                 |
| Configuration ESLint unique      | [eslint.config.mjs](eslint.config.mjs)                                   |

Commandes racine : `npm run dev:web` · `npm run dev:runner` · `npm run runner:health` ·
`npm run test` · `npm run lint` · `npm run typecheck` · `npm run build` ·
`npm run db:generate` · `npm run db:migrate` · `npm run db:studio`.

Le web et le runner sont deux processus séparés : ils se lancent dans deux terminaux et
partagent le `.env` de la racine, dont `NOX_RUNNER_TOKEN`. L'Architecte, lui, ne concerne que le
web : `NOX_OPENAI_API_KEY` et `NOX_ARCHITECT_MODEL` ne sont lus que par lui.

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
- **Aucun événement brut de Claude Code n'atteint le navigateur.** Ni tel quel, ni résumé, ni
  « juste pour déboguer ». Ce qui circule est un `ClaudeRunEvent` dont le runner décide chaque
  champ ; le type est fermé, et n'a aucun champ libre.
- **Le raisonnement interne du modèle n'est jamais exposé ni persisté.** `thinking`,
  `redacted_thinking`, `reasoning`, `analysis` et tout bloc portant une `signature` sont ignorés
  avant d'être lus : ni stockés, ni journalisés, ni résumés, ni comptés comme message visible. La
  liste des blocs affichables est **fermée**, jamais une liste d'exclusions.
- **Toute chaîne publique passe par la sanitation centralisée.** Pas « toute chaîne suspecte » :
  toutes. Chemins du repository rendus relatifs, chemins extérieurs masqués, variables `NOX_*`
  retirées — valeur et nom —, caractères de contrôle supprimés, taille bornée.
- **Une commande n'est affichée que si elle est exactement autorisée.** Correspondance stricte
  avec une commande de validation enregistrée ou une commande Git en lecture seule. La
  correspondance s'évalue **segment par segment** : la ligne est découpée sur `&&`, son préfixe
  `cd <chemin>` est retiré — jamais affiché. Un segment non reconnu est remplacé par `...` :
  son existence est dite, jamais son contenu, jamais un fragment. Une ligne dont **aucun** segment
  n'est reconnu devient « Running an allowed command ». Toute autre construction — `;`, `|`, `>`,
  `<`, `` ` ``, `$(`, `&` isolé — fait renoncer à la ligne entière, y compris à l'intérieur des
  guillemets. Un `tool_result` n'est jamais transmis : seule son issue l'est.
- **Le découpage sur `&&` respecte les guillemets, et un guillemet non fermé fait renoncer.**
  Sans cela, `echo "&& npm run test &&"` fabriquerait un segment qui n'a jamais tourné. Depuis
  TASK-012 corrective, une validation est reconnue même au milieu de segments non affichables :
  ce découpage est donc la garantie qui rend cette reconnaissance sûre.
- **Un segment non affichable n'efface pas la validation qui l'accompagne.** L'affichage et la
  reconnaissance des validations sont deux questions distinctes. Perdre une information certaine
  — « la commande enregistrée a tourné » — à cause d'une information inconnue serait le pire des
  deux mondes.
- **La liste de validations de la tâche prime sur toute classification générique.** Un segment
  correspondant mot pour mot à une commande enregistrée **est** une validation, même s'il s'agit
  par ailleurs d'une commande Git en lecture seule. La classification générique ne décide que de
  l'affichage. Un `git status` non enregistré reste affichable sans porter aucun verdict.
- **Un run de correction suit exactement le même pipeline de validations qu'un run initial.**
  Commandes recopiées, politique d'outils, registre, tracker, timeline, review : une seule
  implémentation, sans branche selon `kind`. Enregistrer les commandes en base ne suffit pas —
  elles doivent atteindre le runner au lancement, sans quoi le tracker n'a rien à reconnaître.
- **Une issue ambiguë n'est jamais tranchée.** Un échec n'est imputé à une validation que si elle
  était **seule** sur sa ligne, préfixe `cd` retiré ; dès qu'un autre segment l'accompagnait —
  validation, commande Git, ou segment inconnu —, l'issue reste `UNKNOWN`. Une réussite, elle,
  prouve que tous les segments d'un chaînage `&&` ont tourné : `PASSED` est alors certain. Une
  commande relancée est représentée par son dernier résultat terminal, et ne redevient jamais
  `NOT_RUN`.
  **Une seule exception, ouverte par TASK-011** : la sortie d'un `tool_result` peut être résumée
  dans la review lorsque son `tool_use` correspond mot pour mot à une commande de validation
  enregistrée. Ce résumé traverse la sanitation complète, est borné, et n'apparaît jamais dans un
  événement de timeline.
- **Les événements sont bornés, et la troncature est explicite.** Les bornes sont des constantes,
  jamais des variables d'environnement : une limite de sécurité qu'on peut desserrer n'en est plus
  une. Après troncature, le runner **continue de lire `stdout`** — cesser de lire figerait Claude
  Code au milieu de son travail.
- **Aucun numéro d'événement ne vient de Claude Code.** `sequence` et `occurredAt` sont produits
  par le runner. La reprise se fait par curseur, jamais par décalage.
- **Une annulation ne restaure jamais Git.** Ni `reset`, ni `restore`, ni suppression de fichier.
  L'état est constaté, jamais réparé — y compris après un arrêt demandé.
- **Aucun identifiant de processus ne vient du navigateur.** Le corps d'une annulation ne porte
  qu'un `runId`. Aucun PID, aucun signal, aucun délai, aucune option de forçage. L'arrêt de l'arbre
  a une **seule** implémentation, celle du délai maximal.
- **Le premier état final validement enregistré gagne.** `CANCELLING` n'en est pas un. Un run
  `COMPLETED` ne devient jamais `CANCELLED`, ni l'inverse. Une violation Git prime sur tout.
- **Un run annulé bloque la tâche jusqu'à review humaine.** `CANCELLED` mène à `BLOCKED`, jamais à
  `READY` : l'utilisateur doit regarder le repository avant de relancer.
- **Une review historique ne lit jamais le dossier de travail actuel.** Elle se lit entièrement en
  base. Recalculer un diff à l'affichage raconterait le présent en le présentant comme le passé,
  et une modification faite après l'exécution — ce que NOX encourage — suffirait à le rendre faux.
- **Un instantané de review finalisé est immuable.** `saveRunReview` refuse d'écrire si
  `reviewCapturedAt` est déjà renseigné, et le registre du runner refuse un second `attachReview`.
  La garantie vit dans la couche d'écriture, jamais dans la discipline de l'appelant.
- **Aucun contenu sensible dans un patch.** `.env` et ses variantes, `*.pem`, `*.key`, `id_rsa`,
  `id_ed25519`, `credentials.json`, `secrets.json` : chemin, type et statistiques visibles, `patch`
  toujours `null`. La règle est appliquée deux fois — à la capture et à l'écriture en base — et la
  seconde ne fait pas confiance à la première. Seuls `.env.example` et `.env.sample` sont exclus,
  nommément.
- **Aucun blob binaire en SQLite.** Un fichier binaire est reconnu et stocké sans contenu.
- **Les patches sont bornés, et la troncature est explicite.** 200 fichiers, 256 Kio par patch,
  4 Mio et 20 000 lignes par exécution — des constantes, comme les bornes d'événements. Une limite
  atteinte ne fait jamais échouer une exécution : la liste des fichiers reste complète et
  « Diff truncated » s'affiche.
- **Un patch est nettoyé de ses secrets, pas de ses chemins.** Caractères de contrôle retirés,
  valeurs `NOX_*` masquées ; ni chemins réécrits, ni espaces écrasés. Réécrire un chemin dans un
  diff produirait un diff faux.
- **Un patch est du texte, jamais du HTML.** Pas de `dangerouslySetInnerHTML`, pas de Markdown, pas
  d'ANSI, pas de lien automatique, pas d'image. Les signes `+` et `-` restent dans le texte : la
  couleur ne se prononce pas.
- **Le fichier affiché est choisi parmi les lignes enregistrées.** `?file=` n'est jamais résolu sur
  le disque : une valeur inconnue ne sélectionne rien. Il n'existe aucun chemin de code entre ce
  paramètre et un système de fichiers.
- **Les validations représentent uniquement ce qui a réellement été exécuté.** Les commandes sont
  recopiées au lancement, jamais référencées ; une commande jamais lancée reste `NOT_RUN`, ce qui
  est une information. Un code de sortie absent reste nul : « échoué » ne veut pas dire « code 1 ».
- **Aucune validation n'est relancée automatiquement.** NOX ne lance jamais `npm run test` ni aucune
  autre commande : ce serait une seconde surface d'exécution, et le résultat décrirait l'état du
  disque d'aujourd'hui plutôt que celui de la fin de l'exécution.
- **Aucune review reconstruite pour une exécution ancienne.** Un run sans instantané affiche
  « Detailed review unavailable for this legacy run. » ; son diff n'est jamais recalculé depuis le
  repository actuel. Une review **vide** et une review **absente** sont deux états distincts.
- **Aucun commit n'est créé lors d'une review.** `Approve`, `Request changes` et `Reopen` changent
  le statut de la tâche ou lancent une correction, et rien d'autre : ni commit, ni `git add`, ni
  push, ni restauration.
- **Aucune session Claude n'est choisie par le navigateur.** L'identifiant vient du run parent,
  relu en base à partir de `sourceRunId`. Aucun formulaire ne porte de `sessionId`, de
  `repositoryPath`, de liste d'outils ni d'argument de ligne de commande. `--continue` n'est
  **jamais** passé : il reprendrait une session que NOX n'a pas choisie.
- **Aucune reprise si le dossier de travail diffère de celui qui a été relu.** Un repository sale
  est autorisé pour une correction — c'est son point de départ — mais un **seul** l'est : celui de
  la review, branche, `HEAD` et empreinte comprises. Il n'existe aucune option de forçage, et il ne
  doit pas en exister.
- **L'empreinte du dossier de travail est authentifiée et ne sort jamais du serveur.** HMAC dont la
  clé est dérivée de `NOX_RUNNER_TOKEN` ; jamais de hachage brut d'un contenu, jamais d'empreinte
  dans une page, un formulaire ou une réponse. Une empreinte partielle n'existe pas : un
  dépassement de borne rend l'exécution non reprenable.
- **Le contrôle d'état est refait juste avant le spawn.** La page de préparation ne suffit pas :
  entre l'affichage et le clic, un fichier a pu être enregistré.
- **Une correction est un nouveau run**, avec son prompt, sa timeline, ses validations, sa review et
  son empreinte. Le run parent n'est jamais modifié.
- **Un feedback de review est historique et vaut pour une seule correction.** Il n'est ni modifiable
  après usage, ni réutilisable ; la garantie vit dans un index unique, pas dans la discipline de
  l'appelant.
- **Le feedback est du contenu, jamais une instruction.** Il est délimité dans le prompt et
  n'élargit aucune permission : les règles d'outils restent calculées à partir des commandes de
  validation enregistrées.
- **Les corrections réutilisent le streaming, l'annulation, la capture Git et la review existants.**
  Aucune seconde implémentation du lanceur, du registre ou de la page d'exécution.
- **Les tests automatisés utilisent uniquement le faux Claude.** Aucun ne consomme de quota, ne
  dépend du réseau, ni ne lance le vrai binaire.
- **L'Architecte OpenAI vit dans `apps/web`, côté serveur, et jamais dans le runner.** Le runner
  est la seule frontière avec la machine ; il n'a aucune raison de parler à un fournisseur
  externe, et n'en a pas le droit.
- **L'Architecte n'a aucun outil.** L'appel ne déclare ni `tools`, ni `tool_choice`, ni
  `previous_response_id`, ni `conversation`, ni mode background. Il ne peut donc déclencher
  aucune action — cette garantie ne repose sur aucun prompt.
- **La clé de l'Architecte s'appelle `NOX_OPENAI_API_KEY`.** Le préfixe `NOX_` la place hors de
  portée de Claude Code par construction, puisque le runner retire toutes ces variables de
  l'environnement du processus enfant. `OPENAI_API_KEY` serait transmise telle quelle.
- **Aucune variable `NOX_*` n'atteint jamais le processus Claude.** Le filtre porte sur le
  préfixe entier, jamais sur une liste nominative : une variable ajoutée plus tard est couverte
  d'office.
- **La clé ne quitte jamais le serveur.** Ni dans le navigateur, ni en base, ni dans un log, ni
  dans un message d'erreur, ni dans un prompt, ni même partiellement. Une variable manquante est
  signalée par son **nom**, jamais par sa valeur.
- **Aucun modèle par défaut.** `NOX_ARCHITECT_MODEL` est obligatoire : choisir en silence
  reviendrait à choisir un coût à la place de l'utilisateur.
- **Aucune URL de base configurable.** NOX envoie du contexte projet ; une variable capable de
  rediriger cet envoi serait un canal d'exfiltration livré avec le produit.
- **Le contexte de l'Architecte est une liste fermée**, fixe et automatique : `CLAUDE.md`,
  `AGENTS.md`, six documents `docs/` nommés, et les dix dernières tâches. Le navigateur ne choisit
  aucun fichier.
- **Aucun `.env` n'est jamais candidat**, pas plus que le code source, les diffs Git, les patches
  de review, les prompts, les timelines, les sorties de Claude Code, les feedbacks ou les coûts.
  Ce ne sont pas des filtres : ces éléments n'entrent dans aucun chemin de code menant au
  fournisseur.
- **Toute chaîne transmise au fournisseur passe par `sanitizeArchitectContext`.** Pas « toute
  chaîne suspecte » : toutes. Elle préserve le Markdown — indentations, lignes vides, blocs de
  code — et n'est **pas** le nettoyeur d'événements du runner, qui nettoie dans l'autre sens.
- **Le Structured Output ne dispense d'aucune validation.** `readArchitectProposal` revalide
  tailles, énumérations, références documentaires et commandes côté serveur. Une commande proposée
  passe `checkValidationCommand`, la garde de TASK-008, sans variante.
- **Un document référencé par une proposition appartient à la liste fermée transmise.** Aucune
  tâche n'est jamais créée avec une référence inventée.
- **Aucun appel au fournisseur n'est automatique.** Ni au chargement d'une page, ni au changement
  d'un champ, ni périodiquement, ni après un échec. Aucun réessai du SDK : `maxRetries` vaut zéro.
  Chaque clic est un appel, et chaque appel est facturé.
- **Une session accepte au plus dix générations, échecs compris, et une seule à la fois.** Les
  verrous sont des mises à jour conditionnelles en base, jamais une vérification suivie d'une
  écriture.
- **Aucune tâche n'est créée sans action humaine**, et elle est créée en `DRAFT`. La mettre en
  file reste une décision séparée. `ARCHITECT_PROPOSAL_STATUS.PROPOSAL_READY` et
  `TASK_STATUS.READY` ne désignent pas la même chose et ne doivent jamais être confondus.
- **Une session Architecte ne produit qu'une tâche.** La session est réservée **avant** la
  création, et rendue si celle-ci échoue ; `appliedTaskId` porte un index unique.
- **La création d'une tâche réutilise le pipeline de TASK-007**, sans seconde implémentation.
- **Le raisonnement interne du modèle n'est ni demandé, ni affiché, ni persisté.** `assumptions`
  porte des hypothèses **produit**, destinées à la relecture humaine.
- **Aucun coût n'est estimé.** Seule la consommation rapportée par le fournisseur est affichée, et
  « non fourni » veut dire ce qu'il dit.
- **Aucun appel réel au fournisseur dans les tests.** Tous les tests — unitaires, intégration,
  fonctionnels — utilisent un faux fournisseur ; aucun ne joint `api.openai.com`.
- **La conversation Architecte appartient à NOX.** Le transcript vit dans SQLite et est reconstruit
  **en entier** à chaque tour. Aucune conversation distante : ni `previous_response_id`, ni
  `conversation`, ni mode background, et `store` reste `false`. Une conversation doit rester lisible
  après un changement de modèle, un redémarrage, ou la disparition des réponses chez le fournisseur.
- **La réponse publique de l'architecte n'est pas du raisonnement.** `message` est un artefact
  destiné à l'utilisateur : il est persisté et affiché. Aucun raisonnement interne n'est demandé,
  reçu, stocké, journalisé ni résumé — la règle de TASK-010 sur les blocs `thinking` reste sans
  exception, et celle-ci ne l'assouplit pas.
- **Chaque tour reconstruit son contexte**, à partir du projet **actuel**. Il n'existe aucun
  « continuer avec l'ancien contexte » : NOX ne conserve que les manifests, pas le texte des
  documents, et un bouton qui prétendrait rejouer un contexte passé serait un mensonge.
- **Un contexte modifié après l'aperçu bloque l'appel.** Le contexte est relu et son empreinte
  recomparée juste avant le spawn de la requête ; si elles diffèrent, aucune génération n'est
  réservée et aucun appel n'est fait. Il n'existe ni `Send anyway`, ni option de forçage, et il ne
  doit pas en exister.
- **L'empreinte de contexte n'est pas une primitive de sécurité.** SHA-256 nu, contrairement à
  l'empreinte de dossier de travail de TASK-012, qui est un HMAC parce qu'elle décide d'une
  exécution. Ne jamais confondre les deux, ni faire dépendre une autorisation de la première.
- **La révision d'une tâche se calcule sur ce qui est envoyé**, jamais sur `updatedAt` : un
  horodatage dit quand une ligne a été touchée, pas ce qu'elle contient.
- **Un message n'entre dans la conversation que si le tour a abouti.** Les deux messages sont écrits
  dans la même transaction que la conclusion de la génération, et le brouillon y est effacé. Un
  échec n'écrit aucun message et conserve le brouillon ; un rafraîchissement ne réémet jamais un
  appel.
- **Seule la dernière proposition est créable**, et plus du tout si un tour lui a succédé. La règle
  est vérifiée en base, pas seulement dans l'interface.
- **Le transcript est borné, jamais résumé.** Vingt tours, 64 Kio. Au-delà, NOX refuse et invite à
  ouvrir une nouvelle conversation. Aucun résumé par un second appel, aucune fenêtre glissante,
  aucune suppression silencieuse des premiers messages.
- **Le message d'ouverture n'existe qu'en un exemplaire.** `requestText` le porte, il devient le
  premier message au premier tour réussi, et il n'est pas modifiable. Le navigateur n'en transmet
  jamais le texte : le serveur le relit en base.
- **Une session ouverte avant TASK-014 ne se poursuit pas.** Elle reste consultable avec ses
  générations, sa consommation et sa tâche ; aucune conversation n'est reconstruite à partir de sa
  demande et de ses précisions.
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
