# NOX

**Orchestration du développement assisté par IA.**

NOX est une application personnelle qui relie la conception d'un projet à son implémentation.
Elle permet de formaliser un besoin dans des documents Markdown, de le découper en petites
tâches, d'envoyer ces tâches à Claude Code, d'exécuter les validations et de relire le résultat
— sans copier-coller manuel entre la conversation de conception et l'agent d'implémentation.

> ⚠️ **Projet en cours de développement.** Le socle technique est en place ; les
> fonctionnalités décrites ci-dessus ne sont pas encore implémentées.

## État actuel

Dernière étape terminée : **TASK-014 — conversation Architecte persistante et évolution explicite du contexte**.

| Élément | État |
| --- | --- |
| Monorepo npm workspaces | ✅ fonctionnel |
| Persistance locale (Prisma + SQLite) | ✅ fonctionnelle |
| Création / liste / consultation d'un projet | ✅ fonctionnelles |
| API HTTP locale du runner, authentifiée | ✅ fonctionnelle |
| Validation d'un repository Git par le runner | ✅ fonctionnelle |
| Inventaire et lecture des documents Markdown | ✅ fonctionnels |
| Modification d'un document Markdown existant | ✅ fonctionnelle |
| Création d'un document Markdown | ✅ fonctionnelle |
| Backlog, création et suivi des tâches | ✅ fonctionnels |
| Document Markdown d'une tâche (`tasks/TASK-xxx.md`) | ✅ fonctionnel |
| Préflight Git et détection de Claude Code | ✅ fonctionnels |
| Lancement manuel de Claude Code sur une tâche | ✅ fonctionnel |
| Suivi d'une exécution et persistance de son résultat | ✅ fonctionnels |
| Suppression d'un document Markdown | ✅ fonctionnelle |
| Suppression d'une tâche sans exécution | ✅ fonctionnelle |
| Streaming des événements, annulation d'une exécution | ✅ fonctionnels |
| Review Git intégrée et validations structurées | ✅ fonctionnelles |
| Feedback de review et reprise ciblée d'une session Claude | ✅ fonctionnelles |
| Architecte OpenAI : contexte contrôlé, proposition de tâche | ✅ fonctionnel |
| Conversation Architecte multi-tours, contexte comparé entre deux tours | ✅ fonctionnelle |
| Renommage, déplacement d'un document | ⬜ non commencés |
| Archivage, suppression d'une tâche avec exécutions | ⬜ non commencés |
| Édition, suppression, archivage d'un projet | ⬜ non commencées |
| Review Architecte assistée d'un run Claude | ⬜ non commencée |
| Tests / lint / typecheck / build | ✅ passent |

Détail complet : [docs/PROJECT_STATE.md](docs/PROJECT_STATE.md).

## Convention de langue de l'interface

NOX est une interface **française**. Une exception, volontairement étroite : les
**micro-éléments techniques** s'affichent en anglais.

| En anglais | En français |
| --- | --- |
| Badges de statut : `Draft`, `Ready`, `Running`, `Review`, `Done` | Navigation, titres et sous-titres |
| Badges de synchronisation : `Pending`, `Synced`, `Error`, `Conflict` | Descriptions et textes explicatifs |
| Badges de priorité : `Low`, `Medium`, `High`, `Critical` | Libellés et aides des formulaires |
| Actions compactes : `Edit`, `Save`, `Cancel`, `Delete`, `Retry` | Avertissements et confirmations |
| Transitions : `Mark ready`, `Approve`, `Reopen`, `New run` | Messages d'erreur détaillés |

Ces étiquettes se lisent d'un coup d'œil et portent les mêmes noms que les valeurs internes
qu'elles désignent : `READY` en base s'affiche `Ready`. Les phrases, elles, restent dans la
langue où l'on pense la nuance. D'où des mélanges assumés :

```text
État de la tâche : Ready
Priorité : High
```

**Aucune valeur interne n'a changé.** Les statuts stockés en base, les contrats web ↔ runner et
les documents Markdown déjà générés sont inchangés — seul l'affichage est traduit.

## Prérequis

- **Node.js ≥ 22.18.0** — requis pour l'exécution native des fichiers TypeScript par le runner
  en mode développement (`node --watch src/index.ts`).
- **npm ≥ 10** — les workspaces natifs sont utilisés.
- **Git**.

Vérifier les versions installées :

```powershell
node --version
npm --version
```

## Installation

```powershell
git clone <url-du-repository> nox
cd nox
npm install
```

`npm install` déclenche le script `prepare`, qui compile `packages/shared` et génère le client
Prisma. Les deux sont des artefacts dérivés : ils ne sont pas versionnés.

Il reste ensuite à créer la base locale :

```powershell
npm run db:migrate
```

## Configuration : le jeton du runner

NOX est composé de **deux processus** : l'application web et le runner local. Le runner exécute
Git sur votre machine ; l'application web l'appelle en HTTP sur la boucle locale. Cet appel est
authentifié par un jeton partagé, **obligatoire**.

Créez le fichier de configuration à partir de l'exemple :

```powershell
Copy-Item .env.example .env
```

Générez ensuite un jeton et collez-le dans `.env` :

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Variante PowerShell native, si vous préférez ne pas passer par Node :

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RNGCryptoServiceProvider]::new().GetBytes($bytes)
($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
```

Le `.env` doit alors contenir :

```env
NOX_RUNNER_HOST=127.0.0.1
NOX_RUNNER_PORT=4310
NOX_RUNNER_URL=http://127.0.0.1:4310
NOX_RUNNER_TOKEN=<votre-jeton-genere>
```

Points importants :

- **Le runner et l'application web doivent utiliser exactement la même valeur.** Un seul `.env`,
  à la racine, est lu par les deux — il n'y a rien à synchroniser tant que vous ne le dupliquez
  pas.
- **Le runner refuse de démarrer sans jeton.** Il n'en génère jamais automatiquement : une
  valeur différente à chaque lancement empêcherait le web de s'y connecter.
- **Le runner refuse d'écouter ailleurs que sur la boucle locale.** Il exécute des commandes sur
  votre machine ; l'exposer au réseau reviendrait à offrir cette capacité à quiconque l'atteint.
- Le fichier `.env` n'est pas versionné. Ne partagez jamais la valeur réelle de votre jeton.

## Configuration : l'Architecte OpenAI

L'Architecte est **facultatif**. Sans lui, NOX fonctionne exactement comme avant : vous écrivez
vos tâches à la main. Avec lui, vous décrivez une intention et il propose une tâche structurée que
vous relisez avant de la créer.

Deux variables, toutes deux obligatoires pour générer :

```env
NOX_OPENAI_API_KEY=<votre-cle-openai>
NOX_ARCHITECT_MODEL=<identifiant-de-modele>
```

Points importants :

- **La clé s'appelle `NOX_OPENAI_API_KEY`, et pas `OPENAI_API_KEY`.** Ce n'est pas un détail : le
  runner retire de l'environnement de Claude Code **toutes** les variables commençant par `NOX_`.
  Nommée ainsi, la clé est hors de portée de l'agent par construction, sans qu'aucune règle
  supplémentaire ait à être écrite — ni oubliée.
- **Aucun modèle par défaut.** NOX n'en choisit jamais un en silence : ce serait choisir un coût et
  une disponibilité à votre place. Sans `NOX_ARCHITECT_MODEL`, la page Architecte reste
  consultable et le contexte reste inspectable ; seule la génération est bloquée.
- **Aucune URL de base configurable.** NOX envoie du contexte projet ; pouvoir rediriger cet envoi
  vers une adresse arbitraire ouvrirait un canal d'exfiltration pour un gain nul.
- **Redémarrez l'application web** après avoir modifié ces variables : elles sont lues au
  démarrage.
- La clé n'atteint jamais le navigateur, n'est jamais écrite en base, et n'apparaît dans aucun
  message d'erreur.

## Base de données locale

NOX stocke ses données dans une base **SQLite** locale, gérée par Prisma.

| | |
| --- | --- |
| Fichier | `data/nox-dev.db`, à la racine du repository |
| Schéma | [packages/database/prisma/schema.prisma](packages/database/prisma/schema.prisma) |
| Migrations | `packages/database/prisma/migrations/` — versionnées dans Git |
| Client généré | `packages/database/src/generated/prisma/` — **non** versionné |

Le chemin du fichier est résolu à partir de la racine du monorepo, pas du répertoire courant :
les commandes Prisma, les scripts npm et l'application Next.js visent donc toujours la même
base. La variable `NOX_DATABASE_URL` permet d'en viser une autre (voir `.env.example`).

### Commandes

```powershell
# Créer la base et appliquer les migrations (première utilisation, ou après un changement de schéma)
npm run db:migrate

# Appliquer les migrations existantes sans en créer de nouvelle
npm run db:deploy

# Régénérer le client Prisma (fait automatiquement par npm install et npm run build)
npm run db:generate

# Explorer et modifier les données dans le navigateur
npm run db:studio
```

### Repartir d'une base vide

Il n'existe volontairement aucune commande qui supprime la base : l'opération est manuelle.

```powershell
Remove-Item data\nox-dev.db
npm run db:migrate
```

> Cette commande supprime **uniquement** la base locale de développement. Elle ne touche à aucun
> repository, ni au code, ni aux migrations.

## Commandes disponibles

Toutes les commandes se lancent depuis la racine du repository.

| Commande | Effet |
| --- | --- |
| `npm run dev:web` | Démarre l'application web sur `http://localhost:3000` |
| `npm run dev:runner` | Démarre le runner en mode surveillé sur `http://127.0.0.1:4310` |
| `npm run start:runner` | Démarre le runner compilé (nécessite `npm run build` au préalable) |
| `npm run build` | Génère le client Prisma puis compile tous les workspaces |
| `npm run build:shared` | Compile uniquement le package partagé |
| `npm run build:database` | Compile uniquement le package d'accès aux données |
| `npm run test` | Lance les tests (`node --test`) |
| `npm run lint` | Analyse ESLint de l'ensemble du repository |
| `npm run typecheck` | Vérifie le typage de tous les workspaces |
| `npm run db:migrate` | Crée la base locale et applique les migrations |
| `npm run db:deploy` | Applique les migrations existantes |
| `npm run db:generate` | Régénère le client Prisma |
| `npm run db:studio` | Ouvre Prisma Studio |
| `npm run runner:health` | Vérifie que le runner est joignable |

## Lancer l'application web

```powershell
npm run dev:web
```

Puis ouvrir <http://localhost:3000>. Le tableau de bord liste les projets enregistrés en base.
Les sections « Socle en place » et « Prochaines grandes étapes » restent des repères statiques
sur l'avancement du produit.

## Créer un premier projet

1. Démarrer le runner : `npm run dev:runner` (premier terminal).
2. Démarrer l'application : `npm run dev:web` (second terminal).
3. Ouvrir <http://localhost:3000>. L'en-tête doit afficher **Runner disponible**.
4. Cliquer sur **Nouveau projet**.
5. Renseigner un nom, éventuellement une description, et le **chemin absolu** d'un repository
   Git déjà présent sur cette machine — par exemple `D:\Projets\mon-projet`.
6. Valider. Le runner vérifie le chemin, puis l'application redirige vers la page du projet.

Ce qui se passe à la validation :

- l'application web appelle `POST /repositories/resolve` sur le runner ;
- le runner exécute `git -C <chemin> rev-parse --show-toplevel`, en lecture seule ;
- la **racine** du repository est enregistrée, pas le chemin saisi — un sous-dossier est donc
  accepté et ramené à sa racine ;
- sont refusés : chemin relatif, inexistant, pointant vers un fichier, hors repository Git, ou
  déjà enregistré.

NOX ne clone rien, ne lit aucun fichier du repository et n'exécute aucune commande qui le
modifierait. Seul le chemin est stocké.

**Sans runner démarré**, l'interface reste utilisable : la liste des projets et les pages projet
s'affichent normalement, et le formulaire reste accessible. Seule la soumission échoue, avec un
message indiquant qu'il faut démarrer le runner.

### Limites actuelles de la gestion des projets

| Possible aujourd'hui | Pas encore possible |
| --- | --- |
| Créer un projet | Modifier un projet existant |
| Lister les projets | Supprimer ou archiver un projet |
| Consulter la page d'un projet | Changer son statut |
| | Sélectionner un dossier via une boîte de dialogue |

Le statut d'un projet est toujours `DRAFT` : les transitions viendront avec la gestion des
tâches. Pour retirer un projet créé par erreur, passer par `npm run db:studio`.

## Consulter les documents d'un projet

Depuis la page d'un projet, la carte **Documents** indique le nombre de fichiers Markdown
détectés et mène à `/projects/<id>/documents`.

La page présente la liste à gauche et le lecteur à droite. Sélectionner un document met son
chemin dans l'URL (`?path=docs%2FPROJECT_BRIEF.md`) : le lien est partageable, le bouton
« précédent » du navigateur fonctionne, et un rechargement conserve le document ouvert.

### Emplacements inspectés

NOX **ne parcourt pas tout le repository**. Il inspecte uniquement :

| Emplacement | Contenu retenu |
| --- | --- |
| Racine | `README.md`, `CLAUDE.md`, `AGENTS.md` — et rien d'autre |
| `docs/` | tous les `.md`, récursivement |
| `decisions/` | tous les `.md`, récursivement |
| `plans/` | tous les `.md`, récursivement |
| `tasks/` | tous les `.md`, récursivement |

Sont toujours ignorés : `node_modules/`, `.git/`, `.next/`, `dist/`, `build/`, `coverage/`,
`out/`, `vendor/`, les fichiers non `.md`, et les liens symboliques (jamais suivis).

Les autres Markdown de la racine — `CHANGELOG.md`, `CONTRIBUTING.md`, `LICENSE.md`… — sont
volontairement écartés : ils encombreraient un inventaire destiné au pilotage du projet.

### Catégories et ordre

Chaque document reçoit une catégorie déduite de son **chemin** uniquement, jamais de son
contenu :

| Catégorie | Origine |
| --- | --- |
| **Principal** | Documents de référence reconnus : `README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/PROJECT_BRIEF.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`… |
| **Documentation** | Autres fichiers de `docs/` |
| **Décision** | Fichiers de `decisions/` |
| **Plan** | Fichiers de `plans/` |
| **Tâche** | Fichiers de `tasks/` |

La liste est triée par catégorie, puis par chemin dans l'ordre alphabétique (insensible à la
casse et aux accents).

### Limites

| Limite | Valeur | Comportement au dépassement |
| --- | --- | --- |
| Taille d'un document | 1 Mio | Le document n'est pas lu ; la liste continue de l'afficher |
| Nombre de documents | 500 | L'inventaire est refusé plutôt que tronqué silencieusement |
| Profondeur de parcours | 6 niveaux | Les fichiers plus profonds sont ignorés |

Les fichiers sont lus en **UTF-8 strict** : un fichier binaire renommé en `.md` est rejeté avec
un message clair plutôt qu'affiché corrompu.

### Affichage brut

Le contenu est affiché brut, sans rendu HTML du Markdown : les `#` et les `**` restent
visibles. NOX relit le fichier à chaque affichage — ce qui est à l'écran est ce qui est sur le
disque.

### Erreurs courantes

| Symptôme | Cause | Correction |
| --- | --- | --- |
| « Inventaire indisponible » + « Runner indisponible » | Le runner n'est pas démarré | `npm run dev:runner` dans un second terminal |
| « Le repository de ce projet est introuvable » | Le dossier a été déplacé ou supprimé depuis son enregistrement | Remettre le dossier en place, ou recréer le projet |
| « Aucun document Markdown » | Le repository n'a rien dans les emplacements inspectés | Vérifier le tableau ci-dessus |
| « Ce document n'existe plus » | Fichier supprimé ou renommé entre la liste et l'ouverture | Recharger la page |
| « Ce document dépasse la taille maximale lisible » | Fichier > 1 Mio | L'ouvrir dans votre éditeur |
| « Ce fichier n'est pas du texte UTF-8 valide » | Fichier binaire ou encodage exotique | Le convertir en UTF-8 |

La page d'un projet reste toujours accessible sans runner : les informations issues de SQLite
(nom, description, statut, chemin, dates) s'affichent normalement, seule la carte Documents
signale l'indisponibilité.

## Modifier un document

Ouvrez un document, puis cliquez sur **Edit**. Le contenu s'affiche dans une zone de texte
monospace ; **Save** l'écrit, **Cancel** revient à la lecture.

### L'écriture agit directement dans le repository

Enregistrer **modifie le fichier réel** sur votre disque, immédiatement. NOX ne conserve
aucune copie, ne crée aucun commit et ne fait aucune sauvegarde de l'ancienne version : c'est
Git qui joue ce rôle. Un `git diff` après enregistrement montre exactement ce qui a changé.

Seuls les documents **déjà existants** sont modifiables. NOX ne crée, ne supprime, ne renomme
et ne déplace aucun fichier.

### Si le fichier a été modifié ailleurs

À l'ouverture, NOX retient une empreinte du contenu du fichier. À l'enregistrement, il la
compare à l'état réel du disque. Si le fichier a changé entre-temps — modifié dans VS Code,
mis à jour par un `git pull` — l'écriture est **refusée** :

> Ce document a été modifié depuis son ouverture. Votre texte est conservé ci-dessous :
> rechargez la version actuelle du fichier, puis reportez-y vos modifications.

Votre texte reste dans le formulaire, et un bouton propose de recharger la version actuelle.
Il n'existe volontairement **aucun bouton pour écraser** : personne ne peut décider d'écraser
sans avoir vu ce qui a changé, et NOX n'affiche pas encore de comparaison.

### Ce que NOX préserve

| Élément | Comportement |
| --- | --- |
| Encodage | UTF-8. Aucun BOM ajouté ; un BOM déjà présent est conservé. |
| Fins de ligne | Celles du fichier existant. Un fichier en LF reste en LF, un fichier en CRLF reste en CRLF. |
| Fin de fichier | Aucun saut de ligne ajouté ni retiré. |
| Permissions | Reprises du fichier remplacé. Aucun fichier ne devient exécutable. |
| Autres fichiers | Aucun autre fichier n'est touché. |

L'écriture passe par un fichier temporaire du même dossier, puis remplace la cible : une
coupure en cours d'écriture ne laisse jamais un document à moitié écrit, et aucun fichier
temporaire ne subsiste.

### Limites de l'édition

- **Taille maximale : 1 Mio**, mesurée sur les octets UTF-8 réellement écrits.
- **Aucune sauvegarde automatique.** Rien n'est écrit tant que vous n'avez pas cliqué sur
  Enregistrer.
- **Aucun brouillon.** Le texte n'est conservé ni en base, ni dans le navigateur.
- **Annuler n'écrit rien** et demande confirmation si le texte a changé.
- **Aucun aperçu Markdown**, aucune comparaison visuelle, aucun historique.

### Erreurs d'enregistrement

| Message | Cause | Correction |
| --- | --- | --- |
| « Ce document a été modifié depuis son ouverture » | Le fichier a changé sur le disque | Recharger la version actuelle, puis reporter vos modifications |
| « Ce document est un lien symbolique » | La cible est un lien, pas un fichier réel | Modifier directement le fichier pointé |
| « Ce document dépasse la taille maximale » | Contenu > 1 Mio | Scinder le document |
| « L'enregistrement a échoué et le document n'a pas été modifié » | Fichier verrouillé par un autre programme | Fermer le programme, puis réessayer |
| « Le runner local ne répond pas » | Runner arrêté | `npm run dev:runner`, puis réessayer — votre texte est conservé |
| « Cette page d'édition n'est plus à jour » | Onglet resté ouvert trop longtemps | Recharger la page |

Dans tous ces cas, **le fichier sur le disque n'a pas été modifié** et le texte saisi reste
dans le formulaire.

## Créer un document

Depuis la page Documents d'un projet, cliquez sur **Nouveau document**. Choisissez une
destination, saisissez un nom de fichier, éventuellement un contenu initial, puis **Créer le
document**.

### Les cinq destinations

| Destination | Emplacement | Exemple |
| --- | --- | --- |
| Document principal | racine, liste fermée | `README.md`, `CLAUDE.md`, `AGENTS.md` |
| Documentation | `docs/` | `docs/PRODUCT_VISION.md` |
| Décision | `decisions/` | `decisions/ADR-004-database.md` |
| Plan | `plans/` | `plans/CURRENT_PLAN.md` |
| Tâche | `tasks/` | `tasks/TASK-007.md` |

Le préfixe est affiché à côté du champ mais ne se saisit pas : c'est le serveur qui recompose le
chemin final à partir de la destination choisie. À la racine, seuls les trois documents reconnus
par NOX sont proposés, et uniquement ceux qui n'existent pas déjà.

### Les dossiers parents doivent exister

NOX **ne crée aucun dossier**. `docs/guides/INSTALLATION.md` n'est acceptée que si `docs/guides/`
existe déjà. Sinon, créez le dossier dans votre explorateur ou votre éditeur, puis réessayez.

Cette limite est volontaire : sans elle, une faute de frappe (`docs/guiides/`) créerait une
arborescence permanente que rien n'effacerait ensuite.

### Un fichier existant n'est jamais remplacé

Si un document occupe déjà l'emplacement demandé, la création est refusée et le message propose
d'**ouvrir le document existant**. C'est le chemin correct : l'éditeur vous montre le contenu
actuel avant que vous n'écriviez par-dessus.

La protection tient même si le fichier apparaît pendant la création — un `git pull` en
parallèle, par exemple. NOX utilise une création exclusive : le système crée le fichier ou
échoue, sans étape intermédiaire.

### Règles de nommage

Le nom doit se terminer par `.md`. Il n'est **jamais corrigé automatiquement** : un nom sans
extension est refusé avec un message, pas complété en silence.

Sont refusés, pour que le repository reste clonable partout :

- les caractères `< > : " | ? *` ;
- les noms réservés de Windows : `CON`, `PRN`, `AUX`, `NUL`, `COM1` à `COM9`, `LPT1` à `LPT9`,
  avec ou sans extension ;
- un espace ou un point en fin de nom — Windows les tronque en silence.

Les espaces, tirets, underscores, accents et parenthèses sont acceptés : `docs/étude
détaillée.md` est un nom parfaitement valide.

### Limites de la création

- **Taille maximale : 1 Mio**, comme à l'édition, mesurée sur les octets UTF-8 écrits.
- **Contenu initial facultatif** : un document vide est accepté, vous le remplirez ensuite.
- **Modifiable immédiatement** : le document créé apparaît aussitôt dans la liste et s'ouvre
  dans l'éditeur sans rechargement manuel.
- **Aucun modèle, aucun contenu généré.** Ce que vous saisissez est ce qui est écrit.
- **Annuler n'écrit rien** et demande confirmation si le formulaire a été rempli.

### Erreurs de création

| Message | Cause | Correction |
| --- | --- | --- |
| « Un document existe déjà à cet emplacement » | Le fichier est déjà là | Ouvrir l'existant, ou choisir un autre nom |
| « Le dossier indiqué n'existe pas » | Dossier parent manquant | Le créer d'abord — NOX n'en crée aucun |
| « Ce dossier ne peut pas être utilisé […] : c'est un lien » | Un parent est un lien symbolique | Viser le dossier réel |
| « Ce nom de fichier ne serait pas utilisable sur tous les systèmes » | Caractère interdit ou nom réservé | Renommer |
| « Le nom doit se terminer par .md » | Extension absente | Ajouter `.md` |
| « Inutile de répéter `docs/` » | Le préfixe a été saisi deux fois | Ne saisir que la partie sous le dossier |

Dans tous ces cas, **aucun fichier n'est créé** et le formulaire conserve destination, nom et
contenu.

## Supprimer un document

Sur un document ouvert, le bouton **Delete** ouvre une confirmation qui rappelle le nom du
fichier et son chemin relatif. Un second clic supprime.

### Ce que la suppression fait, et ne fait pas

- **Le fichier est retiré du repository**, directement. NOX n'en conserve aucune copie.
- **Aucun commit n'est créé.** Vérifiez le changement avec `git status` avant de valider
  définitivement votre travail. Si le fichier était déjà versionné, Git pourra le restaurer
  (`git restore <chemin>`) ; sinon, il est **définitivement perdu**.
- **Aucun dossier n'est supprimé**, même devenu vide. `docs/` appartient à la structure du
  repository, pas au document qui s'y trouvait.
- **Un seul fichier à la fois.** Ni suppression récursive, ni sélection multiple, ni corbeille.
- **Un lien symbolique est refusé.** NOX ne supprime que des fichiers réels, pour que le fichier
  qui disparaît ne soit jamais une surprise.

### Le contrôle de révision

Comme à l'enregistrement, NOX compare l'empreinte du fichier sur le disque à celle qu'il vous a
affichée. Si le document a changé entre-temps — modifié dans VS Code, par exemple — **la
suppression est refusée** et le fichier reste intact.

> Ce document a été modifié depuis son affichage. Rechargez sa version actuelle avant de le
> supprimer.

Il n'existe **aucun bouton pour forcer** : personne ne peut décider de supprimer une version
qu'il n'a pas vue. Rechargez la page, relisez, puis décidez.

### Les documents protégés

Les fichiers `tasks/TASK-001.md`, `tasks/TASK-002.md`… n'ont **pas** de bouton Delete. Ils
appartiennent à une tâche NOX : les supprimer ici laisserait la tâche sans son document, sans que
rien ne l'enregistre. Passez par **Delete task** sur la page de la tâche, qui supprime les deux
ensemble.

Cette protection vit dans le runner, pas seulement dans l'interface : un appel direct à l'API est
refusé avec `DOCUMENT_PROTECTED`, quelle que soit l'orthographe du chemin.

Les **autres** fichiers de `tasks/` — `tasks/NOTES.md`, par exemple — restent des documents
ordinaires, supprimables comme les autres.

### Erreurs de suppression

| Message | Cause | Correction |
| --- | --- | --- |
| « Ce document a été modifié depuis son affichage » | Le disque a changé | Recharger, relire, puis décider |
| « Ce document appartient à une tâche NOX » | Chemin `tasks/TASK-xxx.md` | Utiliser **Delete task** |
| « Ce document n'existe plus dans le repository » | Déjà supprimé ailleurs | Recharger la liste |
| « La suppression a échoué et le document est toujours présent » | Fichier verrouillé | Le fermer, puis réessayer |
| « Le runner local ne répond pas » | Runner arrêté | Le démarrer, puis réessayer |

Dans tous ces cas, **aucun fichier n'est supprimé**.

## Créer et suivre des tâches

Depuis la page d'un projet, **Voir les tâches** ouvre le backlog
(`/projects/[id]/tasks`) ; **Nouvelle tâche** ouvre le formulaire.

Une tâche NOX n'est pas un titre dans une liste : elle doit contenir assez d'informations pour
qu'un agent de développement puisse travailler sans avoir vu la conversation qui l'a produite.

### Les champs d'une tâche

| Champ | Obligatoire | Limite | Rôle |
| --- | --- | --- | --- |
| Titre | oui | 160 caractères | Une phrase, pas un identifiant |
| Priorité | oui | — | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| Objectif | oui | 5 000 caractères | Ce que la tâche doit rendre possible |
| Contexte | non | 10 000 caractères | Ce qu'un agent doit savoir de l'état actuel |
| Hors périmètre | non | 5 000 caractères | Ce qui ne doit surtout pas être fait |
| Documents à lire | non | 100 × 500 caractères | Chemins relatifs, un par ligne |
| Critères d'acceptation | **au moins un** | 100 × 1 000 caractères | Un par ligne |
| Commandes de validation | non | 50 × 1 000 caractères | Une par ligne, **jamais exécutées** |

Les trois listes se saisissent une entrée par ligne : les lignes vides sont ignorées, l'ordre de
saisie est conservé, et les documents en double sont retirés en gardant la première occurrence.

Les chemins de documents ne sont **pas vérifiés comme existants** : une tâche peut légitimement
référencer un fichier qui sera créé avant son exécution. Seule leur forme est contrôlée — pas de
chemin absolu, pas de `..`.

### Le code d'une tâche

Chaque tâche reçoit un code de la forme `TASK-001`, attribué automatiquement et **immuable**. Le
compteur appartient au projet : deux projets numérotent indépendamment, à partir de 1.

Un numéro n'est **jamais réutilisé**. Si une création échoue après réservation, le numéro reste
inutilisé et le suivant est attribué. Un trou dans la numérotation est normal — il vaut mieux
qu'un identifiant qui aurait déjà circulé dans un commit ou dans un log.

### Statuts et transitions

| Statut | Affiché | Sens | Transitions manuelles possibles |
| --- | --- | --- | --- |
| `DRAFT` | `Draft` | Brouillon, statut initial | `Mark ready`, `Mark blocked` |
| `READY` | `Ready` | Prête à être implémentée | `Back to draft`, `Mark blocked`, `Mark done` |
| `BLOCKED` | `Blocked` | Bloquée par autre chose | `Back to draft`, `Mark ready` |
| `COMPLETED` | `Done` | Travail accepté | `Reopen` |
| `REVIEW` | `Review` | Exécution réussie, à relire | `Approve`, `Reopen` |
| `FAILED` | `Failed` | Exécution échouée | `Retry`, `Mark blocked` |
| `RUNNING` | `Running` | Exécution en cours | aucune |

`RUNNING`, `FAILED` et `REVIEW` n'ont **aucune entrée** manuelle : ils sont posés par une
exécution de Claude Code, et les rendre sélectionnables laisserait annoncer un état que rien n'a
produit. Ils ont en revanche une **sortie** manuelle — c'est bien vous qui décidez d'accepter un
travail relu ou de le remettre en file.

### Le document Markdown associé

Chaque tâche possède un fichier `tasks/<code>.md` dans le repository — par exemple
`tasks/TASK-001.md`. Le titre n'entre **pas** dans le nom du fichier : il évoluera, le chemin
non.

Le document contient l'objectif, le contexte, les documents à lire, les critères d'acceptation,
les commandes de validation, le hors-périmètre et un rappel des règles d'exécution. Il ne
contient **ni statut, ni priorité, ni date** : ces valeurs changent sans que la spécification
change, et les y inscrire remplirait l'historique Git de modifications qui n'apprennent rien.

Le dossier `tasks/` est créé automatiquement s'il manque — c'est le seul dossier que NOX crée.
S'il est occupé par un fichier ou par un lien, la création est refusée : NOX ne renomme rien.

> **Limite actuelle** : la base est la source de vérité. Modifier `tasks/TASK-001.md` à la main
> ne met pas à jour la tâche dans NOX. La page de détail le rappelle.

### État de synchronisation

| État | Sens | Que faire |
| --- | --- | --- |
| Document à créer | La tâche existe, son fichier pas encore | Réessayer |
| Document synchronisé | Le fichier correspond à la spécification | Rien |
| Document non créé | La création a échoué (runner arrêté, droits, disque) | Réessayer |
| Emplacement occupé | Un fichier **différent** occupe déjà ce chemin | L'ouvrir, puis trancher |

### Si le runner est arrêté

La tâche est **quand même enregistrée**. NOX crée d'abord la tâche en base, puis tente
d'écrire son document : la seconde étape peut échouer sans remettre la première en cause.

La page de détail affiche alors « Document non créé » et un bouton **Réessayer la création du
document**. Démarrez le runner, cliquez, c'est réglé — rien n'a été ressaisi.

La reprise est sûre à répéter :

- si le fichier n'existe pas, il est créé ;
- s'il existe et que son contenu correspond **exactement** au document attendu, il est adopté
  tel quel, sans réécriture ;
- s'il existe et diffère, la tâche passe en conflit et le fichier n'est **pas** touché.

Il n'existe aucun bouton pour forcer un écrasement. Un fichier différent à cet emplacement est
le travail de quelqu'un — ou de quelque chose — d'autre, et c'est à vous de décider.

### Supprimer une tâche

La section **Supprimer la tâche**, en bas de la page, propose un bouton **Delete task**. La
confirmation rappelle le code, le titre et le chemin du document, puis demande de **recopier le
code exact** — `TASK-001` — avant d'activer le bouton final. Recopier oblige à lire ce qu'on
supprime, ce qu'un « Êtes-vous sûr ? » n'obtient de personne.

Une suppression retire **la tâche, ses critères, ses documents à lire, ses commandes de
validation et son fichier `tasks/TASK-xxx.md`**. Aucun commit n'est créé.

#### Une tâche avec exécutions n'est pas supprimable

Dès qu'une tâche possède **au moins une exécution** — quel que soit son statut, y compris
annulée ou échouée — le bouton disparaît et une explication prend sa place :

> Cette tâche possède un historique d'exécution. Elle ne peut pas être supprimée. Une
> fonctionnalité d'archivage sera ajoutée séparément.

Une exécution est un fait : elle a consommé du quota, modifié un repository et produit un compte
rendu. La supprimer effacerait la trace de ce qui s'est réellement passé. **Aucune exécution
n'est jamais supprimée par NOX**, et une contrainte de la base l'empêche même si on contourne
l'interface.

#### Le numéro n'est jamais réattribué

Supprimer `TASK-001` ne libère pas le numéro. Si le compteur du projet en était à 4, la tâche
suivante sera `TASK-004`.

```text
TASK-001 supprimée          →  prochaine tâche : TASK-004
```

Un trou dans la numérotation ne gêne personne ; un identifiant réutilisé désignerait deux
travaux différents dans Git, dans un log et dans une conversation.

#### L'ordre : le fichier, puis la base

NOX supprime **d'abord** le document Markdown, **ensuite** la tâche en base. Si le runner est
arrêté, **rien n'est supprimé** — ni le fichier, ni la ligne — et vous pouvez réessayer après
l'avoir démarré.

Cet ordre n'est pas arbitraire : les deux systèmes ne partagent aucune transaction, et l'un des
deux échouera un jour entre les deux étapes. Une tâche dont le document a disparu est visible et
se répare d'un second clic ; un fichier orphelin que plus rien ne désigne ne se retrouve jamais.

### Ce que NOX ne fait pas encore

- **Une spécification ne se modifie pas après création** : ni le titre, ni l'objectif, ni les
  listes. Seul le statut change.
- Ni renumérotation, ni duplication, ni dépendances entre tâches.
- Ni archivage, ni suppression d'une tâche possédant un historique d'exécution.

## Lancer une tâche dans Claude Code

Depuis la page d'une tâche **Ready**, le bouton **New run** ouvre la page de lancement. C'est le
seul endroit d'où NOX démarre Claude Code, et c'est toujours vous qui cliquez : rien n'est
déclenché automatiquement.

### Prérequis

NOX utilise l'installation de Claude Code **déjà présente sur votre machine**, avec
**l'authentification que vous y avez déjà configurée**.

> NOX ne demande, ne stocke et ne transmet **aucune clé d'API Anthropic**. Si vous pouvez lancer
> `claude` dans un terminal, NOX le peut aussi. Si vous ne le pouvez pas, NOX ne le pourra pas
> non plus, et il vous le dira au lieu de vous réclamer une clé.

Vérifiez d'abord que l'outil répond :

```bash
claude --version
```

Trois variables facultatives règlent le comportement, dans le `.env` de la racine :

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `NOX_CLAUDE_EXECUTABLE` | `claude` | Nom ou chemin de l'exécutable. Un `claude.cmd` Windows est géré. |
| `NOX_CLAUDE_MAX_TURNS` | `80` | Nombre maximal de tours, borné entre 1 et 500. |
| `NOX_CLAUDE_TIMEOUT_MINUTES` | `120` | Délai maximal, borné entre 1 et 600. |

Une valeur hors bornes **empêche le runner de démarrer**, avec un message qui dit laquelle : elle
n'est jamais rabotée en silence.

### Commitez et poussez avant de lancer

Claude Code modifie **directement** votre repository local. NOX refuse de lancer si :

- le repository contient des modifications non commitées ;
- `HEAD` est détaché ;
- la branche courante n'a pas d'upstream ;
- la branche est en avance ou en retard sur sa référence distante connue.

Ces refus ne sont pas de la rigidité administrative : sans un état de départ propre, il devient
impossible de distinguer ce que l'agent a changé de ce qui traînait déjà, et la relecture perd
tout son sens.

> **Sur l'avance et le retard** : NOX compare votre branche à la référence distante **telle que
> votre machine la connaît**, c'est-à-dire depuis votre dernier `git fetch`. Il ne contacte pas
> le serveur distant, et ne prétend donc pas garantir que votre branche est à jour vis-à-vis de
> lui.

### La page de préparation

Elle montre, avant tout lancement :

- **le prompt exact** qui sera envoyé, et son empreinte SHA-256 ;
- **les commandes qui seront autorisées** — uniquement celles enregistrées avec la tâche ;
- **l'état du repository** : branche, upstream, `HEAD`, propreté, avance et retard ;
- **la version de Claude Code** détectée ;
- **la liste des préconditions**, chacune cochée ou non.

Le prompt n'est pas modifiable pendant TASK-008. Une exécution doit rester reproductible, et le
prompt stocké doit correspondre à la tâche telle qu'elle est écrite.

### Ce que Claude Code a le droit de faire

| Autorisé | Refusé |
| --- | --- |
| Lire, chercher, modifier et créer des fichiers | Créer un commit, pousser, changer de branche |
| `git status`, `git diff`, `git log`, `git show` | `git reset`, `git checkout`, `git clean`, `git rebase`, `git merge` |
| Les commandes de validation **enregistrées avec la tâche**, à l'identique | `rm`, `del`, `Remove-Item`, `curl`, `wget` |

Une commande de validation qui ne peut pas être représentée exactement — parce qu'elle contient
un opérateur de chaînage, une redirection ou un guillemet — **bloque le lancement**. NOX ne
l'élargit pas pour la faire passer : corrigez-la dans la tâche.

`--dangerously-skip-permissions` n'est **jamais** passé, et les variables `NOX_*` sont retirées
de l'environnement du processus : l'agent ne peut ni lire le jeton du runner, ni joindre la base.

### Pendant l'exécution : l'activité en direct

La page du run affiche une section **« Activité Claude Code »** qui se remplit pendant que
l'agent travaille :

```text
01:28:03  Started
01:28:04  Claude Code ready
01:28:05  Reading tasks/TASK-001.md
01:28:09  Reading README.md
01:28:14  Editing README.md
01:28:22  Running npm run test
01:28:29  Validation succeeded
01:28:40  Assistant message
01:30:01  Completed
```

Chaque ligne porte l'heure, ce qui s'est passé, et parfois un détail. La liste défile toute seule
tant que vous restez en bas ; dès que vous remontez pour relire un événement, elle vous laisse
tranquille et reprend si vous redescendez.

#### Ce qui est affiché

| Action de Claude Code | Ce que vous voyez |
| --- | --- |
| Lecture d'un fichier | `Reading docs/ARCHITECTURE.md` |
| Recherche | `Searching for "renderTaskMarkdown"` |
| Modification | `Editing README.md` · `Writing apps/web/lib/runs.ts` |
| Commande de validation | `Running npm run test`, puis `Validation succeeded` ou `failed` |
| Autre commande autorisée | `Running an allowed command` |
| Message public de l'agent | son texte, borné |
| Fin | `Completed`, `Cancelled`, `Failed`… |

#### Ce qui est volontairement masqué

NOX ne vous montre **jamais** :

- **le raisonnement interne du modèle** — les blocs de réflexion sont ignorés avant même d'être
  lus ; ils ne sont ni stockés, ni journalisés, ni résumés ;
- **le contenu des fichiers** lus ou écrits ;
- **la sortie des outils** — seule l'issue est conservée : réussi, échoué ;
- **les chemins absolus** de votre machine : `D:\Projets\Dev\nox\README.md` devient
  `README.md`, et un chemin hors du repository devient `<chemin externe>` ;
- **vos secrets** : toute variable `NOX_*`, valeur comme nom, est retirée ;
- **les commandes non autorisées** : une commande n'est reproduite que si elle correspond mot pour
  mot à une commande de validation que vous avez enregistrée, ou à une commande Git en lecture
  seule. Sinon vous lisez `Running an allowed command`.

Ce n'est pas de la pudeur : ces lignes traversent votre navigateur, et un jour peut-être une
capture d'écran.

#### Si l'exécution est très bavarde

Au-delà de 2 000 événements, NOX cesse d'en enregistrer et ajoute une ligne unique :

```text
TRUNCATED — Certains evenements intermediaires n'ont pas ete conserves.
```

Les changements de statut, les erreurs et le compte rendu final continuent d'être conservés. NOX
continue par ailleurs de lire la sortie de Claude Code : arrêter de la lire figerait l'agent au
milieu de son travail.

#### Fermer l'onglet, et revenir

**Vous pouvez fermer l'onglet.** Claude Code continue dans le runner. À la réouverture, NOX
récupère les événements produits pendant votre absence et vous les affiche : rien n'est perdu.

Si le flux en direct tombe — proxy, extension, coupure —, un avertissement discret apparaît avec
un bouton **`Reconnect`**. Les événements déjà reçus restent affichés, et NOX continue par
ailleurs de vérifier si l'exécution s'est terminée.

**Redémarrer le runner, en revanche, interrompt le suivi.** Les événements déjà enregistrés
restent visibles, mais ceux qui n'avaient pas encore été observés sont perdus. NOX marque
l'exécution bloquée et vous invite à vérifier le repository vous-même — il ne prétend pas
connaître le résultat d'un processus qu'il a cessé de suivre.

**Une seule exécution à la fois**, tous projets confondus.

### Interrompre une exécution

Pendant qu'un run est actif, la page propose **`Cancel run`**. La confirmation prévient :

> Interrompre Claude Code peut laisser des modifications partielles dans le repository. NOX ne
> restaurera aucun fichier automatiquement.

Deux boutons : **`Keep running`** pour renoncer, **`Cancel run`** pour confirmer.

Après confirmation, l'exécution passe immédiatement à **`Cancelling…`**. NOX demande poliment au
processus de s'arrêter, lui laisse cinq secondes, puis l'arrête de force — lui **et ses processus
descendants**. Un second clic est refusé : l'arrêt est déjà engagé.

Une fois le processus fermé :

| | |
| --- | --- |
| Exécution | `Cancelled` |
| Tâche | `Blocked` |

**NOX ne restaure rien.** Pas de `git reset`, pas de `git restore`, aucun fichier supprimé. Claude
Code a peut-être écrit la moitié d'un fichier : c'est exactement ce que vous devez pouvoir relire
pour décider quoi en faire.

> L'exécution a été annulée. Claude Code peut avoir laissé des modifications partielles. Vérifiez
> `git status` et `git diff` avant de remettre la tâche en Ready.

La tâche passe à `Blocked` et non à `Ready` : c'est vous qui décidez, après avoir regardé, que le
repository est dans un état d'où l'on peut repartir. La transition `Blocked → Ready` reste
manuelle, et un nouveau lancement exigera de toute façon un repository propre et synchronisé.

**Si l'annulation arrive trop tard** — Claude Code a fini pendant que vous cliquiez —, l'exécution
reste `Completed` et NOX vous le dit. Un travail réellement terminé n'est jamais réétiqueté en
annulé.

**Si un commit interdit a été créé avant l'arrêt**, c'est cela qui prime : l'exécution est
`Failed` avec `GIT_POLICY_VIOLATION`, même si vous aviez demandé l'annulation. Vous devez
apprendre d'abord qu'un commit existe.

**Si NOX ne parvient pas à constater l'arrêt**, l'exécution est `Blocked` et le message le dit
franchement : le processus peut encore être en train d'écrire.

### Le résultat

| Issue | Exécution | Tâche |
| --- | --- | --- |
| Terminée sans erreur | `Completed` | `Review` |
| Erreur du processus ou sortie illisible | `Failed` | `Failed` |
| Limite Claude, délai dépassé, suivi perdu | `Blocked` | `Blocked` |
| Interrompue par vous | `Cancelled` | `Blocked` |

Une réussite mène à **`Review`**, jamais directement à `Done` : un résultat de Claude Code est un
travail à relire, pas un travail validé. C'est vous qui l'acceptez, et cette acceptation ne crée
aucun commit.

La page affiche le compte rendu de l'agent, la durée, le nombre de tours, le coût **rapporté par
Claude Code** — « non fourni » quand l'outil ne le communique pas, jamais une estimation —, les
fichiers modifiés, `git diff --stat`, et la confirmation que `HEAD` n'a pas bougé.

La timeline **complète** ce compte rendu, elle ne le remplace pas : elle dit ce que l'agent a
fait, le compte rendu dit ce qu'il en pense. Et pour voir ce qu'il a réellement **produit**, un
bouton **`Review changes`** ouvre la review détaillée.

## Relire le travail : `Review changes`

Une fois l'exécution terminée, sa page propose **`Review changes`**. C'est là que se relit le
travail, sans quitter NOX.

### Un instantané, pas une vue du présent

Le point le plus important de cette page tient en une phrase : **elle ne relit pas votre dossier
de travail.** Le diff a été capturé au moment précis où l'exécution s'est terminée, et il ne
bouge plus.

C'est voulu, et c'est ce qui la rend utile. Vous allez relire, puis corriger — c'est le but. Si
NOX recalculait le diff à chaque affichage, votre première correction changerait rétroactivement
ce que l'agent est censé avoir produit, et rien ne vous le signalerait. Une review qui se réécrit
toute seule est pire qu'aucune review.

Concrètement : éditez un fichier dans votre éditeur, rechargez la page — la review est identique.
Elle raconte le passé, `git status` raconte le présent, et les deux sont utiles.

### Le résumé

```text
3 files changed
+42 / -11

Validations: Passed

1 sensitive file hidden
1 truncated patch
```

Des faits, jamais une note. Vous ne verrez ni « Quality: 87 % » ni « Confidence: 94 % » : NOX ne
sait pas juger votre code, et un score fabriqué serait lu comme une évaluation par la seule
personne qui, elle, sait juger.

### Les validations

Une ligne par commande déclarée dans la tâche :

```text
Passed   npm run test      exit 0   12s
Failed   npm run lint      exit 1
Not run  npm run build
```

| État | Ce qu'il veut dire |
| --- | --- |
| `Passed` | lancée par Claude Code, sans erreur |
| `Failed` | lancée, résultat en erreur |
| `Not run` | **jamais lancée** — une information, pas un trou |
| `Unknown` | lancée, mais sans issue propre exploitable |

Une commande est reconnue même quand Claude Code la lance derrière son répertoire de travail —
`cd "D:/mon/depot" && git diff --check` compte bien comme `git diff --check`. En revanche, la
correspondance reste exacte : `git diff --check --cached` est une autre commande, et une ligne
portant un tuyau, une redirection ou un point-virgule n'est pas reconnue du tout.

Une commande peut parfaitement être à la fois une commande Git et une validation : c'est **votre**
liste qui décide, jamais une classification automatique.

**NOX ne relance aucune commande.** Ce tableau décrit ce que Claude Code a réellement exécuté
pendant son run, pas ce qu'on obtiendrait en relançant maintenant. Relancer doublerait le temps de
validation, ouvrirait une seconde surface d'exécution de commandes, et surtout testerait l'état du
disque **d'aujourd'hui** — pas celui de la fin de l'exécution.

`Not run` est donc une information de premier ordre : elle dit que la tâche n'a pas été validée
comme elle devait l'être.

Quand la commande a produit une sortie exploitable, un extrait borné est affiché sous elle. C'est
la seule sortie d'outil que NOX conserve, et seulement pour une commande que **vous** avez
enregistrée mot pour mot.

### Les fichiers et leur diff

Une liste à gauche, le diff à droite. Les marqueurs reprennent le vocabulaire de `git status` :

```text
M  apps/web/lib/runs.ts
A  apps/web/lib/review.ts
D  ancien-module.ts
R  nouveau-nom.md
?  brouillon.md
```

`?` désigne un fichier **non suivi** — créé par l'agent et pas encore ajouté à l'index. NOX ne
lance jamais `git add` : ces fichiers apparaissent quand même, parce que ce sont souvent les plus
intéressants à relire.

Le fichier sélectionné est porté par l'URL (`?file=...`), donc partageable et rechargeable.

### Ce qui n'est pas affiché, et pourquoi

**Un fichier sensible** — `.env`, `.env.local`, `*.pem`, `*.key`, `id_rsa`, `id_ed25519`,
`credentials.json`, `secrets.json` :

```text
Sensitive file — content hidden
```

Son chemin, son type de changement et ses statistiques restent visibles : savoir que `.env` a été
modifié est exactement ce qu'il faut apprendre. Seul son contenu disparaît — il n'a rien à faire
dans une page web, ni dans une capture d'écran. `.env.example` et `.env.sample` font exception :
ils existent pour être lus.

Ce n'est pas un détecteur de secrets. NOX n'analyse pas le contenu de vos fichiers pour deviner ce
qu'ils cachent — un tel détecteur produirait surtout des faux positifs et donnerait l'illusion
d'une protection qu'il ne peut pas tenir.

**Un fichier binaire** :

```text
Binary file changed
```

Aucun contenu binaire n'entre en base. Un diff binaire n'est lisible par personne, et NOX n'a pas
vocation à devenir une copie de votre repository.

**Un diff trop volumineux** :

```text
Diff truncated
```

Les bornes : 200 fichiers, 256 Kio par patch, 4 Mio et 20 000 lignes par exécution. Une limite
atteinte **ne fait jamais échouer l'exécution** : la liste complète des fichiers reste affichée,
et `git diff --stat` reste disponible. Relisez le fichier concerné avec `git diff`.

### Le diff est du texte, et rien d'autre

Un patch vient de votre repository : il peut contenir une balise `<script>`, du Markdown, des
séquences ANSI. NOX l'affiche **littéralement**, sans rien interpréter — pas de rendu HTML, pas de
Markdown, pas de couleurs ANSI, pas de lien cliquable, pas d'image.

Les signes `+` et `-` restent dans le texte, en plus de la couleur : celle-ci disparaît à
l'impression, ne se prononce pas pour un lecteur d'écran, et ne se distingue pas pour tout le
monde.

### Les exécutions antérieures

Les runs lancés avant l'arrivée de cette page n'ont pas d'instantané :

```text
Detailed review unavailable for this legacy run.
```

NOX **ne reconstruit pas** leur diff depuis votre repository actuel : il vous donnerait le diff
d'aujourd'hui en le présentant comme celui d'une exécution passée. Leur compte rendu, leurs
fichiers modifiés et leur `git diff --stat` restent consultables sur la page de l'exécution.

Même message si le runner a redémarré avant que NOX ait pu récupérer l'instantané : ce qui n'a pas
été observé ne sera pas inventé.

### Une exécution annulée ou échouée

La review fonctionne aussi pour elles, avec un avertissement :

```text
Partial changes
```

> Cette exécution a été interrompue. Les changements affichés peuvent être partiels : NOX n'a
> restauré aucun fichier.

C'est souvent le cas le plus utile : voir ce qu'un agent interrompu a laissé derrière lui.

### Accepter ou rejeter : `Approve` / `Request changes` / `Reopen`

Quand la tâche est en `Review`, la page propose trois boutons.

| Bouton | Effet |
| --- | --- |
| `Approve` | `Review` → `Done` |
| `Request changes` | ouvre la saisie d'un feedback, puis une page de préparation |
| `Reopen` | `Review` → `Ready` |

**Aucun des trois ne touche à Git.** Pas de commit, pas de `git add`, pas de push, pas de
restauration. Accepter une review veut dire « j'ai relu, ça me convient » — pas « enregistre-le pour
moi ». Le commit reste votre geste, dans votre terminal, avec le message que vous choisissez.

`Request changes` et `Reopen` rejettent tous les deux le travail, et c'est là que s'arrête la
ressemblance :

- **`Request changes`** demande à *la même session Claude* de corriger, à partir de votre feedback,
  en conservant ce qui est déjà correct. Le repository reste tel quel — il *doit* rester tel quel.
- **`Reopen`** remet simplement la tâche à `Ready`. Vous reprenez la main : c'est vous qui déciderez
  quoi faire du repository avant un futur lancement. NOX ne le nettoie pas, et la vérification
  préalable refusera de partir tant qu'il sera sale — ce qui est la bonne façon de l'apprendre.

## Demander une correction : `Request changes`

C'est ce qui évite de tout réexpliquer à une conversation neuve.

### Écrire le feedback

Un seul champ. Claude Code reprendra la session de cette exécution : il connaît déjà la tâche, les
fichiers, et ce qu'il a produit. Inutile de tout réécrire — dites ce qui ne va pas.

```text
La deuxième phrase du README doit être plus courte. Ne touche pas au reste.
```

Jusqu'à 16 Kio. Accents, listes, extraits de code : tout est conservé tel quel. Le bouton
`Prepare correction` **ne lance rien** — il enregistre votre texte et ouvre la page suivante.

### La page de préparation

Elle montre la source, votre feedback, les préconditions vérifiées à l'instant par le runner, et le
**prompt exact** qui partira. Rien ne démarre avant `Resume Claude Code`.

```text
✓ Task is in Review
✓ Source run completed
✓ Claude session available
✓ Review snapshot available
✓ Git branch and HEAD unchanged
✓ Repository matches reviewed state
✓ Claude Code available
```

### Le repository doit être *exactement* celui que vous avez relu

C'est la condition la moins intuitive, et la plus importante.

Une correction part d'un repository **sale** — le travail relu n'a été ni commité ni restauré, c'est
tout l'intérêt. Mais un seul dossier de travail sale est acceptable : celui de la review.

Si vous avez modifié un fichier entre-temps, NOX refuse :

> Le repository a changé depuis cette review. NOX ne peut pas attribuer sûrement ces modifications au
> run précédent. Rétablissez exactement l'état relu, ou lancez une nouvelle exécution après avoir
> remis Git dans un état propre.

Pourquoi tant de sévérité ? Parce que sans cette règle, Claude reprendrait sa session sur un état
qu'il n'a jamais produit, et la review suivante mélangerait votre travail et le sien sans qu'on
puisse les démêler.

**Il n'existe aucun bouton « continuer quand même »**, et il n'en existera pas. Un forçage
transformerait une garantie en suggestion.

Le contrôle porte sur le contenu réel des fichiers, pas sur leur liste : rééditer une ligne sans
changer le nombre de lignes est détecté. Il est refait **juste avant** le lancement — entre
l'affichage vert et votre clic, un enregistrement a pu se glisser.

### Le run de correction

C'est une exécution à part entière : son propre numéro, son propre prompt, sa propre timeline, ses
propres validations, sa propre review. `Cancel run` fonctionne comme d'habitude.

```text
TASK-006
 ├── RUN-001  travail initial
 └── RUN-002  correction de RUN-001
```

**RUN-001 n'est jamais modifié.** Sa review reste consultable, identique à ce qu'elle était.

La review de RUN-002 montre l'état **complet** du dossier de travail depuis le dernier commit —
travail initial et correction confondus. C'est voulu : rien n'a été commité entre les deux, et la
question posée est « qu'est-ce que j'accepte maintenant ? ».

Vous pouvez enchaîner : `RUN-001 → RUN-002 → RUN-003`. Chaque correction reprend la session de
l'exécution que vous venez de relire, et demande un nouveau feedback — écrit après avoir regardé ce
qu'a produit la précédente.

### Votre feedback n'est pas une instruction privilégiée

Le texte est transmis à Claude entre des marqueurs explicites, et les règles de NOX sont rappelées
après lui. Mais l'essentiel est ailleurs : **les permissions ne dépendent pas de ce que vous
écrivez**. Elles sont calculées à partir des commandes de validation de la tâche, comme pour un run
initial.

Un feedback qui demanderait « lance git push » ou « lis .env » sera transmis tel quel — c'est votre
texte — et n'obtiendra rien de plus : `git push` reste refusé, `.env` reste hors des outils
autorisés, et `--dangerously-skip-permissions` n'est jamais passé.

### Ce que NOX ne fait pas

- Aucun feedback généré automatiquement : c'est vous qui écrivez.
- Aucune correction sans clic.
- Aucune session choisie ailleurs que dans le run que vous relisez.
- Aucun commit, aucun push, aucun `git add`, aucune restauration.
- Les exécutions antérieures à cette fonctionnalité ne sont pas reprenables : NOX n'a pas enregistré
  l'empreinte de leur dossier de travail, et en reconstituer une aujourd'hui décrirait le présent en
  prétendant décrire le passé.

### En cas de limite Claude

NOX détecte prudemment les limites d'utilisation. Quand il en repère une, l'exécution est
bloquée et le message vous invite à relancer plus tard. **Aucune heure de réinitialisation n'est
affichée** : NOX ne la connaît pas, et une heure inventée serait pire qu'aucune. Si l'erreur est
ambiguë, NOX affiche une erreur générique plutôt que d'affirmer une limite qui n'existe peut-être
pas.

### Si l'exécution enfreint les règles

Un commit créé malgré l'interdiction, un changement de branche : NOX le **constate** et marque
l'exécution en échec. Il ne répare rien — pas de `reset`, pas de `restore`. Réparer
automatiquement détruirait justement ce que vous devez relire pour comprendre ce qui s'est
passé.

### Les tests n'appellent jamais Claude

Aucun test automatisé de NOX ne lance le vrai Claude Code : la suite utilise un faux exécutable
qui imite son contrat, y compris son flux `stream-json` — sessions complètes, flux abîmés,
blocs de réflexion, secrets, sorties énormes, processus descendants, et un mode qui modifie
réellement un repository temporaire pour éprouver la review. Elle ne consomme donc aucun quota et
ne dépend d'aucun réseau.

## Concevoir une tâche : `Architect`

Depuis la page d'un projet, `Architect` ouvre la liste des conversations.

```text
Nouvelle conversation
      ↓
Votre message
      ↓
Review context       ← aucun appel au fournisseur
      ↓
Send to Architect    ← un clic, un appel
      ↓
Réponse, questions, ou proposition
      ↓
  ⟳  autant de tours que nécessaire
      ↓
Relecture et édition humaines
      ↓
Create task          → tâche en brouillon, conversation close
```

### Une conversation, pas un formulaire

La conception d'une fonctionnalité se fait rarement d'un coup. L'architecte peut répondre par une
recommandation et deux questions plutôt que par une tâche approximative ; vous répondez dans le
composer, comme dans une discussion normale.

Une proposition **ne clôt pas** la discussion. Si vous la trouvez trop grosse, dites-le : le tour
suivant en produira une autre, et l'ancienne restera consultable. Seule la plus récente peut être
créée — et plus du tout si vous avez écrit quelque chose depuis, parce qu'elle ne tient alors plus
compte de ce que vous venez de dire.

La conversation vit **chez vous**, dans SQLite. Elle repart en entier à chaque tour, et OpenAI n'en
conserve rien. Elle reste donc lisible après un changement de modèle, après un redémarrage, et même
si plus aucune réponse n'est récupérable chez le fournisseur.

### Deux modèles, deux rôles

NOX utilise deux modèles qui ne se parlent jamais.

| | Architecte | Implémenteur |
| --- | --- | --- |
| Fournisseur | OpenAI | Claude Code |
| Rôle | proposer **une** tâche | modifier le repository |
| Accès au disque | aucun | oui, via le runner |
| Accès à Git | aucun | lecture seule |
| Outils | **aucun** | ceux que la tâche autorise |

Entre les deux, il y a vous.

### Ce qui est envoyé, et ce qui ne l'est jamais

Avant chaque appel, `Review context` affiche exactement ce qui quittera votre machine : votre
message, les documents inclus avec leurs révisions courtes et leurs tailles, les documents absents,
le nombre de tâches récentes, la taille du transcript et le modèle utilisé. Un dépliant montre le
**texte exact**.

| Envoyé | Jamais envoyé |
| --- | --- |
| `CLAUDE.md`, `AGENTS.md` | tout fichier `.env` |
| six documents `docs/` nommés | code source |
| spécification des 10 dernières tâches | diffs Git, patches de review |
| vos messages et les réponses de l'architecte | prompts, timelines et sorties de Claude Code |
| | clé d'API, jeton du runner, chemins absolus |

La colonne de droite n'est pas une liste de filtres : ces éléments **ne sont jamais candidats**.
Le constructeur de contexte ne connaît que huit chemins et une table de tâches.

Les documents volumineux sont coupés en gardant leur **début et leur fin**, avec une marque
explicite au milieu — pour un fichier comme `DECISIONS.md`, le début porte les conventions et la
fin les décisions récentes.

### Un clic, un appel

Aucun appel n'est déclenché par l'ouverture d'une page, la saisie d'un champ, un minuteur ou un
échec précédent. **Presser Entrée n'envoie rien** : il faut relire le contexte, puis cliquer.

En cas d'erreur — quota, délai dépassé, panne —, NOX affiche le message, garde votre brouillon et
vous propose de relancer : c'est vous qui recliquez. NOX ne réessaie jamais tout seul, et un
message n'entre dans la conversation que si le tour a réellement abouti — vous ne verrez jamais
votre message affiché deux fois parce qu'il n'était pas parti.

Une conversation accepte au plus **vingt tours**, échecs compris, et un seul à la fois.

### Quand le projet change entre deux tours

Le contexte est comparé à celui du tour précédent, et NOX vous dit ce qui a bougé :

```text
docs/ARCHITECTURE.md    19ab8c3f2d41 → 91fe7b0a5c62    Modified
TASK-014                                               Added to recent context
```

Des faits sûrs, jamais un diff de contenu : NOX ne conserve pas le texte des documents envoyés, et
ne prétend donc pas savoir ce qui a changé dedans.

Si le projet change **après** votre aperçu et avant votre clic — un fichier enregistré entre-temps
—, l'envoi est refusé et aucun jeton n'est consommé. Relisez le contexte mis à jour, puis renvoyez.
Il n'existe pas de bouton pour passer outre : ce serait vider l'aperçu de son sens.

### Rien n'est résumé en silence

Le transcript entier part à chaque tour. NOX ne coupe pas les premiers messages, ne fait aucun
résumé automatique, et n'utilise aucune fenêtre glissante — une décision prise au deuxième message
peut être essentielle au quinzième.

Quand la conversation atteint sa borne, NOX le dit et vous invite à en ouvrir une nouvelle. C'est
moins pratique qu'un oubli silencieux, et beaucoup plus honnête.

### Questions et précisions

Si une décision structurante manque, l'architecte répond par des **questions** plutôt que par une
tâche approximative. Répondez dans le champ prévu, puis cliquez `Generate again` : la nouvelle
génération reçoit votre demande, les questions précédentes, vos réponses et le contexte actuel.

### La proposition

Chaque champ est modifiable : titre, priorité, objectif, contexte, critères, hors périmètre,
documents, commandes de validation. Les **hypothèses** de l'architecte sont affichées à part —
elles servent à votre relecture, pas à la spécification.

`Create task` crée la tâche par le même chemin qu'une création manuelle : même numéro, même
document `tasks/TASK-xxx.md`, même statut **brouillon**. Aucune exécution Claude Code ne démarre,
et la mettre en file reste une décision séparée.

Une conversation ne crée **qu'une** tâche. Une fois créée, la conversation passe en lecture seule :
l'historique et la proposition restent consultables, et `Start new conversation` en ouvre une autre.

### Conversations d'avant TASK-014

Les demandes créées par la version précédente de l'Architecte restent consultables — leur demande,
leurs précisions, leurs générations, leur consommation, leur proposition et leur tâche. Elles ne se
poursuivent pas : elles n'ont jamais enregistré de messages, et NOX préfère le dire plutôt que
d'inventer des tours qui n'ont pas eu lieu.

### Consommation

Chaque génération affiche `Usage reported by OpenAI` : jetons d'entrée, de sortie, total, et part
servie par le cache. Une valeur que le fournisseur ne rapporte pas s'affiche « non fourni ».

**NOX n'estime aucun coût en euros ou en dollars.** Un prix dépend du modèle, du palier et de la
date ; un chiffre affiché ici serait faux à la première grille tarifaire modifiée, et un chiffre
faux sur une facture est pire que pas de chiffre du tout. Consultez le tableau de bord de votre
fournisseur.

## Lancer le runner

Dans un second terminal :

```powershell
npm run dev:runner
```

Sortie attendue :

```text
[nox-runner] v0.1.0 - etat RUNNING
[nox-runner] En ecoute sur http://127.0.0.1:4310
[nox-runner] Sonde de sante : http://127.0.0.1:4310/health
[nox-runner] Routes sensibles protegees par NOX_RUNNER_TOKEN.
```

Le port est configurable ; l'hôte doit rester une adresse de boucle locale :

```powershell
$env:NOX_RUNNER_PORT = "4400"
npm run dev:runner
```

Le runner s'arrête proprement sur `Ctrl+C` (`SIGINT`) ou sur `SIGTERM`.

L'application web et le runner tournent en parallèle, dans deux terminaux. Ils ne sont pas
lancés ensemble : le runner peut être redémarré sans toucher au web, et inversement.

## API du runner

| Route | Méthode | Authentification | Rôle |
| --- | --- | --- | --- |
| `/health` | `GET`, `HEAD` | aucune | Sonde de disponibilité |
| `/repositories/resolve` | `POST` | `Bearer` obligatoire | Racine Git d'un chemin local |
| `/repositories/documents/list` | `POST` | `Bearer` obligatoire | Inventaire des Markdown reconnus |
| `/repositories/documents/read` | `POST` | `Bearer` obligatoire | Contenu et révision d'un document autorisé |
| `/repositories/documents/update` | `POST` | `Bearer` obligatoire | Remplace un document existant, après contrôle de révision |
| `/repositories/documents/create` | `POST` | `Bearer` obligatoire | Crée un document (`201`), sans jamais écraser ni créer de dossier |
| `/repositories/tasks/create-document` | `POST` | `Bearer` obligatoire | Crée `tasks/<code>.md` (`201`), en créant `tasks/` s'il manque |
| `/claude/preflight` | `POST` | `Bearer` obligatoire | Vérifie l'état Git et la présence de Claude Code, en lecture seule |
| `/claude/runs/start` | `POST` | `Bearer` obligatoire | Lance Claude Code (`202`), sans attendre la fin |
| `/claude/runs/status` | `POST` | `Bearer` obligatoire | État d'une exécution, depuis le registre en mémoire |

### Tester `/health`

Le plus simple :

```powershell
npm run runner:health
```

Ou directement :

```powershell
Invoke-RestMethod http://127.0.0.1:4310/health | ConvertTo-Json
```

Réponse attendue :

```json
{
  "service": "nox-runner",
  "status": "ok",
  "version": "0.1.0"
}
```

### Tester la route protégée

`/repositories/resolve` exige le jeton. En PowerShell, en le lisant depuis `.env` pour ne jamais
l'afficher à l'écran :

```powershell
$token = (Select-String -Path .env -Pattern '^NOX_RUNNER_TOKEN=(.*)$').Matches.Groups[1].Value
$body = @{ repositoryPath = "D:\Projets\mon-projet" } | ConvertTo-Json

Invoke-RestMethod -Method Post http://127.0.0.1:4310/repositories/resolve `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" -Body $body
```

Réponse attendue — un sous-dossier est ramené à la racine du repository :

```json
{
  "ok": true,
  "repository": { "canonicalPath": "D:\\Projets\\mon-projet" }
}
```

Sans jeton, la réponse est un `401` :

```powershell
try {
  Invoke-RestMethod -Method Post http://127.0.0.1:4310/repositories/resolve `
    -ContentType "application/json" -Body '{"repositoryPath":"D:\\Projets\\mon-projet"}'
} catch { $_.ErrorDetails.Message }
```

```json
{ "ok": false, "error": { "code": "UNAUTHORIZED" } }
```

Toutes les erreurs suivent cette forme : un code stable, jamais de message technique ni de trace
d'exception. Une route inconnue renvoie `404` avec `ROUTE_NOT_FOUND`.

## Erreurs fréquentes

| Symptôme | Cause probable | Correction |
| --- | --- | --- |
| L'interface affiche « Runner indisponible » | Le runner n'est pas démarré | `npm run dev:runner` dans un second terminal |
| La création échoue avec « le runner local ne répond pas » | Idem, ou port différent | Vérifier avec `npm run runner:health` |
| Le runner répond `401` à l'application web | `NOX_RUNNER_TOKEN` différent entre les deux | Un seul `.env` à la racine ; redémarrer les deux processus après modification |
| `NOX_RUNNER_TOKEN est absent` au démarrage du runner | Jeton non défini | Voir « Configuration : le jeton du runner » |
| `NOX_RUNNER_HOST ... n'est pas une adresse de boucle locale` | Hôte non autorisé en V1 | Remettre `127.0.0.1` |
| `Le port 4310 est deja utilise` | Un autre runner tourne déjà | L'arrêter, ou définir `NOX_RUNNER_PORT` **et** `NOX_RUNNER_URL` |
| `GIT_NOT_AVAILABLE` / « Git est introuvable » | Git absent du `PATH` du runner | Installer Git, puis redémarrer le runner |

Après toute modification du `.env`, **redémarrez les deux processus** : les variables sont lues
au démarrage.

## Structure du repository

```text
NOX/
├── apps/
│   ├── web/                    Application Next.js (App Router, Tailwind CSS)
│   │   ├── app/
│   │   │   ├── page.tsx        Tableau de bord (liste des projets)
│   │   │   └── projects/
│   │   │       ├── new/        Formulaire + Server Action de création
│   │   │       └── [id]/       Page de détail d'un projet
│   │   │           ├── documents/  Liste, lecteur, éditeur + Server Action
│   │   │           │   └── new/    Formulaire de création + Server Action
│   │   │           ├── architect/   Conversations Architecte
│   │   │           │   └── [sessionId]/  Fil, contexte, tours, proposition
│   │   │           └── tasks/      Backlog filtrable
│   │   │               ├── new/        Formulaire de tâche + Server Action
│   │   │               └── [taskId]/   Détail, transitions, reprise
│   │   │                   └── runs/   Préparation et résultat d'une exécution
│   │   ├── app/api/                Route Handlers : interrogation et flux SSE d'un run
│   │   ├── components/         Composants d'interface réutilisables
│   │   ├── lib/
│   │   │   ├── runner/         Client HTTP du runner (serveur uniquement)
│   │   │   ├── documents.ts    Chargement des documents pour les pages
│   │   │   ├── document-edit.ts    Logique du formulaire d'édition
│   │   │   ├── document-create.ts  Destinations et construction du chemin
│   │   │   ├── task-input.ts       Validation du formulaire de tâche
│   │   │   ├── task-sync.ts        Synchronisation idempotente du document
│   │   │   ├── task-display.ts     Libellés, compteurs, filtres
│   │   │   ├── tasks.ts            Chargement des tâches pour les pages
│   │   │   ├── run-prompt.ts       Prompt d'exécution et son empreinte
│   │   │   ├── run-report.ts       Traduction du rapport du runner
│   │   │   ├── run-display.ts      Tons, durées, URL des exécutions
│   │   │   ├── run-cancel.ts       Règles d'annulation, pures et testables
│   │   │   ├── run-events.ts       Jonction registre ↔ SQLite, rattrapage
│   │   │   ├── run-review.ts       Transfert unique de l'instantané vers la base
│   │   │   ├── review-display.ts   Sélection de fichier, lignes de diff, disponibilité
│   │   │   ├── correction-display.ts
│   │   │   │                   URL, refus expliqués, préconditions
│   │   │   ├── architect/       Architecte OpenAI, serveur uniquement
│   │   │   │   ├── config.ts        Variables d'environnement, sans défaut
│   │   │   │   ├── context.ts       Liste fermée, bornes, manifest
│   │   │   │   ├── context-diff.ts  Comparaison de deux manifests
│   │   │   │   ├── fingerprint.ts   Empreintes de contexte et de tâche
│   │   │   │   ├── sanitize.ts      Nettoyage de ce qui quitte la machine
│   │   │   │   ├── transcript.ts    Conversation locale, transmise en entier
│   │   │   │   ├── prepare.ts       Contexte + transcript + prompt + empreintes
│   │   │   │   ├── provider.ts      Interface étroite + faux fournisseur
│   │   │   │   ├── openai.ts        Responses API, Structured Output strict
│   │   │   │   ├── service.ts       Préparation d'un tour, puis envoi contrôlé
│   │   │   │   └── apply.ts         Création par le pipeline de TASK-007
│   │   │   ├── labels.ts           Seule couche de traduction des valeurs internes
│   │   │   ├── runs.ts             Chargement et réconciliation des runs
│   │   │   └── ...             Validation métier et lecture des données
│   │   └── public/             Fichiers statiques
│   │
│   └── runner/                 Runner local Node.js
│       ├── fixtures/           Faux Claude Code, pour les tests uniquement
│       └── src/
│           ├── index.ts        Démarrage et arrêt propre
│           ├── config.ts       Configuration validée au démarrage
│           ├── server.ts       Routage HTTP
│           ├── http/           Authentification, corps JSON, réponses
│           ├── claude/
│           │   ├── executable.ts   Résolution sans shell, environnement nettoyé
│           │   ├── preflight.ts    Vérifications avant lancement
│           │   ├── launcher.ts     Lancement, stdin, délai, arrêt de l'arbre
│           │   ├── output.ts       Analyse JSON et détection de limite
│           │   ├── registry.ts     Registre en mémoire : états et événements
│           │   ├── cancel.ts       Annulation contrôlée, sans seconde logique d'arrêt
│           │   ├── validations.ts  Suivi des commandes réellement exécutées
│           │   ├── correction-preflight.ts
│           │   │                   État exactement relu, avant toute reprise
│           │   ├── stream/         Parser NDJSON, lecture des commandes Bash,
│           │   │                   normalisation, sanitation
│           │   └── runs.ts         Cycle de vie complet d'une exécution
│           └── repositories/
│               ├── resolve-repository.ts   Résolution Git (execFile, sans shell)
│               ├── git-state.ts            État Git en lecture seule
│               ├── git-review.ts           Capture détaillée du diff, à la finalisation
│               ├── workspace-fingerprint.ts Empreinte authentifiée du dossier de travail
│               ├── documents/              Inventaire, lecture, écriture, création, confinement
│               └── tasks/                  Document de tâche et dossier `tasks/`
│
├── packages/
│   ├── shared/                 Types et constantes partagés (@nox/shared)
│   │   ├── src/statuses.ts     ProjectStatus, TaskStatus, RunStatus
│   │   ├── src/runner.ts       Contrat HTTP web ↔ runner
│   │   ├── src/documents.ts    Contrat des documents Markdown
│   │   ├── src/tasks.ts        Priorités, transitions, codes, types métier
│   │   ├── src/task-markdown.ts    Générateur pur et déterministe
│   │   ├── src/task-documents.ts   Contrat de la route des documents de tâche
│   │   ├── src/runs.ts             Codes RUN, états finaux, bornes, transitions
│   │   ├── src/claude-prompt.ts    Prompt d'exécution pur et déterministe
│   │   ├── src/claude-commands.ts  Validation des commandes et permissions
│   │   ├── src/claude-events.ts    Événements publics, types fermés et bornes
│   │   ├── src/review.ts           Changements, validations, bornes, fichiers sensibles
│   │   ├── src/corrections.ts      Nature d'un run, feedback, conditions de reprise
│   │   ├── src/claude-correction-prompt.ts
│   │   │                           Prompt de correction, pur et déterministe
│   │   └── src/claude.ts           Contrat des routes Claude Code
│   │
│   └── database/               Accès aux données (@nox/database)
│       ├── prisma/             Schéma et migrations versionnées
│       ├── src/                Client, chemins, requêtes sur Project, Task, Run,
│       │                       RunEvent, RunFileChange, RunValidationResult,
│       │                       ReviewFeedback
│       └── prisma.config.ts    Configuration du CLI Prisma
│
├── data/                       Base SQLite locale (contenu non versionné)
├── docs/                       Documentation de référence
├── CLAUDE.md                   Règles permanentes des sessions Claude Code
├── eslint.config.mjs           Configuration ESLint unique du monorepo
├── tsconfig.base.json          Configuration TypeScript commune (mode strict)
└── package.json                Workspaces et scripts racine
```

## Documentation

| Document | Contenu |
| --- | --- |
| [docs/PROJECT_BRIEF.md](docs/PROJECT_BRIEF.md) | Problème, vision, rôles et flux cible |
| [docs/V1_SCOPE.md](docs/V1_SCOPE.md) | Périmètre de la V1 et exclusions |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Découpage technique et responsabilités |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Étapes ordonnées jusqu'à la V1 |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Décisions prises et justifications |
| [docs/PROJECT_STATE.md](docs/PROJECT_STATE.md) | État réel du projet à l'instant T |
| [CLAUDE.md](CLAUDE.md) | Règles permanentes des sessions Claude Code |

## Développement

Le projet avance par petites tâches successives. Avant chaque nouvelle tâche, l'état validé est
commité et poussé manuellement — NOX et Claude Code ne poussent jamais vers un dépôt distant.

Avant de considérer une tâche terminée :

```powershell
npm run test
npm run lint
npm run typecheck
npm run build
```
