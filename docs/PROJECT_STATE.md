# PROJECT_STATE — Ce que NOX sait faire aujourd'hui

> **Rôle de ce document** : l'état réel du produit, capacité par capacité. Ce qui est
> disponible, ce qui ne l'est pas, et sous quelles limites.
>
> Il ne raconte pas comment on en est arrivé là — c'est le rôle de
> [DECISIONS.md](DECISIONS.md) — ni comment le code est organisé — c'est celui de
> [ARCHITECTURE.md](ARCHITECTURE.md). Il ne décrit pas non plus la cible : voir
> [PROJECT_BRIEF.md](PROJECT_BRIEF.md) et [V1_SCOPE.md](V1_SCOPE.md).

**Dernière mise à jour** : 30 août 2026, à l'issue de `TASK-032`.

---

## 1. En un coup d'œil

La chaîne complète existe et fonctionne : concevoir une tâche, la lancer, la suivre en direct,
relire ce qui a changé, demander une correction, la faire relire, savoir quoi faire ensuite.

```text
Project Plan  →  V1 Backlog  →  Tâche   →  Claude Code  →  Review Git
(intention)      (découpage)     (spec)     (exécution)     (+ validations)
     ↑                ↑                                          ↓
     │           Architecte                                      │
     └─── Décision humaine ← Workflow guidé ← Review Architecte ──┘
                 ↑
           Mémoire projet
```

Et la boucle revient à son point de départ : depuis la conversation du projet, un **changement
de projet** fait évoluer le brief, le plan et le plan des tâches futures, qui repartent dans la
file d'exécution ordinaire.

L'Architecte occupe deux rôles distincts : il **converse** — en réponse à un message, et il
peut y proposer une tâche, une mise à jour du projet, ou une replanification du travail futur —
et il **planifie** — un backlog entier, en réponse à l'état du projet, sans conversation. Deux
workflows, deux prompts, deux contrats de sortie ; aucun des deux ne peut déclencher l'autre.
`backlog/2` crée le **premier** plan d'un projet ; `replan/1` fait évoluer celui qui existe.

Ce que NOX **ne fait pas**, et n'a jamais prétendu faire : aucun lancement automatique de
Claude Code, aucun passage automatique en `READY`, aucune boucle autonome entre les deux
modèles, aucun réessai caché, aucun résumé silencieux, aucune review déclenchée en
arrière-plan, aucune exécution automatique de l'étape recommandée, aucune mémoire créée
automatiquement, aucune estimation de coût, aucun backlog généré sans clic — et, tant que la
politique de livraison du projet reste `Manual`, aucun commit et aucun push.

Une exception, et une seule, a été ajoutée par `TASK-027` : une tâche dont **tous** les critères
sont automatisés et **tous** prouvés par des commandes que NOX a exécutées lui-même se termine sans
clic. Ce n'est pas une boucle autonome — c'est un contrat écrit avant l'exécution, vérifié par des
codes de sortie, et refusé dès qu'une preuve manque.

`TASK-028` étend cette exception, et l'étend seulement là où une file a été **démarrée à la main** :
quand une preuve automatisée échoue, NOX peut relancer Claude Code de lui-même, **au plus deux fois
par cycle de travail**. Le texte de `Start queue` l'annonce avant le clic. Hors file, file en pause,
panne d'infrastructure, amorçage ou borne atteinte : rien ne part sans un geste humain.

`TASK-029` ouvre la dernière : NOX peut écrire dans Git, et **seulement** si le projet l'y a
autorisé par une politique distincte de celle de la file. Le défaut est `Manual`, et il n'accorde
rien. Là où un mode automatique a été choisi, NOX commite — et pousse, si c'est le mode retenu —
le travail qu'il vient de valider, à la condition que le repository y corresponde encore
exactement. Toute divergence bloque l'écriture au lieu de l'emporter avec.

`TASK-031` ne crée aucune exception : elle en **retire** une limitation. Plusieurs projets
peuvent désormais travailler en même temps, chacun sur son repository. Ce qui reste interdit —
deux exécutions sur un **même** repository — l'est toujours, et l'est deux fois : en base et
dans le runner. Aucune autorisation ne s'est élargie : démarrer la file d'un projet n'a jamais
rien dit des autres, et c'est encore vrai.

`TASK-032` n'en crée aucune non plus, et referme la boucle : quand une exigence change, on le
dit dans la conversation du projet, et l'Architecte peut **proposer** un changement — le
Project Plan, le plan des tâches futures, ou les deux ensemble. Une proposition ne modifie
toujours rien : elle se relit sur une page, se corrige, et s'applique d'un seul geste humain.
Le passé — ce qui a tourné, ce qui est en file, l'amorçage — n'est jamais réécrit.

| Chiffre | Valeur |
| --- | --- |
| Workspaces | 4 — `web`, `runner`, `shared`, `database` |
| Modèles Prisma | 30 |
| Migrations appliquées | 23 |
| Routes du runner | 23, dont une seule publique (`GET /health`) |
| Pages de l'application web | 39 |
| Tests automatisés | 4 382, dont 6 ignorés sous Windows |
| Décisions consignées | 377 |

---

## 2. Capacités

Chaque capacité est décrite en trois temps : ce qui est **disponible**, ses **limites**
actuelles, et les **frontières** qu'elle ne franchit jamais.

### 2.1 Projets

**Disponible.** Créer un projet avec un nom et une description, le renommer, le consulter,
le supprimer de NOX. Suivre son statut parmi `DRAFT`, `ACTIVE`, `PAUSED`, `COMPLETED`,
`ARCHIVED`. Associer un projet à un dossier du poste : NOX vérifie que le chemin existe, que
c'est un repository Git, et affiche sa branche et l'état de son dossier de travail.

La page d'accueil est un **tableau de bord des projets** : une carte par projet, avec le résumé
de son brief, ses compteurs de tâches par statut, l'état de son amorçage et sa dernière
activité. Tout y est dérivé à chaque rendu ; rien n'est stocké.

Supprimer un projet retire **tout son état NOX** — conversation, brief, plan, mémoire, backlog,
tâches, dépendances, exécutions, reviews — en une transaction, plus les documents
`tasks/TASK-xxx.md` que NOX a lui-même écrits. Le repository, son code, son `.git` et sa
documentation applicative sont préservés. Le même dossier peut ensuite être réenregistré comme
un projet réellement neuf.

**Limites.**

- La suppression est irréversible : ni corbeille, ni archivage réel, ni restauration.
- Une exécution active interdit la suppression ; NOX ne l'annule pas à la place de
  l'utilisateur.
- Le chemin d'un repository ne se modifie pas après enregistrement.
- Un document de tâche dont la révision n'a jamais été enregistrée n'est pas nettoyé : NOX ne
  peut pas prouver qu'il lui appartient.
- Ni recherche, ni filtre, ni pagination sur le tableau de bord.

**Frontières.** Un chemin absolu ne remonte jamais au navigateur, et le chemin d'un repository
se relit toujours en base à partir de l'identifiant du projet — jamais depuis un formulaire. La
suppression n'accepte aucun chemin du navigateur : la liste des documents à retirer est
reconstruite en base. Aucun `git add`, aucun commit, aucun push, aucun `restore`, et jamais
un fichier que NOX n'a pas écrit.

### 2.1 bis File d'exécution

**Disponible.** Inscrire des tâches `READY` dans la file d'un projet, les réordonner, les en
retirer. Démarrer la file — une autorisation permanente, explicite — puis laisser NOX lancer les
tâches inscrites au fur et à mesure qu'elles deviennent éligibles. Mettre en pause, ou relancer
l'avancement à la main avec « Try next ».

La sélection est déterministe et sans appel à un modèle : la première entrée dont la tâche est
prête et dont les dépendances sont terminées. Une entrée qui attend est sautée et garde sa place.
Un appel démarre au plus une exécution.

Une entrée reste en place pendant toute la vie du travail commencé — exécution, review, correction,
et **réouverture** — et ne disparaît qu'à l'acceptation de la tâche, ou sur retrait humain. Une
tâche rouverte redevient `READY` sans redevenir disponible : son inscription se souvient d'avoir
démarré (`TaskQueueEntry.startedAt`), reste la barrière de la file, et se relance depuis sa propre
page. La file ne relance jamais d'elle-même un travail qui vient d'être refusé.

**Limites.**

- **Aucun démarrage au lancement du serveur.** Une file active retrouve son autorisation après un
  redémarrage, mais rien ne part sans un événement applicatif — une tâche acceptée, une
  inscription, un « Try next ». La barrière courante survit elle aussi : elle est en base, pas en
  mémoire.
- **« Try next » n'est pas une reprise.** Il rappelle quelle tâche la file attend ; reprendre un
  travail refusé se décide sur la page de cette tâche.
- **Aucune livraison Git.** Après une acceptation, le repository reste souvent « dirty » : la file
  s'arrête jusqu'à un commit fait à la main.
- **Aucune validation autonome.** Une exécution terminée attend toujours une décision humaine.
- **L'amorçage n'est pas inscriptible.** `TASK-000` se lance depuis sa propre page.
- **Aucun ordonnanceur global.** La file est locale à un projet ; une seule exécution reste active
  par repository, et une seule dans tout NOX.
- Un échec ou une annulation met la file en pause, et NOX ne reprend jamais tout seul.

**Frontières.** La file ne contourne ni le préflight Git, ni la review humaine, ni l'unicité de
l'exécution active. Elle ne crée aucun second moteur Claude : le dispatcher choisit, le pipeline
existant exécute. Les actions de file — inscrire, retirer, déplacer, mettre en pause — n'appellent
ni OpenAI, ni Claude Code, et n'écrivent rien dans le repository. Une tâche inscrite ne se modifie,
ne se supprime et ne se remet pas de côté tant qu'elle n'en est pas sortie.

### 2.2 Documents Markdown

**Disponible.** Inventorier les documents du repository, les lire, en créer, les modifier, les
supprimer. L'édition est atomique — fichier temporaire du même dossier puis remplacement — et
protégée par un contrôle de révision : le runner relit les octets, recalcule l'empreinte, et
refuse d'écrire si elle a changé. La création utilise une primitive exclusive et n'écrase
jamais rien.

**Limites.**

- Périmètre d'inspection figé, 500 documents maximum.
- Cinq destinations de création seulement ; aucun dossier ne peut être créé, sauf `tasks/`.
- Ni renommage, ni déplacement, ni suppression de dossier.
- Le remplacement n'est pas atomique sous Windows dans tous les cas.
- Une fenêtre de concurrence résiduelle subsiste entre le dernier contrôle de nature et
  l'`unlink` : Node n'expose pas de suppression conditionnée à un descripteur déjà ouvert.
  Ses conséquences restent bornées — `unlink` ne suit jamais un lien.
- `beforeunload` ne couvre pas la navigation interne de Next.js : quitter un éditeur par un
  lien interne ne déclenche pas d'avertissement.

**Frontières.** Aucun fichier hors du repository n'est lisible. Le confinement se vérifie sur
les chemins réels, après `realpath`, jamais par comparaison de préfixe. Aucune écriture dans
un lien symbolique. Un conflit de révision ne se force pas.

### 2.3 Tâches

**Disponible.** Créer une tâche avec titre, priorité, objectif, contexte, critères
d'acceptation, hors-périmètre, documents de référence et commandes de validation. Chaque tâche
porte un code immuable `TASK-xxx`, dérivé d'un compteur atomique, et un document Markdown à
chemin stable `tasks/<code>.md`. L'état de synchronisation entre la base et le disque est
visible et reprenable. Les statuts vont de `DRAFT` à `COMPLETED`, en passant par `READY`,
`RUNNING`, `BLOCKED`, `FAILED` et `REVIEW`.

**Limites.**

- **Une spécification ne se modifie pas après création.** Seul le statut change.
- La modification manuelle d'un `tasks/TASK-xxx.md` ne remonte pas dans la tâche.
- Une tâche possédant un historique d'exécution ne peut pas être supprimée, et aucun archivage
  n'existe.
- Aucune dépendance entre tâches, aucune renumérotation, aucune duplication.
- Un trou dans la numérotation est possible — après un échec entre la réservation et
  l'enregistrement, ou après une suppression. C'est voulu : un identifiant réutilisé serait
  bien pire.
- La suppression n'est pas atomique entre le disque et SQLite. Un échec en base après
  suppression réussie du fichier laisse une tâche sans document : état visible, signalé, et
  reprenable d'un second clic.

**Frontières.** Le code d'une tâche ne vient jamais d'un comptage. Toute transition de statut
passe par une garde unique ; `RUNNING`, `FAILED` et `REVIEW` ne se posent jamais à la main.
Une panne du runner ne supprime jamais une tâche.

### 2.4 Exécution Claude Code

**Disponible.** Un préflight vérifie que le dossier de travail est propre, et que la branche est
synchronisée **dans la mesure où la politique de livraison du projet l'exige** — une branche en
avance est l'état normal d'un projet `AUTO_COMMIT`, pas un blocage. Le prompt — régénéré côté
serveur à partir de la tâche en base — est ensuite affiché avant lancement. Le
lancement est explicite. Les commandes de validation enregistrées sont autorisées à Claude
Code, une par une et à l'identique. Le runner ne les exécute jamais lui-même.

**Limites.**

- **Au plus une exécution active par repository** — voir § 2.7 quater. Deux repositories
  différents ne s'attendent plus.
- Le registre du runner est en mémoire : un redémarrage perd le suivi d'une exécution en cours.
- La détection d'une limite d'utilisation est heuristique, et prudente : en cas de doute, elle
  retourne une erreur générique.
- Aucun réessai, aucune reprise automatique, aucun enchaînement de tâches.

**Frontières.** `--dangerously-skip-permissions` n'est jamais passé. Aucune clé d'API
Anthropic n'existe dans NOX. Toute variable `NOX_*` est retirée de l'environnement du processus
enfant, sur le préfixe entier et jamais sur une liste nominative. Aucun prompt libre ne vient
du navigateur.

### 2.5 Suivi en direct et annulation

**Disponible.** L'activité de Claude Code est lue en `stream-json` et transformée en événements
publics dont le runner décide chaque champ. La timeline se reprend par curseur. Une exécution
en cours peut être interrompue : le runner arrête l'arbre de processus, avec un seul délai
maximal.

**Limites.**

- Les événements ne survivent pas à un redémarrage du runner au-delà de ce qui a déjà été
  persisté. Ce qui a été observé est acquis ; le reste est perdu, et NOX ne prétend pas le
  connaître.
- **Un arrêt peut échouer.** Si le processus ne ferme pas, le run est `BLOCKED` avec
  `CLAUDE_CANCEL_FAILED`, et le message dit que le processus peut encore écrire. NOX ne le tue
  pas par son nom, et ne cherche pas ses descendants réattachés ailleurs.
- Bornes fixes : 2 000 événements ordinaires par exécution, 64 réservés aux événements qui
  doivent survivre à une troncature, 4 096 caractères par détail, 2 Mio de texte au total.

**Frontières.** Aucun événement brut n'atteint le navigateur. Le raisonnement interne du
modèle — `thinking`, `redacted_thinking`, `reasoning`, `analysis`, tout bloc portant une
`signature` — n'est ni stocké, ni journalisé, ni résumé : la liste des blocs affichables est
**fermée**. Aucun numéro d'événement ne vient de Claude Code. Une annulation ne restaure jamais
Git. Aucun identifiant de processus ne vient du navigateur.

### 2.6 Review Git d'une exécution

**Disponible.** À la fin d'une exécution, le runner capture un instantané immuable : fichiers
modifiés, statistiques, diff borné. Cet instantané est enregistré et ne se réécrit jamais. La
page de review l'affiche tel quel, y compris des mois plus tard.

Les validations sont structurées : les commandes enregistrées sont recopiées au lancement, et
leur issue est celle réellement observée dans le flux — `PASSED`, `FAILED`, `UNKNOWN` ou
`NOT_RUN`.

**Limites.**

- **Le résultat des commandes n'est pas analysé** : ni nombre de tests, ni couverture, ni
  diagnostics. Un extrait borné de la sortie est conservé, et rien n'en est déduit. Le code de
  sortie reste nul dans les faits — le binaire n'en fournit aucun.
- **La lecture d'une commande Bash ne comprend qu'une construction : le chaînage `&&`.** Tuyau,
  redirection, substitution, point-virgule, esperluette isolée font renoncer à la ligne
  entière, y compris à l'intérieur des guillemets. Une validation lancée derrière une telle
  ligne restera `NOT_RUN` : prudent, mais incomplet. Élargir demanderait un analyseur de shell,
  et un analyseur approximatif finirait par autoriser ce qu'il n'a pas compris.
- Une exécution antérieure à `TASK-011` n'a pas d'instantané : sa review affiche
  « Detailed review unavailable for this legacy run. » Son diff n'est jamais recalculé.
- Bornes fixes : 200 fichiers, 256 Kio par patch, 4 Mio et 20 000 lignes de diff par exécution.

**Frontières.** Une review historique ne lit jamais le dossier de travail actuel. Un instantané
finalisé est immuable, et la garantie vit dans la couche d'écriture. Aucun contenu sensible
dans un patch — `.env` et variantes, `*.pem`, `*.key`, `id_rsa`, `id_ed25519`,
`credentials.json`, `secrets.json` : chemin et statistiques visibles, contenu jamais. Aucun
blob binaire en base. Un patch est du texte, jamais du HTML. Aucune validation n'est relancée.

### 2.6 bis Validation autonome et classification des critères

**Disponible.** Chaque critère d'acceptation déclare, **avant l'exécution**, comment il se
vérifie : `AUTOMATED` — une ou plusieurs commandes de la tâche suffisent à le prouver — ou
`HUMAN` — un jugement ou une observation humaine est réellement nécessaire, et une instruction
dit quoi regarder. Chaque commande de validation déclare de son côté ce que NOX a le droit d'en
faire : `AGENT_ONLY`, transmise à Claude Code et jamais lancée par NOX, ou `AUTONOMOUS`, que NOX
exécutera lui-même après l'exécution.

Ces deux classifications s'écrivent dans l'éditeur de tâche future, se proposent par le
planificateur de backlog (`backlog/2`) et se corrigent avant application. Elles figurent dans le
document `tasks/TASK-xxx.md` et dans le prompt transmis à Claude Code, qui sait donc que NOX
relancera lui-même ces commandes.

Quand une exécution se termine normalement, NOX exécute les commandes autonomes réclamées par au
moins un critère — **chacune une fois**, dans l'ordre de la tâche, séquentiellement. Le résultat
de chaque commande est enregistré avec son code de sortie, sa durée et ses sorties bornées. Un
critère automatisé est prouvé quand toutes ses preuves passent.

Si tous les critères sont automatisés et tous prouvés, la tâche passe à `Done` sans intervention,
la file d'exécution avance, et la décision est enregistrée comme `AUTOMATED`. Dans tous les autres
cas, la review revient à un humain, avec une liste de cases à cocher qui ne contient **que** les
critères qui le concernent vraiment.

**Limites.**

- **Le résultat des commandes n'est pas analysé.** NOX lit un code de sortie, pas un nombre de
  tests ni une couverture. Une commande qui rend zéro sans rien vérifier est un contrat mal écrit,
  et NOX ne peut pas le savoir.
- **Aucune reprise sur un échec réel.** `Retry` n'existe que lorsque NOX n'a **pas pu** obtenir de
  preuve. Une commande qui a échoué ne se relance pas : le code n'a pas bougé.
- **Un dépassement de délai est un échec**, pas une panne. La limite est de cinq minutes par
  commande, et c'est une constante — jamais une variable d'environnement.
- **Vingt commandes autonomes au maximum** par exécution.
- **Aucune classification automatique.** Le planificateur propose ; c'est un humain qui tranche
  avant d'appliquer. Une tâche créée sans classification explicite reçoit les défauts sûrs —
  `HUMAN` et `AGENT_ONLY` — et ne peut donc pas se terminer seule.
- **Les sorties sont bornées à 16 Kio par flux**, et la troncature est annoncée. La commande, elle,
  continue de tourner.

**Frontières.** Aucun appel à OpenAI, à aucune étape. NOX ne demande jamais à Claude Code « est-ce
que c'est bon ? » : il exécute des commandes et lit des codes de sortie. Aucun interprète de
commandes n'est impliqué — pas de `shell: true`, pas de `cmd /c`, pas de `bash -c` : une commande
validée est une suite de jetons, et c'est ce découpage qui part au système. Le répertoire de
travail est la racine canonique du repository, relue à partir de l'identifiant du projet ; aucune
variable `NOX_*` n'atteint le processus. Aucun `git add`, aucun commit, aucun push, aucun `reset`,
aucun `restore`, aucun `clean`.

Le navigateur n'envoie ni commande, ni chemin, ni délai, ni environnement : un formulaire forgé ne
peut pas transformer `npm test` en autre chose. L'instantané Git du runner reste celui du travail
de Claude Code ; les validations enregistrent séparément deux empreintes de l'état suivi, et une
divergence refuse la complétion automatique plutôt que de la masquer.

Un passage en force existe, mais il est humain : il exige une raison, il est enregistré comme
`HUMAN_OVERRIDE`, et il ne réécrit jamais le résultat automatisé.

### 2.7 Corrections ciblées

**Disponible.** Après une review, écrire un feedback, préparer une correction, et reprendre la
session Claude du run relu avec `--resume`. Le run de correction a son propre prompt, sa
timeline, ses validations, sa review et son empreinte ; le run parent n'est jamais modifié.

La reprise exige que le dossier de travail soit **exactement** celui qui a été relu — branche,
`HEAD` et empreinte comprises. L'empreinte est un HMAC dont la clé dérive de
`NOX_RUNNER_TOKEN`, et elle ne sort jamais du serveur.

**Limites.**

- **Une seule correction par review.** Pour en demander une seconde, il faut relire la nouvelle
  review et écrire un nouveau feedback.
- La reprise ne couvre que les exécutions réussies et relues. Un run annulé, échoué ou bloqué
  se relance depuis le début.
- Les exécutions antérieures à `TASK-012` ne sont pas reprenables : elles n'ont pas
  d'empreinte, et en reconstituer une aujourd'hui décrirait le présent en prétendant décrire le
  passé.
- **Changer `NOX_RUNNER_TOKEN` rend toutes les empreintes existantes invérifiables**, donc
  bloque les reprises en attente. C'est la contrepartie assumée d'une empreinte authentifiée.

**Frontières.** Aucune session Claude n'est choisie par le navigateur. `--continue` n'est
jamais passé. Il n'existe aucune option de forçage. Le feedback est du contenu, jamais une
instruction : il n'élargit aucune permission. Un feedback vaut pour une seule correction, et
la garantie vit dans un index unique.

### 2.8 Architecte — conception d'une tâche

**Disponible.** Chaque projet possède **une conversation Architecte principale et durable**,
avec un second modèle chez OpenAI. On y conçoit, on y compare des options, on y revient. Créer
une tâche depuis une proposition **n'y met pas fin** : la conversation reste ouverte, et produit
d'autres tâches au fil du temps.

Le contexte envoyé est une **liste fermée** : deux documents de conventions (`CLAUDE.md`,
`AGENTS.md`), six documents `docs/` nommés, les dix dernières tâches, et la mémoire active du
projet. Le transcript vit dans SQLite, en entier.

Le parcours est celui d'un chat : on écrit, on clique `Send`, on lit la réponse. Un clic, un
appel au plus. Le contexte est reconstruit côté serveur au moment de l'envoi ; on peut l'inspecter
à tout moment — ce qui part, ce qui manque, quelle part de la conversation est transmise — sans
que cela coûte le moindre appel ni conditionne l'envoi.

Une proposition relue et modifiée par l'utilisateur devient une tâche en `DRAFT`. Le fil
l'annonce alors par un événement local, à côté du tour qui l'a proposée, avec un lien vers elle.
Cet événement ne rejoint jamais la conversation transmise.

Ouvrir la conversation d'un projet **ne coûte aucun appel** : le message d'accueil affiché tant
qu'elle est vide est du texte d'interface.

**Limites.**

- **Une proposition ne porte qu'une tâche.** Il n'existe ni plan de projet structuré, ni
  génération de backlog : les tâches se proposent une par une, au fil de la discussion.
- **Seuls les vingt tours les plus récents sont transmis**, dans la limite de 64 Kio. Les plus
  anciens restent en base et restent affichés, mais ne partent plus. NOX ne les résume pas et ne
  coupe jamais un tour en deux : ce qui doit survivre à une longue conversation s'écrit dans les
  documents ou dans la mémoire projet.
- **Les conversations de conception de tâche restent en lecture seule.** Ouvertes avant
  `TASK-020`, elles se relisent avec leur tâche et leur consommation ; NOX ne les poursuit pas,
  ne les fusionne pas et ne les convertit pas.
- **La sélection du contexte est fixe.** Aucune interface ne permet de cocher un fichier : un
  document utile hors de la liste fermée n'atteindra pas l'architecte.
- **Le contexte d'un tour passé n'est pas rejouable.** Seuls les manifests sont conservés, pas
  le texte des documents. NOX peut dire *avec quoi* un tour a été produit, jamais reconstituer
  ce contexte. Un diff de contexte dit qu'un document a changé et entre quelles révisions,
  jamais ce qui a changé dedans.
- Les sessions ouvertes avant `TASK-014` n'ont jamais enregistré de messages : elles restent
  consultables, sans transcript reconstruit.
- La consommation affichée est celle que le fournisseur rapporte. « Non fourni » veut dire ce
  qu'il dit.
- Le détecteur de secrets de la sanitation n'est pas exhaustif — aucune expression régulière ne
  l'est. La protection qui compte est la liste fermée ; ce module est une seconde barrière.

**Frontières.** L'Architecte vit dans `apps/web`, côté serveur, et jamais dans le runner. Il
n'a **aucun outil** : ni `tools`, ni `tool_choice`, ni `previous_response_id`, ni
`conversation`, ni mode background, et `store` reste `false`. La clé s'appelle
`NOX_OPENAI_API_KEY` — le préfixe la place hors de portée de Claude Code par construction — et
ne quitte jamais le serveur. Le modèle a un défaut assumé, `gpt-5.6-sol` avec un effort de
raisonnement `high`, nommé une seule fois dans `apps/web/lib/architect/config.ts` ;
`NOX_ARCHITECT_MODEL` reste lue et reste prioritaire. Aucune URL de base configurable, aucun
réessai du SDK. Aucun appel n'est automatique : chaque clic est un appel, et chaque appel est
facturé. Le navigateur ne transmet jamais de contexte — seulement le texte d'un message et un
compteur qui ne décide de rien. Un onglet resté sur un état dépassé est refusé sans appel.

### 2.9 Review Architecte d'une exécution

**Disponible.** Faire relire une exécution terminée par l'Architecte, sur demande explicite. Le
bundle vient **entièrement** de l'instantané immuable : spécification de la tâche, fichiers,
patches, validations. Le verdict du fournisseur et le verdict retenu par NOX sont persistés
séparément.

**Limites.**

- **Cinq analyses par exécution**, échecs compris, et une seule active. Au-delà, il faut se
  contenter des analyses existantes — elles restent toutes consultables.
- Bornes d'envoi indépendantes de celles du stockage : 100 fichiers, 128 Kio par patch,
  512 Kio au total, 10 Kio de résumés de validation. **Une troncature interdit une
  recommandation d'approbation** — une exécution très large ne pourra donc jamais obtenir mieux
  que `Human review required`, quelle que soit sa qualité.
- **Le feedback précédent n'est pas transmis lors de l'analyse d'une correction.** La question
  posée est « cet état final satisfait-il la tâche ? », pas « Claude a-t-il suivi le
  feedback ? ». C'est une décision de périmètre.
- **La review Architecte ne reçoit pas la mémoire projet.** Un travail conforme à sa tâche mais
  contraire à une convention enregistrée ne sera pas signalé.
- **Une analyse et une conversation Architecte ne se parlent pas.** Une recommandation n'est
  jamais injectée dans une conversation, et une conversation ne lit aucune review.

**Frontières.** Aucun fichier n'est ouvert, aucun `git diff` relancé, le runner n'est pas
interrogé. Le compte rendu de Claude Code n'est jamais transmis : une déclaration de l'agent
sur son propre travail n'est pas une preuve. Le sort d'un patch absent est toujours dit —
`Content hidden`, `Binary`, `Truncated`, `Unavailable`, `Not sent` — jamais un `patch: null`
muet. Une analyse ne change aucun statut, ne crée aucun feedback, n'approuve rien ; un test
vérifie cette propriété sur la **source** du module.

### 2.10 Workflow guidé

**Disponible.** Sur la page d'une tâche : l'étape courante, la prochaine étape recommandée, les
actions alternatives, les blocages, et une progression en cinq étapes fixes. Dix étapes
possibles, entièrement dérivées de l'état déjà enregistré.

Quand une action va engager une IA, c'est écrit — « This action will call OpenAI », « This
action will start Claude Code » — et seulement pour celles-là.

**Limites.**

- **Le guide ne vit que sur la page d'une tâche.** Le backlog et la page d'un projet n'affichent
  aucune prochaine étape. Une colonne « Next » exigerait, pour chaque tâche, ses exécutions, ses
  analyses, ses feedbacks et une sonde du runner — sans quoi elle contredirait la page de la
  tâche.
- **Deux allers-retours vers le runner au rendu**, dans deux cas seulement : une tâche prête, et
  une tâche dont un feedback attend une correction. Ce sont les préflights existants, en lecture
  seule, mais ils rendent ces deux pages dépendantes du runner pour afficher une recommandation
  exacte.
- Le stage `Changes requested` n'apparaît que lorsque le runner ne répond pas. Dès qu'il répond,
  le guide tranche entre `Correction ready` et `Blocked`. C'est voulu, mais cela rend ce stage
  rare en usage normal.

**Frontières.** Aucun état de workflow n'est persisté, et aucune migration n'a été nécessaire.
Aucun appel IA ne choisit l'étape : la dérivation est pure et déterministe — un test lit la
**source** du module pour vérifier qu'elle ne contient ni `await`, ni `async`, ni `fetch`, ni
`process.env`. Recommander n'autorise rien : les Server Actions et les gardes existantes
restent les seules autorités. Une précondition non vérifiée produit « je ne sais pas », jamais
« le repository a changé ».

### 2.11 Mémoire projet

**Disponible.** Enregistrer explicitement des entrées durables, dans quatre catégories fermées :
`DECISION`, `CONSTRAINT`, `CONVENTION`, `KNOWLEDGE`. Chaque entrée porte un code `MEM-xxx`
stable, un titre, un contenu, une justification facultative, et un statut `ACTIVE` ou
`ARCHIVED`. Les entrées actives partent avec le contexte de l'Architecte, dans l'ordre de leurs
codes.

Le budget est de 48 Kio d'entrées actives par projet, mesuré après sanitation, et 100 entrées
au total. Une opération qui le ferait dépasser est **refusée**, avec ses trois sorties.

**Limites.**

- **Deux modifications concurrentes d'une même entrée s'écrasent.** La dernière écriture gagne :
  il n'existe pas de contrôle de révision comme pour les documents Markdown.
- **La mémoire n'est pas recherchable.** Trois filtres — `Active`, `Archived`, `All` — et rien
  d'autre.
- **Le budget est mesuré en caractères, jamais en jetons.** Il ne prédit pas un coût.
- Aucun pont avec `docs/DECISIONS.md` : une décision qui doit vivre aux deux endroits se
  recopie à la main, dans les deux sens.

**Frontières.** Aucune entrée n'est créée, modifiée ou archivée automatiquement — ni depuis une
conversation, ni depuis une proposition, ni depuis une review, ni depuis un compte rendu de
Claude Code. La mémoire vit dans SQLite, jamais dans le repository : aucune écriture Git, aucun
fichier généré, aucune modification de `CLAUDE.md`. Seules les entrées `ACTIVE` atteignent
l'Architecte, et **toutes** l'atteignent. Aucune troncature silencieuse, aucun classement.
Créer, modifier, archiver, restaurer et supprimer sont des écritures SQLite : la page
fonctionne runner arrêté et sans configuration OpenAI, et un test le vérifie sur la source des
modules.

### 2.12 État structuré du projet — Project Brief et Living V1 Plan

**Disponible.** Un projet porte deux objets structurés, distincts de ses documents Markdown :
un **Project Brief** — ce qu'on construit, pour qui, contre quel problème — et un **Living V1
Plan** — ce que la première version doit accomplir. Chacun s'édite à la main depuis
`/projects/[id]/plan`, champ par champ, listes comprises.

L'Architecte les reçoit à chaque tour, en tête du contexte, avant la documentation du
repository. Il peut proposer de les modifier : la proposition apparaît dans la conversation,
se relit champ par champ en `Current → Proposed`, **se corrige avant d'être appliquée**, puis
s'applique ou s'écarte. Le tour suivant reçoit immédiatement le nouvel état.

Le budget est de 16 Kio, **commun** au brief et au plan, mesuré après sanitation. Une écriture
qui le dépasserait est refusée, jamais tronquée. Les révisions sont déterministes et servent de
jeton de concurrence optimiste : deux onglets ne peuvent pas écrire l'un par-dessus l'autre.

**Limites.**

- **Aucune synchronisation avec `docs/PROJECT_BRIEF.md`.** Les deux coexistent, aucun n'est
  généré depuis l'autre, et la recopie se fait à la main dans les deux sens.
- **Une proposition périmée ne se rattrape pas.** Si le plan a changé depuis, l'application est
  refusée et il faut demander une nouvelle proposition ; il n'existe aucune fusion automatique.
- **Aucun brouillon d'édition n'est enregistré.** Une correction non appliquée vit dans le
  formulaire, et disparaît si l'on quitte la page.
- **Aucun historique de versions.** Ce qui est conservé est ce que chaque proposition
  contenait et ce qui en a été appliqué, pas une chronologie du brief lui-même.
- **Les listes se saisissent un élément par ligne.** Pas de réordonnancement à la souris.

**Frontières.** Ouvrir la page ne crée aucune ligne : « jamais défini » et « défini et vide »
restent deux états distincts. Enregistrer, appliquer et écarter sont des écritures SQLite —
aucun appel à OpenAI, aucune exécution de Claude Code, aucune requête au runner, aucune commande
Git, aucun fichier écrit dans le repository. Une proposition de l'Architecte ne modifie jamais
le projet seule : seule une application explicitement humaine le fait. La proposition du
fournisseur et la valeur réellement appliquée restent conservées séparément, et aucune des deux
n'est réécrite ensuite.

### 2.13 Backlog de V1 — planification multi-tâches

**Disponible.** Depuis `/projects/[id]/backlog`, un projet dont le Living V1 Plan est
défini peut demander à l'Architecte le **backlog des tâches restantes** pour atteindre cette
V1. Un clic, un appel : la génération est toujours explicite, et l'écran annonce ce qu'elle
coûte.

Le planificateur reçoit le Project Brief, le Living V1 Plan, la mémoire active,
l'**inventaire des tâches existantes** et la documentation autorisée du repository. Il ne
reçoit **aucune conversation** : la connaissance durable du projet suffit à planifier, et
c'est précisément ce que `TASK-021` a rendu vrai.

La proposition se relit tâche par tâche, en cartes compactes qu'on déplie pour éditer. On
peut modifier n'importe quel champ, **déplacer** une tâche vers le haut ou vers le bas, et en
**retirer**. `Apply backlog` crée alors toutes les tâches retenues en `DRAFT`, dans
l'ordre validé, avec des codes séquentiels et leurs documents Markdown — ou n'en crée aucune.

**Limites.**

- **Aucune dépendance explicite.** L'ordre exprime une séquence recommandée ; il n'existe ni
  `dependsOn`, ni `blockedBy`, ni graphe.
- **Aucune file d'exécution.** Les tâches créées sont des brouillons ordinaires ; les lancer
  reste un geste par tâche.
- **Aucun ajout de tâche vierge dans la revue.** On édite, on déplace, on retire ; créer une
  tâche de zéro passe par le formulaire de création, qui existe déjà.
- **Un seul backlog en attente par projet.** Il faut appliquer ou écarter avant d'en générer
  un autre — deux plans concurrents ne se départageraient pas.
- **Un backlog périmé ne se rattrape pas.** Toute modification du contexte de planification —
  plan, brief, mémoire active, inventaire des tâches, documents inclus — le refuse, et il
  faut en générer un nouveau.
- **L'inventaire est borné à quarante tâches**, les plus récentes. Au-delà, un travail très
  ancien pourrait être reproposé, et c'est la revue humaine qui l'attrapera.
- **Aucune atomicité entre SQLite et le disque.** Les tâches sont créées en une transaction ;
  leurs documents Markdown sont écrits après, un par un. Une panne à cette étape laisse des
  documents à reprendre — état visible et reprenable d'un clic, jamais silencieux.

**Frontières.** Ouvrir la page ne déclenche aucun appel. Aucune génération n'est provoquée
par un plan enregistré, une mise à jour de projet appliquée, une tâche terminée ou un retour
sur le projet. `Apply` n'appelle ni OpenAI, ni Claude Code, ne crée aucun commit, aucun
`git add`, aucun push. Aucune tâche existante n'est modifiée, supprimée ou renumérotée :
un backlog appliqué s'ajoute à la suite. La proposition du fournisseur reste immuable ; ce
que l'humain a retenu est conservé séparément.

### 2.14 Amorçage d'un projet — TASK-000

**Disponible.** Un projet dont le brief, le plan de V1 et un backlog appliqué existent peut
préparer son repository. La page `/projects/[id]/bootstrap` annonce l'état, nomme les
préconditions manquantes, et offre un aperçu.

L'aperçu construit **exactement** la tâche qui sera créée : titre, objectif, contexte,
critères d'acceptation, hors périmètre. Il est **déterministe** — même état, même texte — et
n'appelle aucune IA. Il lit le repository une fois, en lecture seule, pour distinguer un dépôt
vide d'un dépôt qui porte déjà une application.

`Create TASK-000` crée alors une tâche `DRAFT` de nature `BOOTSTRAP`, portant le
code réservé `TASK-000`, et son document `tasks/TASK-000.md`. Elle suit ensuite le
cycle de vie habituel : relecture, `Mark ready`, exécution explicite, review, corrections.

**Limites.**

- **Aucune exécution automatique.** Créer la tâche ne lance rien. NOX peut recevoir un
  repository qui n'a besoin d'aucun amorçage : « disponible » n'a jamais signifié « fait ».
- **Aucune commande de validation n'est proposée.** NOX ne peut pas les connaître — la pile
  d'un dépôt vide sera choisie pendant l'exécution, et les scripts d'un dépôt existant ne
  sont jamais lus. L'utilisateur en ajoute une fois qu'elles existent.
- **Aucune synchronisation dans les deux sens.** L'amorçage matérialise l'état structuré en
  Markdown une fois. Modifier ensuite le plan dans NOX ne réécrit pas `docs/V1_SCOPE.md` :
  cette synchronisation appartient à un travail futur.
- **Aucune entrée de mémoire n'est créée**, ni à la préparation, ni après l'exécution. Les
  décisions techniques prises pendant l'amorçage sont consignées dans le repository, pas
  dans la mémoire NOX, qui reste contrôlée par l'utilisateur seul.
- **L'inspection est grossière.** Elle constate des manifestes et des dossiers de code
  reconnus, pas une pile technique. Claude Code lit le détail au moment où il travaille.

**Frontières.** Aucun appel à OpenAI, à aucune étape — ouvrir la page, prévisualiser, créer.
Le numéro `0` est réservé : `Project.nextTaskSequence` démarre à `1` et ne recule
jamais, donc aucune attribution ordinaire ne peut le produire, et `@@unique([projectId, sequence])`
garantit qu'un projet n'en porte qu'une. Créer `TASK-000` ne consomme aucun numéro : la tâche
suivante reçoit celui qu'elle aurait reçu sans elle. Aucune tâche existante n'est modifiée,
renumérotée ou déplacée, et leur provenance de backlog reste intacte. `TASK-000` n'en porte
aucune.

### 2.7 bis Boucle de correction pilotée par la validation

**Disponible.** Un échec que NOX a constaté lui-même devient un **contexte de correction** : le
critère non prouvé, la commande qui devait le prouver, son code de sortie et ses sorties bornées
partent avec la reprise. Personne ne relit un log pour en recopier l'erreur.

Deux sources, et elles ne se mélangent pas. `HUMAN_FEEDBACK` : quelqu'un a relu et a demandé
quelque chose. `AUTOMATED_VALIDATION` : NOX possédait la preuve, et n'a eu besoin de personne. La
source est persistée, affichée sur l'exécution, et explique pourquoi Claude Code a été relancé.

Quand la tâche est la **barrière courante d'une file active**, NOX relance Claude Code de lui-même
sur cet échec, au plus **deux fois par cycle de travail**. Chaque correction réussie reçoit un lot
de validations **complet et neuf**. Une tâche entièrement automatisée peut donc échouer, être
corrigée, repasser et se terminer sans aucune action humaine.

Hors file, ou file en pause, rien ne part seul : la review affiche `Correction ready`, les preuves
sont déjà rassemblées, et un clic suffit. Le texte humain devient alors **facultatif** — il ne sert
qu'à dire ce que les preuves ne disent pas.

**Limites.**

- **Deux corrections automatiques par cycle**, et c'est une constante — jamais un réglage
  d'interface. Au-delà, l'écran annonce `Automatic correction limit reached` et la main revient à
  un humain, qui peut toujours demander une correction : la borne borne l'automatisme, pas les
  gestes humains.
- **Une panne d'infrastructure ne déclenche jamais de correction.** Un lot `ERROR` renvoie vers
  `Retry automated validation`. Si la reprise produit un échec réel, la correction redevient
  possible.
- **Une validation qui modifie le dépôt ne se corrige pas automatiquement.** Le dossier de travail
  n'est plus celui qui a été relu, et une reprise exige qu'il le soit exactement. NOX le nomme,
  ne restaure rien, et rend la main.
- **Un amorçage ne se corrige jamais tout seul.**
- **Une exécution Claude Code qui échoue ou est annulée n'ouvre aucune correction** : le problème
  n'est pas la qualité du résultat.
- **Aucune preuve, aucune confirmation humaine ne traverse une tentative.** Chaque review repart de
  zéro sur l'état courant.
- **Aucun démarrage au redémarrage.** Une correction réservée mais jamais lancée reste visible et
  attend un geste explicite.

**Frontières.** Zéro appel à OpenAI : le contexte est construit localement, à partir de la base.
NOX ne demande jamais à l'Architecte ce qu'il faut corriger. Aucun second moteur Claude : le
dispatcher choisit, le moteur de correction existant exécute — mêmes permissions, même préflight,
même streaming. Une correction `NORMAL` garde les permissions `NORMAL`. Aucune écriture Git, aucun
commit, aucune restauration. Le navigateur n'envoie que des identifiants, un texte humain et des
identifiants de critères, tous revalidés côté serveur.

---

### 2.7 ter Livraison Git d'un travail validé

**Disponible.** Chaque projet porte une politique de livraison : `Manual`,
`Auto commit validated`, `Auto commit + push validated`. Elle vit dans les réglages du projet,
et changer ce réglage **est** l'autorisation humaine : NOX ne redemande pas confirmation tâche
par tâche — une file qui s'arrête sur une modale n'avance pas plus qu'une file arrêtée.

Elle est **indépendante** de la file d'exécution. `Start queue` autorise NOX à lancer Claude Code
et à corriger deux fois une validation en échec ; il n'autorise rien dans Git. Une file active
sur un projet `Manual` continue de s'arrêter sur un repository modifié.

Quand une tâche est validée, NOX fige un **candidat de livraison** : la branche, `HEAD`,
l'empreinte authentifiée du dossier de travail et la liste exacte des fichiers changés. Juste
avant d'écrire, il relit tout et compare. Si le repository correspond encore, il prépare les
chemins exacts — jamais un `git add .` — et crée un commit dont le sujet porte le code de la
tâche et le corps un trailer technique. En `Auto commit + push validated`, il pousse ensuite vers
l'upstream **déjà configuré** de la branche courante. La file peut alors continuer.

Ce que « continuer » exige n'est pas le même dans les deux modes automatiques, et la distinction
compte :

| Politique | Ce qui est exigé | État de la branche locale ensuite |
| --- | --- | --- |
| `Auto commit validated` | un commit local validé — **aucun push** | en avance sur son upstream, et la file continue |
| `Auto commit + push validated` | le commit **et** le push confirmé | alignée sur son upstream |

Une branche en avance parce que NOX vient de créer exactement son commit validé n'est donc pas un
repository « non prêt » : c'est l'état normal d'un projet `Auto commit`. Un push refusé, en
revanche, laisse la politique `Auto commit + push validated` insatisfaite, et la file s'arrête —
le commit local, lui, reste en place.

En `Manual`, le candidat est enregistré et affiché quand même : la surface de livraison montre
exactement ce qu'il y aurait à livrer, et deux boutons le livrent — avec les mêmes gardes que
l'automatique. Livrer depuis un terminal reste évidemment possible ; le préflight Git existant
reste alors l'autorité qui laisse la file continuer.

**Limites.**

- **Si le repository ne correspond plus au candidat, NOX n'écrit pas.** Pas de « il essaie de
  sauver ce qu'il peut », pas de distinction entre une modification innocente et une autre,
  aucun bouton `Commit anyway`. Le candidat n'est jamais recalculé sur l'état courant : il
  faudrait une nouvelle validation pour cela.
- **Une tâche simplement marquée terminée ne se livre pas.** Sans exécution, sans review et sans
  décision, il n'existe aucun travail validé — et commiter ce qui traîne serait une invention.
- **NOX ne change jamais de branche, et ne configure jamais un upstream.** `HEAD` détaché,
  branche différente, upstream absent : autant de refus nommés, jamais une réparation.
- **NOX ne force jamais un push, et ne réconcilie jamais un historique.** Un refus
  « non-fast-forward » conserve le commit local et rend la main ; ni `pull`, ni `merge`, ni
  `rebase`.
- **Aucune protection du repository n'est contournée.** `--no-verify` et `--no-gpg-sign` ne sont
  jamais passés. Un hook de commit ou une signature configurée fait renoncer la livraison
  **automatique** — personne ne regarde ; un geste humain reste possible, et le hook s'exécute.
- **Le garde-fou des fichiers sensibles est un filtre de noms, pas un détecteur de secrets.** Il
  refuse qu'un `.env`, un `*.pem`, un `*.key` ou un `credentials.json` apparaisse pour la
  première fois dans un commit automatique. Un secret écrit dans un fichier de code ordinaire
  passera, et NOX ne prétend pas le contraire.
- **NOX ne stocke aucun identifiant Git.** Ni table, ni jeton, ni clé : il utilise
  l'environnement Git déjà fonctionnel de la machine, en mode non interactif.
- **Aucun worker de fond.** Rien ne part d'un rendu de page ni d'un démarrage de serveur : le
  déclencheur est la transition d'une tâche vers `COMPLETED`, et la réservation persistante rend
  le geste idempotent.
- **Un dossier de travail propre n'est pas une livraison.** Si l'utilisateur a commité lui-même,
  NOX ne cherche pas à reconnaître quel commit correspondait au travail : deviner serait pire que
  ne rien dire.

**Frontières.** Zéro appel à OpenAI, zéro Claude Code : une livraison n'est ni une décision de
produit, ni une relecture. Trois commandes d'écriture seulement — `git add` sur des chemins
littéraux, `git commit`, `git push` — et aucune autre n'est atteignable. Le navigateur n'envoie
que des identifiants et un mode ; ni chemin, ni branche, ni remote, ni message, ni argument Git.
Supprimer un projet retire son état de livraison et jamais son historique Git.

### 2.7 quater Orchestration multi-projets

**Disponible.** Plusieurs projets peuvent travailler en même temps, chacun sur son repository :
leur file, leur exécution Claude Code, leurs validations, leurs corrections et leur livraison Git
avancent sans se bloquer mutuellement.

La règle qui reste, et qui protégeait ce qu'il fallait protéger : **au plus une exécution Claude
Code active par repository canonique**. Deux Claude Code sur un même dossier se marcheraient
dessus dès la première écriture ; deux repositories différents ne partagent rien.

L'exclusion porte sur l'identité **canonique** du repository, jamais sur l'identifiant du projet.
Un séparateur final, un séparateur inversé, un segment `..` résiduel ou une différence de casse
sous Windows ne la contournent pas — et deux projets qui viseraient le même dossier, ce que NOX
interdit normalement, restent exclus l'un de l'autre. Elle est vérifiée deux fois, par deux
composants indépendants : le serveur web en base, dans la transaction qui crée l'exécution ; le
runner ensuite, sur les processus réels, sans faire confiance au web.

Le tableau de bord montre cette simultanéité : chaque carte porte ce que **son** projet fait —
`Claude running`, `Correcting`, `Validating`, `Waiting for human validation`, `Git delivery
pending`, `Queue active`, `Queue paused`, `Blocked`, `Idle` — et sa politique de livraison Git.
Un résumé dérivé compte les projets, les exécutions en cours, les files actives et les attentes
humaines. Il n'existe aucune « exécution courante » globale : elle désignerait arbitrairement
l'un des travaux en cours.

**Limites.**

- **Aucune dépendance entre projets.** Une tâche n'attend que des tâches de son propre projet, et
  le service refuse une arête qui traverserait deux projets.
- **Aucun ordonnanceur, aucune équité, aucun plafond global.** Ni priorité, ni tourniquet, ni pool
  de travailleurs, ni nombre maximal d'exécutions simultanées. Il n'y a pas de ressource partagée
  à répartir : le seul conflit possible est déjà tranché par le verrou de repository.
- **Aucune activation automatique.** Démarrer la file d'un projet n'en démarre aucun autre, et
  redémarrer le serveur ne lance rien — même avec plusieurs files actives en base.
- **Les limites de la machine et du fournisseur restent extérieures à NOX.** Si deux exécutions
  simultanées se heurtent à un refus du fournisseur, chacune suit son propre échec ; NOX n'en
  déduit jamais qu'il est « occupé » globalement.
- **Le registre du runner reste en mémoire.** Un redémarrage du runner perd le suivi de toutes
  les exécutions en cours, exactement comme avant : chacune est alors marquée bloquée, et NOX ne
  prétend pas savoir ce que les processus ont fait. La concurrence ne change rien à cette limite,
  et n'attribue jamais l'exécution d'un repository au mauvais projet.

**Frontières.** Zéro appel à OpenAI : choisir quoi lancer est déterministe. Le navigateur ne
porte ni chemin, ni clé de verrou, ni identifiant de processus — un projet et une tâche,
revalidés côté serveur. Aucune action ne traverse deux projets : annulation, review, correction
et livraison vérifient toutes la chaîne projet → tâche → exécution.

### 2.15 Changement de projet depuis la conversation — replanification

**Disponible.** Depuis la conversation principale d'un projet, un message qui change une
exigence peut recevoir bien plus qu'une réponse : l'Architecte peut proposer un **changement de
projet**, qui porte le Project Brief et le Living V1 Plan, le plan des tâches futures, ou les
deux ensemble.

Quand un tour propose les deux, ils forment **une seule intention** : une carte dans le fil, une
page de revue, un bouton `Apply project change`. Deux revues auraient rendu possible l'état que
cette capacité existe pour empêcher — un plan qui décrit un produit, et un backlog qui en
construit un autre.

**Ce qui est replanifiable, et ce qui ne l'est pas.** Une tâche qui a une exécution, qui est
inscrite dans la file, dont le statut n'est plus un statut d'avant-exécution, ou qui est
`TASK-000`, est **verrouillée** : l'Architecte la voit dans un inventaire compact, ne reçoit pas
son contrat, et ne peut pas la réécrire. Les autres sont **modifiables**, et leur contrat complet
lui est transmis. La classification est celle de `TASK-024`, pas une seconde règle.

**Ce que le fournisseur rend.** L'état cible complet des tâches futures — pas une suite
d'opérations. NOX dérive lui-même ce que ce plan fait au plan courant : conservée, modifiée,
retirée, ajoutée, déplacée, dépendances changées. Le fournisseur ne pose jamais ces étiquettes.

La revue affiche le brief et le plan champ par champ, puis le sort de chaque tâche. Tout le
contrat est éditable — titre, priorité, objectif, contexte, hors périmètre, documents, critères,
modes de vérification, commandes, modes d'exécution, liens critère-commande, dépendances, ordre —
avec exactement les règles de l'éditeur de tâche future et la garde des commandes de `TASK-027`.
On peut ajouter une tâche, en retirer une, et restaurer un retrait sans redemander un tour.

**Ce que l'application fait.** Une transaction SQLite, tout ou rien : brief, plan, mises à jour,
suppressions, créations, ordre de planification, dépendances, transitions `READY → DRAFT`,
attribution des codes, proposition et mise à jour liée passées à `APPLIED`. Les documents
Markdown suivent, et seules les tâches réellement changées sont réécrites.

**Limites.**

- **Au plus un changement en attente par projet.** Tant qu'il attend, l'Architecte n'en propose
  pas d'autre — la conversation, elle, continue normalement.
- **Un projet sans backlog initial appliqué n'est pas replanifiable.** L'interface renvoie vers
  la planification initiale : il n'existe pas de second chemin pour créer un premier plan.
- **Un changement conçu sur un état devenu obsolète est refusé.** Brief modifié, plan modifié,
  tâche éditée, inscrite en file, lancée, ajoutée ou retirée depuis : l'application refuse et dit
  ce qu'elle peut nommer. Il n'existe ni fusion, ni « appliquer quand même ».
- **`TASK-000` jamais exécutée bloque un changement qui toucherait le brief ou le plan.** Elle a
  été rédigée à partir de l'état produit d'alors. NOX ne la réécrit ni ne la supprime : c'est un
  geste humain.
- **Aucune sauvegarde intermédiaire de la revue.** Les corrections vivent dans le formulaire
  jusqu'à l'application ; un refus les rend, une fermeture d'onglet les perd.
- **Le plan de travail transmis est borné.** Au-delà du budget, le tour est refusé avec
  `REPLAN_CONTEXT_TOO_LARGE` : les contrats modifiables ne sont jamais tronqués en silence.

**Frontières.** Relire, éditer, appliquer ou écarter : zéro appel à OpenAI, zéro exécution de
Claude Code, zéro validation, zéro correction, zéro livraison Git, zéro démarrage de file. Une
file active n'est ni mise en pause, ni vidée, ni avancée ; les tâches nées d'un changement
naissent `DRAFT` et hors file. Les identifiants et les codes de tâches sont immuables, et aucun
code n'est jamais recyclé. Le navigateur n'envoie que des identifiants et les valeurs saisies —
aucun statut, aucun code, aucun chemin, et aucun drapeau de forçage, qui n'existe pas.

---

## 3. Où en est l'écart avec la cible

### 3.1 Résolu par `TASK-020` : une conversation par projet

La limitation la plus structurante de l'état précédent — *une conversation Architecte produit une
tâche, puis se ferme* — **n'existe plus**. Un projet a désormais une conversation principale,
durable, qui crée plusieurs tâches au fil du temps.

Le verrou qui empêchait les doublons n'a pas disparu : il a changé de porteur. Ce n'est plus la
conversation qui ne crée qu'une tâche, c'est la **proposition**. Deux clics simultanés sur
« Create task » produisent toujours exactement une tâche.

### 3.2 Résolu par `TASK-021` : une intention produit tenue par NOX

La deuxième limitation structurante — *NOX ne sait rien du projet en dehors de ses documents
Markdown* — n'existe plus non plus. Le Project Brief et le Living V1 Plan sont désormais une
représentation que NOX relit, mesure, versionne et transmet, et que l'Architecte peut proposer
de faire évoluer sans jamais la modifier lui-même.

C'est aussi la première fois qu'une proposition du modèle porte sur **l'état du projet** plutôt
que sur une tâche. Le cycle — proposer, relire, corriger, appliquer — est celui que la
génération multi-tâches réutilisera.

### 3.3 Résolu par `TASK-022` : un plan qui devient un backlog

La troisième limitation structurante — *une proposition porte une tâche, et rien ne relie le
plan validé au travail à faire* — n'existe plus. Un Living V1 Plan produit désormais un
backlog ordonné de plusieurs tâches, relu et corrigé avant d'exister.

Le cycle de `TASK-021` — proposer, relire, corriger, appliquer — a été réutilisé tel
quel, à une différence près qui compte : ce qui s'applique n'est plus un état, c'est un
**lot**. D'où l'atomicité de la transaction, et la franchise sur ce qu'elle ne couvre pas.

### 3.4 Résolu par `TASK-023` à `TASK-031`

Sept limitations de cette liste n'existent plus. Une spécification **se modifie** tant qu'elle n'a
jamais été exécutée ; les **dépendances** entre tâches sont un graphe acyclique explicite ; un
projet vide **s'amorce** par `TASK-000` ; une **file d'exécution** enchaîne les tâches inscrites
sans jamais contourner le préflight Git ni la review humaine ; **correction et re-review
s'enchaînent**, avec une borne écrite ; un travail validé **se livre dans Git**, sous une
politique choisie projet par projet ; et **plusieurs projets avancent en parallèle**, chacun sur
son repository.

`TASK-027` avait fermé la boucle que la file avait ouverte : l'humain n'est sollicité que là où il
apporte quelque chose. `TASK-028` va au bout du raisonnement — quand NOX possède lui-même la preuve
d'un échec, il n'a besoin de personne pour la recopier. `TASK-029` lève la dernière interruption
systématique : le commit, qui arrêtait la file après chaque tâche. `TASK-031` lève la dernière
limitation de capacité : un repository ne bloque plus artificiellement un autre repository.

### 3.5 Résolu par `TASK-032` : le plan futur évolue depuis la conversation

La dernière limitation de cette liste — *une fois le backlog appliqué, le plan des tâches
futures ne change plus qu'à la main, tâche par tâche* — n'existe plus. Une exigence qui change
se dit dans la conversation du projet, et l'Architecte propose un changement complet : le
Project Plan et le plan des tâches futures, relus ensemble, appliqués d'un geste.

Le cycle de `TASK-021` — proposer, relire, corriger, appliquer — est réutilisé une troisième
fois. Ce qui s'applique n'est ni un état, ni un lot : c'est un **état cible**, dont NOX dérive
lui-même ce qu'il fait au plan courant.

### 3.6 Ce qui reste à faire

**Le périmètre de V1 prévu est couvert.** Aucune capacité annoncée dans
[V1_SCOPE.md](V1_SCOPE.md) § 2 n'est manquante, et aucune étape de la roadmap n'est ouverte.

Ce qui reste n'est pas une fonctionnalité : c'est un **premier pilote réel de bout en bout**.
Un vrai projet, un vrai repository, un vrai modèle, du début à la livraison. C'est lui qui dira
ce qui mérite une étape suivante — pas une liste écrite d'avance.

Voir [ROADMAP.md](ROADMAP.md).

---

## 4. Ce qui n'existe pas

**Synchronisation Markdown bidirectionnelle.** L'amorçage matérialise le brief et le plan
dans le repository une fois. Un plan modifié ensuite dans NOX ne réécrit aucun document, et
un document modifié à la main ne remonte pas dans NOX.

Aucun de ces éléments n'est commencé. Les lister évite de les croire disponibles.

**Conception et planification.** Historique de versions du Project Brief ou du Living V1 Plan,
matérialisation automatique et continue de l'état structuré en Markdown, extraction automatique
de mémoire depuis une conversation, une proposition de projet ou un backlog, déduplication
sémantique entre tâches, dépendances entre tâches de projets différents, sauvegarde
intermédiaire d'une revue de changement de projet.

**Exécution.** Plusieurs agents en parallèle sur un **même** repository, worktrees automatiques,
plusieurs comptes Claude, exécution automatique de l'étape recommandée, cron, scheduler,
notifications, ordonnanceur global entre projets.

**Livraison.** Génération d'un message de commit rédigé par un modèle, pull requests,
restauration Git, résolution de conflits, changement de branche, création d'un upstream.

**Interface.** Recherche, filtres et pagination sur le tableau de bord, archivage, corbeille,
déplacement d'un projet, suppression en masse, tableau d'audit des changements de projet.

**IA.** Boucle autonome OpenAI ↔ Claude, approbation ou correction automatique, review
déclenchée en arrière-plan, sélection libre du contexte, lecture du code source par OpenAI,
scan IA de secrets, analyse de plusieurs exécutions à la fois, sélection automatique de modèle,
politique de coût.

**Mémoire.** Extraction automatique depuis une conversation, suggestions de décisions, résumé
automatique, mémoire vectorielle, embeddings, recherche sémantique, RAG, mémoire globale ou
partagée entre projets, import automatique de `DECISIONS.md`, synchronisation mémoire ↔
Markdown, expiration automatique, fusion de doublons, tags libres, relations entre mémoires,
mémoire dans la review Architecte.

**Plateforme.** Authentification, multi-utilisateur, déploiement, monorepos et `CLAUDE.md`
imbriqués, suivi des coûts au-delà de ce que les fournisseurs rapportent.

---

## 5. Vérifications manuelles

Un test contre un faux fournisseur prouve que le contrat est respecté. Il ne prouve rien du
comportement réel d'un modèle ou d'un binaire. Chaque étape depuis `TASK-008` se conclut donc
par une vérification exécutée à la main, sur un vrai repository.

### 5.1 Réserves levées

- **Forme réelle des événements `stream-json`** de Claude Code `2.1.223` : entièrement
  observée. La supposition initiale était juste sur la structure et fausse sur le contenu — une
  commande Bash arrive préfixée de `cd "<répertoire>" &&`, ce qui a provoqué un correctif.
- **Reprise ciblée** : une correction réelle a repris la session du run relu, est restée
  ciblée, et n'a créé aucun commit. Le refus `REVIEW_WORKTREE_CHANGED` a été vérifié à la main.
- **Architecte** : une génération réelle a été effectuée — Responses API, Structured Output
  accepté, précisions, proposition, tâche créée en `DRAFT`, aucun run Claude déclenché.
- **Review Architecte** : une analyse réelle a été rendue sur `nox-claude-test` — `TASK-009`,
  `RUN-001`, `ANALYSIS-1`, modèle `gpt-5-mini`, prompt `architect-review/1`. Le Structured
  Output réel a été accepté, des observations réelles ont été produites sur `README.md`, `AC1`
  et `AC2` — dont une `MINOR` sur les fins de ligne CRLF —, et le verdict
  `Approve recommended` **n'a rien approuvé** : la tâche est restée en `REVIEW`, l'approbation
  demeurant un clic humain.

  Un scénario a été vérifié, pas tous : `CHANGES_RECOMMENDED`, `HUMAN_REVIEW_REQUIRED` et les
  dégradations de la garde d'approbation n'ont été observés que contre un faux fournisseur.
- **Mémoire projet** : la mémoire a été confrontée à un contexte Architecte réel à l'issue de
  `TASK-017`.

### 5.2 Réserves ouvertes

- **Le correctif de lecture des lignes Bash n'a pas été revu en exécution réelle.** Il a été
  vérifié contre le faux Claude et contre la ligne exacte relevée dans une transcription de
  session.
- **La chaîne complète n'a jamais été parcourue de bout en bout sur un vrai projet.** Chaque
  capacité a été vérifiée à la main, l'une après l'autre ; leur enchaînement — de la première
  phrase de description jusqu'à une livraison relue, puis un changement de projet — ne l'a pas
  encore été. C'est l'objet du premier pilote réel, et c'est aujourd'hui la seule réserve
  ouverte qui porte sur le produit entier.
- **Le changement de projet n'a été vu qu'à travers un faux fournisseur.** Les trois écrans
  sont rendus et vérifiés par `functional-032` sur un vrai serveur web, mais aucune
  replanification réelle n'a encore été proposée par un modèle.

---

## 6. Dette technique transverse

Les limites propres à une capacité sont dans sa section. Celles-ci n'appartiennent à aucune.

1. **Pas de test de rendu React.** La couverture est assurée par les tests unitaires, un test
   d'intégration réel et des tests fonctionnels HTTP en mode production.
2. **Les Server Actions ne sont pas couvertes par un test fonctionnel HTTP.** Les tests
   fonctionnels appellent les mêmes fonctions serveur qu'elles ; les pages, elles, sont bien
   lues par HTTP. Leurs règles sont couvertes par des tests unitaires, leur câblage par le
   build.
3. **Six tests sont ignorés sous Windows** : cinq portent sur les liens symboliques de
   fichier, un sur l'empreinte de dossier de travail. Tous demandent un privilège que le poste
   n'accorde pas. Les cas d'évasion correspondants restent couverts par des jonctions.
4. **Les scripts fonctionnels ne sont pas versionnés.** Ils vivent dans le dossier de travail
   temporaire d'une session, conformément aux règles de sécurité. Ils sont donc rejouables tant
   que le dossier existe, et perdus ensuite. C'est une conséquence assumée, pas un oubli.
5. **La clé étrangère `Run.parentRunId` n'existe pas au niveau SQLite.** `ALTER TABLE ADD
   COLUMN` ne sait pas en créer, et reconstruire la table qui porte l'historique réel des
   exécutions ne se justifiait pas. Elle ne protégerait de rien d'atteignable : aucune
   exécution n'est jamais supprimée, et l'unicité de `parentRunId` est bien posée.
6. **Aucun cache.** Chaque rendu relit la base.
7. **Le jeton du runner est en clair dans `.env`.** C'est le modèle de menace assumé d'un outil
   local mono-utilisateur.
8. **Versions figées** : TypeScript 5.9, ESLint 9, Node ≥ 22.18 requis.
9. **La revue d'un changement de projet ne se sauvegarde pas.** Les corrections humaines vivent
   dans le formulaire jusqu'à l'application ; un refus les rend, une fermeture d'onglet les
   perd. Le brouillon persistant a été écarté pour cette étape, et reste possible sans
   changement de modèle : `providerJson` et `appliedJson` sont déjà distincts.
10. **La section historique d'une revue de changement liste toutes les tâches verrouillées**,
    et non les seules tâches réellement citées par la cible. Elle est repliée, donc elle ne
    noie pas la page, mais elle en dit plus que nécessaire sur un gros projet.

---

## 7. État Git

- Aucun commit, aucun push, aucun `git add` effectué par Claude Code.
- Historique Git non modifié.
- Commit de départ de `HOTFIX-006` : `c3393bc`
  (`fix: preserve durable architect decisions in planning`), contenant `HOTFIX-005`.
- `HOTFIX-006` reste **local**, non indexé et non commité.

---

## 8. HOTFIX-001 — corrections issues du premier pilote

Le premier pilote réel (TripKit) a produit deux constats, et ce hotfix y répond sans
élargir le périmètre.

**Le modèle de l'Architecte.** `NOX_ARCHITECT_MODEL` était obligatoire, et sa valeur venait d'un
exemple recopié : TripKit a discuté son architecture puis tenté de planifier sa V1 sur
`gpt-5-mini`. Le défaut existait déjà ; il n'était pas assumé. `DEFAULT_ARCHITECT_MODEL` vaut
désormais `gpt-5.6-sol`, avec un effort de raisonnement `high`, et il est nommé à un seul
endroit. La variable reste lue et reste prioritaire ; elle devient facultative. Un modèle
configuré à la main ne reçoit aucun effort de raisonnement — NOX n'en connaît pas les capacités.

**Le refus d'un backlog.** `BACKLOG-001` a échoué sur `tasks.0.acceptanceCriteria`, information
que NOX possédait et n'affichait pas : l'écran disait « format attendu », et relancer était le
seul moyen d'en apprendre plus. Le diagnostic du validateur — chemin du champ et phrase — est
désormais persisté (`errorField`, `errorDetail`, nullables) et affiché sur la ligne `FAILED`.
La nature de l'échec, `OUTPUT_INVALID` ou `PROVIDER_ERROR`, se dérive de `errorCode`.

Ce que ce hotfix n'a pas fait : aucune réparation de sortie, aucun réessai, aucun second appel,
aucun modèle de repli, aucun assouplissement du contrat de `backlog/2`. Un clic vaut toujours au
plus un appel. Les générations historiques gardent le modèle qu'elles ont réellement utilisé.

**Limites connues.** Un effort de raisonnement `high` consomme des jetons de sortie comptés dans
`ARCHITECT_BACKLOG_MAX_OUTPUT_TOKENS` (32 000) et du temps compté dans
`ARCHITECT_REQUEST_TIMEOUT_MS` (90 s). Ces deux bornes sont inchangées : les toucher sans mesure
aurait été deviner. Le premier `Generate` réel du pilote dira si elles suffisent.

---

## 9. HOTFIX-002 — exécution des validations sous Windows

Le pilote a exécuté `TASK-001` de TripKit, puis s'est arrêté sur deux constats.

**La validation autonome ne démarrait pas.** `npm test` produisait
`VALIDATION_SPAWN_FAILED` alors que la commande fonctionnait depuis un terminal. Trois causes
s'additionnaient : la résolution retenait le fichier `npm` **sans extension** que npm installe à
côté de `npm.cmd` — Windows ne sait pas le lancer (`ENOENT`) ; Node refuse depuis
CVE-2024-27980 de lancer un `.cmd` sans shell (`EINVAL`), ce qui condamnait la correction naïve ;
et l'enveloppe `cmd.exe` existante perdait sa citation dès que le chemin contenait une espace,
parce que `/s` retire la première et la dernière guillemet de ce que Node avait cité.

La ligne est désormais écrite par NOX, jeton par jeton, dans
`apps/runner/src/claude/command-line.ts`, et envoyée en `windowsVerbatimArguments`. La résolution
ne retient que les extensions de `PATHEXT`. `shell: true` reste exclu — voir
[D-380](DECISIONS.md).

**La review disait « Claude Code n'a jamais lancé cette commande ».** Le transcript de la session
prouve le contraire : l'agent avait lancé `npm test 2>&1 | tail -60`. NOX a eu **raison** de ne
rien valider — dans un tuyau, le code de sortie observable est celui de `tail` — mais il affirmait
quelque chose qu'il ne savait pas. La correspondance reste exacte ; c'est la phrase qui a changé,
et la timeline distingue désormais une ligne illisible d'une ligne simplement non reconnue. Voir
[D-382](DECISIONS.md).

Ce que ce hotfix n'a pas fait : aucune normalisation d'arguments, aucune lecture du compte rendu
final du modèle, aucune migration, aucun changement de la sémantique de `Retry automated
validation`. Un résultat rapporté par Claude Code ne valide toujours aucun critère `AUTOMATED`.

**Limites connues.** L'exécution réelle de `npm` n'est vérifiée automatiquement que sous Windows
(`windows-validation.test.ts`, ignoré ailleurs) ; partout, la stratégie choisie est vérifiée avec
un système de fichiers et un lanceur simulés. Le champ `detail` d'une erreur du runner n'est
renseigné que par la route de validation : les autres routes continuent de ne rendre qu'un code.

---

## 10. TASK-033 — durcissement de l'autonomie, après le premier pilote

Le pilote TripKit a validé la chaîne complète — conversation, brief, plan, backlog, amorçage,
replanification, Claude Code, validation indépendante, vérification humaine. Il a aussi révélé
quatre interventions humaines qui n'ont pas lieu d'être dans le workflow cible. Cette tâche les
traite, et **uniquement** elles : l'ergonomie, la visibilité du modèle, l'observabilité des
exécutions et les métriques d'autonomie sont reportées.

**Les dépendances s'expriment.** `backlog/3` porte un champ `dependsOn` — des positions,
strictement antérieures — et `architect/6` dit ce qu'une dépendance **est** : un prérequis
fonctionnel réel, jamais une chronologie. Le pilote avait produit deux tâches dont la seconde
étendait le modèle, la persistance et l'écran de la première, sans qu'aucun lien ne l'exprime,
parce que `backlog/2` n'avait pas de champ pour l'écrire. La sémantique reste au fournisseur ; NOX
garantit le contrat et le graphe. Voir [D-384](DECISIONS.md).

**Les plans de vérification se rafraîchissent seuls après l'amorçage.** L'acceptation de
`TASK-000` déclenche au plus un appel, dont le contrat ne porte que quatre champs : mode de
vérification, consigne humaine, commandes, liens critère-commande. Le texte des critères ne
quitte jamais NOX. Une réponse valide s'applique directement ; un champ hors contrat fait refuser
toute la proposition, nommément. Voir [D-385](DECISIONS.md) et [D-386](DECISIONS.md).

**La commande de validation se demande littéralement.** Le prompt d'exécution demande désormais
au moins une exécution exacte de chaque commande enregistrée. `readBashCommand` n'a pas bougé :
une ligne à tuyau reste refusée, et pour la bonne raison. Voir [D-387](DECISIONS.md).

**Le contrat d'une tâche est dit figé, et sa divergence est constatée.** Le pilote avait vu
l'agent cocher les cases de `tasks/TASK-002.md`. Le contrat vit en base et n'avait pas changé ; la
réponse est une consigne et un constat, pas un verrou de système de fichiers. Voir
[D-388](DECISIONS.md).

**La livraison Git est enfin visible.** Une tâche terminée montre toujours la politique du projet
et mène à la surface de livraison, y compris quand aucun candidat n'a pu être réservé — c'est ce
qui renvoyait l'utilisateur dans un terminal après chaque tâche. Aucun nouveau chemin d'écriture
Git : le moteur de TASK-029 reste le seul. Voir [D-389](DECISIONS.md).

**Ce que cette tâche n'a pas eu à faire.** L'auto-approbation déterministe et la continuation de
file existaient déjà — `checkAutoCompletion` depuis TASK-027, `applyTaskTransition` depuis
TASK-029 — et l'inspection a confirmé qu'elles couvraient les six conditions attendues. Aucun
statut n'a été ajouté, aucun second moteur de file, de Git ou de replanification n'a été créé.

**Migration.** Une seule table, `VerificationRefresh`, purement additive : aucun modèle existant
ne pouvait porter un appel de rafraîchissement, son coût, son issue et son empreinte
d'idempotence. Aucune colonne ajoutée ailleurs, aucune table reconstruite, aucune ligne réécrite.

**Limites connues.** Le rafraîchissement ne lit aucun manifeste : il s'appuie sur la documentation
du repository — que `TASK-000` a pour contrat de renseigner — et sur les commandes déjà validées
par un humain sur d'autres tâches du projet. Deviner les scripts d'un `package.json` reviendrait à
construire un catalogue d'écosystèmes que NOX refuse d'entretenir. Par ailleurs, une dépendance
proposée par le backlog ne peut désigner qu'une tâche du même backlog : une dépendance vers une
tâche **existante** se pose à la main après l'application, avec l'éditeur de TASK-024.

---

## 11. TASK-034 — ergonomie et observabilité, après le premier pilote

`TASK-033` a rendu le workflow plus autonome. Cette tâche traite ce qu'on peut en **voir**, et
uniquement cela : lisibilité des statuts, visibilité du modèle Architecte, utilité d'Inspect Run,
métriques d'activité. Elle ne modifie aucune règle métier — ni file, ni dépendances, ni
complétion, ni livraison, ni rafraîchissement, ni contrat de fournisseur.

**Les statuts se reconnaissent avant d'être lus.** `success` et `info` rejoignent la palette : une
tâche terminée est verte, un blocage et un échec sont rouges, une review est ambre, un brouillon
reste neutre. `accent` — le teal de NOX — ne désigne plus que ce qui se passe en ce moment, ce qui
est exactement ce qu'il fallait pour que « prête », « en cours » et « terminée » cessent de se
ressembler. La couleur n'est jamais seule : chaque pastille rend son libellé. Voir
[D-390](DECISIONS.md) et [D-391](DECISIONS.md).

**Le modèle du prochain appel s'affiche avant le clic.** Conversation projet, génération de
backlog et analyse de review annoncent le modèle résolu, son effort de raisonnement quand NOX en
demande un, et d'où vient cette valeur. La résolution est celle de l'appel lui-même — un test le
vérifie — et l'objet affiché ne porte pas la clé. Aucun sélecteur, aucune page de réglages :
TASK-034 rend visible, elle ne rend pas configurable. Voir [D-392](DECISIONS.md).

**Inspect Run répond à « qu'est-ce que NOX a observé ».** Résumé d'exécution, toutes les
tentatives de validation avec leurs diagnostics, ce que Claude Code a lancé, l'état de livraison
Git, la chaîne de corrections. Rien n'a été produit pour l'occasion : le champ qui expliquait le
`VALIDATION_SPAWN_FAILED` du pilote existait depuis HOTFIX-002 et n'avait aucune surface. La page
reste en lecture seule et ne charge pas le compte rendu final de l'agent. Voir
[D-393](DECISIONS.md).

**L'activité d'un projet se lit en quelques chiffres.** Travail, vérification, décisions humaines,
consommation — chaque nombre est un `count` ou une somme sur des lignes réellement persistées.
Aucun taux d'autonomie n'est calculé : un « 87 % » aurait l'air d'une mesure, se serait fait
citer, et aurait été faux. Un rapport s'écrit en fraction, `null` n'est jamais affiché comme zéro,
et aucun prix n'est estimé. Voir [D-394](DECISIONS.md).

**Un travail validé et sa livraison portent deux pastilles.** `Done` en vert et `Delivery failed`
en rouge se lisent côte à côte : la règle existait depuis TASK-033, l'écran ne la montrait pas.
Voir [D-395](DECISIONS.md).

**Aucune migration.** Toutes les métriques se dérivent de modèles existants ; `migrate diff` rend
une migration vide. Aucune colonne n'a été ajoutée pour l'affichage — ce serait fabriquer une
seconde vérité à côté de celle qui existe, et la première divergence serait invisible.

**Limites connues.** Trois métriques ont été volontairement omises faute de donnée fiable : le
nombre de messages échangés avec l'Architecte n'est pas un indicateur d'autonomie et n'est pas
présenté comme tel ; les jetons ne sont pas ventilés par surface, parce que quatre petits nombres
répondraient moins bien qu'un seul ; et le temps humain n'est mesuré nulle part, ni estimé. Par
ailleurs, la sortie d'une commande de validation reste bornée sans être réécrite : Inspect affiche
exactement les octets que la review affiche déjà, et un outil qui imprime son propre chemin absolu
l'imprime dans les deux.

**Ce qui vient ensuite n'est pas une `TASK-035`.** C'est un second vrai pilote.

---

## 12. HOTFIX-003 — diagnostic d'un appel Architecte, pendant le second pilote

Le second pilote réel, sur TicketPulse, a rencontré une panne reproductible. Deux tours consécutifs
ont échoué sur la même phrase — « la réponse ne respecte pas le format attendu par NOX. Aucune
tâche n'a été créée » — alors que la demande était un ajustement du Living V1 Plan, sans aucune
tâche en jeu.

**Ce que l'enquête a trouvé.** Quatre causes de code distinctes produisent ce message : une réponse
vide ou tronquée, un JSON illisible, un contrat de tour refusé, et une mise à jour de projet
hors budget. Aucune n'était enregistrée. Le seul moyen d'en apprendre davantage aurait été de payer
un troisième appel — c'est-à-dire de racheter un diagnostic qui existait avant le premier.

**Ce qui est corrigé.** `ArchitectGeneration` porte désormais un diagnostic sûr, exactement comme
`ArchitectBacklogGeneration` depuis HOTFIX-001 : catégorie, champ fautif, phrase — et rien du
contenu. Un dépassement de budget devient un code à part, qui dit que relancer n'y changera rien.
Une réponse que le fournisseur déclare incomplète cesse de passer pour une réponse malformée. Et la
phrase d'échec parle enfin de l'opération réellement en cours. Voir [D-396](DECISIONS.md) à
[D-399](DECISIONS.md).

**Ce qui était déjà correct.** Le message soumis survivait déjà à un échec — le brouillon n'est
effacé que lorsque le tour aboutit — et l'empreinte de contexte affichée se comportait exactement
comme prévu : elle couvre le projet, jamais la conversation, donc sa stabilité entre deux messages
est attendue. Les deux sont désormais testés et **dits à l'écran**, plutôt que garantis en
silence. Voir [D-400](DECISIONS.md) et [D-401](DECISIONS.md).

**Le délai n'a pas été changé.** `ARCHITECT_REQUEST_TIMEOUT_MS` vaut 90 s, s'applique par requête,
sans réessai, et est partagé par les quatre surfaces d'appel. L'enquête n'a pas produit de preuve
qu'il soit mal dimensionné : deux dépassements sur une requête large, suivis d'une requête compacte
qui passe, sont compatibles avec un délai trop court **comme** avec une lenteur passagère du
fournisseur. La portée est désormais fixée par des tests ; la valeur attend une observation qui la
départage.

**Migration.** Deux colonnes nullables sur `ArchitectGeneration`, par `ALTER TABLE ADD COLUMN`.
Aucune ligne réécrite : les tours 8 et 9 du pilote restent exactement ce qu'ils étaient, et
afficheront « cause non enregistrée » plutôt qu'une cause reconstruite après coup.

### Ce que le diagnostic a immédiatement révélé

Le pilote a rejoué la demande qui avait échoué deux fois. Le tour 10 a nommé la cause :
`projectUpdate.plan.inScope` refusé pour `too_many`.

**Le validateur bornait chaque liste à vingt entrées, et le prompt ne l'annonçait nulle part.** Il
disait même l'inverse — « rends le plan complet avec cette étape en plus » —, c'est-à-dire
exactement le geste qui franchit la borne sur un plan déjà fourni. Le refus était donc
déterministe, ce qui explique deux échecs consécutifs identiques.

Les instructions annoncent maintenant les bornes, en interpolant la constante que le validateur
utilise ; elles demandent de fusionner plutôt que d'ajouter, et séparent une règle produit durable
d'un détail de spécification. La borne n'a **pas** été relevée : les cinq décisions de TicketPulse
tiennent en deux entrées consolidées, et un plan qui demanderait plus de vingt lignes de périmètre
serait une spécification — laquelle appartient aux tâches. Voir [D-402](DECISIONS.md).

`architect/4` devient `architect/7` et `architect/6` devient `architect/8` : le texte des
instructions a changé, donc l'étiquette aussi. Le **schéma** ne bouge pas, et `readArchitectTurn`
accepte exactement ce qu'il acceptait.

**Une régression d'affichage, trouvée et corrigée dans la foulée.** Les tours 5 et 6, persistés en
`ARCHITECT_TIMEOUT`, s'étaient mis à s'afficher « Panne du fournisseur ». La catégorie regroupe
cinq codes ; l'utiliser comme libellé effaçait ce que la base portait toujours. L'affichage part
désormais du code enregistré. Aucune ligne ancienne n'a été modifiée. Voir
[D-403](DECISIONS.md).

## 13. HOTFIX-004 — attente, arrêt et durée d'un appel Architecte

Le second pilote a continué après HOTFIX-003, et a buté sur ce que le diagnostic ne pouvait pas
réparer : **le délai lui-même**.

### Ce qui a été observé

| Charge de travail | Issue |
| --- | --- |
| Conversation, message volumineux | dépassement de délai, **deux fois** |
| Conversation, message raccourci | aboutit |
| `Generate V1 backlog`, projet complet | dépassement de délai, **deux fois** |

Deux charges de travail sans rapport, quatre dépassements, et une seule réussite — obtenue en
**amputant la demande**. Sur `gpt-5.6-sol` en raisonnement élevé, avec un brief et un plan de V1
substantiels, quatre-vingt-dix secondes ne suffisaient pas.

HOTFIX-003 avait délibérément laissé cette valeur tranquille faute de preuve. La preuve est arrivée.

### Ce qui a changé

**Le délai de quatre-vingt-dix secondes n'existe plus comme échéance de travail.** Il est remplacé
par un plafond de sécurité de dix minutes — la dernière garde contre une requête réellement
bloquée, jamais une durée attendue, et aucun écran ne l'affiche. `NOX_ARCHITECT_TIMEOUT_MS` peut le
déplacer entre une minute et une heure ; toute valeur illisible retombe sur le défaut.

Dix minutes n'est pas une estimation de la durée juste : personne ne la connaît encore. C'est un
ordre de grandeur assez large pour qu'un travail légitime ne le rencontre jamais. Voir
[D-404](DECISIONS.md) et [D-405](DECISIONS.md).

**Ce qui remplace l'échéance supprimée est l'utilisateur.** Le temps écoulé s'affiche pendant
l'appel, et un bouton `Arrêter` interrompt réellement la requête : le signal va jusqu'à la couche
réseau du SDK. Marquer une ligne `CANCELLED` sans cela laisserait le fournisseur travailler et
facturer — c'est exactement ce que faisait un rechargement de page. Voir [D-406](DECISIONS.md).

**L'arrêt conclut la base avant d'abandonner la requête**, et c'est cet ordre qui ferme la course :
une réponse arrivée ensuite trouve une ligne qui n'est plus `RUNNING`, et toute sa transaction est
refusée — messages, mise à jour de projet, replanification, proposition de backlog. Un second clic
est sans effet par le même mécanisme. Voir [D-407](DECISIONS.md).

**Un arrêt n'est pas un échec**, et un plafond atteint reste un délai dépassé. Les quatre causes
séparées par HOTFIX-003 sont intactes ; une cinquième s'y ajoute. Voir [D-408](DECISIONS.md).

**Chaque génération enregistre désormais sa durée.** `ArchitectGeneration` reçoit `finishedAt` — la
seule information qui n'était pas dérivable, et que la planification de backlog possédait déjà. La
durée s'en dérive, et « durée inconnue » n'est pas « zéro ». Voir [D-409](DECISIONS.md).

### Ce que le prochain pilote devrait regarder

Les durées réelles. C'est la raison d'être de la mesure ajoutée ici : le réglage juste du plafond
viendra de ce qui aura été observé, et non d'un second pari. Trois questions valent d'être posées
au retour du pilote — combien de temps prend réellement une planification de backlog complète ;
est-ce que quelqu'un a eu besoin d'`Arrêter` ; est-ce que dix minutes ont jamais été approchées.

Une limite reste connue : le registre des contrôleurs vit en mémoire et ne survit pas à un
redémarrage du serveur web. La ligne, elle, est conclue en base dans tous les cas — mais NOX dira
alors qu'il ne peut pas confirmer avoir fermé la requête, plutôt que de l'affirmer.

## 14. HOTFIX-005 — continuité d'une spécification produit

Le second pilote a continué après HOTFIX-004, et a rencontré un défaut d'**architecture** — le
premier depuis le début des pilotes qui ne soit ni un délai, ni un diagnostic, ni un affichage.

### Ce qui a été observé

TicketPulse a établi, au fil d'une longue conversation Architecte, un contrat d'import Excel
complet : une feuille unique, colonnes identifiées par intitulé exact, quatre colonnes requises,
`CI / Application` pouvant être vide et affichée « Non renseigné », lignes vides et lignes
« Filtres appliqués : » ignorées, espaces de bord retirés, doublons rejetant **toutes** leurs
occurrences, sémantique de mise à jour champ par champ, six champs facultatifs retenus.

`architect/7` **n'a pas** recopié ce détail dans le Living V1 Plan, et il a eu raison : ce sont dix-
neuf règles, et le plan en portait déjà quatre — les y ajouter aurait franchi la borne de vingt.

Puis `BACKLOG-003` a réussi (gpt-5.6-sol, 16 157 jetons, 1 min 58 s, cinq tâches) et a dit
lui-même ce qui lui manquait :

> « Le point restant incertain est le contrat Excel détaillé : la liste complète des intitulés et
> formats réellement observés n'apparaît ni dans le brief ni dans le plan. »

La tâche 2 renvoyait alors aux « intitulés exacts du contrat V1 » — un contrat qu'aucune tâche ne
contenait. Et une décision a été **affaiblie** en étant résumée :

| | |
| --- | --- |
| Décision réelle | un numéro dupliqué fait rejeter **toutes** ses occurrences |
| Tâche générée | les numéros répétés ne doivent pas créer deux incidents |

La seconde autorise à en garder une quand les deux lignes sont identiques. Ce n'est plus la même
règle, et personne ne s'en serait aperçu avant la recette.

### La cause

**La mémoire du projet était déjà la bonne autorité** — durable, bornée, transmise à la
conversation, à la planification et à la replanification, et déjà dans l'empreinte de contexte.
Ce qui manquait n'était pas une couche de persistance : c'était un **chemin**. Aucune ligne de code
ne menait d'une conversation jusqu'à elle, et l'utilisateur devait recopier chaque règle à la main
en le sachant.

### Ce qui a changé

**Un tour peut proposer des règles durables**, au plus huit, dans le champ `projectUpdate.memories`.
Elles sont revues et appliquées par le même geste humain que le brief et le plan, dans la même
transaction. Proposer n'est pas écrire : rien n'entre en mémoire sans un `Apply` explicite. Voir
[D-411](DECISIONS.md) et [D-412](DECISIONS.md).

**Une tâche générée porte les règles exactes** dont son implémenteur aura besoin. `backlog/4`
interdit l'exigence par renvoi et demande la règle exacte plutôt que son résumé — le prompt cite le
cas des doublons comme contre-exemple. Voir [D-413](DECISIONS.md).

**Aucune sélection de pertinence n'a été inventée** : les entrées `ACTIVE` partent toutes, les
`ARCHIVED` ne partent pas. Une façon silencieuse de retirer une règle d'un contexte serait le bug
de HOTFIX-005 réintroduit par l'autre bout. Voir [D-414](DECISIONS.md).

**Le contrat de tour passe en versions 5 et 6**, et le prompt en `architect/9` / `architect/10` :
la forme change cette fois, contrairement à HOTFIX-003 qui n'avait touché qu'aux instructions. Les
générations enregistrées en version 3 restent lisibles sans migration. Voir [D-415](DECISIONS.md).

**La péremption couvre un troisième axe**, la mémoire, comme elle couvrait déjà le brief et le
plan. Voir [D-416](DECISIONS.md).

### La hiérarchie durable, telle qu'elle se lit désormais

```text
Project Brief                  pourquoi, pour qui, quel résultat
Living V1 Plan                 les capacités de la V1        (20 entrées, inchangé)
Mémoire du projet              les règles produit exactes    (48 Kio actifs)
Backlog / replanification      consomment les trois ci-dessus
Contrat d'une tâche            porte les règles exactes dont elle a besoin
Documentation du repository    l'état réellement implémenté
```

### Ce que le prochain pilote devrait regarder

Que l'Architecte propose effectivement des entrées quand une règle est tranchée — c'est la seule
partie du correctif qui dépend du modèle plutôt que du code. Le reste est vérifié par des tests
déterministes ; celle-ci ne peut l'être que par l'usage.

### Reprise — le premier essai réel n'a rien proposé

Le pilote a envoyé le contrat d'import complet en demandant explicitement de l'enregistrer. Le
modèle a répondu qu'il proposait « six entrées consolidées de Project Memory » qui « ne seront
enregistrées qu'après votre validation » — puis a rendu `projectUpdate: null`. Aucune carte, rien à
valider.

**NOX avait raison d'afficher une discussion : c'est exactement ce qu'il avait reçu.** La cause est
dans le contrat lui-même, qui se décrivait comme « mise à jour proposée du Project Brief et du
Living V1 Plan ». Un tour qui ne change ni l'un ni l'autre le met donc à `null`, et emporte les
règles avec lui. HOTFIX-005 avait ajouté `memories` dans ce champ sans corriger ce que ce champ
disait être, et le prompt disait quoi poser sans jamais dire par où.

Le tour 12 est conservé tel quel comme preuve historique : `architect/9`, `CONTINUE`,
`projectUpdate: null`, aucune ligne `ArchitectProjectUpdate`. Voir [D-417](DECISIONS.md).


## 15. HOTFIX-006 — diagnostiquer un échec, et reprendre le travail qu'il laisse

Le second pilote est passé de l'Architecte à l'exécution. `TASK-000` de TicketPulse a tourné
**11 min 24 s** sur **81 tours**, produit **24 fichiers non commités** (+4 101 lignes), puis :

```text
Now the final end-to-end verification run.
Running an allowed command
Bash completed
Finished with an error
Status: Failed
```

### Ce que NOX affichait

`CLAUDE_PROCESS_FAILED`, `exit 1`, un `HEAD` inchangé, et la review du travail partiel. Rien sur ce
qui avait cédé, rien sur la commande tentée, rien sur ce que NOX avait observé juste avant.

Et **une seule action** : `Retry`. Or `Retry` exige un repository propre. Le seul geste proposé
commençait donc par se débarrasser des onze minutes de travail qu'il fallait sauver — en commitant
un travail raté, en le mettant de côté, en le réinitialisant, ou en déboguant à la main. C'est-à-dire
exactement ce que NOX existe pour éviter.

### Deux défauts, une seule cause

| Symptôme | Cause réelle |
| --- | --- |
| Un code opaque | `CLAUDE_PROCESS_FAILED` couvrait trois incidents distincts |
| Une timeline muette | le `detail` des événements d'outil était toujours `null` |
| Aucune reprise possible | `checkResumeCandidate` exigeait `COMPLETED` **et** `REVIEW` |

Le troisième est le plus frappant : **la machinerie de reprise existait déjà en entier**.
`runCorrectionPreflight` acceptait déjà un dossier de travail sale, l'empreinte HMAC de TASK-012
vérifiait déjà que c'était le bon, `--resume` reprenait déjà la session, `parentRunId` enregistrait
déjà la filiation. Il manquait une **porte** : deux conditions de statut, et rien d'autre.

### Ce qui a changé

**Une exécution nomme ce qui a cédé.** `Run.failureCategory` répond à « qu'est-ce qui a cédé »
pendant qu'`errorCode` continue de répondre à « laquelle des erreurs connues ». Un processus jamais
démarré, un processus sorti en code non nul, un agent qui se déclare en erreur et un processus tué
par un signal cessent de se confondre — et un seul des quatre laisse un travail reprenable. Les
exécutions antérieures gardent `NULL` et sont dérivées à la lecture : aucune ligne n'est réécrite.

**`Correct failed run` rejoint `Retry`, et dit en quoi il en diffère.** Le premier continue le
travail partiel dans la même session Claude ; le second repart de zéro. La page d'une exécution en
échec affiche les deux, avec `Mark blocked`, et recommande — sans choisir.

**Un refus de reprise nomme les chemins.** Les empreintes par entrée permettent de dire « README.md
a été modifié depuis » au lieu de « le dossier de travail a changé ». L'empreinte globale reste seule
autorité : la comparaison a lieu après le refus, et ne peut jamais le lever.

**La timeline se laisse interroger.** La ligne complète quand chaque segment est autorisé, la raison
du masquage sinon, la commande à laquelle un résultat répond, le code de sortie **quand le protocole
l'expose** — et « non exposé par le protocole » quand il ne l'expose pas.

### Ce que la première passe ne rattrapait pas, et que la reprise corrige

`TASK-000` était repassée en `READY` — l'utilisateur avait cliqué `Retry`, le seul geste que NOX lui
proposait alors — et une reprise part par définition d'une tâche en échec. Le travail partiel était
resté sur le disque, mais plus aucun écran n'y menait.

La suite du correctif s'est attaquée à la cause de cet état, puis à l'état lui-même.

**`Retry` ne changeait un statut sans jamais vérifier qu'il pouvait partir.** Le geste ne lance
rien : le lancement est une seconde action, sur une autre page, et c'est elle qui exige un
repository propre. Entre les deux, rien ne vérifiait quoi que ce soit.

```text
RUN-001 échoue, 24 fichiers non commités restent
clic sur Retry           →  TASK-000 passe FAILED → READY
tentative de lancement   →  refusée : repository sale
état final               →  READY, aucune exécution, échec inatteignable
```

`FAILED → READY` est désormais précédée d'un contrôle en lecture — repository libre, préflight
satisfait. Un refus n'écrit rien, et le dit : « aucune exécution n'a démarré, la tâche reste en
échec ». Les autres transitions restent des écritures SQLite, runner arrêté compris.

**Une reprise s'ancre à l'exécution, jamais au statut.** Le seul `READY` accepté est celui d'un
`Retry` qui n'a jamais démarré : exécution en échec, rien d'autre depuis, aucune correction déjà
née. Rien n'est assoupli — branche, `HEAD` et empreinte restent vérifiés par le runner.

### Une garde correcte, deux fois, et un écran qui se contredit

Le pilote a ensuite ouvert la page de reprise, et y a lu les deux moitiés d'une contradiction :

```text
« un Retry l'y a menée, mais aucune exécution n'a démarré »   ← reconnu
« Task is in Failed — Blocked »                              ← refusé
« Git branch and HEAD unchanged — Blocked »                  ← jamais vérifié
```

`ResumeCandidate` était rempli à la main sur huit surfaces. Le cycle l'assemblait depuis la base —
`isLatestRun` compris — et la page le réassemblait sans ce champ. Aucune des deux gardes n'était
fausse prise seule : le défaut n'existait qu'à leur jonction, ce qui explique qu'aucun test unitaire
ne l'ait vu.

L'éligibilité vit désormais à **un seul endroit**, lu par l'écran, le bouton et le lancement. Et les
préconditions ont trois états : une question qu'on n'a pas posée ne s'affiche plus comme un refus.

### Ce que le prochain pilote devrait regarder

Que la reprise aboutisse réellement sur un dossier de travail sale, avec un vrai binaire. Tout le
reste est vérifié par des tests déterministes ; celle-ci demande un processus réel.

Voir [D-420](DECISIONS.md), [D-421](DECISIONS.md), [D-422](DECISIONS.md), [D-423](DECISIONS.md),
[D-424](DECISIONS.md), [D-425](DECISIONS.md), [D-426](DECISIONS.md), [D-427](DECISIONS.md).


## HOTFIX-007 — La source d'amorçage arrivait tronquée

Le premier pilote réel a produit un `docs/V1_SCOPE.md` dont la direction technique s'arrêtait sur
`… et applique u…`. Claude n'avait pas fauté : il avait recopié fidèlement ce que la tâche lui
donnait, puis **refusé d'inventer la suite**, et l'avait signalé dans son compte rendu.

La perte venait de NOX, et elle avait trois formes distinctes sur la même tâche :

```text
plan.technicalDirection   653 caractères  → coupée à 600, avec un « … »
plan.inScope              18 éléments     → 12 conservés, 6 disparus sans trace
mémoire (5 entrées sur 6) 445 à 893 car.  → coupées à 400
contexte entier           ~14 000 car.    → coupé à 11 999
```

Le deuxième cas est le plus dangereux : une troncature laisse un point de suspension, une liste
coupée à son douzième élément ne laisse rien. Le quatrième l'est presque autant — cinq sections de
consignes (état du repository, préservation, choix de la pile, installation, responsabilité de
chaque document) ne sont **jamais arrivées** à Claude Code.

### Ce qui a changé

Le rendu de ce qui est contractuel — brief, plan de V1, mémoire active — vit désormais dans un
module qui ne contient aucun raccourcisseur, et dont les fonctions ne prennent aucune chaîne. La
borne du contexte se dérive des bornes métier au lieu d'être choisie ; un état produit hors de ses
bornes est refusé **en nommant le champ**, jamais coupé. Et la fidélité est prouvée sur le contexte
assemblé avant que la tâche ne soit créée.

L'aperçu montre maintenant le contexte complet : il annonçait « voici exactement la tâche qui sera
créée » en omettant sa plus grosse partie.

### La récupération du pilote

`TASK-000` de TicketPulse est en `REVIEW`, avec `RUN-002` terminée. Son contrat porte une source
amputée, mais l'état produit du projet n'a pas bougé depuis sa création — NOX le **prouve** en
rejouant le rendu de l'époque sur les lignes d'aujourd'hui.

Une correction humaine demandée sur `RUN-002` reçoit donc un bloc
`Authoritative bootstrap source supplement` portant les 12 valeurs canoniques manquantes. La tâche
n'est pas modifiée, ses critères non plus, et les prompts de `RUN-001` et `RUN-002` restent des
faits historiques.

### Ce que le prochain pilote devrait regarder

Que la correction de `RUN-002` produise bien un `docs/V1_SCOPE.md` complet, sans que l'utilisateur
ait eu à recopier quoi que ce soit à la main.

Voir [D-428](DECISIONS.md), [D-429](DECISIONS.md), [D-430](DECISIONS.md), [D-431](DECISIONS.md).
