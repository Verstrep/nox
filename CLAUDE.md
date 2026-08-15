# CLAUDE.md — Règles opérationnelles des sessions Claude Code

Ce fichier définit les règles qui s'appliquent à **toutes** les sessions Claude Code sur le
repository NOX. Il n'est pas propre à une tâche.

En cas de contradiction entre ce fichier et le prompt d'une tâche, le prompt de la tâche
l'emporte sur les préférences, mais **jamais** sur les règles Git et Sécurité ci-dessous.

Pour comprendre le produit avant de coder : [docs/PROJECT_BRIEF.md](docs/PROJECT_BRIEF.md) ·
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/PROJECT_STATE.md](docs/PROJECT_STATE.md) ·
[docs/DECISIONS.md](docs/DECISIONS.md).

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

- **TypeScript strict.** `strict: true` est actif dans `tsconfig.base.json` ; ne pas
  l'affaiblir pour faire passer un typage.
- **Éviter `any`.** Utiliser `unknown` et restreindre par garde de type. Un `any` doit être
  exceptionnel et justifié en commentaire.
- **Séparer la logique métier de l'interface.** Les composants React affichent ; la logique vit
  dans des modules qui ne dépendent pas de React.
- **Préférer des fonctions petites et lisibles.** Une fonction qui nécessite un commentaire pour
  expliquer _ce qu'elle fait_ est probablement trop grosse.
- **Éviter les abstractions prématurées.** Deux usages ne font pas un motif. Attendre le
  troisième avant de généraliser.
- **Ne pas ajouter de dépendance sans justification.** Une dépendance doit apporter davantage
  que quelques lignes de code simples, et sa raison d'être doit figurer dans le compte rendu.
- **Ne pas ajouter de fonctionnalité non demandée.** Pas d'écran « bonus », pas d'option
  « pendant qu'on y est ».
- **Maintenir la documentation cohérente avec le code.** Une modification qui invalide un
  document doit mettre ce document à jour dans la même tâche — dans **le** document responsable
  de l'information, pas dans les six.

## 3. Validation

- **Exécuter le typecheck** : `npm run typecheck`.
- **Exécuter le lint** : `npm run lint`.
- **Exécuter le build lorsque la tâche concerne l'application** : `npm run build`.
- **Ne jamais annoncer qu'une commande réussit sans l'avoir réellement exécutée.** Aucune
  exception. Une commande non lancée est rapportée comme non lancée, pas comme réussie.
- **Rapporter clairement les erreurs non résolues.** Avec le message d'erreur réel, la cause
  identifiée et ce qui a été tenté. Ne jamais masquer un échec, ne jamais le contourner en
  désactivant une règle ou en supprimant un test.
- **Les tests automatisés utilisent uniquement le faux Claude et le faux fournisseur.** Aucun
  ne consomme de quota, ne dépend du réseau, ni ne lance le vrai binaire.

## 4. Git

- **Ne jamais pousser vers un dépôt distant.** Ni `git push`, ni aucune variante.
- **Ne jamais modifier l'historique Git.** Pas de `rebase`, pas d'`amend`, pas de
  `filter-branch`, pas de `push --force`.
- **Ne jamais utiliser `git reset --hard`.**
- **Ne jamais supprimer les modifications existantes de l'utilisateur.** Vérifier `git status`
  avant d'écraser un fichier non versionné.
- **Ne pas créer de commit sauf demande explicite** dans le prompt de la tâche.
- **Rappel de processus** : avant chaque nouveau prompt Claude, l'utilisateur doit valider,
  commit et push l'état précédent. Terminer chaque tâche sur un état commitable, et proposer les
  commandes Git correspondantes sans les exécuter.

## 5. Sécurité

- **Ne jamais lire ou afficher les secrets.** Y compris pour « vérifier » qu'ils sont bien
  définis.
- **Ne jamais inclure le contenu d'un `.env` dans un compte rendu.** Seul `.env.example` est
  versionné, et il ne contient aucune valeur réelle.
- **Ne jamais exécuter de commande destructive sans autorisation explicite.** Suppression
  récursive, réinitialisation, écrasement de fichiers non versionnés : demander d'abord.
- **Ne pas accéder à un dossier extérieur au repository.** Les fichiers temporaires vont dans un
  dossier de travail dédié, pas dans l'arborescence du projet.
- **Le runner écoute sur la boucle locale uniquement.** Ne pas l'exposer sur `0.0.0.0`.

---

## 6. Repères techniques

| Élément | Emplacement |
| --- | --- |
| Application web | [apps/web/](apps/web/) — Next.js App Router, Tailwind CSS |
| Runner local | [apps/runner/](apps/runner/) — API HTTP native, port `4310` par défaut |
| Contrat web ↔ runner | [packages/shared/src/runner.ts](packages/shared/src/runner.ts) |
| Client runner (serveur) | [apps/web/lib/runner/](apps/web/lib/runner/) |
| Architecte OpenAI (serveur) | [apps/web/lib/architect/](apps/web/lib/architect/) — jamais dans le runner |
| Code partagé | [packages/shared/](packages/shared/) — types et statuts, sans dépendance |
| Accès aux données | [packages/database/](packages/database/) — Prisma + SQLite |
| Base locale | `data/nox-dev.db` — jamais versionnée |
| Configuration TypeScript commune | [tsconfig.base.json](tsconfig.base.json) |
| Configuration ESLint unique | [eslint.config.mjs](eslint.config.mjs) |

Commandes racine : `npm run dev:web` · `npm run dev:runner` · `npm run runner:health` ·
`npm run test` · `npm run lint` · `npm run typecheck` · `npm run build` ·
`npm run db:generate` · `npm run db:migrate` · `npm run db:studio`.

Le web et le runner sont **deux processus séparés** : ils se lancent dans deux terminaux et
partagent le `.env` de la racine, dont `NOX_RUNNER_TOKEN`. L'Architecte ne concerne que le web :
`NOX_OPENAI_API_KEY` et `NOX_ARCHITECT_MODEL` ne sont lus que par lui.

Le client Prisma et les dossiers `dist/` sont générés : ne jamais les modifier à la main, et ne
jamais les versionner. Les sources de `apps/runner` importent leurs voisins avec l'extension
`.ts` : le mode développement exécute le TypeScript directement, sans transpileur.

---

## 7. Frontières d'architecture

Ces frontières sont **sans exception**. Le détail et les raisons sont dans
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) ; les règles ci-dessous suffisent pour coder sans
les enfreindre.

| Interdit | |
| --- | --- |
| `apps/web` lance un processus système | Le runner est la seule frontière avec la machine |
| `apps/web` ouvre, liste ou lit un fichier de projet | Tout passe par une route du runner |
| Le navigateur appelle le runner | Le jeton ne quitte jamais le serveur |
| Une route sensible du runner sans authentification | Seule `GET /health` est publique en local |
| Le runner écoute hors de la boucle locale | Il refuse de démarrer |
| Le runner appelle un fournisseur de modèle | Il exécute ; il ne décide pas |
| Le runner écrit en base | Il reste sans état |
| `packages/shared` importe Node, React ou une dépendance runtime | Doit rester importable des deux côtés |
| `packages/database` importe React ou Next | Doit rester utilisable par un script |
| Un Client Component appelle Prisma ou le client runner | Exposerait la couche données |
| Un code d'erreur redéclaré dans `apps/web` ou `apps/runner` | Le contrat vit dans `@nox/shared` |

**Le web ne reçoit que des chemins relatifs.** Un chemin absolu de la machine ne doit jamais
figurer dans une réponse du runner, ni atteindre le navigateur. Le chemin d'un repository se
relit toujours en base à partir de l'identifiant du projet, jamais depuis un formulaire.

**Le jeton ne quitte jamais le serveur.** Pas de variable `NEXT_PUBLIC_*`, pas de jeton dans une
réponse, un message d'erreur ou une ligne de log — même partiellement.

---

## 8. Invariants à ne pas casser

Chaque ligne est une garantie que le code tient aujourd'hui. Une tâche qui en contredirait une
doit le dire explicitement et la justifier.

### 8.1 Chemins et écritures dans un repository

- **Aucun chemin fourni par l'utilisateur n'est résolu sans contrôle de confinement** : filtrage
  syntaxique (relatif, sans `..`, extension attendue, emplacement autorisé) **puis** vérification
  après `realpath`, qui seule révèle les liens sortants. Jamais par comparaison de préfixe.
- **Une seule implémentation de cette validation.** Lecture, écriture et suppression suivent
  exactement le même chemin. Aucune seconde logique ne doit exister.
- **Toute création passe par une primitive exclusive** (`open` en `wx`). Un enchaînement
  `exists()` puis `writeFile()` n'est jamais une garantie.
- **Aucune création ne peut écraser un fichier existant**, quelles que soient les circonstances.
- **Aucune modification sans contrôle de révision.** Le runner relit les octets, recalcule
  l'empreinte, et refuse si elle diffère. Un conflit se règle en rechargeant ; n'ajoutez pas de
  bouton « écraser ».
- **Toute écriture passe par un fichier temporaire du même dossier, puis un remplacement.** Aucun
  document ne reste partiellement écrit, aucun fichier temporaire ne survit — ni en production,
  ni après les tests.
- **Aucune écriture ni suppression à travers un lien symbolique**, même si sa cible reste dans le
  repository.
- **Aucun dossier créé ni supprimé.** Seule exception : `tasks/` à la racine, par la route des
  documents de tâche et par elle seule. Un parent manquant est une erreur, pas une invitation.
- **Les parents d'un chemin de création sont contrôlés** : chacun doit exister, être un vrai
  dossier, ne pas être un lien, et rester dans le repository.
- **Les noms créés sont validés pour rester portables** : ni caractère interdit sous Windows, ni
  nom réservé, ni espace ou point final. Le nom saisi n'est jamais transformé en silence.
- **Les chemins finaux sont reconstruits côté serveur.** Le navigateur n'envoie jamais un chemin
  complet, ni un préfixe, ni un chemin absolu.
- **Aucune suppression sans contrôle de révision**, et une suppression forcée n'existe pas.
- **Aucun document de tâche supprimé par la route générique.** Les chemins
  `tasks/TASK-<chiffres>.md` sont refusés par `POST /repositories/documents/delete`, quelle que
  soit la révision. La protection vit dans le runner, pas seulement dans l'interface.
- **`unlink` uniquement** : jamais `rmdir`, jamais de suppression récursive, jamais de nettoyage
  d'un parent devenu vide.
- **Aucune écriture dans un repository sans tâche qui la demande explicitement.** Sont
  autorisées : modification, création et suppression d'un document Markdown, création et
  suppression du document d'une tâche. Ni renommage, ni déplacement.

### 8.2 Tâches

- **Une tâche possède un code immuable.** `sequence` est fixé à la création ; le code affiché
  (`TASK-001`) s'en dérive et n'est pas stocké.
- **Le code ne vient jamais d'un comptage.** Il vient de `Project.nextTaskSequence`, incrémenté
  de façon atomique. Un trou dans la numérotation est acceptable ; un identifiant réutilisé ne
  l'est pas — et un numéro supprimé n'est jamais rendu.
- **Le document d'une tâche a un chemin stable** : `tasks/<code>.md`, sans le titre.
- **Aucun fichier existant n'est écrasé pendant une synchronisation.** Un document identique est
  adopté ; un document différent produit un conflit, jamais un remplacement.
- **Une panne du runner ne supprime jamais une tâche.** Base et disque sont deux étapes
  distinctes. À la suppression, l'ordre est `runner → SQLite`, jamais l'inverse ; un document
  absent est une réussite idempotente.
- **Aucune tâche possédant un historique d'exécution n'est supprimée.** Vérifié dans la
  transaction, et doublé par une contrainte `Restrict`. Aucun run n'est jamais supprimé.
- **Les statuts internes restent stables.** `DRAFT`, `READY`, `COMPLETED`… ne changent ni en
  base, ni dans les contrats, ni dans les documents déjà générés. Seul leur affichage est
  traduit, et **les libellés sont centralisés** dans `apps/web/lib/labels.ts`, nulle part
  ailleurs.
- **Toute transition passe par `canTransitionTaskStatus`.** `RUNNING`, `FAILED` et `REVIEW` ne
  se posent jamais à la main.

### 8.3 Exécution de Claude Code

- **Les commandes de validation enregistrées ne sont jamais exécutées par NOX.** Elles sont
  autorisées à Claude Code, une par une et à l'identique ; le runner n'en exécute aucune, et
  n'en relance aucune.
- **Toute exécution exige un repository propre et synchronisé.** Le lancement est toujours
  explicite : NOX ne déclenche jamais Claude Code de lui-même, ni pour réessayer, ni pour
  enchaîner une tâche.
- **Une seule exécution active à la fois**, tous projets confondus.
- **Aucun prompt libre ne vient du navigateur.** Il est régénéré côté serveur à partir de la
  tâche en base ; les règles d'outils sont calculées, jamais reçues.
- **Aucune clé d'API Anthropic dans NOX.** L'authentification est celle déjà configurée dans
  Claude Code.
- **`--dangerously-skip-permissions` n'est jamais passé**, sous aucune condition.
- **Aucune variable `NOX_*` n'atteint le processus enfant.** Le filtre porte sur le préfixe
  entier, jamais sur une liste nominative : une variable ajoutée plus tard est couverte d'office.
- **Aucun commit ni push automatique, aucune réparation Git automatique.** NOX constate l'état
  laissé sur le disque ; il ne le restaure pas — y compris après une annulation.
- **Un résultat de Claude Code ne vaut pas validation humaine.** Une réussite mène à `REVIEW`,
  jamais à `COMPLETED`.

### 8.4 Événements et annulation

- **Aucun événement brut n'atteint le navigateur.** Ce qui circule est un `ClaudeRunEvent` dont
  le runner décide chaque champ ; le type est fermé et n'a aucun champ libre.
- **Le raisonnement interne du modèle n'est jamais exposé ni persisté.** `thinking`,
  `redacted_thinking`, `reasoning`, `analysis` et tout bloc portant une `signature` sont ignorés
  avant d'être lus. La liste des blocs affichables est **fermée**, jamais une liste d'exclusions.
- **Toute chaîne publique passe par la sanitation centralisée** — pas « toute chaîne suspecte » :
  toutes. Chemins du repository rendus relatifs, chemins extérieurs masqués, variables `NOX_*`
  retirées (valeur **et** nom), caractères de contrôle supprimés, taille bornée.
- **Une commande n'est affichée que si elle est exactement autorisée.** La ligne est découpée sur
  `&&` **en respectant les guillemets**, son préfixe `cd <chemin>` est retiré et jamais affiché.
  Un segment non reconnu devient `...` : son existence est dite, jamais son contenu. Toute autre
  construction — `;`, `|`, `>`, `<`, `` ` ``, `$(`, `&` isolé, guillemet non fermé — fait
  renoncer à la ligne entière, y compris à l'intérieur des guillemets.
- **Un segment non affichable n'efface pas la validation qui l'accompagne.** Affichage et
  reconnaissance sont deux questions distinctes.
- **La liste de validations de la tâche prime sur toute classification générique.** Un segment
  correspondant mot pour mot à une commande enregistrée **est** une validation.
- **Une issue ambiguë n'est jamais tranchée.** Un échec n'est imputé à une validation que si elle
  était **seule** sur sa ligne ; sinon l'issue reste `UNKNOWN`. Une réussite prouve que tous les
  segments d'un chaînage `&&` ont tourné. Une commande relancée est représentée par son dernier
  résultat terminal, et ne redevient jamais `NOT_RUN`. Seule exception : la sortie d'un
  `tool_result` peut être résumée dans la review quand son `tool_use` correspond mot pour mot à
  une commande enregistrée.
- **Les bornes sont des constantes, jamais des variables d'environnement** : une limite de
  sécurité qu'on peut desserrer n'en est plus une. Après troncature, le runner **continue de
  lire `stdout`**.
- **Aucun numéro d'événement ne vient de Claude Code.** `sequence` et `occurredAt` sont produits
  par le runner ; la reprise se fait par curseur, jamais par décalage.
- **Aucun identifiant de processus ne vient du navigateur.** Le corps d'une annulation ne porte
  qu'un `runId` : aucun PID, aucun signal, aucun délai, aucune option de forçage. L'arrêt de
  l'arbre a **une seule** implémentation.
- **Le premier état final validement enregistré gagne.** `CANCELLING` n'en est pas un. Un run
  annulé mène la tâche à `BLOCKED`, jamais à `READY`.

### 8.5 Review Git et corrections

- **Une review historique ne lit jamais le dossier de travail actuel.** Elle se lit entièrement
  en base.
- **Un instantané finalisé est immuable.** La garantie vit dans la couche d'écriture, jamais dans
  la discipline de l'appelant.
- **Aucun contenu sensible dans un patch.** `.env` et variantes, `*.pem`, `*.key`, `id_rsa`,
  `id_ed25519`, `credentials.json`, `secrets.json` : chemin, type et statistiques visibles,
  `patch` toujours `null`. La règle est appliquée deux fois, et la seconde ne fait pas confiance
  à la première. Seuls `.env.example` et `.env.sample` sont exclus, nommément.
- **Aucun blob binaire en SQLite.** **Un patch est du texte**, jamais du HTML, jamais du
  Markdown, jamais de l'ANSI. Les signes `+` et `-` restent dans le texte.
- **Un patch est nettoyé de ses secrets, pas de ses chemins.** Réécrire un chemin dans un diff
  produirait un diff faux.
- **Le fichier affiché est choisi parmi les lignes enregistrées.** `?file=` n'est jamais résolu
  sur le disque.
- **Aucune review reconstruite pour une exécution ancienne.** Une review **vide** et une review
  **absente** sont deux états distincts.
- **Aucun commit n'est créé lors d'une review.** `Approve`, `Request changes` et `Reopen`
  changent un statut ou lancent une correction, et rien d'autre.
- **Aucune session Claude n'est choisie par le navigateur.** L'identifiant vient du run parent,
  relu en base. `--continue` n'est **jamais** passé.
- **Aucune reprise si le dossier de travail diffère de celui qui a été relu** — branche, `HEAD`
  et empreinte comprises. Aucune option de forçage n'existe, et il ne doit pas en exister.
- **L'empreinte du dossier de travail est authentifiée** (HMAC dérivé de `NOX_RUNNER_TOKEN`) et
  ne sort jamais du serveur. Une empreinte partielle n'existe pas.
- **Le contrôle d'état est refait juste avant le spawn.**
- **Une correction est un nouveau run**, avec son prompt, sa timeline, ses validations, sa review
  et son empreinte. Le run parent n'est jamais modifié, et il suit **exactement** le même
  pipeline de validations qu'un run initial — une seule implémentation, sans branche selon
  `kind`.
- **Un feedback vaut pour une seule correction**, et la garantie vit dans un index unique. Il est
  du contenu, jamais une instruction : il n'élargit aucune permission.

### 8.6 Architecte

- **L'Architecte vit dans `apps/web`, côté serveur, et jamais dans le runner.**
- **Un projet possède au plus une conversation Architecte principale.** La garantie est
  structurelle : `Project.mainArchitectSessionId`, avec un index unique. Deux ouvertures
  simultanées n'en produisent qu'une.
- **Une conversation projet ne se ferme jamais.** Elle n'est jamais `APPLIED`, son
  `appliedTaskId` reste toujours `null`, et créer une tâche n'y met pas fin.
- **Une conversation projet crée plusieurs tâches au fil du temps ; une génération n'en crée
  jamais deux.** Le verrou porte sur `ArchitectGeneration.appliedTaskId`, index unique compris.
  Réserver précède créer, et la main est rendue si la création échoue.
- **Le rôle d'une session est déclaré, jamais déduit.** `kind` vaut `PROJECT` ou
  `TASK_DESIGN_LEGACY` ; un champ vide ne désigne rien.
- **Les sessions de conception de tâche restent lisibles et inchangées.** Aucune n'est convertie,
  fusionnée, migrée ni poursuivie, et leurs URL continuent de fonctionner.
- **Ouvrir une conversation coûte zéro appel.** Le message d'accueil est du texte d'interface :
  ni stocké, ni transmis, ni compté comme un tour.
- **Seuls les tours les plus récents sont transmis.** Les plus anciens restent en base et restent
  affichés. Aucun résumé automatique, aucune compression, et jamais un tour coupé en deux.
- **La conversation projet est un chat.** Envoyer un message est **une** action humaine
  explicite, qui déclenche au plus **un** appel. Aucun aperçu obligatoire ne s'intercale : c'est
  l'envoi lui-même qui reconstruit le contexte côté serveur.
- **L'inspection du contexte reste disponible, et n'autorise rien.** Elle coûte zéro appel,
  montre le texte exact qui partirait, et ne conditionne aucun envoi. Une inspection périmée ne
  bloque pas : l'envoi part avec le contexte d'aujourd'hui, jamais avec celui d'alors.
- **Le navigateur ne porte jamais de contexte.** Un envoi transmet le texte du message et un
  compteur de messages, rien d'autre. Ce compteur est un indice : il ne peut qu'obtenir un refus,
  jamais élargir quoi que ce soit.
- **Un onglet resté sur un état dépassé est refusé, sans appel**, et son texte lui est rendu.
- **Un événement local n'est jamais un message.** Une tâche créée s'affiche dans le fil, dérivée
  de `ArchitectGeneration.appliedTaskId` ; elle n'entre ni dans le transcript, ni dans le prompt,
  ni dans le décompte de jetons, et aucun `ArchitectMessage` n'est écrit pour elle.
- **L'attente est un état d'écran, jamais une ligne en base.** Les trois points affichés pendant
  un envoi, et la bulle du message en cours d'envoi, ne sont ni stockés, ni transmis, ni comptés.
  Ils disparaissent quand le tour aboutit **comme** quand il échoue : aucun état d'attente ne
  peut rester bloqué.
- **NOX ne fait aucun streaming.** La réponse est reçue entière, en un appel, et enregistrée avant
  d'être affichée ; seule sa **révélation à l'écran** est progressive. Ni streaming réseau, ni
  SSE, ni route supplémentaire, et le vocabulaire du code ne doit pas laisser croire l'inverse.
  Cette animation est bornée en durée, ne concerne que la réponse arrivée pendant que la page
  était ouverte, et l'historique s'affiche toujours d'un bloc.
- **L'apparence d'un message ne change rien à ce qu'il est.** Alignement et couleur sont de
  l'affichage : le contenu stocké est identique, et le fournisseur ne voit ni l'un ni l'autre.
- **L'empreinte enregistrée à un aperçu couvre le tour entier** — contexte, transcript retenu,
  message en attente — et non le seul contexte projet.
- **L'Architecte n'a aucun outil.** L'appel ne déclare ni `tools`, ni `tool_choice`, ni
  `previous_response_id`, ni `conversation`, ni mode background. Cette garantie ne repose sur
  aucun prompt.
- **La clé s'appelle `NOX_OPENAI_API_KEY`** — le préfixe la place hors de portée de Claude Code
  par construction. Elle ne quitte jamais le serveur : ni navigateur, ni base, ni log, ni message
  d'erreur, ni prompt, même partiellement. Une variable manquante est signalée par son **nom**.
- **Aucun modèle par défaut. Aucune URL de base configurable.**
- **Le contexte est une liste fermée**, fixe et automatique : `CLAUDE.md`, `AGENTS.md`, six
  documents `docs/` nommés, les dix dernières tâches, la mémoire active. Le navigateur ne choisit
  aucun fichier. Aucun `.env`, aucun code source, aucun diff, aucun prompt, aucune timeline,
  aucune sortie de Claude Code n'est jamais candidat — ce ne sont pas des filtres : ces éléments
  n'entrent dans aucun chemin de code menant au fournisseur.
- **Toute chaîne transmise passe par `sanitizeArchitectContext`**, qui préserve le Markdown et
  n'est **pas** le nettoyeur d'événements du runner.
- **Le Structured Output ne dispense d'aucune validation.** Tailles, énumérations, références
  documentaires et commandes sont revalidées côté serveur ; une commande proposée passe
  `checkValidationCommand`. Un document référencé appartient à la liste fermée transmise.
- **Aucun appel n'est automatique** : ni au chargement, ni au changement d'un champ, ni
  périodiquement, ni après un échec. `maxRetries` vaut zéro. Chaque clic est un appel, et chaque
  appel est facturé.
- **Une seule génération active à la fois.** Les verrous sont des mises à jour conditionnelles
  en base, jamais une vérification suivie d'une écriture. Une session de conception de tâche
  reste bornée à vingt générations ; une conversation projet n'a pas de borne de vie — ce qu'elle
  protégeait est déjà assuré par le clic obligatoire, l'absence de réessai et le verrou d'unicité.
- **La conversation appartient à NOX.** Le transcript vit dans SQLite et est reconstruit **en
  entier** à chaque tour ; `store` reste `false`. Il est borné, jamais résumé : au-delà, NOX
  refuse et invite à ouvrir une nouvelle conversation.
- **Chaque tour reconstruit son contexte** à partir du projet actuel, au moment de l'envoi. Il
  n'existe aucun « continuer avec l'ancien contexte ». Dans le parcours en deux clics d'une
  session de conception, un contexte modifié après l'aperçu bloque l'appel — sans `Send anyway`.
- **L'empreinte de contexte n'est pas une primitive de sécurité** : SHA-256 nu, contrairement à
  l'empreinte de dossier de travail, qui est un HMAC parce qu'elle décide d'une exécution. Ne
  jamais confondre les deux.
- **La révision d'une tâche se calcule sur ce qui est envoyé**, jamais sur `updatedAt`.
- **Un message n'entre dans la conversation que si le tour a abouti.** Les deux messages sont
  écrits dans la même transaction que la conclusion de la génération.
- **Le message d'ouverture n'existe qu'en un exemplaire**, et le navigateur n'en transmet jamais
  le texte.
- **Seule la dernière proposition est créable**, et plus du tout si un tour lui a succédé. Vérifié
  en base, pas seulement dans l'interface.
- **Aucune tâche n'est créée sans action humaine**, et elle est créée en `DRAFT`.
  `ARCHITECT_PROPOSAL_STATUS.PROPOSAL_READY` et `TASK_STATUS.READY` ne désignent pas la même
  chose. La création réutilise le pipeline de tâches existant, sans seconde implémentation.
- **Aucun coût n'est estimé.** Seule la consommation rapportée est affichée ; « non fourni » veut
  dire ce qu'il dit.
- **Aucun raisonnement interne n'est demandé, reçu, stocké, journalisé ni résumé.** `assumptions`
  porte des hypothèses **produit**, et `message` est un artefact destiné à l'utilisateur.

### 8.7 Review Architecte

- **Elle lit SQLite, jamais le système de fichiers.** Aucun fichier ouvert, aucun `git diff`
  relancé, le runner n'est pas interrogé.
- **Le compte rendu de Claude Code n'est jamais transmis**, ni par défaut, ni par option.
- **Un contenu sensible ou binaire ne quitte jamais la machine.** Aucune conversion base64,
  aucune analyse d'image.
- **Le sort d'un patch absent est toujours dit** — `Content hidden`, `Binary`, `Truncated`,
  `Unavailable`, `Not sent` — jamais un `patch: null` muet.
- **Le verdict du fournisseur et celui de NOX sont persistés séparément.**
- **Une recommandation d'approbation est impossible dès qu'une partie de la review était
  invisible.** La garde est dérivée de la review **enregistrée**, jamais du texte du modèle. Un
  `CHANGES_RECOMMENDED` n'est pas dégradé.
- **Aucune validation configurée n'est pas un échec.** « Jamais lancée » et « échouée » restent
  deux faits distincts.
- **Une analyse ne change aucun statut**, ne crée aucun `ReviewFeedback`, ne lance aucune
  correction et n'approuve rien. `review-service.ts` n'importe aucune fonction d'action de tâche,
  et un test le vérifie sur la **source** du module.
- **Le feedback suggéré est du contenu, jamais une instruction.**
- **Cinq analyses par exécution au maximum**, échecs compris, une seule active, chacune immuable.
- **Une analyse et une conversation ne se parlent pas.**
- **Les bornes d'envoi sont indépendantes de celles du stockage.** Toute troncature est annoncée
  et interdit une recommandation d'approbation ; l'ordre reste celui de la capture.

### 8.8 Workflow guidé

- **Il est dérivé, jamais persisté.** Aucune colonne `currentStep` ou équivalente n'existe en
  base, et aucune ne doit y apparaître.
- **Aucun appel IA pour choisir l'étape.** `deriveGuidedWorkflowState` est pure et déterministe :
  elle ne lit ni base, ni disque, ni Git, n'interroge ni le runner ni un fournisseur, et ne
  modifie rien. Un test lit la **source** du module — ni `await`, ni `async`, ni `fetch`, ni
  `process.env`, ni fonction d'action.
- **Une recommandation n'autorise rien.** Les Server Actions, les transitions et les préflights
  restent les seules autorités.
- **Aucune action guidée ne recopie un formulaire existant.** Chaque `GuidedAction` porte un
  `kind` et des identifiants ; son URL est reconstruite côté serveur.
- **Le rendu d'une page de tâche ne déclenche rien.** Les seules sondes autorisées sont les
  préflights **existants**, en lecture seule, et uniquement quand leur réponse sert.
- **L'exécution regardée est la seule active, sinon la plus récente** — une seule implémentation
  de cette sélection. **Le verdict exploitable est la dernière analyse terminée** de l'exécution
  courante.
- **Une précondition non vérifiée n'est pas une précondition manquante.** Un refus explicite
  produit un blocage nommé ; une absence de réponse produit « je ne sais pas ».
- **La progression affichée compte cinq étapes fixes**, jamais une par exécution.
- **Une action qui engage une IA est annoncée, et elle seule.**

### 8.9 État structuré du projet

- **Le Project Brief et le Living V1 Plan sont l'intention produit courante**, structurée et
  validée par l'utilisateur. La **mémoire projet** porte des décisions, contraintes,
  conventions et connaissances durables explicites. La **documentation du repository** décrit
  l'état du dépôt, et peut avoir pris du retard sur l'intention produit. Trois sources, trois
  rôles ; les confondre est l'erreur que ce paragraphe existe pour empêcher.
- **Une mise à jour proposée par l'Architecte n'est qu'une proposition.** Seule une application
  explicitement humaine change l'état structuré du projet.
- **Édition manuelle, Apply et Dismiss n'appellent ni OpenAI, ni Claude Code, ni le runner, et
  ne touchent jamais Git.** Ce sont des écritures SQLite ; les pages fonctionnent runner arrêté
  et sans configuration OpenAI.
- **Les révisions de base d'une proposition sont celles réellement vues par le fournisseur**,
  capturées à la préparation du tour — jamais relues après l'appel. C'est le seul endroit de NOX
  où relire l'état courant côté serveur serait la mauvaise réponse.
- **La proposition du fournisseur et la valeur appliquée par l'humain restent historiquement
  distinctes.** `proposedJson` n'est jamais réécrit ; `appliedJson` porte ce qui a été retenu.
- **Une proposition périmée n'est jamais fusionnée automatiquement.** Toute divergence de
  révision — brief ou plan — la refuse, et aucun chemin de code ne mène d'un conflit à un appel.
- **Le brief et le plan partagent un seul budget de 16 Kio**, mesuré après sanitation, refusé à
  l'écriture et jamais tronqué.
- **Absent et défini-mais-vide sont deux états distincts**, du schéma jusqu'à l'écran. Ouvrir
  une page n'en crée jamais aucun.
- **Aucune matérialisation en Markdown.** L'état structuré de NOX n'est pas
  `docs/PROJECT_BRIEF.md`, et aucune synchronisation n'existe entre les deux.
- **Une carte de proposition n'est pas un message.** Elle est dérivée de la base, et n'entre ni
  dans le transcript, ni dans le prompt, ni dans le décompte de jetons.

### 8.10 Mémoire projet

- **Elle est contrôlée par l'utilisateur, et par lui seul.** Aucune entrée n'est créée, modifiée
  ou archivée automatiquement : ni depuis une conversation, ni depuis une proposition, ni depuis
  une review, ni depuis un compte rendu de Claude Code. Le Structured Output d'un tour ne porte ni
  `memoriesToCreate`, ni `memoriesToUpdate`.
- **Aucune opération de mémoire n'appelle OpenAI, Claude Code ou le runner.** Ce sont des
  écritures SQLite ; un test le vérifie sur la source des modules.
- **La mémoire vit dans SQLite, jamais dans le repository.** Aucune écriture Git, aucun fichier
  Markdown généré, aucune modification de `CLAUDE.md`.
- **Seules les entrées `ACTIVE` atteignent la conversation, et toutes l'atteignent.** Il n'existe
  pas de troisième état.
- **Aucune troncature silencieuse, aucun classement.** Une opération qui ferait dépasser le
  budget est refusée à l'**écriture**, avec ses trois sorties ; les entrées partent dans l'ordre
  de leurs codes.
- **Sanitisée avant de partir, stockée telle qu'écrite.** Budget et révision se mesurent sur le
  texte **envoyé**.
- **Un changement de mémoire est un changement de contexte** : les entrées actives entrent dans
  l'empreinte de contexte.
- **La review Architecte ne reçoit pas la mémoire.** Élargir cette surface demande une décision
  séparée.
