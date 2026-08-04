# V1_SCOPE — Périmètre de la première V1

Ce document définit ce que la **V1 de NOX** doit permettre. Il ne décrit pas l'état actuel
du projet (voir [PROJECT_STATE.md](PROJECT_STATE.md)) mais la cible à atteindre.

Critère de réussite de la V1 : **piloter un vrai petit projet de bout en bout avec NOX,
sans copier-coller manuel entre la conception et Claude Code.**

## 1. Périmètre inclus

### 1.1 Créer un projet NOX

- Créer un projet avec un nom et une description.
- Lister les projets existants.
- Consulter et modifier les informations d'un projet.
- Suivre l'état du projet via `ProjectStatus` (`DRAFT`, `ACTIVE`, `PAUSED`, `COMPLETED`, `ARCHIVED`).

### 1.2 Enregistrer le chemin d'un repository local

- Associer un projet à un dossier du poste de développement.
- Vérifier que le chemin existe et qu'il s'agit bien d'un repository Git.
- Afficher la branche courante et l'état du dossier de travail.
- Refuser toute action sur un chemin qui n'a pas été enregistré explicitement.

### 1.3 Discuter avec l'orchestrateur

- Une conversation par projet, persistée.
- L'orchestrateur a accès aux documents Markdown du projet comme contexte.
- La conversation sert à clarifier le besoin, pas à écrire le code.
- Historique consultable et repris d'une session à l'autre.

### 1.4 Maintenir les principaux documents du projet

- Créer, lire et modifier les documents Markdown depuis l'interface.
- L'orchestrateur peut proposer une mise à jour ; l'utilisateur la valide.
- Les documents restent des fichiers réels du repository, versionnés par Git.
- Ensemble minimal : brief, périmètre, architecture, roadmap, décisions, état.

### 1.5 Créer des tâches structurées

- Une tâche appartient à un projet.
- Champs minimaux : titre, objectif, périmètre, hors-périmètre, critères d'acceptation,
  commandes de validation.
- Ordonnancement des tâches dans un backlog.
- Suivi du statut via `TaskStatus` (`DRAFT`, `READY`, `RUNNING`, `BLOCKED`, `FAILED`,
  `REVIEW`, `COMPLETED`).

### 1.6 Envoyer une tâche à Claude Code

- Génération du prompt à partir de la tâche et des documents référencés.
- Prévisualisation du prompt **avant** envoi.
- Déclenchement explicite par l'utilisateur — jamais automatique.
- Exécution par le runner local, dans le repository du projet.
- Possibilité d'annuler une exécution en cours.

### 1.7 Suivre les logs

- Flux de sortie de Claude Code visible pendant l'exécution.
- Logs conservés et rattachés à l'exécution correspondante.
- Suivi du statut via `RunStatus` (`QUEUED`, `RUNNING`, `BLOCKED`, `FAILED`, `CANCELLED`,
  `COMPLETED`).

### 1.8 Récupérer les résultats Git et les validations

- `git status` et liste des fichiers modifiés après exécution.
- Diff consultable depuis l'interface.
- Résultat du lint, du typecheck et du build, avec la sortie d'erreur exploitable.
- Distinction claire entre « la commande a échoué » et « la commande n'a pas été lancée ».

### 1.9 Accepter le résultat ou demander une correction

- Marquer une tâche comme validée.
- Créer une tâche de correction reprenant le contexte de l'exécution ratée.
- Le commit et le push restent des actions humaines, hors de NOX.

## 2. Hors périmètre de la V1

Ces éléments sont explicitement exclus. Ils pourront être reconsidérés après la V1.

| Hors périmètre | Raison |
| --- | --- |
| Plusieurs comptes Claude | Complexité de gestion des sessions et des quotas, sans bénéfice pour un usage personnel. |
| Plusieurs agents en parallèle | Rend la review humaine impossible à suivre et multiplie les conflits d'écriture. |
| Git worktrees automatiques | Utile seulement avec du parallélisme, qui est lui-même hors périmètre. |
| Application mobile | L'usage cible est un poste de développement avec un repository local. |
| Déploiement automatique | NOX orchestre le développement, pas la livraison. |
| Authentification multi-utilisateur | Outil personnel, exécuté en local sur la boucle locale. |
| Apprentissage automatique des préférences | Nécessite un volume d'historique inexistant avant un usage réel prolongé. |

## 3. Contraintes transverses de la V1

- **Exécution locale.** Le runner n'écoute que sur la boucle locale.
- **Aucune action Git distante.** NOX ne pousse jamais vers un dépôt distant.
- **Aucune exécution implicite.** Toute commande sur le repository est déclenchée par
  l'utilisateur.
- **Secrets hors du repository.** Les clés d'API vivent dans un `.env` non versionné.
- **Coûts visibles.** L'usage OpenAI et les limites Claude doivent être consultables — au
  minimum de façon indicative.
