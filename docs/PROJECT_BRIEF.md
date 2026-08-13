# PROJECT_BRIEF — NOX

> **Rôle de ce document** : pourquoi NOX existe, pour qui, quel problème il résout, et quelle
> expérience il vise à terme.
>
> Ce document décrit une **cible**. Ce qui existe réellement aujourd'hui est décrit dans
> [PROJECT_STATE.md](PROJECT_STATE.md), et ce qui est envisagé ensuite dans
> [ROADMAP.md](ROADMAP.md). Une capacité décrite ici n'est pas, par ce seul fait, disponible.

---

## 1. Le problème

Le développement assisté par IA fonctionne aujourd'hui en deux mondes séparés :

- **Un monde de conception** : une conversation avec un modèle de langage, où le besoin est
  discuté, clarifié, contesté, puis découpé.
- **Un monde d'exécution** : un agent de code (Claude Code) qui modifie réellement le
  repository, lance les tests et rapporte les erreurs.

Rien ne relie ces deux mondes. Le lien est l'humain, qui passe son temps à :

- recopier des morceaux de conversation dans un prompt d'implémentation ;
- recopier les erreurs de build dans la conversation de conception ;
- reconstruire mentalement le contexte à chaque nouvelle session ;
- perdre les décisions prises, faute d'un endroit stable où les écrire ;
- laisser les tâches devenir trop grosses, parce qu'aucun outil ne force le découpage.

Le coût réel n'est pas le copier-coller. C'est la **perte de contexte** : chaque aller-retour
manuel dégrade la mémoire du projet, et la qualité de l'implémentation avec elle.

## 2. Pour qui

NOX est une **application personnelle**, exécutée en local, par un développeur qui pilote ses
propres projets avec l'aide de l'IA. Un utilisateur, une machine, un repository à la fois.

Ce n'est ni un produit d'équipe, ni un service hébergé. Cette contrainte est structurante :
elle autorise une base SQLite locale, un runner sur la boucle locale, et une interface qui
suppose un seul décideur — l'utilisateur.

## 3. La vision

NOX est le **poste de pilotage** d'un projet développé avec l'aide de l'IA : un endroit unique
où l'on discute du besoin, où l'on écrit la documentation, où l'on découpe le travail, où l'on
déclenche l'implémentation et où l'on relit le résultat.

Objectif central : **supprimer les copier-coller manuels entre la conception et l'exécution**,
sans supprimer le contrôle humain sur ce qui est réellement lancé.

NOX n'est pas un agent autonome. C'est un outil d'orchestration : il prépare le travail, le
déclenche à la demande, et rend le résultat lisible.

## 4. Le flux cible

```text
User
 ↓
NOX project conversation
 ↓
Project understanding
 ↓
Living plan
 ↓
Tasks
 ↓
Claude execution
 ↓
Validation
 ↓
Delivery
```

Chaque flèche de ce schéma est aujourd'hui, en tout ou partie, une action manuelle. NOX les
outille une par une.

## 5. L'expérience visée

### 5.1 Créer un projet

L'utilisateur crée un projet, choisit l'emplacement de son repository, et **ouvre une
conversation principale** avec NOX.

NOX accueille l'utilisateur et lui demande ce qu'il veut construire — quelque chose de
conceptuellement proche de :

> Bonjour, je suis NOX, ton assistant de développement. Décris-moi ce que tu veux construire.

La formulation exacte n'est pas arrêtée, et n'a pas à l'être ici.

### 5.2 Concevoir

L'utilisateur décrit l'application qu'il veut. L'Architecte peut alors :

- poser des questions lorsqu'une réponse manque ;
- proposer une stack et une architecture ;
- définir un périmètre de V1 ;
- produire un plan découpé en plusieurs tâches.

La conception n'est pas un formulaire. C'est une discussion, dont NOX conserve la trace.

### 5.3 Un plan vivant

Un projet possède à terme un **Living Project Plan** : un plan de travail structuré, rattaché
au projet, contenant plusieurs tâches ordonnées.

Vivant, parce qu'un plan de développement ne survit jamais intact au contact du code. Il se
relit, se réordonne et se complète à mesure que le projet avance — sans repartir de zéro et
sans perdre ce qui a déjà été décidé.

### 5.4 Exécuter

Les tâches du plan progressent le long d'un cycle de vie :

```text
Draft  →  Ready  →  Queued  →  Running  →  Needs validation  →  Done
```

Ces noms décrivent l'intention, pas le contrat actuel. Les statuts réellement implémentés
aujourd'hui sont décrits dans [PROJECT_STATE.md](PROJECT_STATE.md), et ils ne changent pas
sans tâche dédiée.

### 5.5 Valider

À terme, la validation d'un travail suit trois temps :

```text
Claude output
→ automated validations
→ Architect review
→ human tests only when necessary
```

L'intention n'est pas de retirer l'humain de la boucle, mais de **ne le solliciter que
lorsqu'il apporte quelque chose** : ce qu'une commande peut vérifier ne devrait pas occuper
une relecture humaine.

Le contrôle humain reste requis là où il compte : ce qui est lancé, ce qui est approuvé, et
ce qui part vers un dépôt distant.

### 5.6 Une conversation durable

L'utilisateur peut revenir à tout moment dans la conversation de son projet pour :

- ajouter une fonctionnalité ;
- revenir sur une décision ;
- préparer une V2 ;
- replanifier des tâches futures.

C'est le point le plus important de cette vision. Une conversation qui se ferme après avoir
produit une tâche oblige à reconstruire le contexte à chaque fois — exactement le problème
décrit au § 1, réintroduit à l'intérieur de l'outil censé le résoudre.

> **Ce n'est pas encore le cas.** L'implémentation actuelle ouvre une conversation Architecte
> par tâche à concevoir. Cette limitation est décrite comme telle dans
> [PROJECT_STATE.md](PROJECT_STATE.md) ; elle n'est pas la cible.

## 6. Les rôles

### 6.1 L'utilisateur — propriétaire du produit

- Définit ce que le produit doit faire, et pourquoi.
- Tranche les arbitrages : périmètre, priorités, compromis techniques.
- Valide, ou rejette, le résultat de chaque tâche.
- Commit et push l'état validé avant chaque nouvelle exécution.
- Reste le seul à décider de ce qui part vers un dépôt distant.

### 6.2 L'Architecte — conception et relecture

Un modèle de conception, sans aucun accès à la machine.

- Structure le besoin exprimé en conversation.
- Propose un découpage en tâches petites, ordonnées et vérifiables.
- Rédige la spécification d'une tâche, avec ses critères d'acceptation.
- Relit une exécution terminée et rend une recommandation.
- N'écrit pas de code, ne touche pas au repository, ne dispose d'aucun outil.

### 6.3 Claude Code — implémenteur

Un agent de code, avec un accès réel au repository.

- Lit la tâche et les documents référencés **avant** toute modification.
- Implémente strictement le périmètre demandé, et rien de plus.
- Exécute réellement les commandes de validation enregistrées.
- Produit un compte rendu précis, y compris de ses échecs.
- Ne commit pas, ne push pas, ne réécrit pas l'historique Git.

Cette séparation est volontaire, et elle est structurelle : **celui qui conçoit n'a pas accès
à la machine, et celui qui implémente ne décide pas du périmètre.** Les deux modèles ne se
parlent jamais directement ; entre eux, il y a un humain.

## 7. Comment une tâche doit être découpée

Une tâche est l'unité de travail confiée à Claude Code. Elle respecte ces règles :

1. **Une tâche = un objectif vérifiable.** Si l'on ne sait pas dire « c'est fait » sans
   ambiguïté, la tâche est mal découpée.
2. **Petite avant tout.** Une tâche qui touche à tout produit une review impossible à faire.
3. **Critères d'acceptation explicites.** Écrits avant l'implémentation, pas après.
4. **Périmètre fermé.** Ce qui est hors périmètre est écrit noir sur blanc, pour éviter
   l'élargissement spontané.
5. **Validations obligatoires.** Chaque tâche indique les commandes à exécuter réellement.
6. **Pas d'anticipation.** On n'implémente pas la tâche suivante « tant qu'on y est ».
7. **Un état stable entre deux tâches.** Le repository doit être commitable après chacune.

## 8. Pourquoi la documentation Markdown est centrale

La documentation n'est pas un livrable annexe : c'est la **mémoire du projet**.

- Elle est **versionnée avec Git**, donc traçable et réversible.
- Elle est **lisible par un humain et par un modèle**, sans format propriétaire.
- Elle survit à la fin d'une conversation : un modèle oublie, un fichier non.
- Elle sert de **contexte d'entrée** aux prompts d'implémentation : ce qui n'est pas écrit
  n'existe pas pour la session suivante.
- Elle rend les décisions **opposables** : [DECISIONS.md](DECISIONS.md) évite de re-débattre
  indéfiniment des mêmes arbitrages.

Règle pratique : si une information doit survivre à la fermeture de l'onglet, elle appartient
à un fichier Markdown du repository.

À côté de cette mémoire versionnée, NOX dispose d'une **mémoire projet** interne — décisions,
contraintes, conventions et connaissances durables — qui vit dans sa base et jamais dans le
repository. Les deux sont complémentaires : l'une est le livrable, l'autre est l'outil.

## 9. Principes qui ne changent pas

Ces principes gouvernent chaque étape, présente et future. Une tâche qui les contredirait
serait un changement de produit, pas une évolution.

| Principe | Ce qu'il interdit |
| --- | --- |
| Rien ne s'exécute sans une décision humaine | Lancement automatique, réessai caché, enchaînement de tâches |
| NOX ne pousse jamais vers un dépôt distant | `git push` automatique, réécriture d'historique |
| Le résultat d'un modèle n'est pas une validation | Passage direct en « terminé » sur le seul avis d'une IA |
| Ce qui est envoyé à un fournisseur est connu à l'avance | Exploration libre du repository, contexte choisi par un modèle |
| Une limite atteinte est dite, jamais contournée en silence | Résumé implicite, troncature muette, fenêtre glissante |
| Le doute n'est jamais présenté comme un fait | « Je ne sais pas » transformé en « non » |

## 10. Documents de référence

| Document | Rôle |
| --- | --- |
| [PROJECT_BRIEF.md](PROJECT_BRIEF.md) | Pourquoi NOX existe et où il va |
| [V1_SCOPE.md](V1_SCOPE.md) | Cible produit : acquis, V1 visée, hors périmètre |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Comment NOX fonctionne aujourd'hui |
| [PROJECT_STATE.md](PROJECT_STATE.md) | Ce que NOX sait faire aujourd'hui, et ses limites |
| [DECISIONS.md](DECISIONS.md) | Pourquoi certains choix ont été faits |
| [ROADMAP.md](ROADMAP.md) | Ce qui est envisagé ensuite |
| [../CLAUDE.md](../CLAUDE.md) | Règles opérationnelles des sessions Claude Code |
| [../README.md](../README.md) | Installation, configuration, lancement |
