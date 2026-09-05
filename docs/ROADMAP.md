# ROADMAP — NOX

> **Rôle de ce document** : ce qui est envisagé ensuite, et dans quel ordre.
>
> Ce qui existe est décrit dans [PROJECT_STATE.md](PROJECT_STATE.md), la cible produit dans
> [V1_SCOPE.md](V1_SCOPE.md), et les choix déjà tranchés dans [DECISIONS.md](DECISIONS.md).

**Les numéros au-delà de `TASK-018` sont une direction, pas un contrat.** Ils disent l'ordre
probable et la découpe envisagée. Une étape peut être fusionnée, scindée, réordonnée ou
abandonnée — et le sera, si le projet le demande. Une étape n'existe vraiment qu'au moment où
son prompt est écrit.

---

## Étapes terminées

`TASK-001` → `TASK-032`. La chaîne complète, d'un dossier vide à une livraison relue, puis
retour à la conversation du projet pour faire évoluer le plan restant. `TASK-019` a été
sautée, `TASK-030` absorbée par `TASK-025` : les deux sont expliquées plus bas.

| # | Étape | Ce qu'elle a apporté |
| --- | --- | --- |
| 1 | Socle monorepo | Workspaces npm, TypeScript strict, ESLint unique, trois packages |
| 2 | Gestion locale des projets | Projets en SQLite, statuts, chemin de repository enregistré |
| 3 | Connexion web ↔ runner | Runner local authentifié, contrat partagé, boucle locale exclusive |
| 4 | Documents Markdown | Inventaire et lecture confinés, chemins vérifiés après `realpath` |
| 5 | Édition d'un document | Écriture atomique, contrôle de révision, aucun forçage de conflit |
| 6 | Création de documents | Primitive exclusive, noms portables, parents contrôlés |
| 7 | Tâches structurées | Codes immuables, document à chemin stable, synchronisation visible |
| 8 | Lancement Claude Code | Préflight Git, prompt régénéré côté serveur, politique d'outils calculée |
| 9 | Suppression et libellés | Suppression contrôlée, libellés centralisés, statuts internes stables |
| 10 | Streaming et annulation | `stream-json`, événements fermés et bornés, arrêt de l'arbre de processus |
| 11 | Review Git et validations | Instantané immuable, diff borné, issue réellement observée |
| 12 | Feedback et reprise ciblée | Empreinte de dossier de travail authentifiée, `--resume`, run de correction |
| 13 | Architecte NOX | Second modèle sans outils, contexte fermé, proposition relue puis créée |
| 14 | Conversation Architecte | Transcript possédé par NOX, empreinte de contexte, diff entre deux tours |
| 15 | Review Architecte | Bundle issu de l'instantané, verdict et garde d'approbation |
| 16 | Workflow guidé | Étape courante et prochaine action, dérivées, sans stockage ni IA |
| 17 | Mémoire projet | Décisions durables, budget refusé à l'écriture, injection tracée |
| 18 | Consolidation documentaire | Un rôle par document, vision réalignée, audit technique |
| 20 | Conversation projet | Une conversation durable par projet, plusieurs tâches dans le temps |
| 21 | Plan de projet structuré | Project Brief et Living V1 Plan, proposés par l'Architecte, appliqués par l'humain |
| 22 | Backlog de V1 | Planification multi-tâches, revue et réordonnancement, création par lot |
| 23 | Amorçage d'un projet | `TASK-000` déterministe, construite sans appel à une IA |
| 24 | Dépendances et tâches futures | Graphe acyclique explicite, édition avant première exécution |
| 25 | Tableau de bord et cycle de vie | Accueil centrée projets, suppression d'un projet de NOX, repository préservé |
| 26 | File d'exécution | Intention persistée, autorisation explicite, sélection déterministe |
| 27 | Validation autonome | Classification écrite avant l'exécution, preuves obtenues par NOX lui-même |
| 28 | Correction pilotée par la validation | Contexte d'échec local, relance bornée à deux tentatives |
| 29 | Livraison Git contrôlée | Politique par projet, candidat figé, aucune réconciliation |
| 31 | Runner multi-projets | Concurrence par repository, aucune file ni ordonnanceur global |
| 32 | Replanification depuis la conversation | État cible du travail futur, revue combinée, application atomique |

**Ce que NOX ne fait pas, et n'a jamais prétendu faire** : aucun lancement automatique,
aucune boucle autonome entre les deux modèles, aucun résumé silencieux, aucune estimation de
coût — et, tant que la politique de livraison du projet reste `Manual`, aucun commit et aucun
push.

---

## Étapes récentes

### `TASK-018` — Consolidation documentaire et réalignement produit — terminée

Chaque information remise dans le document qui en est responsable, documents de vision réalignés
sur la direction ci-dessous, repository audité. Aucun changement fonctionnel.

### `TASK-019` — Nettoyage de dette technique — **sautée**

L'audit de `TASK-018` n'a trouvé ni sous-système obsolète, ni couche dupliquée, ni fichier mort :
seulement deux helpers de quatre lignes, consignés pour être traités en marge d'une tâche qui
touchera déjà ces fichiers. Une tâche dédiée n'était pas justifiée.

### `TASK-020` — Project Architect : conversation principale persistante — terminée

Un projet possède désormais une conversation Architecte durable, qui ne se ferme pas quand une
tâche est créée et qui en produit plusieurs au fil du temps. Les conversations de conception de
tâche restent lisibles, en lecture seule.

C'était le pivot de toute la suite : le plan, le backlog et la replanification supposent tous un
endroit durable où la conception vit.

### `TASK-021` — Project Brief structuré et Living V1 Plan — terminée

NOX tient désormais l'intention produit d'un projet dans deux objets structurés, distincts de
ses documents Markdown : ce qu'on construit et pour qui d'un côté, ce que la V1 doit accomplir
de l'autre. Ils s'éditent à la main, accompagnent chaque tour de l'Architecte, et priment sur la
documentation du repository pour l'intention produit.

L'Architecte peut **proposer** de les modifier. La proposition se relit champ par champ, se
corrige, puis s'applique ou s'écarte — et seule une application humaine change quoi que ce soit.
Une proposition bâtie sur un état devenu obsolète est refusée, jamais fusionnée.

C'est le premier cycle « le modèle propose, l'humain relit et corrige, NOX applique » de
l'outil. `TASK-022` l'a réutilisé pour le backlog.

### `TASK-022` — Planification multi-tâches et génération de backlog — terminée

Le Living V1 Plan validé se transforme désormais en un backlog ordonné de plusieurs tâches.
Un workflow de planification dédié — `backlog/1`, distinct du contrat conversationnel —
reçoit le brief, le plan, la mémoire, l'inventaire des tâches existantes et la documentation
autorisée, mais **aucune conversation** : la connaissance durable du projet suffit à
planifier.

La proposition se relit tâche par tâche, s'édite, se réordonne, s'ampute, puis s'applique en
un lot de tâches `DRAFT`. Toute modification du contexte de planification entre la
génération et l'application refuse le backlog — jamais de fusion automatique.

Ce que cette étape n'a **pas** fait, délibérément : ni dépendances explicites, ni file
d'exécution, ni modification des tâches existantes.

---

## Direction retenue

Cette direction remplace l'ancienne, qui s'arrêtait à un « test sur un petit projet réel »
suivi de « fonctionnalités avancées ». Elle est plus précise parce que la fondation, elle,
est finie.

Le cap tient en une phrase : **faire passer NOX d'un outil qui exécute des tâches à un outil
qui tient un projet.** Depuis `TASK-032`, la boucle ci-dessous est fermée : elle revient à la
conversation, et le plan restant y évolue.

```text
1 Project
    ↓
1 persistent project conversation
    ↓
Living Project Plan
    ↓
Multiple Tasks
    ↓
Execution queue
    ↓
Claude Code
    ↓
Automated validations
    ↓
Architect review
    ↓
Human validation only when necessary
    ↓
Validated delivery
    ↓
Back to the project conversation
    ↓
Project change  →  replanned future work
```

### `TASK-023` — Amorçage d'un projet — `TASK-000` — terminée

Le premier pas d'un projet : `TASK-000` prépare le repository et sa documentation fondamentale
avant les tâches produit. Construite **déterministement** à partir du brief, du plan, de la
mémoire, du backlog appliqué et d'une inspection en lecture seule du repository — sans aucun
appel à une IA. Le numéro `0` lui est réservé, un projet n'en porte qu'une, et sa création ne
consomme aucun numéro de tâche ordinaire.

### `TASK-024` — Dépendances entre tâches et modification des tâches futures — terminée

Une tâche peut en attendre d'autres, explicitement. Le graphe est acyclique et local au projet,
la satisfaction se dérive du statut courant — seule une tâche terminée compte —, et le lancement
est revalidé côté serveur. Une tâche jamais exécutée reste modifiable ; dès sa première
exécution, sa spécification est figée.

### `TASK-025` — Tableau de bord et cycle de vie d'un projet — terminée

La page d'accueil est devenue un tableau de bord des projets : une carte par projet, dérivée des
données réelles, à la place des textes de développement qui décrivaient l'avancement de NOX
lui-même. La navigation d'un projet a été remise dans l'ordre du travail, et les métadonnées
techniques d'une exécution sont passées derrière Inspect.

Un projet se **supprime de NOX** : tout son état part en une transaction, et les documents
`tasks/TASK-xxx.md` que NOX a écrits sont retirés — reconnus par la révision enregistrée en
base, jamais par un motif de nom de fichier. Le code applicatif, le `.git` et la documentation
du repository sont préservés, aucune opération Git n'a lieu, et le même dossier peut être
réenregistré comme un projet réellement neuf. Un projet se renomme aussi, sans que rien du
repository ne bouge.

### `TASK-026` — File d'exécution — terminée

Plusieurs tâches prêtes s'inscrivent dans la file d'un projet, et NOX les lance une à une. Deux
gestes humains, pas un : inscrire ne lance rien, démarrer la file ouvre une autorisation
permanente. La sélection est déterministe, sans appel à un modèle, et saute les entrées qui
attendent une dépendance — elles gardent leur place.

Ce que la file **ne fait pas** compte autant : elle ne contourne ni le préflight Git, ni la review
humaine, ni l'unicité de l'exécution active, et un redémarrage du serveur ne lance jamais rien. Une
entrée reste en place jusqu'à ce que la tâche soit acceptée — une exécution terminée n'est pas un
travail accepté.

### `TASK-027` — Validation autonome et classification des critères — terminée

Chaque critère d'acceptation déclare **avant l'exécution** comment il se vérifie : par une commande
que NOX exécutera lui-même, ou par un humain. Une tâche dont tous les critères sont automatisés et
tous prouvés se termine seule ; toutes les autres reviennent à un humain, avec une review qui ne
montre que ce qui le concerne vraiment.

La distinction centrale est celle entre un **récit** et une **preuve** : « Claude dit avoir lancé
`npm test` » n'est pas « NOX a lancé `npm test` ». Seule la seconde soutient un critère, et elle est
obtenue sans interprète de commandes, sans variable `NOX_*`, et sans jamais toucher à Git.

Ce que cette étape **ne fait pas** : elle ne demande son avis à aucune IA — ni OpenAI, ni Claude
Code —, ne transforme jamais un échec en réussite, et n'offre aucun contournement. Un passage en
force existe, mais il est humain, motivé, et laisse le résultat automatisé intact.

### `TASK-028` — Boucle de correction pilotée par la validation — terminée

Un échec que NOX a constaté lui-même devient un **contexte de correction** : le critère non prouvé,
la commande qui devait le prouver, son code de sortie et ses sorties partent avec la reprise. Plus
personne ne lit des logs pour en recopier l'erreur.

Une file active autorise NOX à relancer Claude Code de lui-même sur cet échec, **au plus deux fois
par cycle de travail**. Au-delà, la main revient à un humain, et l'écran le dit. Hors file, ou file
en pause, rien ne part sans un clic — la correction est simplement déjà prête.

Ce que cette étape **ne fait pas** : elle ne corrige jamais sur une panne d'infrastructure — « je
n'ai pas pu regarder » n'est pas « j'ai regardé et c'est faux » —, ne touche pas au contrat gelé de
la tâche, ne reprend aucune preuve d'une tentative précédente, ne recycle aucune confirmation
humaine, et ne lance rien au démarrage du serveur.

### `TASK-029` — Livraison Git contrôlée — terminée

Chaque projet porte une politique de livraison : `Manual`, `Auto commit validated`,
`Auto commit + push validated`. Le défaut est `Manual`, et il n'accorde rien — installer cette
version produit zéro commit et zéro push. Changer ce réglage **est** l'autorisation humaine :
NOX ne redemande pas confirmation tâche par tâche, et l'écran l'annonce avant le clic.

Une tâche validée fige un **candidat** : branche, `HEAD`, empreinte du dossier de travail et
liste exacte des fichiers. Juste avant d'écrire, NOX relit tout et compare. S'il correspond, il
prépare les chemins exacts, crée un commit lisible et — selon le mode — le pousse vers
l'upstream déjà configuré. La file peut alors continuer : `Auto commit validated` est satisfaite
dès le commit local, sans push, et la branche reste alors volontairement en avance sur son
upstream ; `Auto commit + push validated` attend, elle, la confirmation du push.

Ce que cette étape **ne fait pas** : elle ne commite jamais un état qui a divergé — sans
échappatoire —, ne change jamais de branche, ne configure jamais un upstream, ne force jamais un
push, ne tire, ne fusionne, ne rebase, ne réinitialise, ne restaure et ne nettoie jamais. Elle ne
contourne ni les hooks, ni la signature, et ne stocke aucun identifiant Git.

### `TASK-030` — Vue d'ensemble multi-projets — **absorbée par `TASK-025`**

Le tableau de bord des projets existe depuis `TASK-025`. Cette entrée reste ici pour que son
numéro ne soit pas réutilisé, et pour dire explicitement ce qu'elle est devenue : **aucune
seconde implémentation de tableau de bord n'est prévue**. Ce qui pourra encore manquer — une
recherche, un filtre, une pagination — se traitera comme une évolution de la surface existante,
pas comme une nouvelle étape.

### `TASK-031` — Runner multi-projets — terminée

La limitation globale a disparu. Plusieurs projets travaillent en même temps, chacun sur son
repository : leur file, leur exécution, leurs validations, leurs corrections et leur livraison
Git avancent sans se bloquer. Ce qui reste interdit l'est toujours — **au plus une exécution
Claude Code par repository canonique** — et l'est deux fois : en base, dans la transaction qui
crée l'exécution, puis dans le runner, sur les processus réels.

Ce que cette étape **ne fait pas** : elle n'ordonnance rien, ne crée aucune file globale, aucune
priorité, aucune équité, aucun plafond chiffré. Elle n'élargit aucune autorisation — démarrer la
file d'un projet n'en démarre aucun autre —, ne dispatche rien au démarrage du serveur, et
n'ouvre pas les dépendances entre projets.

### `TASK-032` — Replanification depuis la conversation principale — terminée

La boucle se referme. Une exigence qui change se dit dans la conversation du projet, et
l'Architecte peut y proposer un **changement de projet** : le Project Brief et le Living V1
Plan, le plan des tâches futures, ou les deux ensemble — une seule intention, une seule revue,
un seul `Apply project change`.

Le passé est immuable et le futur est replanifiable : une tâche qui a tourné, qui est en file,
ou qui est `TASK-000` n'est jamais réécrite ; les autres se modifient, se retirent, se
déplacent, et de nouvelles s'ajoutent avec leurs dépendances. Le fournisseur rend un **état
cible**, jamais des opérations — NOX dérive lui-même ce que cet état fait au plan courant.
L'identifiant et le code d'une tâche existante sont immuables, et aucun code n'est recyclé.

La planification initiale reste `backlog/2` ; la replanification est `replan/1`. Deux prompts,
deux moments, aucun des deux ne fait le travail de l'autre.

Ce que cette étape **ne fait pas** : elle ne modifie rien avant un geste humain, ne fusionne
jamais un état devenu obsolète, n'offre aucun forçage, n'appelle ni Claude Code ni le runner à
l'application, ne touche jamais à Git, et ne démarre, ne met en pause et ne vide aucune file.

**Elle achève le périmètre de V1 prévu.**

---

## Prochaine étape — `FIRST NOX V1 REAL PILOT`

Ce n'est pas une `TASK-033`, et il ne faut pas en écrire une avant.

Le périmètre de V1 prévu est couvert : la chaîne complète existe, de la première phrase de
description d'un projet jusqu'à une livraison Git relue, et revient à la conversation pour
faire évoluer le plan. Ce qui manque n'est plus une capacité — c'est l'**observation d'un vrai
usage**.

Le pilote consiste à conduire un vrai projet, sur un vrai repository, avec un vrai modèle, de
bout en bout. Ce qu'il doit mesurer :

| Ce qu'on observe | Ce que cela dirait |
| --- | --- |
| Nombre et nature des interventions humaines | Où NOX demande de l'aide sans en avoir besoin, et l'inverse |
| Endroits où la chaîne s'arrête | Quel arrêt est une garde utile, et lequel est une friction |
| Justesse des classifications `HUMAN` / `AUTOMATED` | Si le contrat écrit avant l'exécution tient à l'usage |
| Qualité du backlog initial | Si `backlog/2` produit un découpage réellement exécutable |
| Qualité des replanifications | Si `replan/1` fait évoluer le plan sans le réinventer |
| Corrections automatiques | Si deux tentatives suffisent, et ce qu'elles réparent vraiment |
| Blocages de livraison Git | Ce qui empêche un commit qui aurait dû passer |
| Confusions d'interface | Ce qui se relit deux fois avant d'être compris |
| Répétitions d'information | Ce que NOX fait redire à l'utilisateur |
| Décisions d'Architecte perdues | Ce qui est décidé dans une conversation et n'atteint jamais une tâche |
| Qualité réelle du projet construit | La seule mesure qui compte pour finir |

Aucune fonctionnalité nouvelle ne sera écrite avant que ce pilote ait tourné. Une liste écrite
d'avance décrirait les manques qu'on imagine, pas ceux qu'on rencontre.

### Correctifs issus du pilote

Un correctif de pilote n'est pas une étape de roadmap : il répare ce que l'usage réel a montré,
sans rien ajouter. Il est consigné ici pour que la chronologie reste lisible.

`TASK-033` et `TASK-034` y figurent aussi, bien qu'elles portent des numéros de tâche : elles ne
livrent aucune capacité qu'un utilisateur aurait demandée, elles retirent des gestes et des
angles morts que le pilote a rendus visibles. La première traite l'autonomie du workflow, la
seconde ce qu'on peut en voir.

**Ensemble, elles closent le durcissement issu du premier pilote.** Ce qui vient après n'est pas
une `TASK-035` : c'est un **second vrai pilote**, sur un autre projet et une autre pile, dont le
seul livrable est le relevé des frictions réellement rencontrées.

| Correctif | Ce que le pilote a montré | Ce qui a changé |
| --- | --- | --- |
| `HOTFIX-001` | TripKit décidait son architecture sur `gpt-5-mini`, parce que `NOX_ARCHITECT_MODEL` était obligatoire et sa valeur recopiée d'un exemple. Et `BACKLOG-001` a échoué en n'affichant que « format attendu », alors que NOX connaissait le champ fautif. | Un modèle d'architecture par défaut, assumé et nommé à un seul endroit ; le diagnostic de refus d'un backlog persisté et affiché. Voir [D-378](DECISIONS.md) et [D-379](DECISIONS.md). |
| `HOTFIX-002` | La validation autonome de `TASK-001` ne démarrait pas sous Windows — `npm` y est un `.cmd`, et trois défauts distincts s'additionnaient. Et la review affirmait que Claude Code n'avait jamais lancé des commandes qu'il avait bel et bien lancées, dans un enchaînement que NOX refuse de lire. | Une stratégie de lancement dépendante de la plateforme, écrite à un seul endroit ; un diagnostic d'infrastructure qui nomme sa cause ; une review qui dit ce que NOX a observé plutôt que ce que l'agent aurait fait. Voir [D-380](DECISIONS.md) à [D-383](DECISIONS.md). |
| `TASK-033` | Quatre gestes humains restaient nécessaires alors que rien ne les exigeait : poser les dépendances à la main, savoir qu'un replan de vérification était possible après l'amorçage, et retourner dans un terminal pour livrer. | Les dépendances entrent dans `backlog/3` et `architect/6` ; un rafraîchissement borné des plans de vérification suit l'amorçage ; la commande de validation se demande littéralement ; la livraison Git devient visible depuis toute tâche terminée. Voir [D-384](DECISIONS.md) à [D-389](DECISIONS.md). |
| `TASK-034` | Il fallait lire chaque pastille pour savoir où en était un projet ; `BACKLOG-002` a été généré par un modèle que son auteur croyait avoir remplacé, invisible avant l'appel ; comprendre un `VALIDATION_SPAWN_FAILED` a demandé de reproduire `spawn("npm")` à la main, alors que NOX avait déjà le diagnostic ; et l'autonomie obtenue restait éparpillée dans neuf tables. | Un langage visuel où terminé, bloqué et échoué se reconnaissent sans être lus ; le modèle du prochain appel affiché avec sa provenance ; Inspect Run devenu la surface qui dit ce que NOX a observé ; des compteurs d'activité par projet — des faits, jamais un score. Aucune migration. Voir [D-390](DECISIONS.md) à [D-395](DECISIONS.md). |

---

## Vérification sur un projet réel

Ce n'est pas une étape : c'est une pratique permanente.

Chaque étape depuis `TASK-008` se conclut par une procédure de vérification manuelle,
exécutée par l'utilisateur sur un vrai repository, et consignée dans
[PROJECT_STATE.md](PROJECT_STATE.md). Un test automatisé contre un faux fournisseur ne prouve
rien du comportement réel d'un modèle ou d'un binaire — il prouve seulement que le contrat est
respecté.

Cette pratique est ce qui a révélé, entre autres, la forme réelle des lignes Bash de Claude
Code et la structure exacte de ses événements `stream-json`.

---

## Hors périmètre, durablement

Ces éléments ne figurent nulle part ci-dessus, et c'est délibéré. Le détail et les raisons
sont dans [V1_SCOPE.md](V1_SCOPE.md) § 3.

Autonomie sans checkpoints · orchestration multi-agents complexe · parallélisme agressif dans
un même repository · automatisation avancée des PR GitHub · cloud multi-utilisateur ·
collaboration temps réel · plusieurs comptes Claude · worktrees automatiques · application
mobile · déploiement applicatif · apprentissage automatique des préférences · mémoire
vectorielle, embeddings et RAG.
