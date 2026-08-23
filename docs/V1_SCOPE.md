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

### 1.10 Project Brief structuré et Living V1 Plan

- Tenir l'intention produit du projet dans deux objets structurés, édités à la main, transmis
  à l'Architecte à chaque tour, et bornés par un budget commun.
- Laisser l'Architecte **proposer** de les modifier, relire la proposition champ par champ,
  la corriger, puis l'appliquer ou l'écarter. Seule une application humaine change l'état.

---

### 1.11 Backlog de V1 généré et appliqué par lot

Un Living V1 Plan validé produit, sur demande explicite, le backlog ordonné des tâches
restantes. La proposition se relit tâche par tâche, s'édite, se réordonne, s'ampute, puis crée
en un lot des tâches `DRAFT` aux codes séquentiels — ou n'en crée aucune.

Une génération coûte au plus un appel, et n'est jamais déclenchée autrement que par un clic.
Un backlog bâti sur un état devenu obsolète est refusé, jamais fusionné.

---

### 1.12 Amorçage d'un projet — `TASK-000`

Un projet dont le brief, le plan et un backlog appliqué existent peut préparer son repository.
NOX construit `TASK-000` de façon **déterministe**, sans aucun appel à une IA : l'aperçu montre
exactement la tâche qui sera créée, et une seule lecture du repository distingue un dépôt vide
d'un dépôt qui porte déjà une application.

Le numéro `0` lui est réservé, un projet n'en porte qu'une, et sa création ne consomme aucun
numéro de tâche ordinaire. Elle naît en brouillon et suit ensuite le cycle de vie habituel :
rien n'est exécuté sans un geste humain.

### 1.13 Dépendances entre tâches et modification des tâches futures

Une tâche peut en attendre d'autres, explicitement. Le graphe est acyclique et local au projet ;
les cycles transitifs sont refusés, et deux requêtes simultanées ne peuvent pas en fermer un à
elles deux. Seule une tâche **terminée** satisfait une dépendance, et une dépendance ne change
jamais un statut : une tâche prête qui attend reste prête, c'est son lancement qui est refusé.

Une tâche qui n'a jamais été exécutée reste modifiable — contrat, dépendances et statut d'un
seul geste. Modifier une tâche en file la ramène en brouillon dès que son contrat change, et
seulement alors. Dès la première exécution, la spécification est figée : ce qui a déjà servi
devient un fait historique.

### 1.14 Tableau de bord et cycle de vie d'un projet

La page d'accueil répond « quels projets existent, où en est chacun, lequel ouvrir » sans
ouvrir une seule tâche. Tout y est dérivé des données réelles : résumé du brief, compteurs de
tâches par statut, état d'amorçage, dépendances en attente, dernière activité.

Un projet se renomme, et se **supprime de NOX** : son état complet part en une transaction, et
les documents `tasks/TASK-xxx.md` que NOX a écrits sont retirés du repository. Le code source,
le `.git` et la documentation applicative sont préservés, aucune opération Git n'a lieu, et le
même dossier peut ensuite être réenregistré comme un projet réellement neuf — rien n'est
reconstruit depuis le disque.

### 1.15 File d'exécution

Plusieurs tâches prêtes s'inscrivent dans la file d'un projet, dans l'ordre choisi. Démarrer la
file est une autorisation permanente, explicite : NOX peut ensuite lancer les tâches **déjà
inscrites** quand elles deviennent éligibles, une à la fois.

Enchaîner n'est pas s'autonomiser. La sélection est déterministe et sans modèle ; les dépendances
restent autoritaires ; la review humaine reste une barrière ; le préflight Git aussi. Un échec ou
une annulation met la file en pause. Un redémarrage du serveur ne lance jamais rien.

---

## 2. Capacités nécessaires à la V1 visée

Ces capacités **n'existent pas**. Elles constituent l'écart entre l'état actuel et la V1.

### 2.1 Validation intelligente

Distinguer ce qu'une commande peut prouver, ce qu'une relecture par l'Architecte peut établir,
et ce qui exige réellement un test humain — pour ne solliciter l'humain que dans le troisième
cas.

### 2.2 Livraison Git contrôlée

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
