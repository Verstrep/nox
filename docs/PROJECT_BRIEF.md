# PROJECT_BRIEF — NOX

## 1. Le problème actuel

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

## 2. La vision de NOX

NOX est une application personnelle qui rend ce lien explicite et outillé.

NOX doit devenir le **poste de pilotage** d'un projet développé avec l'aide de l'IA :
un endroit unique où l'on discute du besoin, où l'on écrit la documentation, où l'on
découpe le travail, où l'on déclenche l'implémentation et où l'on relit le résultat.

Objectif central : **supprimer les copier-coller manuels entre la conversation de conception
et Claude Code**, sans supprimer le contrôle humain sur ce qui est réellement exécuté.

NOX n'est pas un agent autonome. C'est un outil d'orchestration : il prépare le travail,
le déclenche à la demande, et rend le résultat lisible.

## 3. Les trois rôles

### 3.1 L'utilisateur — propriétaire du produit

- Définit ce que le produit doit faire et pourquoi.
- Tranche les arbitrages : périmètre, priorités, compromis techniques.
- Valide (ou rejette) le résultat de chaque tâche.
- **Commit et push l'état validé du projet** avant chaque nouveau prompt d'implémentation.
- Reste le seul à décider de ce qui part vers un dépôt distant.

### 3.2 ChatGPT — architecte produit et technique

- Structure le besoin exprimé en conversation.
- Rédige et maintient les documents Markdown de référence.
- Découpe le projet en tâches petites, ordonnées et vérifiables.
- Rédige le prompt de chaque tâche, avec ses critères d'acceptation.
- N'écrit pas le code de production et ne touche pas au repository.

### 3.3 Claude Code — implémenteur

- Lit la tâche et les documents référencés **avant** toute modification.
- Implémente strictement le périmètre demandé, et rien de plus.
- Exécute réellement le lint, le typecheck et le build.
- Produit un compte rendu précis, y compris des échecs non résolus.
- Ne commit pas, ne push pas, ne réécrit pas l'historique Git.

Cette séparation est volontaire : celui qui conçoit n'est pas celui qui implémente, et celui
qui implémente ne décide pas du périmètre.

## 4. Le flux cible

```text
Discussion avec un orchestrateur IA
                ↓
Formalisation du besoin dans des fichiers Markdown
                ↓
Découpage du projet en petites tâches
                ↓
Envoi automatique d'une tâche à Claude Code
                ↓
Modification du repository local
                ↓
Exécution des tests, du lint et du build
                ↓
Review du résultat
                ↓
Validation ou création d'une correction
```

Chaque flèche de ce schéma est aujourd'hui une action manuelle. NOX les outille une par une.

## 5. Principes de segmentation des tâches

Une tâche NOX est l'unité de travail confiée à Claude Code. Elle doit respecter ces règles :

1. **Une tâche = un objectif vérifiable.** Si l'on ne sait pas dire « c'est fait » sans
   ambiguïté, la tâche est mal découpée.
2. **Petite avant tout.** Une tâche qui touche à tout produit une review impossible à faire.
3. **Critères d'acceptation explicites.** Ils sont écrits avant l'implémentation, pas après.
4. **Périmètre fermé.** Ce qui est hors périmètre est écrit noir sur blanc, pour éviter
   l'élargissement spontané.
5. **Validations obligatoires.** Chaque tâche indique les commandes à exécuter réellement.
6. **Pas d'anticipation.** On n'implémente pas la tâche suivante « tant qu'on y est ».
7. **Un état stable entre deux tâches.** Le repository doit être commitable après chaque tâche.

## 6. Pourquoi la documentation Markdown est centrale

La documentation n'est pas un livrable annexe : c'est la **mémoire du projet**.

- Elle est **versionnée avec Git**, donc son évolution est traçable et réversible.
- Elle est **lisible par un humain et par un modèle**, sans format propriétaire.
- Elle survit à la fin d'une conversation : un modèle oublie, un fichier non.
- Elle sert de **contexte d'entrée** aux prompts d'implémentation : ce qui n'est pas écrit
  n'existe pas pour la session suivante.
- Elle rend les décisions **opposables** : `DECISIONS.md` évite de re-débattre indéfiniment
  des mêmes arbitrages.

Règle pratique : si une information doit survivre à la fermeture de l'onglet, elle appartient
à un fichier Markdown du repository.

## 7. Documents de référence

| Document | Rôle |
| --- | --- |
| [PROJECT_BRIEF.md](PROJECT_BRIEF.md) | Problème, vision, rôles, flux cible |
| [V1_SCOPE.md](V1_SCOPE.md) | Périmètre de la première vraie V1 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Découpage technique et responsabilités |
| [ROADMAP.md](ROADMAP.md) | Étapes ordonnées jusqu'à la V1 |
| [DECISIONS.md](DECISIONS.md) | Décisions prises et leur justification |
| [PROJECT_STATE.md](PROJECT_STATE.md) | État réel du projet à l'instant T |
| [../CLAUDE.md](../CLAUDE.md) | Règles permanentes des sessions Claude Code |
