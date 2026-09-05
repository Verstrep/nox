/**
 * Les dependances dans un backlog : ce que le contrat accepte, et ce qu'il refuse.
 *
 * ## Le scenario, et pourquoi c'est celui-la
 *
 * Celui du premier pilote reel, TripKit. Deux taches :
 *
 * ```text
 * TASK-001  Gerer localement les deplacements et leurs hotels
 * TASK-002  Gerer les notes de frais et leur total
 * ```
 *
 * `TASK-002` etend le modele, la persistance et la fiche de detail que
 * `TASK-001` cree. Le backlog produit affichait pourtant « aucune dependance »
 * des deux cotes — non parce que le modele avait mal juge, mais parce que
 * `backlog/2` n'avait aucun champ ou l'ecrire, et interdisait explicitement d'en
 * parler.
 *
 * ## Ce que ce fichier ne teste pas
 *
 * L'intelligence du modele. Aucun test ici ne verifie qu'un fournisseur
 * *decouvre* la dependance : ce serait tester quelqu'un d'autre. Ce qui est
 * verifie est que **NOX la demande explicitement**, qu'il sait la lire, et qu'il
 * refuse tout ce qu'il ne saurait pas garantir.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ARCHITECT_BACKLOG_LIMITS,
  ARCHITECT_BACKLOG_SCHEMA_NAME_3,
  ARCHITECT_BACKLOG_SCHEMA_VERSION,
  ARCHITECT_BACKLOG_SCHEMA_VERSION_2,
  ARCHITECT_BACKLOG_SCHEMA_VERSION_3,
  buildArchitectBacklogSchemaV3,
  readAnyArchitectBacklogProposal,
  readArchitectBacklogProposalV3,
  TASK_PRIORITY,
  VERIFICATION_MODE,
  renderBacklogPrompt,
  BACKLOG_PROMPT_VERSION,
} from "../dist/index.js";

const DOCUMENTS = ["docs/ROADMAP.md"];

/** Les deux taches du pilote, sous la forme que le fournisseur rendrait. */
function tripkit(overrides: {
  first?: Record<string, unknown>;
  second?: Record<string, unknown>;
  version?: number;
} = {}): Record<string, unknown> {
  const task = (title: string, objective: string): Record<string, unknown> => ({
    title,
    priority: TASK_PRIORITY.MEDIUM,
    objective,
    context: null,
    acceptanceCriteria: [
      {
        text: `${title} fonctionne`,
        verificationMode: VERIFICATION_MODE.HUMAN,
        humanInstructions: "Verifier a la main.",
        validationCommandIndexes: [],
      },
    ],
    outOfScope: [],
    documentReferences: [],
    validationCommands: [],
    dependsOn: [],
  });

  return {
    schemaVersion: overrides.version ?? ARCHITECT_BACKLOG_SCHEMA_VERSION_3,
    message: "Deux increments : le modele de deplacement, puis les notes de frais.",
    tasks: [
      {
        ...task("Gerer les deplacements et leurs hotels", "Creer le modele, la persistance, la fiche."),
        ...overrides.first,
      },
      {
        ...task("Gerer les notes de frais et leur total", "Etendre le modele et la fiche."),
        dependsOn: [0],
        ...overrides.second,
      },
    ],
  };
}

describe("le scenario TripKit se represente maintenant", () => {
  it("lit « TASK-002 attend TASK-001 »", () => {
    const read = readArchitectBacklogProposalV3(tripkit(), DOCUMENTS);
    assert.ok(read.ok);
    assert.deepEqual(read.proposal.tasks[0]?.dependsOn, []);
    assert.deepEqual(read.proposal.tasks[1]?.dependsOn, [0]);
  });

  it("accepte un backlog sans aucune dependance", () => {
    // Deux taches reellement independantes n'ont rien a declarer, et une chaine
    // ou tout attend tout n'apprendrait rien a personne.
    const read = readArchitectBacklogProposalV3(
      tripkit({ second: { dependsOn: [] } }),
      DOCUMENTS,
    );
    assert.ok(read.ok);
    assert.deepEqual(read.proposal.tasks[1]?.dependsOn, []);
  });

  it("traite un champ absent comme une absence de dependance", () => {
    const payload = tripkit();
    const tasks = payload["tasks"] as Record<string, unknown>[];
    delete tasks[1]?.["dependsOn"];
    const read = readArchitectBacklogProposalV3(payload, DOCUMENTS);
    assert.ok(read.ok);
    assert.deepEqual(read.proposal.tasks[1]?.dependsOn, []);
  });
});

describe("le graphe est garanti, jamais devine", () => {
  it("refuse une reference vers l'avant, et le dit", () => {
    // Un plan ou la tache 1 attend la tache 2 est un plan dont l'ordre est faux.
    // NOX le refuse et le nomme, plutot que de reordonner en silence.
    const read = readArchitectBacklogProposalV3(
      tripkit({ first: { dependsOn: [1] } }),
      DOCUMENTS,
    );
    assert.ok(!read.ok);
    assert.equal(read.refusal.field, "tasks.0.dependsOn");
    assert.match(read.refusal.message, /ne la precede pas/u);
  });

  it("refuse qu'une tache s'attende elle-meme", () => {
    const read = readArchitectBacklogProposalV3(
      tripkit({ second: { dependsOn: [1] } }),
      DOCUMENTS,
    );
    assert.ok(!read.ok);
    assert.match(read.refusal.message, /s'attend elle-meme/u);
  });

  it("rend un cycle structurellement impossible", () => {
    // Un cycle demanderait au moins une arete vers l'avant. Il n'existe donc
    // aucun parcours de graphe a ecrire, et aucun a oublier.
    const read = readArchitectBacklogProposalV3(
      tripkit({ first: { dependsOn: [1] }, second: { dependsOn: [0] } }),
      DOCUMENTS,
    );
    assert.ok(!read.ok);
  });

  it("refuse une position qui ne designe aucune tache", () => {
    const read = readArchitectBacklogProposalV3(
      tripkit({ second: { dependsOn: [7] } }),
      DOCUMENTS,
    );
    assert.ok(!read.ok);
  });

  it("refuse ce qui n'est pas une position", () => {
    for (const value of [["TASK-001"], [1.5], [null], "0", { 0: 0 }]) {
      const read = readArchitectBacklogProposalV3(
        tripkit({ second: { dependsOn: value } }),
        DOCUMENTS,
      );
      assert.ok(!read.ok, JSON.stringify(value));
    }
  });

  it("dedoublonne et trie", () => {
    const read = readArchitectBacklogProposalV3(
      tripkit({ second: { dependsOn: [0, 0] } }),
      DOCUMENTS,
    );
    assert.ok(read.ok);
    assert.deepEqual(read.proposal.tasks[1]?.dependsOn, [0]);
  });

  it("conserve la borne commune de NOX", () => {
    assert.equal(ARCHITECT_BACKLOG_LIMITS.dependencies.max, 50);
  });

  it("refuse tout le backlog des qu'une seule tache est fautive", () => {
    // Un backlog est une unite : conserver la tache valide livrerait un
    // decoupage dont personne ne saurait dire ce qui manque.
    const read = readArchitectBacklogProposalV3(
      tripkit({ second: { dependsOn: [3] } }),
      DOCUMENTS,
    );
    assert.ok(!read.ok);
  });
});

describe("les propositions anterieures restent lisibles", () => {
  it("releve une proposition de version 2 sans lui inventer de dependance", () => {
    const payload = tripkit({ version: ARCHITECT_BACKLOG_SCHEMA_VERSION_2, second: { dependsOn: [0] } });
    const read = readAnyArchitectBacklogProposal(payload, DOCUMENTS);
    assert.ok(read.ok);
    assert.equal(read.proposal.schemaVersion, ARCHITECT_BACKLOG_SCHEMA_VERSION_3);
    // Le `dependsOn` present dans un document estampille version 2 est ignore :
    // la version portee par le document decide, et une version 2 n'exprimait
    // aucune dependance. Lui en accorder une apres coup lui ferait dire ce que
    // son auteur n'avait pas dit.
    assert.deepEqual(read.proposal.tasks[1]?.dependsOn, []);
  });

  it("releve une proposition de version 1 avec les memes defauts surs", () => {
    const read = readAnyArchitectBacklogProposal(
      {
        schemaVersion: ARCHITECT_BACKLOG_SCHEMA_VERSION,
        message: "Un backlog historique.",
        tasks: [
          {
            title: "Une tache",
            priority: TASK_PRIORITY.MEDIUM,
            objective: "Un objectif.",
            context: null,
            acceptanceCriteria: ["Un critere"],
            outOfScope: [],
            documentReferences: [],
            validationCommands: [],
          },
        ],
      },
      DOCUMENTS,
    );
    assert.ok(read.ok);
    assert.equal(read.proposal.schemaVersion, ARCHITECT_BACKLOG_SCHEMA_VERSION_3);
    assert.deepEqual(read.proposal.tasks[0]?.dependsOn, []);
  });
});

describe("le schema transmis au fournisseur", () => {
  it("porte le champ, avec sa contrainte dite", () => {
    const schema = buildArchitectBacklogSchemaV3();
    const tasks = (schema["properties"] as Record<string, unknown>)["tasks"] as Record<string, unknown>;
    const item = tasks["items"] as Record<string, unknown>;
    const fields = item["properties"] as Record<string, unknown>;
    const dependsOn = fields["dependsOn"] as Record<string, unknown>;

    assert.equal(dependsOn["type"], "array");
    assert.match(String(dependsOn["description"]), /Strictement anterieures/u);
    assert.ok((item["required"] as string[]).includes("dependsOn"));
    assert.equal(item["additionalProperties"], false);
  });

  it("declare la version 3, et rien d'autre", () => {
    const schema = buildArchitectBacklogSchemaV3();
    const version = (schema["properties"] as Record<string, unknown>)["schemaVersion"] as Record<
      string,
      unknown
    >;
    assert.deepEqual(version["enum"], [ARCHITECT_BACKLOG_SCHEMA_VERSION_3]);
    assert.equal(ARCHITECT_BACKLOG_SCHEMA_NAME_3, "nox_v1_backlog_v3");
  });

  it("ne declare aucune borne de taille", () => {
    // Le sous-ensemble accepte en mode strict les ignore, et les declarer ferait
    // echouer la requete entiere.
    const serialized = JSON.stringify(buildArchitectBacklogSchemaV3());
    for (const forbidden of ["maxItems", "minItems", "maxLength", "pattern"]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  });
});

describe("le contrat transmis demande explicitement la dependance", () => {
  // C'est le point de A4 : ce test prouve que **NOX demande**, pas que le modele
  // repond bien. L'intelligence du fournisseur n'est pas testable ici, et
  // pretendre le contraire donnerait une fausse assurance.
  const prompt = renderBacklogPrompt({
    projectName: "TripKit",
    instructionDocuments: [],
    projectBrief: null,
    projectV1Plan: null,
    projectMemory: [],
    existingTasks: [],
    contextDocuments: [],
    availableDocuments: [],
  });

  it("est etiquete backlog/3", () => {
    assert.equal(prompt.version, BACKLOG_PROMPT_VERSION);
    assert.equal(prompt.version, "backlog/3");
  });

  it("dit qu'une dependance est un prerequis reel", () => {
    assert.match(
      prompt.instructions,
      /suppose l'existence de quelque chose que/u,
      "la semantique est ecrite, pas supposee",
    );
    assert.ok(prompt.instructions.includes("**ce que cette tache etend,"));
    assert.ok(prompt.instructions.includes("lit, affiche ou complete, qui le cree ?**"));
  });

  it("decrit exactement le cas du pilote", () => {
    // Une tache cree une entite, sa persistance et sa fiche ; une autre y ajoute
    // une notion supplementaire. La seconde attend la premiere.
    assert.match(prompt.instructions, /une tache cree une entite, sa persistance et sa fiche de detail/u);
    assert.match(prompt.instructions, /La seconde attend la premiere/u);
  });

  it("dit que l'ordre seul n'empeche rien", () => {
    assert.match(prompt.instructions, /L'ordre est une recommandation ; une dependance est une contrainte\./u);
    assert.match(prompt.instructions, /autorise donc l'execution des taches dans n'importe quel ordre/u);
  });

  it("interdit la dependance chronologique automatique", () => {
    assert.match(
      prompt.instructions,
      /Ne rattache pas mecaniquement chaque tache a celle qui la precede/u,
    );
    assert.match(prompt.instructions, /restent\s+independantes/u);
  });

  it("annonce la contrainte que le validateur fait respecter", () => {
    assert.match(prompt.instructions, /strictement anterieure/u);
    assert.match(prompt.instructions, /`dependsOn` porte les \*\*positions\*\*/u);
  });

  it("ne souffle aucun code de tache au fournisseur", () => {
    // Les codes sont attribues par NOX a l'application : une dependance
    // exprimee en `TASK-002` serait un chemin de donnees que le modele n'a pas
    // le droit d'ouvrir.
    assert.equal(prompt.instructions.includes("TASK-00"), false);
  });
});
