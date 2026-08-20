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

/** Bornes de la specification produite. */
export const BOOTSTRAP_SPEC_LIMITS = {
  objective: 1_200,
  context: 12_000,
  outOfScope: 2_000,
  criteria: { max: 16, length: 400 },
  documents: { max: 8 },
  memories: { max: 20, length: 400 },
  upcomingTasks: { max: 30, titleLength: 200, objectiveLength: 300 },
  field: 600,
  list: { max: 12, length: 300 },
} as const;

/** Une tache a venir, telle que l'amorcage a besoin de la connaitre. */
export type BootstrapUpcomingTask = {
  code: string;
  title: string;
  objective: string;
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

function truncate(value: string, limit: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function bulletList(values: readonly string[], limit: number, length: number): string[] {
  return values
    .map((value) => truncate(value, length))
    .filter((value) => value !== "")
    .slice(0, limit);
}

function block(title: string, lines: readonly string[]): string {
  return [`### ${title}`, "", ...lines].join("\n");
}

function listLines(values: readonly string[]): string[] {
  return values.length === 0 ? ["- (aucun)"] : values.map((value) => `- ${value}`);
}

/**
 * Resume du brief produit.
 *
 * Repris tel quel, borne champ par champ : l'amorcage doit savoir ce que le
 * projet cherche a faire, sans recopier des pages de specification.
 */
function briefBlock(brief: ArchitectPromptBrief | null): string {
  if (brief === null) {
    return block("Brief produit", ["Non defini."]);
  }
  const { field: fieldLimit, list } = BOOTSTRAP_SPEC_LIMITS;
  return block("Brief produit", [
    `Resume : ${truncate(brief.summary, fieldLimit)}`,
    `Probleme : ${truncate(brief.problem, fieldLimit)}`,
    `Utilisateurs vises : ${truncate(brief.targetUsers, fieldLimit)}`,
    `Resultat attendu : ${truncate(brief.desiredOutcome, fieldLimit)}`,
    "",
    "Objectifs :",
    ...listLines(bulletList(brief.goals, list.max, list.length)),
    "",
    "Hors objectifs :",
    ...listLines(bulletList(brief.nonGoals, list.max, list.length)),
  ]);
}

/**
 * Resume du plan de V1.
 *
 * La direction technique y figure telle quelle, y compris lorsqu'elle laisse
 * plusieurs options ouvertes — c'est precisement l'information dont l'amorcage
 * a besoin pour savoir s'il lui revient de trancher.
 */
function planBlock(plan: ArchitectPromptV1Plan | null): string {
  if (plan === null) {
    return block("Plan de V1", ["Non defini."]);
  }
  const { field: fieldLimit, list } = BOOTSTRAP_SPEC_LIMITS;
  return block("Plan de V1", [
    `Objectif de V1 : ${truncate(plan.goal, fieldLimit)}`,
    `Direction technique : ${truncate(plan.technicalDirection, fieldLimit)}`,
    "",
    "Dans le perimetre :",
    ...listLines(bulletList(plan.inScope, list.max, list.length)),
    "",
    "Hors perimetre :",
    ...listLines(bulletList(plan.outOfScope, list.max, list.length)),
    "",
    "Etapes :",
    ...listLines(bulletList(plan.milestones, list.max, list.length)),
  ]);
}

function memoryBlock(memories: readonly ArchitectPromptMemory[]): string {
  if (memories.length === 0) {
    return block("Memoire du projet", ["Aucune entree active."]);
  }
  const { memories: limits } = BOOTSTRAP_SPEC_LIMITS;
  const lines = memories.slice(0, limits.max).map((memory) => {
    const rationale = memory.rationale === null ? "" : ` (${truncate(memory.rationale, 200)})`;
    return `- ${memory.code} · ${memory.category} · ${truncate(memory.title, 200)} : ${truncate(memory.content, limits.length)}${rationale}`;
  });
  return block("Memoire du projet", [
    "Decisions, contraintes et conventions enregistrees explicitement. Elles",
    "s'appliquent des l'amorcage.",
    "",
    ...lines,
  ]);
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
  const { upcomingTasks: limits } = BOOTSTRAP_SPEC_LIMITS;
  const lines = tasks.slice(0, limits.max).map((task) => {
    return `- ${task.code} · ${task.priority} · ${task.status} · ${truncate(task.title, limits.titleLength)} — ${truncate(task.objective, limits.objectiveLength)}`;
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
  return truncate(
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
 * du repository — borne, et dans un ordre fixe.
 */
function buildContext(input: BootstrapSpecInput, shape: RepositoryShape): string {
  const sections = [
    block("Ce que cette tache est", [
      `Projet : ${truncate(input.projectName, BOOTSTRAP_SPEC_LIMITS.field)}`,
      "",
      "Cette tache prepare le repository pour les taches produit qui suivront.",
      "Elle ne livre aucune fonctionnalite de la V1.",
    ]),
    briefBlock(input.brief),
    planBlock(input.v1Plan),
    memoryBlock(input.memories),
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

  return truncate(sections.join("\n\n"), BOOTSTRAP_SPEC_LIMITS.context);
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

  return bulletList(criteria, BOOTSTRAP_SPEC_LIMITS.criteria.max, BOOTSTRAP_SPEC_LIMITS.criteria.length);
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

  return truncate(lines.join("\n"), BOOTSTRAP_SPEC_LIMITS.outOfScope);
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
export function buildBootstrapTaskSpec(input: BootstrapSpecInput): BootstrapTaskSpec {
  const shape = classifyRepository(input.inspection);

  return {
    version: BOOTSTRAP_SPEC_VERSION,
    title: BOOTSTRAP_TASK_TITLE,
    // L'amorcage precede tout le reste : rien d'autre ne peut avancer avant.
    // `CRITICAL` reste reserve a une urgence technique ou de securite reelle.
    priority: TASK_PRIORITY.HIGH,
    objective: buildObjective(),
    context: buildContext(input, shape),
    acceptanceCriteria: buildCriteria(input, shape),
    outOfScope: buildOutOfScope(input),
    documentReferences: buildDocumentReferences(input.inspection),
    validationCommands: [],
    shape,
  };
}
