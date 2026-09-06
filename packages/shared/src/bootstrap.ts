/**
 * Specification deterministe de la tache d'amorcage.
 *
 * ## Pourquoi aucun appel a un fournisseur
 *
 * Parce que la question n'est pas ouverte. Le planificateur de backlog repond a
 * « quel travail produit reste-t-il ? », qui depend du projet et merite un
 * modele. L'amorcage repond a « de quelles fondations ces taches ont-elles
 * besoin ? », et NOX connait deja la reponse : un repository qui demarre, et
 * huit documents dont il sait qui possede quoi.
 *
 * Depenser un appel pour reformuler une responsabilite qu'on connait serait
 * payer pour de la variabilite. Ce module est donc **pur** : meme entree, meme
 * sortie, sans horloge, sans aleatoire, sans reseau. C'est aussi ce qui rend
 * l'apercu honnete — le texte affiche avant creation est exactement celui qui
 * sera cree.
 *
 * ## Ce qu'elle decide, et ce qu'elle ne decide pas
 *
 * TASK-000 decide des **moyens** : elle peut demander de choisir une pile
 * minimale quand le repository est vide et que le plan laisse le choix ouvert.
 * C'est l'endroit precis ou un choix laisse ouvert par le plan devient
 * necessaire, parce qu'il faut bien creer quelque chose.
 *
 * Elle ne decide jamais du **produit**. Ni perimetre, ni fonctionnalite, ni
 * objectif de V1 : ce que le backlog decrit reste au backlog, et une fondation
 * qui implementerait une capacite du produit aurait vole son travail a la tache
 * qui la porte.
 *
 * ## Elle n'ecrase rien
 *
 * Le contrat impose l'inspection avant toute modification, et la preservation
 * de ce qui existe. Un repository apporte a NOX peut deja contenir une
 * application entiere : la reamorcer serait la detruire.
 */

import {
  classifyRepository,
  FOUNDATIONAL_DOCUMENTS,
  REPOSITORY_SHAPE,
  type RepositoryInspection,
  type RepositoryShape,
} from "./repository-inspection.js";
import { TASK_PRIORITY, type TaskPriority } from "./tasks.js";
import type { ArchitectPromptMemory } from "./project-memory.js";
import type { ArchitectPromptBrief, ArchitectPromptV1Plan } from "./project-plan.js";
import {
  BOOTSTRAP_SOURCE_LIMITS,
  checkBootstrapSourceFidelity,
  renderBootstrapBriefSection,
  renderBootstrapMemorySection,
  renderBootstrapPlanSection,
  type BootstrapSourceRefusal,
} from "./bootstrap-source.js";

/**
 * Version du constructeur de specification.
 *
 * Elle change des que le texte produit change : deux TASK-000 construites par
 * deux versions differentes ne se comparent pas.
 */
export const BOOTSTRAP_SPEC_VERSION = "bootstrap/1";

/**
 * Titre de la tache d'amorcage.
 *
 * Fixe, et volontairement : il n'y a qu'une tache d'amorcage par projet, et son
 * role ne varie pas d'un projet a l'autre. Ce qui varie est son contenu.
 */
export const BOOTSTRAP_TASK_TITLE =
  "Bootstrap project repository and foundational documentation";

/**
 * Bornes des sections de **presentation**.
 *
 * Elles situent la tache sans l'engager : le nom du projet, et l'inventaire des
 * taches a venir donne pour etre evite, jamais fait. Les raccourcir ne coute
 * rien — contrairement au brief, au plan et a la memoire, que `TASK-000` a la
 * charge de materialiser fidelement et qui vivent desormais dans
 * `bootstrap-source.ts`.
 */
export const BOOTSTRAP_PRESENTATION_LIMITS = {
  projectName: 600,
  upcomingTasks: { max: 30, titleLength: 200, objectiveLength: 300 },
} as const;

/**
 * Texte raccourci pour l'affichage.
 *
 * Type nominal, et c'est tout son interet : un `string` ordinaire ne s'y
 * convertit pas. Un champ declare `SummaryText` ne peut donc recevoir qu'une
 * valeur passee par `summarizeForDisplay`, et le compilateur refuse d'y ranger
 * une valeur canonique sans qu'on l'ait explicitement resumee.
 *
 * L'autre sens — glisser un resume la ou une source canonique est attendue —
 * est ferme differemment : les rendus contractuels ne prennent aucune chaine,
 * seulement les objets canoniques eux-memes.
 */
export type SummaryText = string & { readonly __summary: unique symbol };

/**
 * Raccourcit une valeur destinee a l'affichage, et signale la coupe.
 *
 * Le seul raccourcisseur de l'amorcage. Ce qu'il produit ne peut plus etre
 * confondu avec une source : le type le refuse.
 */
export function summarizeForDisplay(value: string, limit: number): SummaryText {
  const trimmed = value.trim();
  if (trimmed.length <= limit) {
    return trimmed as SummaryText;
  }
  return `${trimmed.slice(0, Math.max(0, limit - 1)).trimEnd()}…` as SummaryText;
}

/**
 * Budget des sections de **presentation** du contexte.
 *
 * Elles situent la tache : nom du projet, inventaire des taches a venir, etat
 * du repository, consignes fixes. Chacune est deja bornee individuellement ;
 * cette somme majore ce qu'elles peuvent peser ensemble.
 */
const PRESENTATION_BUDGET =
  BOOTSTRAP_PRESENTATION_LIMITS.projectName +
  BOOTSTRAP_PRESENTATION_LIMITS.upcomingTasks.max *
    (BOOTSTRAP_PRESENTATION_LIMITS.upcomingTasks.titleLength +
      BOOTSTRAP_PRESENTATION_LIMITS.upcomingTasks.objectiveLength +
      128) +
  // Etat du repository et consignes fixes : du texte ecrit par NOX, dont la
  // seule part variable est l'inventaire deja borne par l'inspection.
  16 * 1024;

/**
 * Bornes de la specification produite.
 *
 * `context` n'est plus un chiffre choisi. C'est la somme de ce que l'etat
 * produit **valide** peut peser — bornes metier du brief, du plan et de la
 * memoire, plus le balisage du rendu — et de ce que les sections de
 * presentation peuvent ajouter. Un projet dans ses bornes tient donc toujours,
 * et un projet qui n'y tient pas est refuse par son nom plutot que coupe.
 *
 * L'ancienne valeur valait douze mille caracteres. Le premier pilote reel l'a
 * atteinte : cinq sections de consignes — etat du repository, preservation,
 * fondation technique, installation, responsabilite des documents — n'ont
 * jamais atteint Claude, et rien ne l'a signale.
 */
export const BOOTSTRAP_SPEC_LIMITS = {
  objective: 1_200,
  context: BOOTSTRAP_SOURCE_LIMITS.total + PRESENTATION_BUDGET,
  outOfScope: 2_000,
  criteria: { max: 16, length: 400 },
  documents: { max: 8 },
  upcomingTasks: BOOTSTRAP_PRESENTATION_LIMITS.upcomingTasks,
  field: BOOTSTRAP_PRESENTATION_LIMITS.projectName,
} as const;

/**
 * Une tache a venir, telle que l'amorcage a besoin de la connaitre.
 *
 * Titre et objectif sont declares `SummaryText` : ils sont donnes pour situer
 * le travail futur, pas pour etre materialises. Le type interdit d'y ranger une
 * valeur canonique sans l'avoir explicitement resumee.
 */
export type BootstrapUpcomingTask = {
  code: string;
  title: SummaryText;
  objective: SummaryText;
  priority: string;
  status: string;
};

/** Tout ce dont la construction a besoin, deja relu par l'appelant. */
export type BootstrapSpecInput = {
  projectName: string;
  /** Brief produit courant. Une precondition en exige un. */
  brief: ArchitectPromptBrief | null;
  /** Plan de V1 courant. Une precondition en exige un. */
  v1Plan: ArchitectPromptV1Plan | null;
  /** Memoire **active** seulement. Une entree archivee n'arrive jamais ici. */
  memories: readonly ArchitectPromptMemory[];
  /** Taches produit deja enregistrees, dans l'ordre valide par l'humain. */
  upcomingTasks: readonly BootstrapUpcomingTask[];
  /** Ce que le runner a constate du repository. */
  inspection: RepositoryInspection;
};

/** Ce que la construction produit : exactement une specification de tache. */
export type BootstrapTaskSpec = {
  version: string;
  title: string;
  priority: TaskPriority;
  objective: string;
  context: string;
  acceptanceCriteria: string[];
  outOfScope: string;
  /** Uniquement des documents **existants**. Voir `documentReferences` plus bas. */
  documentReferences: string[];
  /** Toujours vide a la creation. Voir la note dediee. */
  validationCommands: string[];
  /** Forme constatee du repository, conservee pour l'affichage. */
  shape: RepositoryShape;
};

/**
 * Borne une liste de criteres ecrits par NOX lui-meme.
 *
 * Ces textes sont des constantes de ce module : la borne ne les coupe jamais,
 * elle garantit seulement qu'une evolution du texte ne peut pas deriver sans
 * qu'un test le voie.
 */
function boundedCriteria(values: readonly string[], limit: number, length: number): string[] {
  return values
    .map((value) => summarizeForDisplay(value, length) as string)
    .filter((value) => value !== "")
    .slice(0, limit);
}

/**
 * Ce que la construction rend.
 *
 * Une union, et non une specification eventuellement incomplete. Un contrat
 * d'amorcage tronque a l'air complet — c'est exactement ce qui l'a rendu si
 * couteux chez le premier pilote —, donc l'appelant ne peut pas l'obtenir sans
 * avoir traite le refus.
 */
export type BootstrapSpecOutcome =
  | { ok: true; spec: BootstrapTaskSpec }
  | { ok: false; refusal: BootstrapSourceRefusal };

function block(title: string, lines: readonly string[]): string {
  return [`### ${title}`, "", ...lines].join("\n");
}

function listLines(values: readonly string[]): string[] {
  return values.length === 0 ? ["- (aucun)"] : values.map((value) => `- ${value}`);
}

/**
 * Les trois sections contractuelles, deleguees au rendu integral.
 *
 * Elles vivaient ici, bornees champ par champ « pour ne pas recopier des pages
 * de specification ». C'etait exactement l'erreur : ce que `TASK-000` doit
 * recopier dans `docs/PROJECT_BRIEF.md` et `docs/V1_SCOPE.md`, elle doit
 * d'abord le recevoir en entier.
 */
function sourceSections(input: BootstrapSpecInput): string[] {
  return [
    renderBootstrapBriefSection(input.brief),
    renderBootstrapPlanSection(input.v1Plan),
    renderBootstrapMemorySection(input.memories),
  ];
}

/**
 * Inventaire des taches produit a venir.
 *
 * Il ne sert pas a les implementer — c'est meme l'inverse. Il sert a preparer
 * un repository dans lequel elles pourront l'etre, et a savoir ce qu'il ne faut
 * surtout pas faire a leur place.
 */
function upcomingBlock(tasks: readonly BootstrapUpcomingTask[]): string {
  if (tasks.length === 0) {
    return block("Taches produit a venir", ["Aucune tache enregistree."]);
  }
  const { upcomingTasks: limits } = BOOTSTRAP_PRESENTATION_LIMITS;
  // Titre et objectif sont deja resumes par l'appelant : ce sont des
  // `SummaryText`, et les reraccourcir ici les couperait deux fois.
  const lines = tasks.slice(0, limits.max).map((task) => {
    return `- ${task.code} · ${task.priority} · ${task.status} · ${task.title} — ${task.objective}`;
  });
  return block("Taches produit a venir", [
    "Ces taches sont deja enregistrees et seront executees **apres** celle-ci.",
    "Elles sont donnees pour que les fondations leur conviennent — jamais pour",
    "etre implementees ici, meme partiellement.",
    "",
    ...lines,
  ]);
}

/** Ce que le runner a constate, dit en clair. */
function repositoryBlock(inspection: RepositoryInspection, shape: RepositoryShape): string {
  const count = inspection.rootEntryCountTruncated
    ? `${String(inspection.rootEntryCount)}+`
    : String(inspection.rootEntryCount);

  const description =
    shape === REPOSITORY_SHAPE.APPLICATION
      ? "Une application existe deja dans ce repository."
      : shape === REPOSITORY_SHAPE.MINIMAL
        ? "Le repository contient quelques fichiers, mais aucun code applicatif reconnu."
        : "Le repository est vide ou quasiment vide.";

  return block("Etat du repository", [
    description,
    "",
    `Entrees a la racine : ${count}`,
    `Historique Git : ${inspection.hasCommits ? "presente au moins un commit" : "aucun commit"}`,
    "",
    "Manifestes reconnus :",
    ...listLines(inspection.manifests),
    "",
    "Dossiers de code reconnus :",
    ...listLines(inspection.sourceDirectories),
    "",
    "Documents fondamentaux presents :",
    ...listLines(inspection.foundationalDocuments),
    "",
    "Cet inventaire est grossier et date de la preparation de cette tache :",
    "inspecte toi-meme le repository avant d'y toucher.",
  ]);
}

/**
 * Objectif de la tache.
 *
 * Une phrase, la meme pour tous les projets : etablir une fondation minimale
 * qui demarre et materialiser la documentation fondamentale, sans implementer
 * la moindre fonctionnalite du backlog.
 */
function buildObjective(): string {
  return summarizeForDisplay(
    [
      "Etablir une fondation de repository minimale et executable, alignee sur la V1",
      "validee, et materialiser la documentation fondamentale du projet — sans",
      "implementer aucune fonctionnalite produit du backlog de V1.",
    ].join(" "),
    BOOTSTRAP_SPEC_LIMITS.objective,
  );
}

/** Consignes de preservation, adaptees a ce qui a ete constate. */
function preservationLines(shape: RepositoryShape): string[] {
  if (shape === REPOSITORY_SHAPE.APPLICATION) {
    return [
      "Ce repository porte deja une application. Adapte l'amorcage a ce qui",
      "existe : ne remplace pas une pile technique en place parce qu'une autre",
      "te serait plus familiere, ne supprime aucun code source, ne reinitialise",
      "pas Git, et n'ecrase aucune documentation sans l'avoir lue.",
      "",
      "Complete ce qui manque, aligne ce qui a diverge, et laisse intact ce qui",
      "est deja juste.",
    ];
  }
  if (shape === REPOSITORY_SHAPE.MINIMAL) {
    return [
      "Ce repository contient quelques fichiers mais aucune application reconnue.",
      "Inspecte-le avant d'ecrire : conserve ce qui existe, et mets en place la",
      "fondation manquante autour, sans repartir de zero.",
    ];
  }
  return [
    "Ce repository est vide ou quasiment vide. Verifie-le toi-meme avant",
    "d'ecrire : s'il contient malgre tout du travail existant, preserve-le.",
  ];
}

/**
 * Ce qui est attendu de la pile technique.
 *
 * C'est le seul endroit ou l'amorcage autorise un choix technique — et il ne
 * l'autorise que parce qu'il faut bien creer quelque chose. Le plan reste
 * l'autorite : si la direction technique tranche deja, elle s'impose.
 */
function stackLines(shape: RepositoryShape, plan: ArchitectPromptV1Plan | null): string[] {
  if (shape === REPOSITORY_SHAPE.APPLICATION) {
    return [
      "N'introduis aucune nouvelle pile technique : celle qui est en place fait",
      "foi. Complete l'outillage manquant si la V1 en a besoin, et documente ce",
      "que tu constates.",
    ];
  }

  const direction =
    plan === null || plan.technicalDirection.trim() === ""
      ? "Le plan de V1 ne donne aucune direction technique explicite."
      : "Respecte la direction technique du plan de V1, rappelee plus haut.";

  return [
    direction,
    "",
    "Aucune pile n'est en place : choisis la solution **minimale** qui convienne",
    "a la V1 validee, aux contraintes de la memoire du projet et aux taches",
    "produit a venir. Prefere l'option la plus simple qui tienne, et n'ajoute",
    "aucun outil dont rien n'a besoin aujourd'hui.",
    "",
    "Chaque choix que tu fais ici devient une decision durable : consigne-le,",
    "avec sa raison, dans la documentation des decisions.",
  ];
}

/**
 * Ce qui doit etre installe et verifie avant de conclure.
 *
 * Le premier run reel de TASK-000 a livre un repository dont les dependances
 * n'etaient pas installees et dont rien n'avait tourne : le prompt d'execution
 * lui interdisait toute commande, et le contrat ne lui demandait rien de plus
 * que « le projet demarre ». Les deux ont ete corriges ensemble — une
 * permission sans exigence n'aurait servi a rien, et une exigence sans
 * permission serait restee invérifiable.
 *
 * Le texte ne nomme **aucun ecosysteme**. NOX ne sait pas encore lequel sera
 * choisi, et souffler `npm` ici reviendrait a choisir a la place de la tache.
 */
function installationLines(): string[] {
  return [
    "Une fondation qui n'a jamais tourne n'est pas une fondation. Une fois la pile",
    "choisie ou constatee :",
    "",
    "- installe ses dependances, et laisse le fichier de verrouillage que",
    "  l'ecosysteme produit lorsqu'il en produit un ;",
    "- lance la build si la pile en possede une ;",
    "- lance les tests si une commande de test existe ;",
    "- verifie raisonnablement le demarrage, sans laisser tourner un serveur",
    "  permanent qui bloquerait l'execution ;",
    "- documente dans le `README.md` les commandes reellement utilisees.",
    "",
    "Ces commandes ne sont pas des validations enregistrees : personne ne pouvait",
    "les connaitre avant que la pile ne soit choisie. Elles servent a etablir la",
    "fondation, pas a valider une specification — n'en invente aucune qui sorte de",
    "l'amorcage.",
    "",
    "Si une commande t'est refusee ou echoue pour une raison que tu ne peux pas",
    "regler ici, ne la contourne pas : dis-le, et dis ce qui reste non verifie.",
  ];
}
/** Ce que chaque document fondamental doit porter, et lui seul. */
function documentOwnershipLines(): string[] {
  return [
    "- `README.md` : point d'entree — installation, demarrage, commandes usuelles.",
    "  Court et utile ; ce n'est pas un journal d'amorcage.",
    "- `CLAUDE.md` : regles operationnelles et invariants **de ce repository**,",
    "  destines a l'agent qui y travaillera.",
    "- `docs/PROJECT_BRIEF.md` : pourquoi, pour qui, resultat attendu, objectifs",
    "  et hors-objectifs.",
    "- `docs/V1_SCOPE.md` : ce que la V1 inclut, et ce qu'elle exclut.",
    "- `docs/ARCHITECTURE.md` : l'architecture technique **reelle** et ses",
    "  mecanismes.",
    "- `docs/PROJECT_STATE.md` : ce qui existe aujourd'hui, et ce qui n'existe pas",
    "  encore.",
    "- `docs/DECISIONS.md` : pourquoi les decisions durables ont ete prises.",
    "- `docs/ROADMAP.md` : la trajectoire d'implementation ordonnee.",
    "",
    "Une information appartient a **un** document. La dupliquer garantit que les",
    "copies divergeront, et que personne ne saura laquelle fait foi.",
  ];
}

/**
 * Contexte de la tache.
 *
 * Il porte l'etat structure du projet, la memoire, les taches a venir et l'etat
 * du repository, dans un ordre fixe.
 *
 * ## Il n'est plus tronque
 *
 * La derniere ligne coupait l'assemblage a douze mille caracteres. Chez le
 * premier pilote reel, cette coupe est tombee au milieu de l'inventaire des
 * taches a venir : les cinq sections suivantes — etat du repository, consignes
 * de preservation, choix de la pile, installation, responsabilite de chaque
 * document — ne sont jamais arrivees a Claude Code, et rien ne l'a dit.
 *
 * Ce qui la remplace n'est pas un seuil plus large : c'est l'absence de seuil
 * ici, et un refus nomme lorsque l'etat produit sort de ses propres bornes
 * metier.
 */
function buildContext(input: BootstrapSpecInput, shape: RepositoryShape): string {
  const sections = [
    block("Ce que cette tache est", [
      `Projet : ${summarizeForDisplay(input.projectName, BOOTSTRAP_SPEC_LIMITS.field)}`,
      "",
      "Cette tache prepare le repository pour les taches produit qui suivront.",
      "Elle ne livre aucune fonctionnalite de la V1.",
    ]),
    ...sourceSections(input),
    upcomingBlock(input.upcomingTasks),
    repositoryBlock(input.inspection, shape),
    block("Inspecter avant de modifier", preservationLines(shape)),
    block("Fondation technique", stackLines(shape, input.v1Plan)),
    block("Installer et verifier la fondation", installationLines()),
    block("Documentation fondamentale", [
      "Cree ou aligne les documents ci-dessous lorsqu'ils sont pertinents pour ce",
      "projet, en respectant strictement la responsabilite de chacun :",
      "",
      ...documentOwnershipLines(),
      "",
      "Le brief et le plan de V1 rappeles plus haut sont l'intention produit",
      "validee : materialise-les fidelement dans `docs/PROJECT_BRIEF.md` et",
      "`docs/V1_SCOPE.md`. Ne les reinvente pas, ne les elargis pas, ne les",
      "corrige pas.",
      "",
      "`docs/ROADMAP.md` peut lister les taches a venir dans l'ordre donne",
      "ci-dessus. Ce n'est qu'un reflet lisible : l'autorite sur les taches reste",
      "NOX, et ce document ne doit pas devenir une seconde base de taches.",
      "",
      "`docs/PROJECT_STATE.md` decrit ce qui existe **reellement** apres cette",
      "tache. Les capacites des taches a venir ne sont pas disponibles : elles",
      "sont prevues. Ne presente jamais comme fait ce qui n'a pas ete construit.",
      "",
      "`docs/ARCHITECTURE.md` ne decrit que ce qui vient reellement d'etre mis en",
      "place. Une architecture racontee d'avance est une fiction.",
      "",
      "Si un de ces documents existe deja et contredit clairement le brief ou le",
      "plan ci-dessus, ne choisis pas une verite intermediaire : aligne-le sur",
      "l'intention produit validee, et signale le conflit dans ton compte rendu.",
    ]),
  ];

  return sections.join("\n\n");
}

/**
 * Criteres d'acceptation.
 *
 * Deterministes, et adaptes a la forme du repository : un repository qui porte
 * deja une application n'a pas les memes criteres de reussite qu'un repository
 * vide, et faire semblant du contraire produirait des criteres invérifiables.
 */
function buildCriteria(
  input: BootstrapSpecInput,
  shape: RepositoryShape,
): string[] {
  const criteria: string[] = [
    "Le repository a ete inspecte avant toute modification, et le compte rendu dit ce qui s'y trouvait.",
  ];

  if (shape === REPOSITORY_SHAPE.APPLICATION) {
    criteria.push(
      "Le code source, la configuration et l'historique Git existants sont intacts : rien n'a ete supprime ni reinitialise.",
      "La pile technique deja en place a ete conservee et completee, jamais remplacee.",
    );
  } else {
    criteria.push(
      "Tout fichier deja present a ete conserve ; rien n'a ete supprime ni ecrase sans raison enoncee.",
      "Une fondation applicative minimale existe, et le choix de la pile est justifie par la V1 validee.",
    );
  }

  criteria.push(
    "Les dependances de la pile retenue sont installees et resolues ; le fichier de verrouillage existe lorsque l'ecosysteme en produit un.",
    "La build et les tests ont ete lances lorsque la pile en possede, et le compte rendu distingue ce qui a reellement tourne de ce qui n'a pas pu l'etre, avec sa raison.",
    "Le projet demarre : la commande de demarrage est documentee, et son fonctionnement a ete verifie plutot que suppose.",
    "Les commandes usuelles de developpement, de build et de test existantes sont documentees dans le `README.md`.",
  );

  const documents = input.inspection.foundationalDocuments;
  criteria.push(
    documents.length === 0
      ? "Les documents fondamentaux pertinents existent et respectent chacun leur unique responsabilite."
      : "Les documents fondamentaux pertinents existent, respectent chacun leur unique responsabilite, et ceux qui existaient deja ont ete completes plutot qu'ecrases.",
    "`docs/PROJECT_BRIEF.md` et `docs/V1_SCOPE.md` restituent fidelement le brief et le plan de V1 valides, sans ajout ni retrait.",
    "`docs/PROJECT_STATE.md` distingue ce qui existe de ce qui est seulement prevu ; aucune capacite non construite n'est presentee comme disponible.",
    "`docs/ARCHITECTURE.md` ne decrit que ce qui a reellement ete mis en place.",
    "Chaque decision technique prise pendant cette tache est consignee dans `docs/DECISIONS.md`, avec sa raison.",
  );

  if (input.upcomingTasks.length > 0) {
    const codes = input.upcomingTasks
      .slice(0, 4)
      .map((task) => task.code)
      .join(", ");
    criteria.push(
      `Aucune fonctionnalite produit des taches a venir (${codes}…) n'a ete implementee, meme partiellement.`,
    );
  } else {
    criteria.push(
      "Aucune fonctionnalite produit de la V1 n'a ete implementee, meme partiellement.",
    );
  }

  criteria.push(
    "Le diff est relisible : aucun fichier genere volumineux n'a ete ajoute au suivi de version.",
    "Aucun commit et aucun push n'ont ete effectues.",
  );

  return boundedCriteria(
    criteria,
    BOOTSTRAP_SPEC_LIMITS.criteria.max,
    BOOTSTRAP_SPEC_LIMITS.criteria.length,
  );
}

/** Ce que l'implementeur ne doit pas faire. */
function buildOutOfScope(input: BootstrapSpecInput): string {
  const lines = [
    "- Implementer une fonctionnalite produit de la V1, meme simple, meme « pendant qu'on y est ».",
  ];

  if (input.upcomingTasks.length > 0) {
    lines.push(
      `- Realiser tout ou partie des taches produit deja enregistrees (${input.upcomingTasks
        .slice(0, 6)
        .map((task) => task.code)
        .join(", ")}).`,
    );
  }

  lines.push(
    "- Modifier le perimetre du produit, les objectifs de la V1 ou ses hors-objectifs.",
    "- Ajouter une capacite utilisateur que la V1 validee ne demande pas.",
    "- Supprimer, reinitialiser ou remplacer du code, de la configuration ou un historique Git existants.",
    "- Creer un commit ou pousser vers un depot distant.",
    "- Deployer, publier ou configurer une infrastructure d'hebergement.",
  );

  return summarizeForDisplay(lines.join("\n"), BOOTSTRAP_SPEC_LIMITS.outOfScope);
}

/**
 * Documents a lire, restreints a ceux qui **existent**.
 *
 * Le contrat d'une tache ne verifie pas l'existence d'un chemin, et il aurait
 * donc accepte les huit documents fondamentaux. Les y mettre tous aurait produit
 * une liste dont la moitie designe des fichiers absents — un contournement
 * silencieux de ce que ce champ signifie.
 *
 * Les documents encore inexistants sont decrits comme des livrables, dans le
 * contexte et les criteres. C'est leur place : on ne demande pas de lire ce
 * qu'on demande d'ecrire.
 */
function buildDocumentReferences(inspection: RepositoryInspection): string[] {
  const present = new Set(inspection.foundationalDocuments);
  return FOUNDATIONAL_DOCUMENTS.filter((path) => present.has(path)).slice(
    0,
    BOOTSTRAP_SPEC_LIMITS.documents.max,
  );
}

/**
 * Construit la specification de la tache d'amorcage.
 *
 * ## Pourquoi aucune commande de validation
 *
 * Parce que NOX ne peut pas les connaitre. Sur un repository vide, la pile sera
 * choisie **pendant** l'execution : proposer `npm run build` a un projet qui
 * sera peut-etre en Python serait une commande fausse, autorisee a Claude Code
 * et vouee a echouer. Sur un repository existant, NOX voit les manifestes mais
 * jamais leur contenu : deviner les scripts serait deviner.
 *
 * Une liste vide est le seul etat honnete, et il est deja modelise : « aucune
 * validation configuree » n'a jamais signifie « echec » dans NOX. L'utilisateur
 * peut en ajouter avant de lancer, une fois qu'il sait.
 *
 * Vide ne veut pas dire **muet** pour autant. Une tache d'amorcage installe et
 * verifie la fondation qu'elle vient de choisir : ce sont des commandes de
 * setup, autorisees par `claude-commands.ts` et exigees par les criteres
 * ci-dessus, et elles n'ont jamais ete des validations structurees. Confondre
 * les deux est exactement l'erreur qui a produit, au premier run reel, un
 * repository livre sans dependances installees.
 */
export function buildBootstrapTaskSpec(input: BootstrapSpecInput): BootstrapSpecOutcome {
  const shape = classifyRepository(input.inspection);
  const context = buildContext(input, shape);

  // La fidelite se prouve sur le contexte **assemble**, pas sur un rendu refait
  // pour l'occasion : c'est le texte qui sera enregistre dans la tache qui est
  // examine, et c'est ce qui permettrait d'attraper une perte survenue apres
  // les sections elles-memes.
  const refusal = checkBootstrapSourceFidelity(
    { brief: input.brief, v1Plan: input.v1Plan, memories: input.memories },
    context,
  );
  if (refusal !== null) {
    return { ok: false, refusal };
  }

  const spec: BootstrapTaskSpec = {
    version: BOOTSTRAP_SPEC_VERSION,
    title: BOOTSTRAP_TASK_TITLE,
    // L'amorcage precede tout le reste : rien d'autre ne peut avancer avant.
    // `CRITICAL` reste reserve a une urgence technique ou de securite reelle.
    priority: TASK_PRIORITY.HIGH,
    objective: buildObjective(),
    context,
    acceptanceCriteria: buildCriteria(input, shape),
    outOfScope: buildOutOfScope(input),
    documentReferences: buildDocumentReferences(input.inspection),
    validationCommands: [],
    shape,
  };

  return { ok: true, spec };
}
