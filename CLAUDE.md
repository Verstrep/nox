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
`npm run db:generate` · `npm run db:migrate` · `npm run db:deploy` · `npm run db:studio`.

**Appliquer des migrations est un geste manuel.** Ni `npm run dev:web`, ni `npm run build`, ni le
démarrage du serveur n'écrivent dans le schéma de la base : un serveur de développement qui
modifierait la base en silence rendrait impossible de dire quand elle a changé. Après avoir
récupéré des migrations écrites ailleurs, `npm run db:deploy` les applique à la base existante
**sans rien supprimer** ; `npm run db:migrate` sert à en créer une nouvelle pendant le
développement. Une colonne manquante se manifeste sinon par une erreur Prisma au premier accès.

La configuration du CLI Prisma vit dans
[packages/database/prisma.config.ts](packages/database/prisma.config.ts), et c'est **elle** qui
calcule l'URL de la base. Prisma 7 la découvre depuis le répertoire courant : une commande
`npx prisma …` lancée depuis la racine, même avec `--schema`, ne la charge pas et échoue sur
`datasource.url is required`. Passer par les scripts npm, qui s'exécutent dans le workspace.

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

- **Aucune entrée n'est jamais écrite sans un geste humain.** Ni depuis une review, ni depuis un
  compte rendu de Claude Code, ni depuis une planification de backlog, ni au fil d'une
  conversation. Une entrée n'apparaît qu'après un `Apply` explicite.
- **Une conversation peut en *proposer*, depuis HOTFIX-005, et proposer n'est pas écrire.**
  `projectUpdate.memories` porte au plus huit entrées, revues et appliquées par le même geste
  humain que le brief et le plan, dans la même transaction. C'était la pièce manquante : la
  mémoire était déjà la bonne autorité, déjà bornée et déjà transmise à la planification, et aucun
  chemin de code n'y menait depuis une conversation. Voir § 8.26.
- **Aucune proposition ne supprime une entrée.** `CREATE` et `UPDATE`, et rien d'autre : une règle
  qui cesse de s'appliquer s'archive, et l'archivage reste un geste humain.
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
- **Aucun interprète de commandes ne fabrique jamais une ligne à partir de nos chaînes.** Ni
  `shell: true`, ni `powershell -Command`, ni `bash -c`, ni `sh -c`. Une commande validée est une
  suite de jetons, et c'est ce découpage qui part au système.
- **Sous Windows, un script `.cmd` est lancé par `cmd.exe /d /s /c`, avec une ligne que NOX écrit
  lui-même.** Ce n'est pas une exception à la règle précédente, c'est son application : `npm` y est
  un `.cmd`, Node refuse de le lancer autrement, et `shell: true` demanderait à Node de composer
  une ligne que NOX ne verrait pas. Ici NOX cite chaque jeton, ajoute la paire extérieure que `/s`
  consomme, et **refuse de construire** la ligne dès qu'un jeton porte un guillemet, un `%`, un
  caractère de contrôle ou un antislash final. La construction vit à un seul endroit,
  `apps/runner/src/claude/command-line.ts`, et elle est la même pour Claude Code et pour les
  validations.
- **Un fichier sans extension n'est jamais exécutable sous Windows.** La résolution ne retient que
  les extensions de `PATHEXT` — retenir le `npm` destiné à Unix, présent à côté de `npm.cmd`,
  produisait un `ENOENT` au lancement.
- **Le répertoire de travail est la racine canonique du repository**, relue à partir de
  l'identifiant du projet. Aucune variable `NOX_*` n'atteint le processus, et aucun secret n'est
  transmis.
- **Le navigateur n'envoie ni commande, ni chemin, ni délai, ni environnement.** Il transmet des
  identifiants ; tout le reste est relu côté serveur.
- **La politique est rejouée par le runner.** Il ne fait pas confiance au web, et refuse
  lui-même ce qu'il n'a pas le droit de lancer.
- **Un dépassement de délai est un échec de validation, pas une panne.** `ERROR` est réservé aux
  cas où NOX n'a **pas pu** obtenir de preuve. « Je n'ai pas pu regarder » n'est jamais « j'ai
  regardé et c'est faux ». Un code de sortie non nul est une **réponse** : il produit `FAILED`,
  jamais `VALIDATION_SPAWN_FAILED`, qui reste réservé à l'impossibilité de créer le processus.
- **Une panne nomme sa cause, et rien de plus.** Le diagnostic conservé est écrit par NOX à partir
  du seul code système (`ENOENT`, `EINVAL`) : jamais le message d'origine de Node, qui porte le
  chemin absolu de l'exécutable. Ni environnement, ni trace, ni jeton, ni chemin de la machine.
- **Un arrêt vise l'arbre du processus, jamais le seul processus lancé.** Sous Windows, la commande
  tourne sous une enveloppe : signaler l'enveloppe laisserait le vrai programme travailler dans le
  repository. Une seule implémentation, partagée avec Claude Code.
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

### 8.22 Autonomie du workflow après le premier pilote

- **Une dépendance est un prérequis réel, jamais une chronologie.** Une tâche B attend une
  tâche A quand B suppose une capacité, une structure, un fichier ou un comportement que A a la
  charge de créer. L'ordre d'un backlog est une recommandation que NOX ne fait respecter par
  rien ; une dépendance, elle, refuse un lancement. Les deux ne se remplacent pas.
- **La sémantique appartient au fournisseur, le graphe appartient à NOX.** Aucune dépendance
  n'est déduite d'un numéro de tâche, d'un mot commun dans deux titres ou de l'ordre du backlog.
  Le code garantit le contrat et le graphe ; il ne prétend pas comprendre le produit.
- **Dans un backlog, une dépendance ne peut désigner qu'une position strictement antérieure.**
  C'est cette seule contrainte qui rend un cycle impossible, interdit l'auto-référence, et force
  l'ordre et les prérequis à raconter la même histoire. Un plan qui la viole est **refusé et
  nommé**, jamais réordonné en silence.
- **Un amorçage accepté peut rafraîchir les plans de vérification des tâches futures, et rien
  d'autre.** Le fournisseur ne reçoit ni titre, ni objectif, ni contexte, ni hors périmètre, ni
  texte de critère, ni ordre, ni dépendance : le contrat ne lui en donne pas la place, et un
  champ hors liste blanche condamne **toute** la proposition. Aucun champ n'est ignoré en
  silence.
- **Le texte d'un critère ne quitte jamais NOX pendant un rafraîchissement.** Un critère est
  désigné par sa position, et NOX réécrit le texte qu'il possède déjà. Ce n'est pas une
  vérification d'égalité : c'est l'absence de chemin de retour.
- **Un rafraîchissement est déclenché par la transition d'un amorçage vers `COMPLETED`, jamais
  par un rendu de page**, et il coûte **au plus un appel** — l'index unique
  `(projectId, planningFingerprint)` le garantit, et un amorçage dont le rafraîchissement a déjà
  abouti n'en repaie aucun. Aucun réessai automatique, aucun modèle de repli, aucune réparation
  silencieuse.
- **Un échec de rafraîchissement laisse les tâches exactement telles qu'elles étaient.** Il ne
  fait jamais tomber l'acceptation de l'amorçage : `TASK-000` **est** terminée, et des plans de
  vérification inchangés sont un état parfaitement valable — celui d'avant TASK-033.
- **Le code produit validé et l'état de livraison Git sont deux concepts distincts.** Un push
  refusé ne transforme jamais une implémentation validée en échec : la tâche reste `COMPLETED`,
  la livraison porte l'échec, et `Retry push` ne recrée jamais de commit.
- **Une tâche terminée montre toujours sa politique de livraison**, y compris quand aucun
  candidat n'a pu être réservé. Le premier pilote réel renvoyait son utilisateur dans un
  terminal non par manque de boutons, mais parce qu'aucun écran ne menait jusqu'à eux.
- **Une commande de validation doit être lancée au moins une fois telle qu'elle est
  enregistrée.** La demande est dans le prompt d'exécution ; la reconnaissance, elle, ne se
  relâche pas — une ligne à tuyau reste refusée, parce que le code de sortie observable y est
  celui du dernier maillon. Et le résultat de Claude Code reste **informatif** dans tous les
  cas : seule la validation autonome de NOX vérifie un critère.
- **Le contrat d'une tâche est figé pendant son exécution.** L'autorité est la base ;
  `tasks/<code>.md` en est une projection à sens unique, sans case cochée et sans résultat.
  L'agent a pour consigne de ne pas le modifier, et la review **dit** qu'il l'a fait le cas
  échéant — sans rien bloquer, puisque le contrat, lui, n'a pas bougé.

### 8.23 Lisibilite et observabilite

- **Un statut se reconnait avant d'etre lu.** Une tache terminee est verte, un blocage et un
  echec sont rouges, une review est ambre, un brouillon reste neutre. `accent` — le teal de
  NOX — ne designe que ce qui se passe **en ce moment** : lui faire dire aussi « prete » et
  « terminee » le rendait muet.
- **La couleur n'est jamais la seule information.** Chaque pastille rend son libelle. `Blocked`
  et `Failed` partagent volontairement un ton, parce qu'ils appellent la meme reaction ; ce qui
  les distingue est leur texte, et il doit le rester.
- **Aucun compteur d'avancement n'est stocke.** Repartitions, totaux et metriques se recalculent
  a chaque rendu, a partir des lignes qui font autorite. Un compteur mis en cache deviendrait
  faux a la premiere tache rouverte, et rien ne le signalerait.
- **Une repartition par statut a un seul ordre**, celui du workflow, dans `task-display.ts`.
  Deux tables d'ordre finiraient par raconter deux avancements differents du meme projet.
- **Toute surface qui peut engager un appel Architecte affiche le modele resolu avant le clic.**
  Le premier pilote a genere un backlog entier avec un modele que son utilisateur croyait avoir
  remplace : la valeur n'apparaissait qu'apres l'appel, dans l'historique. La provenance est
  dite avec le modele — « defaut NOX » et « vous l'avez impose » ne se lisent pas pareil.
- **L'affichage et l'appel partagent une seule resolution.** Deux fonctions qui repondraient
  differemment feraient annoncer un modele et en engager un autre, ce qui serait pire que de ne
  rien annoncer. `EffectiveArchitectConfiguration` ne porte pas la cle : elle n'entre pas dans
  un rendu, donc elle ne peut pas en sortir.
- **L'historique n'est jamais reecrit pour afficher la configuration du jour.** Une generation
  dit le modele qu'elle a reellement utilise ; la pastille dit celui du prochain appel. Deux
  notions, deux affichages.
- **Rendre visible n'est pas rendre configurable.** Aucun selecteur de modele, aucune page de
  reglages, aucune ecriture dans `.env` : changer de modele reste une variable d'environnement,
  c'est-a-dire une decision prise hors de l'interface.
- **Inspect Run repond a « qu'est-ce que NOX a observe », et rien d'autre.** Lecture seule,
  entierement en base : ni repository, ni runner, ni fournisseur, aucune commande relancee,
  aucun formulaire, aucun bouton d'ecriture. Rien n'y est calcule qui ne soit deja persiste.
- **Aucune valeur d'environnement, cle, jeton, en-tete, trace d'exception ni chemin absolu n'y
  entre.** Ce n'est pas un filtre de sortie : ces valeurs ne figurent dans aucune des lectures
  de la page. Le diagnostic d'une panne est celui que le runner ecrit a partir du seul code
  systeme, jamais le message de Node qui porterait le chemin de l'executable.
- **Toutes les tentatives de validation sont affichees, de la premiere a la derniere.** Une
  reprise reussie n'efface pas la panne qui l'a precedee — c'etait la seule ligne qui expliquait
  l'echec du premier pilote. L'ordre est croissant, contrairement au reste de NOX : ici on
  raconte, on ne decide pas.
- **Ce que Claude Code a lance reste informatif, et le dit.** La section porte un avertissement
  permanent : seules les commandes que NOX a executees lui-meme valent preuve. `NOT_RUN` s'y
  ecrit « aucune execution litterale observee », jamais « non lancee » — la seconde formulation
  affirme plus que ce que NOX sait.
- **Les metriques d'un projet sont des faits, jamais un score.** Chaque nombre correspond a des
  lignes qu'on peut aller compter a la main. Aucun taux d'autonomie n'est calcule : NOX ne sait
  pas combien de fois quelqu'un a clique, et un pourcentage precis serait cite d'autant plus
  volontiers qu'il serait faux.
- **Un rapport s'ecrit en fraction, jamais en pourcentage.** `1 / 2` montre son denominateur ;
  `50 %` le cache, et rend `1 / 2` indiscernable de `500 / 1000`. Aucune division n'a lieu, donc
  aucun `NaN` ne peut apparaitre.
- **`null` n'est pas zero.** « Aucun cout rapporte » et « zero dollar » sont deux affirmations
  differentes. NOX n'estime aucun cout, ne consulte aucun catalogue de prix, et affiche
  « non rapporte » quand un fournisseur n'a rien rapporte.
- **Un travail valide et sa livraison portent deux pastilles distinctes.** `Done` en vert et
  `Delivery failed` en rouge se lisent cote a cote : un push refuse ne transforme pas une
  implementation validee en echec, et une pastille unique mentirait forcement sur l'un des deux.

### 8.24 Diagnostic d'un appel Architecte

- **Un appel qui echoue enregistre pourquoi.** Categorie, champ fautif et phrase, nettoyes et
  bornes a l'ecriture. Sans cela, relancer est le seul moyen d'apprendre ce que NOX savait
  deja — c'est-a-dire payer un second appel pour lire un diagnostic qui existait avant le
  premier.
- **Un diagnostic ne porte jamais de contenu.** Ni JSON brut, ni prompt, ni reponse du
  fournisseur, ni en-tete, ni cle, ni trace. Ce n'est pas un filtre applique en sortie : le type
  n'a aucun champ ou les mettre. Les seules valeurs citees sont des nombres calcules par NOX.
- **Un depassement de budget n'est pas une erreur de format.** La reponse etait bien formee ;
  NOX refuse de l'ecrire. Le refus est **deterministe**, et conseiller de relancer y est la pire
  consigne possible.
- **Une reponse interrompue n'est pas une reponse malformee.** Le fournisseur le declare
  lui-meme, et NOX le lit **avant** d'analyser le texte : une reponse coupee peut porter un JSON
  lisible jusqu'a sa troncature, et l'analyser produirait une erreur imputee au contrat — ou un
  objet partiel accepte par hasard.
- **Rien venu du reseau n'entre tel quel dans un diagnostic.** Un motif rapporte n'est recopie
  que s'il ressemble a un identifiant du contrat du fournisseur ; sinon il devient `unknown`.
- **La phrase d'echec parle de l'operation qui a echoue.** Un tour de conversation ne dit jamais
  qu'aucune tache n'a ete creee : aucune n'etait attendue. Le **code** reste unique et stable ;
  seule la phrase s'adapte, sans quoi la classification divergerait pour un probleme
  d'affichage.
- **Le message soumis survit a un tour echoue, et l'ecran le dit.** Le brouillon n'est efface
  que lorsque le tour a abouti. Une garantie que l'utilisateur ne peut pas observer ne le
  rassure pas.
- **Un echec ne declenche jamais un second appel.** Ni reessai aveugle, ni repli de modele :
  `maxRetries` vaut zero, et un echec remonte a l'utilisateur, qui recliquera s'il le souhaite.
  Un reessai automatique produirait une facture en double, et parfois une proposition en double.
- **Toute borne que le validateur applique est annoncee au fournisseur.** Le mode strict ignore
  `maxItems` et `maxLength` : les bornes ne peuvent vivre qu'aux deux endroits qui existent, les
  instructions et la validation. Une borne connue d'un seul des deux produit un refus
  deterministe que le modele ne peut pas eviter, et les deux se lisent depuis **la meme
  constante**.
- **Le Living V1 Plan porte des regles produit durables, pas une specification.** Le detail
  d'implementation appartient aux taches et a la documentation, ou il peut etre aussi precis
  qu'il faut. Le recopier dans le plan le fait grossir a chaque decision, jusqu'a franchir ses
  bornes.
- **Une section pleine se consolide, elle ne se tronque pas.** NOX n'ecarte jamais une entree en
  trop pour faire passer une mise a jour : la proposition entiere est refusee, et c'est
  l'utilisateur qui decide quoi fusionner.
- **Une categorie regroupe, un code constate.** L'affichage d'un echec part du code enregistre
  quand il en existe un ; la categorie ne sert qu'a defaut. Une categorie utilisee comme libelle
  efface ce que la base portait — un delai depasse cesserait de se lire comme un delai.
- **L'empreinte affichee couvre le contexte projet, jamais la conversation.** Sa stabilite d'un
  tour a l'autre est le comportement attendu, et non le signe d'un contexte perime. L'empreinte
  qui couvre le message en attente existe, s'appelle autrement, et decide d'un refus d'envoi.

### 8.25 Attente, arret et duree d'un appel Architecte

- **Quatre-vingt-dix secondes n'est plus l'echeance normale d'un appel.** Un travail d'Architecte
  peut legitimement durer plusieurs minutes, et le second pilote reel l'a montre sur deux charges
  differentes. Ce qui subsiste est un **plafond de securite** genereux, garde-fou contre une
  requete reellement bloquee — jamais une duree attendue, jamais affiche.
- **Une borne de temps d'attente n'est pas une borne de securite.** Les bornes de NOX ne se
  desserrent pas depuis un `.env` parce qu'elles decident de ce qu'il accepte, enregistre ou
  execute. Celle-ci dit seulement combien de temps NOX attend une reponse a une requete qu'il a
  deja decide d'envoyer : la deplacer n'elargit aucune surface. Elle est bornee, et toute valeur
  illisible retombe sur le defaut.
- **Un arret ferme la requete, ou ne pretend pas l'avoir fait.** Marquer une ligne `CANCELLED` ne
  coute rien au fournisseur : la requete, le raisonnement et la facture continuent. Le signal va
  donc jusqu'a la couche reseau. Quand NOX ne detient plus le controleur — apres un redemarrage —
  l'ecran dit qu'il ne peut pas confirmer, plutot que d'affirmer.
- **La base est conclue avant que la requete soit abandonnee.** C'est cet ordre qui ferme la
  course : une reponse arrivee ensuite trouve une ligne qui n'est plus `RUNNING`, et toute sa
  transaction est refusee — messages, mise a jour de projet, replanification, proposition de
  backlog. La garantie vit dans le `where`, pas dans la vigilance des appelants, et c'est elle qui
  rend un second `Arrêter` sans effet.
- **Un arret n'est pas un echec.** Rien n'a laché, rien n'a ete viole, aucun delai n'a ete
  depasse : quelqu'un a decide de ne pas attendre. Un plafond atteint reste un delai depasse, et
  les deux ne se confondent jamais — le SDK les distingue lui-meme.
- **`Cancel` et `Arrêter` sont deux gestes.** Le premier renonce a un brouillon qui n'est jamais
  parti, sans appel ni facture ; le second interrompt un appel en vol. Leur donner le meme mot
  ferait croire qu'un brouillon abandonne a coute quelque chose.
- **Une duree se mesure, elle ne se reconstruit pas.** `finishedAt` est pose dans la transaction
  qui conclut, et la duree s'en **derive** — deux colonnes se contrediraient. Absente pour une
  generation en vol ou anterieure, et « duree inconnue » n'est pas « zero ».
- **Le temps ecoule s'affiche sans juger.** Aucun seuil, aucune couleur d'alerte, aucune animation :
  reintroduire par l'ecran l'echeance qu'on vient de retirer du code ne vaudrait rien. Le compteur
  avance dans le navigateur, a partir de l'instant **enregistre** au depart — la base n'est pas
  interrogee chaque seconde.
- **Un arret n'est expose que la ou quelqu'un regarde.** Conversation projet et planification de
  backlog, c'est-a-dire exactement les surfaces ou des appels ont ete perdus. Les workflows sans
  interface partagent le plafond, et rien de plus : un bouton qu'aucun ecran ne montre serait un
  bouton mort.
- **Le prochain reglage du plafond viendra de durees observees.** Pas d'un second pari : c'est pour
  cela que la mesure a ete ajoutee en meme temps que la valeur a ete deplacee.

### 8.26 Continuite d'une specification produit

- **Quatre autorites durables, quatre roles.** Le **Project Brief** dit pourquoi et pour qui. Le
  **Living V1 Plan** dit quelles capacites la V1 apporte. La **memoire du projet** porte les regles
  produit **exactes** — formats, intitules, comportements ligne a ligne, semantiques de mise a
  jour. La **documentation du repository** decrit ce qui est reellement implemente. Les confondre
  est l'erreur que ce paragraphe existe pour empecher, et l'omettre la troisieme est celle que le
  second pilote reel a payee.
- **Le detail produit ne monte pas dans le plan.** Une specification recopiee dans le Living V1
  Plan le fait grossir a chaque decision jusqu'a franchir ses bornes, et la borne de vingt entrees
  ne bouge pas pour l'accueillir. Le contrat d'import de TicketPulse — dix-neuf regles — aurait
  fait deborder un plan qui en portait deja quatre.
- **Ce qui n'est ecrit nulle part disparait.** Les tours anciens sortent de la fenetre transmise,
  et la planification ne recoit **aucun transcript**. Une regle tranchee en conversation et jamais
  posee en memoire n'existe donc plus au moment ou une tache est ecrite — quelle que soit la
  clarte avec laquelle elle a ete decidee.
- **Un tour peut proposer une regle durable ; il ne l'ecrit jamais.** Aucune entree n'entre en
  memoire sans un `Apply` humain explicite. Proposer et ecrire restent deux gestes, et c'est la
  garantie que l'invariant « aucune creation automatique » protegeait depuis TASK-018.
- **Une mise a jour du projet est une seule decision.** Brief, plan et regles durables issus du
  meme tour s'appliquent ensemble ou pas du tout, dans une transaction. Un plan qui annoncerait un
  « import controle » sans que la memoire dise ce que « controle » veut dire serait le trou que ce
  correctif comble.
- **Une regle durable se remplace, elle ne se duplique pas.** `UPDATE` vise une entree existante par
  son code et rend son contenu complet. Deux entrees sur un meme sujet laisseraient deux regles
  contradictoires, et la planification recevrait les deux sans savoir laquelle s'applique.
- **Aucune proposition ne supprime une regle.** Une regle qui cesse de s'appliquer s'archive, et
  l'archivage reste un geste humain.
- **La peremption couvre trois axes.** Brief, plan **et** memoire. Une proposition batie sur une
  memoire depuis reecrite est refusee, jamais fusionnee : deux redactions d'une meme regle
  produiraient un contrat que personne n'a valide.
- **Une tache generee porte les regles exactes dont elle a besoin.** Jamais un renvoi — « conforme
  au contrat V1 » decrit une exigence que l'implementeur ne peut pas lire, puisqu'il ne recoit ni
  le brief, ni le plan, ni la memoire. Et jamais un resume : « les doublons ne creent pas deux
  incidents » autorise a en garder un la ou la decision rejetait toutes les occurrences.
- **La pertinence est declaree, jamais devinee.** Les entrees `ACTIVE` partent toutes, les
  `ARCHIVED` ne partent pas, et il n'existe pas de troisieme etat. Aucune selection par mots-cles,
  aucune similarite : une facon silencieuse de retirer une regle d'un contexte serait le bug de
  HOTFIX-005 reintroduit par l'autre bout. C'est le fournisseur, qui voit la memoire et les taches,
  qui decide quelle regle recopier dans quelle tache.
- **Une regle durable ne se propose que par `projectUpdate.memories`.** Il n'existe aucun autre
  canal, et une reponse qui annonce des regles sans remplir ce tableau n'en propose aucune :
  l'utilisateur cherchera une carte a valider et n'en trouvera pas. Une mise a jour qui ne porte
  **que** des regles — brief et plan `UNCHANGED` — est valide et attendue ; c'est le cas central
  quand le plan decrit deja la capacite et que l'utilisateur en fige le contrat precis. Le champ se
  decrivait lui-meme comme portant « le Project Brief et le Living V1 Plan » : le premier pilote a
  donc recu une reponse qui annoncait six entrees et n'en emettait aucune.
- **Un critere d'acceptation prouve un comportement, il ne porte pas une specification.** Chacun
  est borne, et la borne est annoncee au fournisseur comme toutes les autres depuis HOTFIX-003 :
  une borne connue du seul validateur produit un refus deterministe que le modele ne peut pas
  eviter. Plusieurs regles durables sur une meme tache se repartissent sur plusieurs criteres ; le
  contexte et l'objectif portent ce qui leur est commun. Le decoupage repartit les regles, il ne
  les affaiblit jamais.
- **Un refus nomme ce qu'il refuse.** Le critere fautif est designe par son index, sa cause est
  distinguee — vide, absent, trop long — et sa longueur est donnee avec la borne. Le texte refuse,
  lui, n'entre dans aucun diagnostic.
- **Rien ne se deduit du texte du modele.** NOX ne cherche aucune intention dans une phrase, et une
  entree de memoire ne peut naitre que du tableau structure. Une detection en langue naturelle
  transformerait une formulation malheureuse en ecriture durable.
- **Une regle durable est bornee comme toute entree de memoire.** Huit entrees proposables par
  tour, quatre Kio par contenu, quarante-huit Kio actifs. Les bornes sont annoncees au fournisseur
  **et** appliquees par le validateur, depuis la meme constante ; un depassement refuse la mise a
  jour entiere, et rien n'est tronque.


### 8.27 Diagnostic et reprise d'une execution qui a echoue

- **Le code du contrat runner et la cause observee sont deux champs.** `errorCode` reste stable,
  ferme, et porte par les executions deja enregistrees ; il dit **laquelle** des erreurs connues.
  `failureCategory` dit **ce qui a cede** — un processus jamais demarre, un processus sorti en code
  non nul, un agent qui se declare en erreur, un processus tue par un signal. `CLAUDE_PROCESS_FAILED`
  couvrait les trois derniers a lui seul, et un seul appelle une reprise.
- **Une categorie se derive de faits enregistres, jamais d'un message.** Un code de contrat, un code
  de sortie, un drapeau d'annulation. Quand aucun ne tranche, la reponse est `UNKNOWN` — et c'est une
  reponse, pas un trou. Un code que ce web ne connait pas y tombe aussi : le ranger dans une
  categorie plausible serait une invention.
- **Une ligne historique n'est jamais reecrite pour lui donner une categorie.** Les executions
  anterieures portent `NULL`, et la categorie est derivee **a la lecture**, par la meme table que
  celle du runner. Une execution ancienne et une execution recente se lisent donc pareil, sans que
  le passe se mette a dire ce qu'il ne disait pas.
- **Le constat est ecrit par NOX, a partir du seul code systeme.** Jamais le message d'origine de
  Node, qui porterait le chemin absolu de l'executable. Ni environnement, ni trace, ni jeton. Il est
  borne a l'ecriture, comme tout ce qui vient de l'exterieur.
- **`Retry` et `Correct failed run` exigent l'inverse l'un de l'autre**, et l'ecran doit le dire
  avant le clic. Le premier repart d'un repository **propre** ; le second exige que le dossier de
  travail soit **exactement** celui que l'echec a laisse. Les confondre reviendrait a proposer le
  geste qui detruit le travail sous le nom de celui qui le continue.
- **Une correction apres echec n'est jamais automatique.** Un processus mort ne prouve rien sur le
  code : seule une preuve obtenue par NOX lui-meme declenche une reprise sans geste humain, et c'est
  toujours `AUTOMATED_VALIDATION`. `PROCESS_FAILURE` nomme un point de depart, pas un declencheur.
- **Un amorcage se corrige a la main, et pas tout seul.** La boucle automatique le refuse ; la porte
  humaine ne l'a jamais refuse, et celle-ci non plus. Une correction d'amorcage garde les permissions
  d'un amorcage, comme n'importe quelle autre correction garde celles de sa tache.
- **`BLOCKED` et `CANCELLED` ne se reprennent pas d'un clic.** Une limite d'utilisation se resout en
  attendant ; une annulation est une decision humaine de ne pas continuer. Leur dossier de travail
  reste intact et relisible — NOX n'y touche jamais — mais aucun bouton ne le reprend.
- **Un echec qui n'a rien produit ne se reprend pas non plus.** Un processus jamais demarre, une
  limite atteinte avant tout travail : proposer de « continuer » y serait proposer de continuer le
  vide. Le refus est nomme, et l'action reste affichee avec sa raison.
- **L'empreinte du dossier de travail reste seule autorite pour accorder une reprise.** Les
  empreintes par entree qui l'accompagnent ne decident de rien : elles sont comparees **apres** un
  refus, uniquement pour nommer les chemins concernes. Liste identique et empreinte differente : le
  refus tient, et le message ne laisse jamais croire que rien n'a change.
- **Une entree ne porte qu'un chemin relatif, un statut Git et un HMAC tronque.** Jamais un octet de
  fichier. Son digest couvre le **contenu** et non l'etat d'index : les melanger ferait lire un
  `git add` comme une edition. Absentes — execution anterieure, liste hors bornes — le refus tient et
  reconnait qu'il ne peut pas nommer de chemin.
- **Un refus indiagnostiquable finit par etre contourne**, et le contournement detruit le travail que
  le refus protegeait. C'est la raison d'etre de tout ce paragraphe.
- **Ce que le protocole n'expose pas est dit, jamais deduit.** Claude Code ne donne pas toujours la
  commande fautive ni son code de retour. « Non expose par le protocole » et « non enregistre » sont
  deux reponses differentes, et l'ecran les distingue — le silence, lui, se lit comme une lacune de
  NOX et envoie chercher au mauvais endroit.
- **La derniere activite se derive des evenements, elle ne se stocke pas.** Un champ « derniere
  action » serait un compteur denormalise de plus, et divergerait des lignes qu'il pretend resumer.
- **Aucune option de forcage n'existe sur une reprise**, et il ne doit pas en exister. Ni `force`, ni
  `ignoreFingerprint`, ni « continuer quand meme » : c'est cette garantie qui rend la review suivante
  interpretable.
- **`Retry` ne change un statut que s'il pourrait reellement partir.** `FAILED → READY` est precede
  d'un controle en lecture — repository libre, preflight satisfait —, et un refus n'ecrit rien. Le
  geste ne lance pas lui-meme : le lancement est une seconde action, et sans ce controle la tache
  quittait l'echec pour une execution qui ne partirait jamais.
- **Ce controle ne concerne que cette transition.** Toutes les autres restent des ecritures SQLite,
  et les pages continuent de fonctionner runner arrete. Les dependances non satisfaites n'y entrent
  pas non plus : une tache prete qui attend **reste prete**, et la dependance refuse un lancement,
  jamais un statut.
- **Un refus de `Retry` dit ce qui n'a pas bouge.** « Aucune execution n'a demarre, la tache reste en
  echec » repond a la question que l'utilisateur se pose vraiment devant un refus. Sans elle, il
  suppose le pire et va verifier en base.
- **Une reprise s'ancre a l'execution, jamais au statut de la tache.** Le seul `READY` accepte est
  celui d'un `Retry` qui n'a jamais demarre : execution en echec, rien d'autre depuis, aucune
  correction deja nee. Les trois conditions sont cumulatives, et rejouees **dans** la transaction qui
  ecrit — un appelant qui avait raison il y a trois secondes n'est pas une garantie.
- **Les corrections nees d'une execution ne la rendent pas obsolete.** Elles en descendent : les
  compter comme « quelque chose s'est passe depuis » ferait echouer toute reprise. La question posee
  est « autre chose a-t-il eu lieu ? », et elle s'ecrit en `OR` explicite — un `NOT` sur une colonne
  nullable ecarterait silencieusement toutes les executions initiales.
- **Reconnaitre un `Retry` avorte ouvre une porte, jamais une exception.** Branche, `HEAD` et
  empreinte restent verifies par le runner avant le lancement, et un refus laisse la tache ou elle
  etait.
- **Une execution sans empreintes par entree se reprend exactement comme une autre.** L'empreinte
  globale decide ; seule la localisation d'un refus manque, et l'ecran le dit. Affaiblir l'egalite
  parce que le diagnostic est absent serait confondre « je ne peux pas nommer » et « je ne peux pas
  verifier ».
