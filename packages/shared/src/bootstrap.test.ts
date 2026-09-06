/**
 * Construction de la specification de `TASK-000`.
 *
 * ## Ce que ce fichier prouve
 *
 * Quatre choses.
 *
 * Qu'elle est **deterministe** : meme entree, meme sortie, octet pour octet.
 * C'est ce qui rend l'apercu honnete — sans cela, la tache creee pourrait ne
 * pas etre celle qui a ete lue.
 *
 * Qu'elle **s'adapte** au repository. Un depot qui porte deja une application
 * recoit une consigne de preservation ; un depot vide recoit l'autorisation de
 * choisir une pile minimale. Se tromper de consigne est la facon la plus rapide
 * de detruire le travail de quelqu'un.
 *
 * Qu'elle **ne franchit pas** la frontiere du produit. Les taches a venir sont
 * nommees pour etre evitees, jamais pour etre faites.
 *
 * Et qu'elle ne reference **aucun document absent**. Le contrat d'une tache ne
 * verifie pas l'existence d'un chemin : mettre les huit documents fondamentaux
 * dans `documentReferences` aurait contourne silencieusement ce que ce champ
 * signifie.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BOOTSTRAP_SPEC_LIMITS,
  BOOTSTRAP_SPEC_VERSION,
  BOOTSTRAP_TASK_CODE,
  BOOTSTRAP_TASK_SEQUENCE,
  BOOTSTRAP_TASK_TITLE,
  FOUNDATIONAL_DOCUMENTS,
  REPOSITORY_SHAPE,
  TASK_PRIORITY,
  buildBootstrapTaskSpec,
  classifyRepository,
  formatTaskCode,
  summarizeForDisplay,
  type ArchitectPromptBrief,
  type ArchitectPromptMemory,
  type ArchitectPromptV1Plan,
  type BootstrapSpecInput,
  type BootstrapUpcomingTask,
  type RepositoryInspection,
} from "../dist/index.js";

const BRIEF: ArchitectPromptBrief = {
  revision: "brief-1",
  summary: "Un planificateur de repas hebdomadaire.",
  problem: "Preparer la semaine prend trop de temps.",
  targetUsers: "Une personne seule, non technicienne.",
  desiredOutcome: "Une semaine preparee en dix minutes.",
  goals: ["planifier les repas", "generer une liste de courses"],
  nonGoals: ["reseau social", "comptes multiples"],
};

const PLAN: ArchitectPromptV1Plan = {
  revision: "plan-1",
  goal: "Preparer une semaine de repas et sa liste de courses.",
  inScope: ["planning hebdomadaire", "liste de courses imprimable"],
  outOfScope: ["comptes multi-utilisateurs", "application mobile"],
  technicalDirection:
    "Application web simple ; le stockage peut etre localStorage, IndexedDB ou un backend minimal selon les contraintes.",
  milestones: ["structure de donnees definie", "planning utilisable"],
};

const MEMORY: ArchitectPromptMemory = {
  code: "MEM-001",
  category: "CONSTRAINT",
  revision: "mem-1",
  title: "Aucune dependance payante",
  content: "Le projet doit tourner sans service payant.",
  rationale: "Usage personnel.",
};

const UPCOMING: BootstrapUpcomingTask[] = [
  {
    code: "TASK-001",
    title: summarizeForDisplay("Poser le domaine et la persistance", 200),
    objective: summarizeForDisplay(
      "Un repas se cree, se relit et survit a un rechargement.",
      300,
    ),
    priority: "HIGH",
    status: "DRAFT",
  },
  {
    code: "TASK-002",
    title: summarizeForDisplay("Livrer l'experience de planning", 200),
    objective: summarizeForDisplay("La semaine s'affiche et s'edite.", 300),
    priority: "MEDIUM",
    status: "DRAFT",
  },
];

const EMPTY_REPOSITORY: RepositoryInspection = {
  manifests: [],
  sourceDirectories: [],
  foundationalDocuments: [],
  hasCommits: false,
  rootEntryCount: 0,
  rootEntryCountTruncated: false,
};

const EXISTING_REPOSITORY: RepositoryInspection = {
  manifests: ["package.json"],
  sourceDirectories: ["src"],
  foundationalDocuments: ["README.md"],
  hasCommits: true,
  rootEntryCount: 12,
  rootEntryCountTruncated: false,
};

/**
 * La specification, extraite de l'issue.
 *
 * La construction rend desormais une union : elle peut refuser un etat produit
 * qui ne tiendrait pas dans son propre contrat. Les cas de refus ont leurs
 * propres tests ; ici, l'assertion tient lieu de garde et fait echouer le test
 * plutot que de laisser lire un champ sur un refus.
 */
function spec(overrides: Partial<BootstrapSpecInput> = {}) {
  const built = buildBootstrapTaskSpec({
    projectName: "Planificateur de repas",
    brief: BRIEF,
    v1Plan: PLAN,
    memories: [],
    upcomingTasks: [],
    inspection: EMPTY_REPOSITORY,
    ...overrides,
  });
  assert.ok(built.ok, "la construction devait aboutir");
  return built.spec;
}

describe("le code reserve", () => {
  it("est TASK-000, derive du numero zero", () => {
    assert.equal(formatTaskCode(BOOTSTRAP_TASK_SEQUENCE), BOOTSTRAP_TASK_CODE);
    assert.equal(BOOTSTRAP_TASK_SEQUENCE, 0);
  });

  it("precede toute tache ordinaire dans un tri par code", () => {
    const codes = [formatTaskCode(2), BOOTSTRAP_TASK_CODE, formatTaskCode(1)].sort((a, b) =>
      a.localeCompare(b),
    );
    assert.deepEqual(codes, ["TASK-000", "TASK-001", "TASK-002"]);
  });
});

describe("classification du repository", () => {
  it("reconnait un repository vide", () => {
    assert.equal(classifyRepository(EMPTY_REPOSITORY), REPOSITORY_SHAPE.EMPTY);
  });

  it("reconnait un repository minimal : des fichiers, aucun code", () => {
    assert.equal(
      classifyRepository({ ...EMPTY_REPOSITORY, foundationalDocuments: ["README.md"] }),
      REPOSITORY_SHAPE.MINIMAL,
    );
    assert.equal(
      classifyRepository({ ...EMPTY_REPOSITORY, rootEntryCount: 4 }),
      REPOSITORY_SHAPE.MINIMAL,
    );
  });

  it("reconnait une application a son manifeste", () => {
    assert.equal(
      classifyRepository({ ...EMPTY_REPOSITORY, manifests: ["go.mod"] }),
      REPOSITORY_SHAPE.APPLICATION,
    );
  });

  it("reconnait une application a son dossier de code", () => {
    assert.equal(
      classifyRepository({ ...EMPTY_REPOSITORY, sourceDirectories: ["src"] }),
      REPOSITORY_SHAPE.APPLICATION,
    );
  });

  it("penche du cote de la prudence : un seul signal suffit", () => {
    // Mieux vaut preserver un repository qu'on croyait vide que reamorcer un
    // repository qui ne l'etait pas.
    assert.equal(
      classifyRepository({ ...EXISTING_REPOSITORY, rootEntryCount: 1 }),
      REPOSITORY_SHAPE.APPLICATION,
    );
  });
});

describe("determinisme", () => {
  it("rend deux fois exactement la meme specification", () => {
    const first = spec({ memories: [MEMORY], upcomingTasks: UPCOMING });
    const second = spec({ memories: [MEMORY], upcomingTasks: UPCOMING });
    assert.deepEqual(first, second);
  });

  it("ne lit ni horloge, ni aleatoire", () => {
    assert.equal(spec().context, spec().context);
    assert.equal(spec().objective, spec().objective);
  });

  it("declare sa version", () => {
    assert.equal(spec().version, BOOTSTRAP_SPEC_VERSION);
    assert.equal(BOOTSTRAP_SPEC_VERSION, "bootstrap/1");
  });
});

describe("la forme de la tache", () => {
  it("porte le titre fixe de l'amorcage", () => {
    assert.equal(spec().title, BOOTSTRAP_TASK_TITLE);
    assert.equal(spec().title, "Bootstrap project repository and foundational documentation");
  });

  it("est prioritaire sans etre critique", () => {
    // Rien ne peut avancer avant elle ; ce n'est pas pour autant une urgence de
    // securite, et `CRITICAL` reste reserve a celles-la.
    assert.equal(spec().priority, TASK_PRIORITY.HIGH);
  });

  it("annonce un objectif de fondation, pas de fonctionnalite", () => {
    const objective = spec().objective;
    assert.ok(objective.includes("fondation de repository minimale"));
    assert.ok(objective.includes("documentation fondamentale"));
    assert.ok(objective.includes("sans"));
    assert.ok(objective.includes("implementer aucune fonctionnalite produit"));
  });

  it("respecte ses bornes", () => {
    const built = spec({ memories: [MEMORY], upcomingTasks: UPCOMING });
    assert.ok(built.objective.length <= BOOTSTRAP_SPEC_LIMITS.objective);
    assert.ok(built.context.length <= BOOTSTRAP_SPEC_LIMITS.context);
    assert.ok(built.outOfScope.length <= BOOTSTRAP_SPEC_LIMITS.outOfScope);
    assert.ok(built.acceptanceCriteria.length <= BOOTSTRAP_SPEC_LIMITS.criteria.max);
    for (const criterion of built.acceptanceCriteria) {
      assert.ok(criterion.length <= BOOTSTRAP_SPEC_LIMITS.criteria.length, criterion);
    }
  });

  it("porte au moins huit criteres verifiables", () => {
    assert.ok(spec().acceptanceCriteria.length >= 8);
  });
});

describe("le contexte transmis", () => {
  it("porte le brief et le plan valides", () => {
    const context = spec().context;
    assert.ok(context.includes("Brief produit"));
    assert.ok(context.includes("Preparer la semaine prend trop de temps."));
    assert.ok(context.includes("Plan de V1"));
    assert.ok(context.includes("Preparer une semaine de repas et sa liste de courses."));
  });

  it("porte la direction technique telle quelle, options comprises", () => {
    // C'est precisement l'information dont l'amorcage a besoin pour savoir s'il
    // lui revient de trancher.
    assert.ok(spec().context.includes("localStorage, IndexedDB ou un backend minimal"));
  });

  it("porte la memoire active quand il y en a", () => {
    const context = spec({ memories: [MEMORY] }).context;
    assert.ok(context.includes("Memoire du projet"));
    assert.ok(context.includes("MEM-001"));
    assert.ok(context.includes("Aucune dependance payante"));
  });

  it("dit explicitement qu'il n'y a aucune memoire active", () => {
    assert.ok(spec().context.includes("Aucune entree active."));
  });

  it("porte l'etat du repository constate", () => {
    const context = spec({ inspection: EXISTING_REPOSITORY }).context;
    assert.ok(context.includes("Etat du repository"));
    assert.ok(context.includes("package.json"));
    assert.ok(context.includes("Entrees a la racine : 12"));
  });

  it("dit que l'inventaire est grossier et date", () => {
    assert.ok(spec().context.includes("inspecte toi-meme le repository avant d'y toucher"));
  });

  it("ne transmet aucun transcript", () => {
    const context = spec({ memories: [MEMORY], upcomingTasks: UPCOMING }).context;
    assert.equal(context.includes("<conversation>"), false);
    assert.equal(context.includes("<user_message>"), false);
  });
});

describe("un repository existant est preserve", () => {
  const built = spec({ inspection: EXISTING_REPOSITORY, upcomingTasks: UPCOMING });

  it("annonce qu'une application existe deja", () => {
    assert.ok(built.context.includes("Une application existe deja dans ce repository."));
    assert.equal(built.shape, REPOSITORY_SHAPE.APPLICATION);
  });

  it("interdit de remplacer la pile en place", () => {
    assert.ok(built.context.includes("ne remplace pas une pile technique en place"));
    assert.ok(built.context.includes("ne supprime aucun code source"));
    assert.ok(built.context.includes("ne reinitialise"));
    assert.ok(built.context.includes("pas Git"));
    assert.ok(built.context.includes("n'ecrase aucune documentation sans l'avoir lue"));
  });

  it("n'autorise aucune nouvelle pile technique", () => {
    assert.ok(built.context.includes("N'introduis aucune nouvelle pile technique"));
  });

  it("porte des criteres de preservation verifiables", () => {
    const criteria = built.acceptanceCriteria.join("\n");
    assert.ok(criteria.includes("intacts"));
    assert.ok(criteria.includes("conservee et completee, jamais remplacee"));
  });
});

describe("un repository vide peut recevoir une pile", () => {
  const built = spec({ inspection: EMPTY_REPOSITORY });

  it("annonce que le repository est vide", () => {
    assert.ok(built.context.includes("Le repository est vide ou quasiment vide."));
    assert.equal(built.shape, REPOSITORY_SHAPE.EMPTY);
  });

  it("autorise le choix de la solution minimale", () => {
    assert.ok(built.context.includes("choisis la solution **minimale**"));
    assert.ok(built.context.includes("Prefere l'option la plus simple qui tienne"));
  });

  it("ne choisit aucune technologie a la place de l'implementeur", () => {
    // NOX ne sait pas quelle pile convient : le dire serait figer un choix que
    // le plan laisse ouvert.
    for (const forbidden of ["Next.js", "React", "Vue", "Django", "Rails", "Spring"]) {
      assert.equal(built.context.includes(forbidden), false, forbidden);
    }
  });

  it("rappelle la direction technique du plan quand elle existe", () => {
    assert.ok(built.context.includes("Respecte la direction technique du plan de V1"));
  });

  it("dit quand le plan n'en donne aucune", () => {
    const sans = spec({
      v1Plan: { ...PLAN, technicalDirection: "   " },
    });
    assert.ok(sans.context.includes("ne donne aucune direction technique explicite"));
  });

  it("demande de consigner chaque choix fait", () => {
    assert.ok(built.context.includes("Chaque choix que tu fais ici devient une decision durable"));
  });
});

describe("la frontiere du produit", () => {
  const built = spec({ upcomingTasks: UPCOMING, inspection: EMPTY_REPOSITORY });

  it("nomme les taches a venir pour les eviter, jamais pour les faire", () => {
    assert.ok(built.context.includes("TASK-001"));
    assert.ok(built.context.includes("seront executees **apres** celle-ci"));
    assert.ok(built.context.includes("jamais pour"));
    assert.ok(built.context.includes("etre implementees ici"));
  });

  it("interdit d'implementer une fonctionnalite produit", () => {
    assert.ok(
      built.outOfScope.includes(
        "Implementer une fonctionnalite produit de la V1, meme simple",
      ),
    );
    assert.ok(built.outOfScope.includes("TASK-001, TASK-002"));
  });

  it("interdit d'ajouter une capacite non demandee", () => {
    assert.ok(built.outOfScope.includes("Ajouter une capacite utilisateur que la V1 validee ne demande pas."));
  });

  it("interdit de modifier le perimetre produit", () => {
    assert.ok(built.outOfScope.includes("Modifier le perimetre du produit"));
  });

  it("interdit commit, push et deploiement", () => {
    assert.ok(built.outOfScope.includes("Creer un commit ou pousser vers un depot distant."));
    assert.ok(built.outOfScope.includes("Deployer, publier"));
  });

  it("porte un critere explicite de non-implementation", () => {
    const criteria = built.acceptanceCriteria.join("\n");
    assert.ok(criteria.includes("Aucune fonctionnalite produit des taches a venir"));
    assert.ok(criteria.includes("meme partiellement"));
  });

  it("porte ce critere meme sans tache a venir", () => {
    const criteria = spec().acceptanceCriteria.join("\n");
    assert.ok(criteria.includes("Aucune fonctionnalite produit de la V1 n'a"));
  });
});

describe("la documentation fondamentale", () => {
  const built = spec();

  it("nomme les huit documents et leur proprietaire", () => {
    for (const path of FOUNDATIONAL_DOCUMENTS) {
      assert.ok(built.context.includes(path), path);
    }
    assert.equal(FOUNDATIONAL_DOCUMENTS.length, 8);
  });

  it("demande de materialiser fidelement le brief et le plan", () => {
    assert.ok(built.context.includes("materialise-les fidelement"));
    assert.ok(built.context.includes("Ne les reinvente pas, ne les elargis pas"));
  });

  it("empeche la roadmap de devenir une seconde base de taches", () => {
    assert.ok(built.context.includes("ne doit pas devenir une seconde base de taches"));
  });

  it("interdit de presenter comme fait ce qui est seulement prevu", () => {
    assert.ok(built.context.includes("Ne presente jamais comme fait ce qui n'a pas ete construit."));
  });

  it("interdit une architecture racontee d'avance", () => {
    assert.ok(built.context.includes("Une architecture racontee d'avance est une fiction."));
  });

  it("dit quoi faire d'un document qui contredit l'intention validee", () => {
    assert.ok(built.context.includes("ne choisis pas une verite intermediaire"));
    assert.ok(built.context.includes("signale le conflit dans ton compte rendu"));
  });
});

describe("les documents references", () => {
  it("ne reference aucun document absent", () => {
    assert.deepEqual(spec({ inspection: EMPTY_REPOSITORY }).documentReferences, []);
  });

  it("ne reference que ce que l'inspection a reellement trouve", () => {
    const built = spec({
      inspection: {
        ...EMPTY_REPOSITORY,
        foundationalDocuments: ["README.md", "docs/ARCHITECTURE.md"],
      },
    });
    assert.deepEqual(built.documentReferences, ["README.md", "docs/ARCHITECTURE.md"]);
  });

  it("garde l'ordre de la liste de reference, pas celui de l'inspection", () => {
    const built = spec({
      inspection: {
        ...EMPTY_REPOSITORY,
        foundationalDocuments: ["docs/ROADMAP.md", "README.md"],
      },
    });
    assert.deepEqual(built.documentReferences, ["README.md", "docs/ROADMAP.md"]);
  });

  it("respecte la borne", () => {
    const built = spec({
      inspection: { ...EMPTY_REPOSITORY, foundationalDocuments: [...FOUNDATIONAL_DOCUMENTS] },
    });
    assert.ok(built.documentReferences.length <= BOOTSTRAP_SPEC_LIMITS.documents.max);
  });
});

describe("les commandes de validation", () => {
  it("sont vides, sur un repository vide comme sur un repository existant", () => {
    // NOX ne peut pas les connaitre : la pile d'un repository vide sera choisie
    // pendant l'execution, et les scripts d'un repository existant ne sont
    // jamais lus. Une liste vide est le seul etat honnete.
    assert.deepEqual(spec({ inspection: EMPTY_REPOSITORY }).validationCommands, []);
    assert.deepEqual(spec({ inspection: EXISTING_REPOSITORY }).validationCommands, []);
  });
});

describe("un contexte incomplet reste utilisable", () => {
  it("dit qu'un brief absent l'est", () => {
    assert.ok(spec({ brief: null }).context.includes("Brief produit"));
    assert.ok(spec({ brief: null }).context.includes("Non defini."));
  });

  it("dit qu'un plan absent l'est", () => {
    assert.ok(spec({ v1Plan: null }).context.includes("Plan de V1"));
  });

  it("produit une specification complete sans tache a venir", () => {
    const built = spec({ upcomingTasks: [] });
    assert.ok(built.context.includes("Aucune tache enregistree."));
    assert.ok(built.acceptanceCriteria.length >= 8);
    assert.ok(built.outOfScope.length > 0);
  });
});


/**
 * Installer et verifier la fondation.
 *
 * Le premier run reel a livre un repository dont les dependances n'etaient pas
 * installees. Deux causes, corrigees ensemble : le prompt interdisait toute
 * commande, et le contrat ne demandait rien de plus que « le projet demarre ».
 * Une permission sans exigence n'aurait servi a rien ; une exigence sans
 * permission serait restee inverifiable.
 */
describe("installer et verifier la fondation", () => {
  it("demande l'installation des dependances et le fichier de verrouillage", () => {
    const criteria = spec().acceptanceCriteria.join("\n");

    assert.ok(criteria.includes("dependances de la pile retenue sont installees"));
    assert.ok(criteria.includes("fichier de verrouillage"));
  });

  it("demande que la build et les tests aient tourne lorsqu'ils existent", () => {
    const criteria = spec().acceptanceCriteria.join("\n");

    assert.ok(criteria.includes("build et les tests ont ete lances"));
    // « Non lance » et « echoue » restent deux faits distincts : le compte rendu
    // doit dire lequel.
    assert.ok(criteria.includes("n'a pas pu l'etre, avec sa raison"));
  });

  it("exige un demarrage verifie, pas suppose", () => {
    const criteria = spec().acceptanceCriteria.join("\n");

    assert.ok(criteria.includes("verifie plutot que suppose"));
  });

  it("porte la meme exigence sur un repository existant", () => {
    // Un depot qui porte deja une application doit lui aussi etre installable :
    // c'est meme la que la verification a le plus de valeur.
    const criteria = spec({ inspection: EXISTING_REPOSITORY }).acceptanceCriteria.join("\n");

    assert.ok(criteria.includes("dependances de la pile retenue sont installees"));
    assert.ok(criteria.includes("build et les tests ont ete lances"));
  });

  it("reste sous la borne de criteres", () => {
    for (const inspection of [EMPTY_REPOSITORY, EXISTING_REPOSITORY]) {
      const built = spec({ inspection, upcomingTasks: UPCOMING, memories: [MEMORY] });
      assert.ok(
        built.acceptanceCriteria.length <= BOOTSTRAP_SPEC_LIMITS.criteria.max,
        `${String(built.acceptanceCriteria.length)} criteres`,
      );
    }
  });

  it("explique dans le contexte ce qu'installer veut dire", () => {
    const context = spec().context;

    assert.ok(context.includes("Installer et verifier la fondation"));
    assert.ok(context.includes("Une fondation qui n'a jamais tourne n'est pas une fondation"));
    assert.ok(context.includes("laisse le fichier de verrouillage"));
    assert.ok(context.includes("sans laisser tourner un serveur"));
  });

  it("distingue le setup d'une validation structuree", () => {
    const context = spec().context;

    assert.ok(context.includes("Ces commandes ne sont pas des validations enregistrees"));
    assert.ok(context.includes("n'en invente aucune qui sorte de"));
  });

  it("demande de dire ce qui reste non verifie", () => {
    const context = spec().context;

    assert.ok(context.includes("ne la contourne pas"));
    assert.ok(context.includes("ce qui reste non verifie"));
  });

  it("ne nomme aucun ecosysteme", () => {
    // NOX ne sait pas encore quelle pile sera choisie. Souffler `npm` ici
    // reviendrait a la choisir a moitie, et a rendre le texte faux pour toutes
    // les autres.
    const built = spec();
    const text = [built.objective, built.context, ...built.acceptanceCriteria].join("\n");

    for (const forbidden of ["npm", "pnpm", "yarn", "cargo", "pip", "bundler", "gradle", "dotnet"]) {
      assert.ok(!text.toLowerCase().includes(forbidden), forbidden);
    }
  });

  it("n'enregistre toujours aucune commande de validation", () => {
    // L'ouverture porte sur les permissions et sur le contrat, jamais sur ce
    // champ : NOX ne peut pas connaitre les commandes d'une pile qui n'existe
    // pas encore, et en inventer produirait des validations fausses.
    assert.deepEqual(spec().validationCommands, []);
    assert.deepEqual(spec({ inspection: EXISTING_REPOSITORY }).validationCommands, []);
  });

  it("reste deterministe", () => {
    assert.deepEqual(spec(), spec());
    assert.equal(spec().version, BOOTSTRAP_SPEC_VERSION);
  });
});
