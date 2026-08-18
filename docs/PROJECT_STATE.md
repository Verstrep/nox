# PROJECT_STATE — Ce que NOX sait faire aujourd'hui

> **Rôle de ce document** : l'état réel du produit, capacité par capacité. Ce qui est
> disponible, ce qui ne l'est pas, et sous quelles limites.
>
> Il ne raconte pas comment on en est arrivé là — c'est le rôle de
> [DECISIONS.md](DECISIONS.md) — ni comment le code est organisé — c'est celui de
> [ARCHITECTURE.md](ARCHITECTURE.md). Il ne décrit pas non plus la cible : voir
> [PROJECT_BRIEF.md](PROJECT_BRIEF.md) et [V1_SCOPE.md](V1_SCOPE.md).

**Dernière mise à jour** : 15 août 2026, à l'issue de `TASK-021`.

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

L'Architecte occupe deux rôles distincts : il **converse** — une tâche à la fois, en réponse
à un message — et il **planifie** — un backlog entier, en réponse à l'état du projet. Deux
workflows, deux prompts, deux contrats de sortie ; aucun des deux ne peut déclencher l'autre.

Ce que NOX **ne fait pas**, et n'a jamais prétendu faire : aucun lancement automatique de
Claude Code, aucun passage automatique en `READY`, aucune boucle autonome entre les deux
modèles, aucun réessai caché, aucun résumé silencieux, aucune review déclenchée en
arrière-plan, aucune exécution automatique de l'étape recommandée, aucune mémoire créée
automatiquement, aucun commit, aucun push, aucune estimation de coût, aucun backlog généré
sans clic.

| Chiffre | Valeur |
| --- | --- |
| Workspaces | 4 — `web`, `runner`, `shared`, `database` |
| Modèles Prisma | 20 |
| Migrations appliquées | 15 |
| Routes du runner | 16, dont une seule publique (`GET /health`) |
| Pages de l'application web | 28 |
| Tests automatisés | 3 026, dont 5 ignorés sous Windows |
| Décisions consignées | 290 |

---

## 2. Capacités

Chaque capacité est décrite en trois temps : ce qui est **disponible**, ses **limites**
actuelles, et les **frontières** qu'elle ne franchit jamais.

### 2.1 Projets

**Disponible.** Créer un projet avec un nom et une description, le lister, le consulter.
Suivre son statut parmi `DRAFT`, `ACTIVE`, `PAUSED`, `COMPLETED`, `ARCHIVED`. Associer un
projet à un dossier du poste : NOX vérifie que le chemin existe, que c'est un repository Git,
et affiche sa branche et l'état de son dossier de travail.

**Limites.**

- Aucune suppression de projet. Ni corbeille, ni archivage réel, ni restauration.
- Le chemin d'un repository ne se modifie pas après enregistrement.

**Frontières.** Un chemin absolu ne remonte jamais au navigateur, et le chemin d'un repository
se relit toujours en base à partir de l'identifiant du projet — jamais depuis un formulaire.

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

**Disponible.** Un préflight vérifie que le repository est propre et synchronisé, puis le
prompt — régénéré côté serveur à partir de la tâche en base — est affiché avant lancement. Le
lancement est explicite. Les commandes de validation enregistrées sont autorisées à Claude
Code, une par une et à l'identique. Le runner ne les exécute jamais lui-même.

**Limites.**

- **Une seule exécution active**, tous projets confondus.
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
ne quitte jamais le serveur. Aucun modèle par défaut, aucune URL de base configurable, aucun
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

### 3.4 Ce qui reste à faire

- **Une spécification ne se modifie pas après création.** Un plan vivant suppose de pouvoir
  réécrire ce qui n'a pas encore été lancé.
- **Aucune dépendance entre tâches**, aucune replanification structurée.
- **Aucun amorçage d'un projet vide.**
- **Aucune file d'exécution.** Les tâches d'un backlog se lancent une par une.

Voir [ROADMAP.md](ROADMAP.md), `TASK-023` à `TASK-026`.

---

## 4. Ce qui n'existe pas

Aucun de ces éléments n'est commencé. Les lister évite de les croire disponibles.

**Conception et planification.** Amorçage d'un projet vide, dépendances entre tâches,
modification d'une spécification après création, replanification depuis la conversation,
ajout d'une tâche vierge dans une revue de backlog, ordre global entre tâches existantes et
nouvelles, historique de versions du Project Brief ou du Living V1 Plan, matérialisation
automatique de l'état structuré en Markdown, extraction automatique de mémoire depuis une
proposition de projet ou un backlog, déduplication sémantique entre tâches.

**Exécution.** File d'exécution, plusieurs agents en parallèle, worktrees, plusieurs comptes
Claude, exécution automatique de l'étape recommandée, cron, scheduler, notifications,
orchestration parallèle, runner multi-projets.

**Livraison.** Commit, push, génération d'un message de commit ou d'une PR, restauration Git.

**Interface.** Tableau de bord d'un projet, tableau de bord multi-projets, indicateur
« prochaine étape » ailleurs que sur la page d'une tâche, suppression de projet ou
d'exécution, archivage, corbeille, renommage, déplacement, suppression en masse.

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

---

## 6. Dette technique transverse

Les limites propres à une capacité sont dans sa section. Celles-ci n'appartiennent à aucune.

1. **Pas de test de rendu React.** La couverture est assurée par les tests unitaires, un test
   d'intégration réel et des tests fonctionnels HTTP en mode production.
2. **Les Server Actions ne sont pas couvertes par un test fonctionnel HTTP.** Les tests
   fonctionnels appellent les mêmes fonctions serveur qu'elles ; les pages, elles, sont bien
   lues par HTTP. Leurs règles sont couvertes par des tests unitaires, leur câblage par le
   build.
3. **Cinq tests sont ignorés sous Windows** : quatre portent sur les liens symboliques de
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

---

## 7. État Git

- Aucun commit, aucun push, aucun `git add` effectué par Claude Code.
- Historique Git non modifié.
- Commit de départ de `TASK-020` : `e6b4c89` (`docs: consolidate NOX project documentation`),
  contenant `TASK-018`. `TASK-019` a été volontairement sautée : l'audit de `TASK-018` a conclu
  qu'une tâche de nettoyage dédiée n'était pas justifiée.
- `TASK-020` reste **locale**, non indexée et non commitée.
