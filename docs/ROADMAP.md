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

## Phase de fondation — terminée

`TASK-001` → `TASK-017`. Dix-sept étapes qui ont construit la chaîne complète, d'un dossier
vide à une exécution relue.

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

**Ce que la fondation ne fait pas, et n'a jamais prétendu faire** : aucun lancement
automatique, aucune boucle autonome entre les deux modèles, aucun commit, aucun push, aucun
résumé silencieux, aucune estimation de coût.

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
qui tient un projet.**

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

### `TASK-025` — Tableau de bord et cycle de vie d'un projet — **suivante**

Répondre à « où en est ce projet » sans ouvrir chaque tâche, et savoir en sortir. Cette étape
regroupe ce qui a été reporté depuis plusieurs tâches : nettoyer la page d'accueil des textes de
développement devenus obsolètes, une présentation réellement centrée projet, un vocabulaire et
une navigation revus, les métadonnées techniques derrière une inspection plutôt qu'en surface,
la suppression d'un projet **de NOX** avec sa Danger Zone, et la gestion des documents
`tasks/TASK-xxx.md` laissés dans le repository — pour qu'un même dépôt puisse être réajouté
comme nouveau projet. Le code applicatif, le repository et son `.git` ne sont jamais supprimés.

### `TASK-026` — File d'exécution

Enchaîner plusieurs tâches prêtes. Enchaîner n'est pas s'autonomiser : chaque départ reste
décidé, et une seule exécution reste active.

### `TASK-027` — Validation autonome et classification des tests humains

Distinguer ce qu'une commande prouve, ce que l'Architecte peut établir, et ce qui exige
réellement un test humain.

### `TASK-028` — Boucle bornée de correction et de re-review

Enchaîner correction et relecture, avec une borne explicite. Une boucle sans borne finit par
tourner seule.

### `TASK-029` — Livraison Git contrôlée

Commit et push depuis NOX, sur décision explicite, avec un message relu. La règle « aucun push
automatique » ne change pas : c'est le geste qui entre dans l'outil, pas la décision.

### `TASK-030` — Vue d'ensemble multi-projets

Une vue d'ensemble, une fois qu'un projet unique est correctement tenu. À réconcilier avec
`TASK-025` le moment venu : deux tableaux de bord vaudraient moins qu'un seul.

### `TASK-031` — Runner multi-projets

Aujourd'hui, une seule exécution est active tous projets confondus. Cette limite tombe ici, ou
pas du tout.

### `TASK-032` — Replanification depuis la conversation principale

La boucle se referme : revenir dans la conversation du projet et réordonner le plan restant.

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
