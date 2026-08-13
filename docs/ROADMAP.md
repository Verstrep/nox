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

**Ce que la fondation ne fait pas, et n'a jamais prétendu faire** : aucun lancement
automatique, aucune boucle autonome entre les deux modèles, aucun commit, aucun push, aucun
résumé silencieux, aucune estimation de coût.

---

## Étape en cours

### `TASK-018` — Consolidation documentaire et réalignement produit

Remettre chaque information dans le document qui en est responsable, réaligner les documents
de vision sur la direction ci-dessous, et auditer le repository pour identifier la dette
technique réelle.

Aucun changement fonctionnel.

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

### `TASK-019` — Nettoyage de dette technique

**Conditionnelle.** N'a lieu de se faire que si `TASK-018` prouve une dette suffisante. Une
tâche de nettoyage motivée par « le code pourrait être plus propre » coûte une review et
n'apporte rien.

### `TASK-020` — Project Architect : conversation principale persistante

Une conversation rattachée au projet, et non à une tâche à concevoir. On y revient.

C'est le pivot de toute la suite : le plan, le backlog et la replanification supposent tous un
endroit durable où la conception vit.

### `TASK-021` — Project Brief structuré et plan de V1 vivant

Une compréhension du projet tenue par NOX, structurée et modifiable, et le premier plan qui en
découle.

### `TASK-022` — Planification multi-tâches et génération de backlog

Produire plusieurs tâches ordonnées à partir d'une conception, chacune créée en brouillon et
relue avant d'être mise en file.

### `TASK-023` — Amorçage d'un projet — `TASK-000`

Le premier pas d'un projet vide : structure, documents de référence, premier commit préparé.

### `TASK-024` — Dépendances entre tâches et modification des tâches futures

Un plan vivant suppose de pouvoir réécrire ce qui n'a pas encore été lancé, et de dire qu'une
tâche en attend une autre.

### `TASK-025` — Refonte du tableau de bord d'un projet

Répondre à « où en est ce projet » sans ouvrir chaque tâche.

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

### `TASK-030` — Tableau de bord multi-projets

Une vue d'ensemble, une fois qu'un projet unique est correctement tenu.

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
