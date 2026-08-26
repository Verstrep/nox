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
| 23 | Amorçage d'un projet | `TASK-000` déterministe, construite sans appel à une IA |
| 24 | Dépendances et tâches futures | Graphe acyclique explicite, édition avant première exécution |
| 25 | Tableau de bord et cycle de vie | Accueil centrée projets, suppression d'un projet de NOX, repository préservé |
| 26 | File d'exécution | Intention persistée, autorisation explicite, sélection déterministe |
| 27 | Validation autonome | Classification écrite avant l'exécution, preuves obtenues par NOX lui-même |

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

### `TASK-029` — Livraison Git contrôlée — **suivante**

Permettre à NOX, après une validation réussie, d'effectuer une livraison Git **explicitement
autorisée**, afin que la file puisse continuer sans attendre un commit manuel. La règle « aucun
push automatique » ne change pas : c'est le geste qui entre dans l'outil, pas la décision.

### `TASK-030` — Vue d'ensemble multi-projets — **absorbée par `TASK-025`**

Le tableau de bord des projets existe depuis `TASK-025`. Cette entrée reste ici pour que son
numéro ne soit pas réutilisé, et pour dire explicitement ce qu'elle est devenue : **aucune
seconde implémentation de tableau de bord n'est prévue**. Ce qui pourra encore manquer — une
recherche, un filtre, une pagination — se traitera comme une évolution de la surface existante,
pas comme une nouvelle étape.

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
