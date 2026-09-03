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
`NOX_OPENAI_API_KEY` et `NOX_ARCHITECT_MODEL` ne sont lus que par lui. Seule la clé est
obligatoire ; le modèle a un défaut, nommé une seule fois dans
[apps/web/lib/architect/config.ts](apps/web/lib/architect/config.ts).

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
  Seule exception, nommée : le **nettoyage des documents de tâches d'un projet supprimé**, dont
  la route dédiée calcule et **rapporte** la révision — un document divergent est annoncé comme
  tel — sans en faire une condition. Ce qui prouve l'appartenance y est la révision enregistrée
  en base, sans laquelle le document n'entre même pas dans la requête.
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

- **Une tâche d'amorçage peut installer et vérifier sa fondation ; aucune autre ne le peut.**
  Une tâche `BOOTSTRAP` reçoit une **liste fermée** de programmes d'écosystème, jamais l'outil
  `Bash` entier, jamais un interpréteur de commandes, jamais `cd`. Une tâche `NORMAL` ne reçoit
  pas une règle de plus qu'avant. `--dangerously-skip-permissions` reste interdit, sans condition.
- **Les refus tiennent pendant un amorçage, et s'étendent.** Commit, push, réinitialisation Git,
  suppression et commandes réseau restent refusés ; s'y ajoutent la publication, le déploiement,
  l'accès à une machine distante, l'élévation de privilèges et la lecture d'un fichier hors de
  l'outil de lecture. Un refus l'emporte toujours sur une autorisation, et une commande
  enregistrée qui entrerait en conflit **bloque le lancement** au lieu d'être arbitrée à
  l'exécution.
- **Installer n'est pas valider.** « Aucune validation structurée configurée » et « aucune
  commande exécutée » sont deux faits distincts, et le compte rendu d'un amorçage les sépare en
  deux sections. La règle générale — ne pas inventer de validation là où rien n'est configuré —
  reste entière.
- **La nature d'une tâche est transmise au runner, jamais déduite.** Elle est relue en base par
  le serveur web ; le navigateur ne la porte pas, et un corps qui ne la déclare pas est refusé.
- **Les commandes de validation enregistrées ne sont jamais exécutées par NOX.** Elles sont
  autorisées à Claude Code, une par une et à l'identique ; le runner n'en exécute aucune, et
  n'en relance aucune.
- **Toute exécution exige un dossier de travail propre.** Sans état de départ connu, il devient
  impossible de dire ce que l'agent a changé. Le lancement est toujours explicite : NOX ne
  déclenche jamais Claude Code de lui-même, ni pour réessayer, ni pour enchaîner une tâche.
- **La synchronisation avec l'upstream n'est exigée que là où la politique de livraison la
  produit.** Une branche **en retard** est toujours refusée : aucune politique ne crée cet état.
  Une branche **en avance** est refusée sous `MANUAL` et `AUTO_COMMIT_PUSH`, et acceptée sous
  `AUTO_COMMIT` — c'est exactement ce que cette politique produit à chaque tâche livrée, et la
  refuser rendrait la file inutilisable dès la deuxième. La politique est relue en base par le
  serveur web et **rejouée par le runner** ; absente ou illisible, elle vaut `MANUAL`.
- **« Le repository peut-il recevoir une autre tâche ? » et « la livraison est-elle satisfaite ? »
  restent deux questions distinctes.** La première est le préflight ; la seconde est
  `deliverySatisfied`. Aucune ne doit emprunter sa réponse à l'autre.
- **Au plus une exécution active par repository canonique.** Deux repositories différents
  peuvent exécuter Claude Code en même temps ; un même repository, jamais — voir § 8.20.
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
- **Le modèle par défaut est une autorité unique, jamais une valeur recopiée.**
  `DEFAULT_ARCHITECT_MODEL` vit dans `apps/web/lib/architect/config.ts`, et aucun autre module de
  production n'écrit d'identifiant de modèle. `NOX_ARCHITECT_MODEL` reste lue et reste
  prioritaire ; son absence n'est plus un refus. L'effort de raisonnement se **dérive** du modèle
  retenu : NOX n'en demande un que pour celui qu'il a choisi lui-même, parce qu'il ne connaît pas
  les capacités des autres. Rien d'autre de `reasoning` n'est jamais déclaré — ni `summary`, ni
  `include` : le raisonnement interne n'est ni demandé, ni reçu.
- **Chaque génération enregistre le modèle réellement utilisé.** Une ligne historique n'est jamais
  réécrite pour afficher le modèle du jour.
- **Aucune URL de base configurable.**
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

### 8.11 Backlog de V1

- **Générer un backlog est une action humaine explicite, et coûte au plus un appel.** Aucun
  rendu de page, aucun plan enregistré, aucune mise à jour de projet appliquée, aucune tâche
  terminée, aucun minuteur et aucun échec précédent ne la déclenche. Un refus — plan absent,
  planification en vol, proposition en attente — est constaté **avant** l'appel, et coûte zéro.
- **Une proposition de backlog ne crée jamais de tâche.** Seule une application explicitement
  humaine le fait.
- **Les tâches créées sont toujours `DRAFT`.** Jamais `READY`, jamais en file, jamais lancées.
- **Appliquer n'appelle personne et ne livre rien** : ni OpenAI, ni Claude Code, ni `git add`,
  ni commit, ni push.
- **Aucune tâche existante n'est modifiée, supprimée ou renumérotée** par une application. Un
  backlog appliqué s'ajoute à la suite ; les numéros viennent de `Project.nextTaskSequence`,
  qui ne recule jamais.
- **Une proposition est fondée sur le contexte de planification réellement vu par le
  fournisseur.** L'empreinte est capturée avant l'appel et jamais relue après — même correction
  qu'en TASK-021, pour la même raison.
- **Si ce contexte change avant l'application, la proposition est périmée et refusée**, jamais
  fusionnée. Aucun chemin de code ne mène d'un conflit à un appel, et il n'existe ni « Merge
  with current », ni « Auto resolve », ni « Refresh with AI ».
- **La péremption se dérive, elle ne se stocke pas.** Il n'existe aucun statut `STALE`.
- **Au plus une proposition en attente par projet**, et au plus une planification en vol. Les
  deux verrous sont des colonnes de `Project`, prises par mise à jour conditionnelle.
- **Un backlog est une unité.** Un seul élément invalide condamne toute la proposition à la
  génération, et tout le lot à l'application. Jamais huit tâches sur neuf.
- **La création des tâches est atomique.** L'état « trois tâches créées, la quatrième en
  erreur, proposition marquée appliquée » n'existe pas.
- **NOX ne prétend pas à l'atomicité entre SQLite et le disque.** Les documents Markdown sont
  écrits après la transaction, un par un, avec la primitive exclusive de TASK-007. Le préflight
  refuse d'appliquer si le repository ne répond pas ; une panne pendant l'écriture laisse un
  document à reprendre, état visible et jamais silencieux.
- **Aucun chemin de fichier ne vient du fournisseur.** Le code d'une tâche est attribué par
  NOX, et son document en est dérivé.
- **L'amorçage du repository n'appartient pas au backlog.** NOX le traite séparément ; le
  planificateur ne produit aucune tâche d'initialisation, de scaffold ou de documentation
  initiale, et le prompt ne lui souffle jamais le code de cette tâche.
- **Le backlog planifie la V1 validée, il n'en propose pas une meilleure.** Chaque capacité
  visible par l'utilisateur se rattache à une exigence du brief, du plan, de la mémoire ou d'une
  tâche existante ; une nécessité d'implémentation reste autorisée, une capacité produit non
  demandée ne l'est pas. Aucun choix technique n'est figé là où le plan le laisse délibérément
  ouvert : un backlog n'est ni une séance d'idéation, ni la mémoire du projet.
- **La proposition du fournisseur est immuable.** `providerJson` n'est jamais réécrit ;
  `appliedJson` porte ce que l'humain a retenu, et les deux restent distincts.
- **L'ordre appliqué est celui validé par l'humain**, jamais celui du fournisseur.
- **La planification ne reçoit aucun transcript.** Le brief, le plan, la mémoire, l'inventaire
  des tâches et la documentation autorisée suffisent — c'est ce que TASK-021 existe pour rendre
  vrai. `backlog/1` est un workflow séparé : la conversation projet reste inchangée.
- **La planification ne crée ni mémoire, ni message de conversation, ni mise à jour de projet.**
  Aucun faux échange n'est ajouté au transcript de l'Architecte.
- **Le navigateur ne porte aucune autorité** : ni contexte, ni prompt, ni modèle, ni état du
  projet, ni inventaire, ni empreinte, ni codes de tâche à venir. Il transmet un identifiant
  et les valeurs que l'utilisateur a saisies, toutes revalidées côté serveur.

### 8.12 Amorçage d'un projet

- **`TASK-000` est réservée à l'amorçage du repository.** Son numéro est `0` ;
  `Project.nextTaskSequence` démarre à `1` et ne recule jamais, donc aucune attribution
  ordinaire ne peut le produire. Une tâche normale ou issue d'un backlog ne reçoit jamais ce
  code, même en concurrence.
- **Au plus une tâche d'amorçage par projet**, et la garantie est structurelle :
  `@@unique([projectId, sequence])`. Deux créations simultanées n'en produisent qu'une.
- **Créer `TASK-000` ne consomme aucun numéro.** `nextTaskSequence` n'est ni lu, ni
  incrémenté : la tâche suivante reçoit le numéro qu'elle aurait reçu sans elle.
- **Aucune tâche existante n'est modifiée, supprimée, renumérotée ou déplacée** par un
  amorçage, et leur provenance de backlog reste intacte. `TASK-000` n'en porte aucune.
- **La nature d'une tâche est déclarée, jamais déduite d'un code.** `Task.kind` vaut `NORMAL`
  ou `BOOTSTRAP` ; il n'existe pas de troisième valeur, et un registre générique de types de
  tâches n'a pas lieu d'être.
- **L'amorçage est explicite et déterministe : il n'appelle aucun fournisseur.** Ni à
  l'ouverture de la page, ni à l'aperçu, ni à la création. Le texte affiché avant création est
  exactement celui qui sera créé.
- **Aucune création automatique.** Ni un projet créé, ni un brief enregistré, ni un plan
  enregistré, ni un backlog appliqué, ni l'ouverture d'une page ne produit `TASK-000`.
- **Créer `TASK-000` ne lance jamais Claude Code.** Elle naît `DRAFT`, et c'est un humain qui
  la passe `READY` puis la lance. « Disponible » ne signifie pas « fait » : NOX peut recevoir
  un repository qui n'a besoin d'aucun amorçage.
- **L'exécution réutilise le pipeline existant.** Aucun second moteur, aucun second cycle de
  vie : l'état d'amorçage est **dérivé** de la tâche, jamais persisté.
- **Les préconditions sont vérifiées avant de faire travailler le runner** : brief, plan et
  au moins un backlog `APPLIED`. Une proposition `PENDING` ou `DISMISSED` ne compte pas.
- **Le contexte vient des vraies tâches créées**, jamais du `providerJson` d'une proposition :
  ce que l'humain a appliqué fait foi.
- **L'inspection du repository est en lecture seule et ne lit aucun contenu.** Le runner rend
  des noms d'entrées reconnues ; la classification est calculée côté web.
- **Un repository existant est inspecté et préservé, jamais remplacé.** Le contrat interdit de
  supprimer du code, de réinitialiser Git ou d'écraser une documentation sans l'avoir lue.
- **Si l'état change entre l'aperçu et la création, la création est refusée**, jamais fusionnée.
  Il n'existe ni « créer quand même », ni résolution automatique.
- **`TASK-000` prépare les fondations ; elle n'implémente aucune fonctionnalité du backlog.**
  Les tâches à venir lui sont transmises pour être évitées, pas faites.
- **Aucun document inexistant n'est référencé.** Le champ `documents` ne porte que des fichiers
  réellement présents ; ceux à créer sont décrits comme livrables.
- **Aucune entrée de mémoire n'est créée par l'amorçage**, ni avant, ni après l'exécution.
- **Le Project Brief et le Living V1 Plan restent l'autorité dans NOX.** Leur matérialisation
  en Markdown est un instantané, jamais une synchronisation bidirectionnelle.

### 8.13 Dépendances entre tâches

- **Une dépendance est une arête explicite et persistée.** `taskId` **attend**
  `dependsOnTaskId` ; inverser les deux produirait un graphe qui a l'air correct et qui bloque
  exactement les mauvaises tâches. Aucune dépendance n'est jamais déduite d'un numéro : un code
  plus petit ne fait pas une antériorité.
- **Le graphe est acyclique et local au projet.** Les cycles **transitifs** sont refusés, pas
  seulement l'arête inverse, et la vérification a lieu dans la transaction, **après** l'écriture :
  c'est ce qui empêche deux requêtes simultanées d'en fermer un à elles deux. Une tâche ne dépend
  jamais d'elle-même, et jamais d'une tâche d'un autre projet — même si le navigateur forge
  l'identifiant.
- **Seul `COMPLETED` satisfait une dépendance.** Ni `READY`, ni `RUNNING`, ni `REVIEW`.
- **Une dépendance ne modifie jamais `Task.status`.** Une tâche prête qui attend reste prête :
  c'est le lancement qui est refusé, pas la tâche qui est bloquée. `BLOCKED` reste un état
  décidé par un humain.
- **Rien de ce qui se dérive n'est stocké.** Aucun compteur de dépendances satisfaites en base :
  il serait faux dès la première réouverture d'une tâche terminée.
- **Une exécution est refusée tant qu'une dépendance n'est pas terminée**, correction comprise —
  une reprise est une nouvelle exécution. Le contrôle est refait côté serveur, avant toute
  écriture et avant toute sollicitation du runner, et le refus nomme les tâches qui manquent.
- **`TASK-000` ne dépend d'aucune tâche produit.** L'inverse est autorisé, et c'est le cas
  utile. L'amorçage ne reçoit aucune dépendance implicite : rien n'est créé automatiquement.
- **Une tâche attendue par une autre n'est pas supprimable.** Le refus la nomme ; retirer la
  dépendance reste un geste humain.

### 8.14 Modification d'une tâche future

- **Une tâche n'est modifiable qu'avant sa première exécution.** Le critère est `runCount === 0`,
  jamais le statut : une tâche rouverte après un échec porte un historique, donc reste figée.
  Les corrections d'un travail déjà produit passent par `Request changes` et `Reopen` — il
  n'existe pas de seconde façon de réécrire une tâche.
- **Code, numéro, nature, provenance de backlog et historique d'exécution sont immuables.** Une
  proposition de backlog `APPLIED` reste ce qui a été appliqué à l'époque ; la tâche devient le
  contrat courant, et les deux restent distincts.
- **Une sauvegarde est une seule opération.** Contrat, dépendances et statut changent ensemble
  ou pas du tout, et toute la validation précède la première écriture.
- **Une tâche en file redevient un brouillon dès que son contrat change**, et seulement alors.
  Une sauvegarde sans modification ne touche ni le statut, ni `updatedAt`, ni le document.
- **La concurrence optimiste porte sur le contrat, jamais sur `updatedAt`.** Un onglet resté
  sur un état dépassé est refusé, jamais fusionné, et son contenu lui est rendu.
- **Le document Markdown suit la transaction, il ne la conditionne pas.** Il est réécrit sous
  contrôle de révision ; un fichier modifié à la main produit un conflit, jamais un écrasement.
  Éditer ce fichier ne modifie toujours pas la tâche : la synchronisation reste à sens unique.
- **Aucun appel OpenAI, aucun Claude Code, aucune écriture Git.** Éditer une tâche ou gérer ses
  dépendances sont des écritures SQLite ; les pages fonctionnent runner arrêté.
- **Le planificateur de backlog est inchangé.** `backlog/1` ne propose aucune dépendance : elles
  sont posées à la main après l'application.

### 8.15 Tableau de bord et cycle de vie d'un projet

- **La page d'accueil est centrée projets.** Aucune roadmap statique, aucune « phase courante »,
  aucun inventaire du socle technique, aucune version codée en dur ne pilote l'interface : un
  écran qui décrit l'avancement de NOX lui-même se périme par construction.
- **Tout ce que le tableau de bord affiche est dérivé.** Aucun compteur, aucun état
  d'avancement, aucune « progression » n'est stocké en base, et ouvrir la page n'appelle ni
  fournisseur, ni Claude Code, ni le runner.
- **Supprimer un projet, c'est supprimer son état NOX, jamais son repository applicatif.** Ni
  code source, ni `.git`, ni documentation fondamentale, ni fichier arbitraire n'est retiré.
- **Seuls les documents de tâches dont NOX connaît la révision sont nettoyés.** L'appartenance
  se prouve en base, jamais par un motif de nom de fichier : un `tasks/TASK-999.md` qu'aucune
  tâche ne revendique est préservé, et un balayage de `tasks/*.md` n'existe pas.
- **Aucun chemin ne vient du navigateur.** La suppression reçoit un identifiant de projet et un
  nom recopié ; la liste des documents à retirer est reconstruite côté serveur.
- **Le disque avant la base.** Supprimer les lignes d'abord emporterait les révisions qui
  prouvent l'appartenance des documents. Un échec de nettoyage **refuse** la suppression : un
  projet à moitié supprimé n'existe pas, et un artefact resté en place l'interdit entièrement.
- **Une suppression de projet ne touche jamais à Git.** Aucun `git add`, aucun commit, aucun
  push, aucun `reset`, aucun `restore`. Le repository peut rester « dirty » : c'est un fait
  annoncé, pas un problème à réparer.
- **Un projet dont une exécution Claude est active n'est pas supprimable**, et NOX ne l'annule
  pas à la place de l'utilisateur.
- **Les dépendances sont retirées avant les tâches**, comme les six autres relations `Restrict`
  du schéma. L'ordre de suppression est écrit une seule fois, et un test vérifie qu'il couvre
  toutes les tables du projet.
- **Après suppression, le même repository se réenregistre comme un projet neuf**, et rien n'est
  reconstruit depuis Git, les documents restants ou la documentation du dépôt.
- **Renommer un projet est une écriture SQLite.** Aucun dossier renommé, aucune opération Git,
  aucun appel au fournisseur, et aucun document réécrit.
- **Les empreintes, révisions et métadonnées de fournisseur vivent derrière Inspect** dès
  qu'elles ne servent pas au workflow. Elles sont **déplacées**, jamais supprimées : ce qui
  servait au débogage reste à un clic.
### 8.16 File d'exécution

- **L'appartenance à la file est persistée séparément de `Task.status`.** Une tâche inscrite reste
  `READY` ; il n'existe aucun statut `QUEUED`. Comme pour les dépendances, un statut qui changerait
  sans geste humain se mettrait à mentir.
- **Seule une tâche `READY` de nature `NORMAL` peut être inscrite.** Une tâche d'amorçage ne l'est
  jamais : elle reçoit des permissions d'installation élargies et se lance depuis sa propre page.
- **Inscrire dans une file en pause ne lance jamais Claude.** Démarrer la file est un geste humain
  distinct, qui ouvre une **autorisation permanente** portant sur les tâches déjà inscrites.
- **Une file qui se vide referme son autorisation.** Aucune permission dormante ne doit pouvoir
  s'appliquer à une tâche inscrite plus tard.
- **Redémarrer NOX ne déclenche jamais rien.** `ACTIVE` autorise un ordonnancement, pas un
  démarrage au boot : l'avancement vient d'un événement applicatif, jamais du seul redémarrage.
- **L'ordonnancement est déterministe et sans modèle.** Aucun appel à un fournisseur ne choisit
  quoi lancer.
- **Les dépendances restent autoritaires, et la première entrée éligible peut en sauter de plus
  anciennes.** Une entrée qui attend garde sa place ; une file ne se fige pas sur son premier
  élément bloqué.
- **Une inscription qui a démarré reste la barrière de sa file jusqu'à ce que la tâche soit
  `COMPLETED` ou que l'entrée soit explicitement retirée — y compris après un `Reopen` qui ramène
  la tâche à `READY`.** Une exécution `COMPLETED` mène à `REVIEW`, ce qui n'est pas une
  acceptation : la review n'est jamais la fin d'un élément de file.
- **Le départ d'une inscription est persisté, parce qu'aucun statut ne le porte.** Une tâche
  rouverte est `READY`, exactement comme une tâche jamais lancée ; `TaskQueueEntry.startedAt` est
  la seule chose qui les distingue, et un redémarrage ne doit pas l'effacer. Il est posé dans la
  transaction qui crée l'exécution, n'est jamais remis à zéro, et une réinscription crée une entrée
  neuve.
- **La file ne relance jamais d'elle-même un travail refusé.** Une tâche rouverte repart depuis sa
  propre page, sur un geste humain. Le refus du lancement manuel épargne cette tâche-là, et elle
  seule : il vise ce qui doublerait un ordre préparé, pas ce que la file attend.
- **Un échec ou une annulation met la file en pause**, et l'entrée reste en place. NOX ne passe
  jamais automatiquement à la suivante après un incident.
- **Mettre en pause n'annule aucune exécution.** La pause ne concerne que les démarrages suivants.
- **Une tâche inscrite ne se modifie pas, ne se supprime pas, et ne se remet ni en brouillon ni de
  côté par une action humaine** tant qu'elle n'a pas été retirée de la file.
- **Un lancement manuel initial ne contourne pas une file en attente.** Les corrections, elles,
  restent celles du workflow existant : elles terminent un travail déjà commencé.
- **La file utilise toujours le pipeline d'exécution existant.** Il n'existe pas de second moteur
  Claude, et il ne doit pas en exister : le dispatcher choisit, le moteur exécute.
- **La file ne contourne ni le préflight Git, ni la review humaine.** Un repository qui porte des
  modifications non commitées arrête la progression ; NOX ne commite rien à sa place.
- **Au plus une exécution Claude active par repository**, garantie par une transaction
  persistante — jamais par un verrou en mémoire, qui ne survivrait ni à un redémarrage, ni à deux
  processus. L'unicité globale reste celle du runner.
- **Un avancement démarre au plus une exécution.** Aucune boucle ne vide la file d'un coup.
- **Les actions de file autres que l'avancement n'appellent ni OpenAI, ni Claude Code**, et
  n'écrivent rien dans le repository — pas même dans `tasks/TASK-xxx.md`, qui ne porte aucune
  position de file.

### 8.17 Validation autonome et classification des critères

- **La classification appartient au contrat, jamais au résultat.** Un critère déclare
  `AUTOMATED` ou `HUMAN` **avant** l'exécution, et il n'existe pas de troisième valeur. Décider
  après coup qu'un critère était automatisable produirait une classification qui s'adapte au
  résultat — donc qui ne prouve rien.
- **Le compte rendu de Claude Code n'est jamais une preuve.** Seule une commande que **NOX** a
  exécutée lui-même après le travail peut soutenir un critère automatisé. Les deux sources sont
  conservées et affichées ; une seule entre dans une dérivation de résultat.
- **`AGENT_ONLY` est le défaut sûr.** `AUTONOMOUS` ajoute une permission, il n'en retire aucune :
  une tâche antérieure ne gagne rien après coup, et un mode illisible retombe toujours sur la
  valeur qui n'autorise rien.
- **La liste des programmes autonomes est fermée, et distincte de celle de l'amorçage.** Les
  refus, eux, sont **réutilisés**, jamais recopiés. Installations, processus qui ne se terminent
  pas et commandes Git s'y ajoutent, contrôlés sur le **jeton entier** — jamais sur une
  sous-chaîne.
- **Aucun interprète de commandes, sous aucune forme.** Ni `shell: true`, ni `cmd /c`, ni
  `powershell -Command`, ni `bash -c`, ni `sh -c`. Une commande validée est une suite de jetons,
  et c'est ce découpage qui part au système.
- **Le répertoire de travail est la racine canonique du repository**, relue à partir de
  l'identifiant du projet. Aucune variable `NOX_*` n'atteint le processus, et aucun secret n'est
  transmis.
- **Le navigateur n'envoie ni commande, ni chemin, ni délai, ni environnement.** Il transmet des
  identifiants ; tout le reste est relu côté serveur.
- **La politique est rejouée par le runner.** Il ne fait pas confiance au web, et refuse
  lui-même ce qu'il n'a pas le droit de lancer.
- **Un dépassement de délai est un échec de validation, pas une panne.** `ERROR` est réservé aux
  cas où NOX n'a **pas pu** obtenir de preuve. « Je n'ai pas pu regarder » n'est jamais « j'ai
  regardé et c'est faux ».
- **Une reprise n'existe que sur une panne**, et la garantie vit dans la réservation, pas dans un
  bouton. Chaque reprise crée une tentative nouvelle et conserve la précédente.
- **Un lot est réservé par un index unique `(runId, attempt)`.** Jamais un verrou en mémoire :
  il ne survivrait ni à un redémarrage, ni à deux processus. Aucun lot artificiel n'est créé
  quand rien n'est à valider.
- **Le lot est déclenché par la finalisation d'une exécution, jamais par un rendu de page.**
  Consulter une review n'exécute rien.
- **Une commande partagée par deux critères n'est exécutée qu'une fois.**
- **L'instantané Git du runner reste celui du travail de Claude Code**, et n'est pas retouché.
  Deux empreintes de l'état suivi, avant et après le lot, disent si la preuve a modifié ce
  qu'elle évaluait ; deux empreintes inconnues ne disent **rien**, et ne pas savoir n'autorise
  jamais une complétion automatique.
- **`checkAutoCompletion` n'a aucun paramètre `force`, `override` ou `ignoreFailure`.** Un
  amorçage est refusé en premier : il ne se termine jamais seul.
- **Un passage en force est humain, motivé, et ne réécrit rien.** Le lot reste en échec, les
  codes de sortie restent affichés, et la source est persistée comme `HUMAN_OVERRIDE`.
- **Une décision de review est unique par exécution**, écrite dans la transaction de transition.
  Une acceptation humaine et une complétion automatique visent la même ligne ; une seule aboutit.
- **Les critères humains sont relus en base à chaque acceptation.** Le formulaire désigne des
  identifiants ; il ne définit pas la liste, et un identifiant forgé est refusé.
- **Le plan de vérification fait partie du contrat de la tâche.** Il entre dans la revision
  optimiste, ramène une tâche `READY` en `DRAFT` quand il change, et les liens critère-commande
  sont des identifiants de ligne — jamais des textes, jamais des positions d'affichage.
- **`backlog/1` reste lisible et applicable.** Une proposition historique est **relevée** à la
  lecture avec les défauts sûrs, et son `providerJson` n'est jamais réécrit. Le planificateur
  actuel produit `backlog/2`, et une classification proposée reste une proposition : seul un
  humain l'applique.
- **Aucune IA ne participe à la validation autonome.** Ni OpenAI, ni Claude Code : NOX exécute
  des commandes et lit des codes de sortie. Aucun `git add`, aucun commit, aucun push, aucun
  `reset`, aucun `restore`, aucun `clean`.
- **Les faits de NOX ne rejoignent pas la timeline de Claude Code.** `ClaudeRunEvent` reste
  fermé et produit par le runner ; les validations s'affichent à part.

### 8.18 Boucle de correction pilotée par la validation

- **Une correction ne modifie jamais le contrat gelé de la tâche.** Ni les critères, ni leur mode
  de vérification, ni les commandes, ni leur mode d'exécution, ni les liens entre les deux. Une
  correction essaie de satisfaire ce contrat ; elle ne le renégocie pas. Si le contrat est
  réellement mauvais, c'est un humain qui le dit — par un passage en force, ou en terminant le
  cycle puis en éditant une tâche future.
- **Une correction automatique n'est déclenchée que par une preuve de NOX.** `NOX_AUTONOMOUS`, et
  jamais `CLAUDE_OBSERVED` : ce qu'un agent dit avoir lancé ne relance rien.
- **Une panne d'infrastructure n'implique jamais une correction de code.** Un lot `ERROR` mène à
  `Retry automated validation`. « Je n'ai pas pu regarder » n'est pas « j'ai regardé et c'est
  faux », et TASK-028 ne dilue pas cette distinction.
- **Une file `ACTIVE` est une autorisation permanente qui couvre un nombre borné de corrections.**
  Le texte de `Start queue` l'annonce **avant** le clic ; une autorisation qui s'élargirait en
  silence n'en serait plus une.
- **Une tâche lancée à la main, ou dont la file est en pause, ne se corrige jamais toute seule.**
  La correction est prête, ses preuves sont rassemblées, et elle attend un geste.
- **`MAX_AUTOMATED_CORRECTION_ATTEMPTS` vaut deux, et c'est une constante.** Jamais un réglage
  d'interface, jamais une variable d'environnement : une borne qu'on peut desserrer n'en est plus
  une.
- **Le cycle de travail courant est la chaîne des exécutions reliées par `parentRunId`**, jamais
  `runCount`. Une tâche rouverte a une histoire ; la compter consommerait la borne du cycle
  suivant.
- **Une correction est réservée avant d'être lancée, et la réservation est persistée.** Aucun
  verrou en mémoire ne fait autorité : il ne survivrait ni à un redémarrage, ni à deux processus.
  L'index unique `(sourceRunId, attempt)` est le verrou.
- **Un même échec de validation ne lance qu'une seule correction.** Dix constatations simultanées
  n'en obtiennent qu'une, et un `Request changes` humain concurrent reçoit un refus **nommé**,
  jamais une exception brute.
- **Une réservation non consommée est rendue, avec sa raison.** « NOX a renoncé » et « NOX
  corrige » sont deux états distincts, et l'écran doit pouvoir les distinguer.
- **Toute correction réussie reçoit un lot de validations complet et neuf.** Pas seulement les
  commandes qui avaient échoué : corriger `npm test` peut casser `npm run typecheck`.
- **Aucune preuve ne traverse une tentative.** Combiner un résultat d'hier et un résultat
  d'aujourd'hui décrirait un état qui n'a jamais existé.
- **Aucune confirmation humaine ne traverse une correction.** Elles appartiennent à la décision de
  review d'une exécution, et une exécution nouvelle en demande de nouvelles.
- **Une correction automatique ne contourne jamais la review humaine** quand des critères humains
  restent : une tâche mixte revient à un humain, réparée sur sa partie automatisée.
- **Le moteur de correction est unique.** Le dispatcher choisit ; `correction-launch.ts` exécute.
  Aucun second moteur Claude, aucune politique d'outils élargie : une correction `NORMAL` garde les
  permissions `NORMAL`.
- **Le contexte de correction est construit localement, et borné.** Aucun appel à OpenAI, jamais.
  Toute troncature est annoncée, et le contrat de la tâche ne tombe jamais avant les sorties.
- **Le navigateur n'envoie ni prompt, ni preuve, ni commande, ni chemin, ni numéro de tentative.**
  Des identifiants, un texte humain, des identifiants de critères — tous revalidés en base.
- **Une review périmée ne lance rien.** Une correction vise l'exécution courante ; un onglet resté
  sur une exécution déjà corrigée reçoit un refus structuré.
- **Un rendu de page ne réserve rien et ne lance rien.** Le déclencheur est la finalisation d'une
  exécution, et la réservation persistante rend le geste idempotent.
- **Un redémarrage ne lance jamais une correction en attente.** Une réservation survit ; son
  départ demande un geste explicite.
- **Un amorçage ne participe jamais à la boucle automatique.**
- **Une correction n'écrit jamais dans Git.** Ni `add`, ni commit, ni push, ni `reset`, ni
  `restore`, ni `clean` — y compris quand une validation a sali le dépôt : NOX le nomme, et ne le
  répare pas.

### 8.19 Livraison Git

- **Écrire dans Git est une autorisation séparée de celle de la file.** `Start queue` lance
  Claude Code et borne ses corrections ; il n'accorde **rien** dans Git. Une file `ACTIVE` sur
  un projet `MANUAL` s'arrête sur un repository modifié, exactement comme avant TASK-029.
- **La politique de livraison d'un projet vaut `MANUAL` par défaut**, et le défaut est
  structurel : c'est la valeur de la colonne. Appliquer la migration produit zéro commit, zéro
  push, zéro livraison et zéro avancement de file. Une valeur illisible est relue `MANUAL` —
  le défaut sûr n'accorde rien.
- **Changer la politique est l'autorisation humaine, et elle est annoncée avant le clic.** NOX
  ne redemande pas confirmation tâche par tâche : une file qui s'arrête sur une modale n'avance
  pas plus qu'une file arrêtée. En contrepartie, l'écran dit ce que le choix engage.
- **Changer la politique n'écrit rien et ne défait rien.** Aucun commit annulé, aucun `reset`,
  aucune livraison passée supprimée : la nouvelle politique ne gouverne que ce qui n'a pas
  encore eu lieu.
- **Une livraison n'existe qu'après une complétion validée.** Une tâche marquée terminée à la
  main — sans exécution, sans review, sans décision — n'a aucun candidat sûr, et NOX ne commite
  pas ce qui traîne dans le dossier de travail.
- **Le candidat est figé à la décision finale, et immuable.** Branche, `HEAD`, empreinte
  authentifiée et liste exacte des entrées changées. Il n'est jamais recalculé sur l'état
  courant : « maintenant c'est validé » demanderait une nouvelle validation.
- **Une seule implémentation d'empreinte de dossier de travail.** Celle de TASK-012, HMAC
  dérivé du jeton du runner, qui ne quitte jamais le serveur. Pas de deuxième, pas de
  troisième.
- **Le repository doit correspondre exactement au candidat avant toute écriture.** Tout écart —
  fichier suivi modifié, fichier inattendu apparu, index déjà garni, `HEAD` avancé — bloque la
  livraison. Il n'existe ni `Commit anyway`, ni `Accept current state`, ni `Update candidate`,
  et le service ne porte aucun paramètre `force`, `ignoreFingerprint`, `skipValidation` ou
  `pushForce`.
- **NOX ne prépare que les chemins exacts du candidat.** `git add -A -- :(literal)<chemin>`,
  jamais `git add .`, jamais `git add -A` sans pathspec. Ce qui est préparé est revérifié avant
  le commit.
- **Le message de commit est déterministe et figé à la réservation.** Un sujet lisible et un
  trailer `NOX-Delivery: <id>`. Une reprise commite exactement le même texte, sinon le trailer
  ne prouverait plus rien.
- **Une livraison est réservée avant l'écriture, et la réservation est persistée.** L'index
  unique `(taskId, sourceRunId)` garantit une livraison par travail validé ; le compteur
  `attempt`, pris par mise à jour conditionnelle, garantit une écriture à la fois. Jamais un
  verrou en mémoire.
- **Une livraison produit au plus un commit.** Une réponse perdue se **réconcilie** — trailer
  de `HEAD` et parent attendu, ensemble — au lieu de produire un second commit identique. La
  recherche est bornée à `HEAD` : jamais un parcours d'historique.
- **Commit et push ne sont jamais confondus.** `AUTO_COMMIT` est satisfait dès `COMMITTED`,
  `AUTO_COMMIT_PUSH` seulement après `DELIVERED`. Un push refusé **conserve** le commit local,
  et `Retry push` ne recrée jamais de commit.
- **NOX ne change jamais de branche pour livrer**, et refuse un `HEAD` détaché.
- **`AUTO_COMMIT_PUSH` n'utilise que l'upstream déjà configuré de la branche courante**, vérifié
  **avant** le commit. Aucun `push -u`, aucun `remote add`, aucun `branch --set-upstream-to`.
- **Aucun push forcé, jamais.** Ni `--force`, ni `--force-with-lease`. Un refus
  « non-fast-forward » remonte tel quel : NOX ne tire pas, ne fusionne pas, ne rebase pas.
- **Aucun `reset`, `restore`, `checkout`, `clean`, `stash`, `cherry-pick`, `revert`, écriture de
  tag, écriture de configuration ni mutation de remote.** Pas de « nettoyage » après un échec :
  ce qui reste est ce qu'un humain doit relire.
- **Aucune protection du repository n'est contournée.** `--no-verify` et `--no-gpg-sign` ne sont
  jamais passés. Un hook de commit ou une signature configurée fait renoncer la livraison
  **automatique**, avec une raison nommée ; un geste humain reste possible, et le hook s'exécute.
- **Manuel n'a jamais moins de gardes que l'automatique.** Même moteur, même candidat, mêmes
  vérifications — y compris le refus d'un fichier sensible nouveau.
- **Le garde-fou des fichiers sensibles est un filtre de noms conservateur**, et NOX ne prétend
  pas détecter les secrets. Il vise un cas précis : qu'un `.env` créé pendant une exécution ne
  soit pas commité automatiquement parce que personne ne regardait.
- **Aucun identifiant Git n'est stocké par NOX.** Ni table, ni jeton, ni clé. Git est invoqué
  non interactif, sans shell, avec un environnement privé de toute variable `NOX_*`, et aucune
  URL de remote n'est enregistrée ni affichée.
- **Le navigateur n'envoie ni chemin, ni branche, ni remote, ni message, ni argument Git.** Des
  identifiants et un mode, revalidés côté serveur, puis rejoués par le runner.
- **Un rendu de page et un démarrage de serveur n'écrivent jamais dans Git.** Le déclencheur est
  la transition d'une tâche vers `COMPLETED` ; la réservation persistante rend le geste
  idempotent.
- **La file n'avance que lorsque la politique applicable est satisfaite.** En `MANUAL`, c'est le
  préflight Git existant qui fait autorité — livrer depuis un terminal reste possible, et ne rend
  jamais un projet inutilisable.
- **`AUTO_COMMIT` est satisfaite sans push, et le préflight en tient compte.** Le commit local
  validé suffit ; la branche reste **en avance** sur son upstream, et c'est l'état attendu de ce
  mode, tâche après tâche. Traiter cette avance comme un défaut de synchronisation arrêterait la
  file dès la deuxième tâche : « ce repository peut-il recevoir une autre tâche ? » et « cette
  livraison est-elle terminée ? » ne sont pas la même question.
- **`AUTO_COMMIT_PUSH` exige toujours le push, et rien n'y déroge.** Tant que l'upstream ne porte
  pas le commit, la politique n'est pas satisfaite : la file s'arrête, `Retry push` reste le seul
  geste, et aucun second commit n'est créé. Un dossier de travail sale, un `HEAD` inattendu, une
  branche changée ou une branche **en retard** restent refusés sous toutes les politiques.
- **Supprimer un projet retire son état de livraison, jamais son historique Git.** Aucun commit
  défait, aucune branche supprimée, aucun push, aucune commande Git déclenchée. Le repository
  ré-enregistré repart en `MANUAL`, sans livraison reconstruite depuis Git.

### 8.20 Orchestration multi-projets

- **Plusieurs files de projets peuvent être `ACTIVE` en même temps.** Ce n'est plus un état
  exceptionnel : toutes les requêtes et tous les modèles de lecture doivent le supporter.
- **L'autorisation de file reste propre à un projet.** `Start queue` autorise **ce** projet, et
  lui seul. Il n'existe ni « démarrer tous les projets », ni autorisation héritée, ni activation
  en cascade.
- **Deux repositories différents peuvent exécuter Claude Code en même temps.** La contrainte
  « une seule exécution dans tout NOX » n'existe plus, et ne doit pas revenir sous la forme d'un
  plafond chiffré : ni `MAX_GLOBAL_RUNS`, ni pool de travailleurs, ni file d'attente globale.
- **Au plus une exécution Claude Code active par repository canonique.** C'est la seule règle
  d'exclusion, et elle couvre exactement les statuts qui peuvent encore posséder un processus :
  `QUEUED`, `RUNNING`, `CANCELLING`.
- **C'est l'identité du repository qui fait autorité, jamais l'identifiant du projet.** Un
  repository n'appartient normalement qu'à un projet, mais la sécurité d'exécution ne dépend pas
  de cet invariant : deux projets visant le même dossier restent exclus l'un de l'autre. Un
  séparateur final, un séparateur inversé, un segment `..` ou une différence de casse sous
  Windows ne contournent rien.
- **Une seule implémentation de cette identité**, dans `@nox/shared`, utilisée à l'identique par
  le web et par le runner. C'est une clé de comparaison : elle ne sert jamais à ouvrir un
  fichier, ni à lancer un processus, ni à être affichée.
- **Le web et le runner vérifient l'exclusion chacun de son côté.** En base, l'écriture précède
  le comptage — vérifier avant d'écrire laisserait passer deux appels simultanés. Dans le runner,
  le contrôle est refait sur les processus réels, sans faire confiance au web.
- **Le navigateur ne porte aucune autorité d'exécution.** Ni chemin, ni clé de verrou, ni
  identifiant de processus : un projet et une tâche, revalidés côté serveur.
- **Le registre du runner est indexé par exécution et par repository, jamais global.** Il
  n'existe ni « exécution courante », ni processus courant, ni `cancel current`. Une exécution
  qui se termine ne retire qu'elle-même : aucun vidage, aucune variable remise à `null`.
- **Annuler ou faire échouer une exécution n'annule et ne met en pause aucun autre projet.**
  Aucune fonction ne met en pause l'ensemble des files.
- **Validation, correction et livraison Git restent propres à leur projet.** La borne de deux
  corrections automatiques reste par cycle de travail d'une tâche ; les corrections d'un projet
  n'ont aucun effet sur le compteur d'un autre.
- **Une barrière de review humaine dans un projet ne bloque jamais un autre projet.**
- **Un échec de livraison Git dans un projet ne bloque jamais un autre projet.**
- **Les files avancent indépendamment ; il n'existe pas de vagues d'exécution.** NOX n'attend
  jamais que toutes les files aient terminé une tâche pour passer aux suivantes.
- **`advanceQueue` ne regarde et ne lance qu'un seul projet.** Aucune fonction ne choisit un
  projet, ne compare deux files, ni ne fait avancer « la première file active ». La provenance
  est conservée de bout en bout : ce qui est livré puis avancé est le projet de la tâche qui
  vient de se terminer.
- **Démarrer ou reprendre une file n'en démarre jamais une autre.**
- **Le démarrage d'un processus ou du serveur web ne dispatche jamais une file active.** Même
  avec plusieurs files `ACTIVE` en base : zéro exécution, zéro écriture Git, zéro validation,
  zéro correction.
- **Le rendu d'une page — accueil comprise — ne lance jamais rien.**
- **Une action croisée entre projets est refusée par les contrôles d'appartenance.** Annulation,
  stream, review, correction et livraison vérifient toutes la chaîne projet → tâche → exécution.
- **Les dépendances entre tâches de projets différents n'existent pas**, et TASK-031 ne les
  ouvre pas.
- **TASK-031 ajoute de la concurrence, pas une file ni un ordonnanceur.** Ni `GlobalTaskQueue`,
  ni priorité, ni équité, ni tourniquet : il n'y a pas de ressource partagée à répartir.
- **Les politiques de livraison et de correction restent locales à chaque projet.** Aucun
  héritage, aucun réglage global.

### 8.21 Replanification depuis la conversation projet

- **La conversation principale du projet est l'endroit d'où le projet évolue.** Un changement
  d'exigence s'y dit, et l'Architecte peut y proposer une mise à jour du projet, une
  replanification du travail futur, ou les deux. Il n'existe ni seconde conversation, ni second
  écran de planification, ni retour à une planification neuve.
- **La planification initiale et la replanification sont deux workflows distincts.**
  `backlog/2` crée le **premier** plan d'un projet ; `replan/1` fait évoluer celui qui existe.
  Un projet sans backlog `APPLIED` n'est pas replanifiable, et l'interface renvoie vers la
  planification initiale : aucun second chemin ne crée un premier plan.
- **Le passé est immuable, le futur est replanifiable.** Une tâche qui possède une exécution,
  qui est inscrite dans la file, dont le statut n'est plus un statut d'avant-exécution, ou qui
  est `TASK-000`, est verrouillée. Son contrat n'est pas transmis au fournisseur, et rien ne
  peut le réécrire. La classification est celle de TASK-024, jamais une seconde règle.
- **`TASK-000` n'est jamais réécrite par une replanification**, et un changement qui modifierait
  réellement le brief ou le plan est refusé tant qu'elle n'a pas tourné. NOX ne la réécrit ni ne
  la supprime à la place de l'utilisateur.
- **Le fournisseur rend un état cible complet, jamais des opérations.** `KEEP`, `UPDATE`,
  `REMOVE`, `ADD`, le déplacement et le changement de dépendances sont **dérivés** par NOX en
  comparant la cible au plan courant. Le fournisseur ne pose aucune de ces étiquettes.
- **Contrat, position et dépendances sont trois axes indépendants.** L'autorité sur le premier
  est `taskContractChanged` ; deux écritures équivalentes d'un même contrat donnent `KEEP`. Un
  reordonnancement seul ne dégrade aucun statut et ne réécrit aucun document.
- **L'identifiant et le code d'une tâche existante sont immuables.** Aucun formulaire ne les
  porte, et le navigateur n'en propose jamais.
- **Un code n'est attribué qu'à l'application, et jamais recyclé.** Il vient de
  `Project.nextTaskSequence`, réservé atomiquement dans la transaction. `planningOrder` est
  l'ordre du plan, distinct du code : `TASK-006, TASK-011, TASK-007` est un plan valide.
- **Une mise à jour du projet et une replanification issues du même tour forment une seule
  décision humaine.** Une carte, une revue, un `Apply project change`, un `Dismiss`. Jamais deux
  boutons, jamais deux transactions.
- **Une proposition ne modifie rien.** Ni brief, ni plan, ni tâche, ni document, ni file. Seule
  une application explicitement humaine change quelque chose.
- **`providerJson` est immuable, et `appliedJson` porte ce que l'humain a retenu.** Les tâches
  supprimées y figurent nommément — code, titre et contrat d'alors — pour rester racontables.
- **L'application relit tout dans la transaction qui écrit** : proposition, statut, mise à jour
  liée, brief, plan, tâches, statuts, exécutions, nature, file, dépendances, `nextTaskSequence`,
  et l'empreinte de planification recalculée depuis la base. Le graphe final est revalidé par
  `checkReplanTargetGraph`.
- **Un état devenu obsolète est refusé, jamais fusionné.** Aucun chemin de code ne mène d'un
  conflit à un appel, et il n'existe ni « appliquer quand même », ni drapeau de forçage : pas de
  `force`, pas d'`applyAnyway`, pas d'`ignoreStale`.
- **Les tâches créées naissent `DRAFT` et hors file.**
- **Appliquer ou écarter un changement n'a aucun effet d'exécution.** Zéro appel à OpenAI, zéro
  Claude Code, zéro validation, zéro correction, zéro livraison Git, zéro démarrage, pause ou
  avancement de file. Ce sont des écritures SQLite, puis des documents Markdown.
- **Les documents Markdown suivent la transaction, ils ne la conditionnent pas.** Seules les
  tâches réellement changées sont réécrites ; une suppression retire le document dont NOX
  connaît la révision, et un document divergent produit un refus nommé, jamais un écrasement.
- **Une référence croisée entre projets est refusée**, et sans confirmer l'existence de la ligne
  visée : une proposition d'un autre projet est introuvable, pas « refusée ».
- **TASK-032 achève le périmètre de V1 prévu.** Ce qui vient ensuite est un pilote réel, pas une
  fonctionnalité écrite d'avance.
