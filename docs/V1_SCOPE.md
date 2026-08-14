# V1_SCOPE — Cible produit

> **Rôle de ce document** : ce que NOX doit permettre pour mériter le nom de V1.
>
> Il distingue trois ensembles : ce qui est **déjà acquis**, ce qui **manque encore** à la V1
> visée, et ce qui est **explicitement remis à plus tard**. Le détail de ce qui existe est dans
> [PROJECT_STATE.md](PROJECT_STATE.md) ; l'ordre d'arrivée du reste est dans
> [ROADMAP.md](ROADMAP.md).

**Critère de réussite de la V1** : piloter un vrai projet de bout en bout depuis NOX — de la
première phrase de description jusqu'à une livraison relue — sans copier-coller manuel entre la
conception et l'exécution.

---

## 1. Capacités déjà acquises

Ces fondations sont implémentées, testées et utilisables. Elles ne sont pas la V1 ; elles en
sont le socle.

### 1.1 Projets et repository

- Créer un projet, le lister, le consulter, suivre son statut.
- Associer un projet à un dossier du poste, vérifier que c'est un repository Git, afficher sa
  branche et l'état de son dossier de travail.
- Refuser toute action sur un chemin qui n'a pas été enregistré explicitement.

### 1.2 Documents Markdown

- Inventorier, lire, créer, modifier et supprimer les documents du repository depuis
  l'interface, avec contrôle de révision et confinement des chemins.
- Les documents restent des fichiers réels du repository, versionnés par Git.

### 1.3 Tâches structurées

- Créer une tâche avec titre, objectif, contexte, critères d'acceptation, hors-périmètre,
  documents de référence et commandes de validation.
- Code immuable `TASK-xxx`, document Markdown associé à chemin stable, état de synchronisation
  visible, suppression contrôlée.

### 1.4 Exécution Claude Code

- Préflight du repository, prévisualisation du prompt, lancement explicite.
- Suivi en direct de l'activité, sur un flux d'événements produits par le runner.
- Annulation d'une exécution en cours, sans restauration Git.

### 1.5 Review d'une exécution

- Instantané Git immuable pris à la fin de l'exécution : fichiers, statistiques, diff borné,
  contenus sensibles jamais capturés.
- Validations structurées : ce qui a réellement été lancé, et son issue — en distinguant
  « échouée » de « jamais lancée ».
- Accepter, demander une correction, ou rouvrir.

### 1.6 Correction ciblée

- Écrire un feedback de review, préparer une correction, reprendre la session Claude du run
  relu, obtenir une nouvelle review complète.

### 1.7 Architecte

- **Une conversation principale et durable par projet**, dans laquelle on revient : concevoir,
  comparer des options, préparer une évolution. Créer une tâche n'y met pas fin, et une même
  conversation en produit plusieurs au fil du temps.
- Contexte projet fermé et connu à l'avance ; seuls les tours les plus récents sont transmis,
  l'historique complet restant lisible.
- Faire relire une exécution terminée et obtenir une recommandation motivée.
- Aucun outil, aucune action possible depuis le modèle.

### 1.8 Workflow guidé

- Sur la page d'une tâche : étape courante, prochaine étape recommandée, actions alternatives,
  blocages — dérivés de l'état existant, sans stockage ni appel IA.

### 1.9 Mémoire projet

- Enregistrer explicitement décisions, contraintes, conventions et connaissances durables, et
  les injecter de façon bornée et traçable dans le contexte de l'Architecte.

---

## 2. Capacités nécessaires à la V1 visée

Ces capacités **n'existent pas**. Elles constituent l'écart entre l'état actuel et la V1.

### 2.1 Project Brief structuré

Une compréhension du projet, tenue par NOX : ce qu'on construit, pour qui, avec quelle stack,
sous quelles contraintes. Structurée, relue et modifiable par l'utilisateur — pas un texte
libre de plus.

### 2.2 Living Project Plan

Un plan de travail rattaché au projet, contenant plusieurs tâches ordonnées, qui se relit et
se réordonne à mesure que le projet avance.

### 2.3 Génération multi-tâches

Produire un backlog à partir d'une conception, plutôt qu'une tâche isolée. Chaque tâche reste
créée en brouillon, relue et validée par l'utilisateur.

### 2.4 Amorçage d'un projet — `TASK-000`

Le premier pas d'un projet vide : initialiser le repository, poser la structure, produire les
documents de référence. Aujourd'hui, ce travail se fait entièrement hors de NOX.

### 2.5 Dépendances entre tâches

Dire qu'une tâche en attend une autre, et que l'ordre n'est pas qu'une préférence d'affichage.

### 2.6 Modification des tâches futures

Une spécification ne se modifie pas après création. Tant que le plan est vivant, cette
contrainte devient bloquante : replanifier suppose de pouvoir réécrire ce qui n'a pas encore
été lancé.

### 2.7 Tableau de bord d'un projet

Une vue qui répond « où en est ce projet » sans ouvrir chaque tâche.

### 2.8 File d'exécution

Enchaîner plusieurs tâches prêtes, sans qu'un enchaînement devienne une autonomie : chaque
départ reste décidé, et une exécution reste seule active.

### 2.9 Validation intelligente

Distinguer ce qu'une commande peut prouver, ce qu'une relecture par l'Architecte peut établir,
et ce qui exige réellement un test humain — pour ne solliciter l'humain que dans le troisième
cas.

### 2.10 Livraison Git contrôlée

Commit et push depuis NOX, sur décision explicite, avec un message relu. Aujourd'hui ces deux
actions sont entièrement manuelles et hors de l'outil.

---

## 3. Hors V1 — plus tard, ou jamais

Ces éléments sont explicitement exclus de la V1. Les exclure n'est pas les condamner : c'est
refuser qu'ils entrent par la bande.

| Hors périmètre | Raison |
| --- | --- |
| Autonomie sans checkpoints | Une chaîne qui avance seule n'est plus relisible, et l'erreur y devient invisible jusqu'au bout. |
| Orchestration multi-agents complexe | Multiplie les surfaces d'exécution avant même qu'une seule soit maîtrisée. |
| Parallélisme agressif dans un même repository | Deux agents qui écrivent dans le même dossier de travail produisent un diff que personne ne sait attribuer. |
| Automatisation avancée des PR GitHub | Suppose une livraison distante fiable, qui n'existe pas encore. |
| Déploiement en cloud, multi-utilisateur | NOX est un outil personnel, exécuté en local. |
| Collaboration temps réel | Même raison : un seul décideur, une seule machine. |
| Plusieurs comptes Claude | Complexité de gestion des sessions et des quotas, sans bénéfice pour un usage personnel. |
| Git worktrees automatiques | Utiles seulement avec du parallélisme, lui-même hors périmètre. |
| Application mobile | L'usage cible est un poste de développement avec un repository local. |
| Déploiement applicatif | NOX orchestre le développement, pas la livraison du produit développé. |
| Apprentissage automatique des préférences | Demande un historique qui n'existe pas encore, et remplacerait une décision explicite par une inférence. |
| Mémoire vectorielle, embeddings, RAG | La mémoire projet est explicite et bornée ; une pertinence calculée retirerait à l'utilisateur le contrôle de ce qui est envoyé. |

## 4. Contraintes transverses

Elles s'appliquent à toute capacité, acquise ou future.

- **Exécution locale.** Le runner n'écoute que sur la boucle locale.
- **Aucune action Git distante non demandée.** Un push reste une décision humaine explicite,
  y compris quand NOX saura l'exécuter.
- **Aucune exécution implicite.** Toute commande touchant au repository est déclenchée par
  l'utilisateur.
- **Secrets hors du repository.** Les clés d'API vivent dans un `.env` non versionné, et ne
  quittent jamais le serveur.
- **Coûts visibles.** La consommation rapportée par les fournisseurs est affichée telle
  quelle ; NOX n'estime aucun coût.
