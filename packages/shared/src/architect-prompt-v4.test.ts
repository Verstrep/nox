/**
 * Le prompt `architect/4` : conversation projet et etat structure.
 *
 * ## Ce que ce fichier verifie
 *
 * Deux choses que le reste de la suite ne verifie pas.
 *
 * D'abord **l'ordre des sources**. Il porte une hierarchie : ce que
 * l'utilisateur a valide dans NOX est courant par construction, la documentation
 * du repository peut avoir pris du retard. Un ordre qui presenterait la seconde
 * en premier laisserait croire l'inverse, et aucune phrase du prompt ne
 * rattraperait cette impression.
 *
 * Ensuite **ce que les instructions disent**. Un prompt est du code : il decide
 * de ce que le modele produit, et ses regles se cassent en silence. Les assertions
 * portent sur des idees, jamais sur des tournures — elles cherchent les mots qui
 * ne peuvent pas disparaitre sans que la regle disparaisse avec eux.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ARCHITECT_PROMPT_VERSION,
  ARCHITECT_PROMPT_VERSION_V4,
  ARCHITECT_SESSION_KIND,
  architectPromptVersion,
  renderArchitectPrompt,
  type ArchitectPromptBrief,
  type ArchitectPromptInput,
  type ArchitectPromptV1Plan,
} from "../dist/index.js";

const BRIEF: ArchitectPromptBrief = {
  revision: "b".repeat(64),
  summary: "Un suivi de lectures personnel.",
  problem: "Rien ne centralise ce que je lis.",
  targetUsers: "Moi seul.",
  desiredOutcome: "Savoir ce que j'ai lu cette annee.",
  goals: ["Enregistrer un livre"],
  nonGoals: ["Reseau social"],
};

const PLAN: ArchitectPromptV1Plan = {
  revision: "c".repeat(64),
  goal: "Suivre une annee de lectures.",
  inScope: ["Liste des livres"],
  outOfScope: ["Application mobile"],
  technicalDirection: "Application web simple.",
  milestones: ["La liste est utilisable"],
};

function input(overrides: Partial<ArchitectPromptInput> = {}): ArchitectPromptInput {
  return {
    sessionKind: ARCHITECT_SESSION_KIND.PROJECT,
    projectName: "Suivi de lectures",
    planningState: null,
    instructionDocuments: [
      { path: "CLAUDE.md", revision: "a".repeat(64), truncated: false, content: "# Regles" },
    ],
    contextDocuments: [
      {
        path: "docs/ARCHITECTURE.md",
        revision: "d".repeat(64),
        truncated: false,
        content: "# Architecture",
      },
    ],
    projectMemory: [
      {
        code: "MEM-001",
        category: "DECISION",
        revision: "e".repeat(64),
        title: "SQLite",
        content: "Nous stockons en SQLite.",
        rationale: null,
      },
    ],
    projectBrief: BRIEF,
    projectV1Plan: PLAN,
    recentTasks: [
      {
        code: "TASK-001",
        title: "Lister les livres",
        status: "COMPLETED",
        objective: "Afficher la liste.",
        outOfScope: null,
        acceptanceCriteria: ["La liste s'affiche."],
        documentReferences: [],
        validationCommands: [],
      },
    ],
    availableDocuments: ["docs/ARCHITECTURE.md"],
    transcript: [],
    newMessage: "Que me conseilles-tu ?",
    ...overrides,
  };
}

/** Position d'un titre de section dans l'entree assemblee. */
function at(text: string, heading: string): number {
  const index = text.indexOf(`## ${heading}`);
  assert.notEqual(index, -1, `section absente : ${heading}`);
  return index;
}

describe("version du prompt", () => {
  it("une conversation projet utilise architect/4", () => {
    assert.equal(architectPromptVersion(ARCHITECT_SESSION_KIND.PROJECT), ARCHITECT_PROMPT_VERSION_V4);
    assert.equal(renderArchitectPrompt(input()).version, ARCHITECT_PROMPT_VERSION_V4);
  });

  it("une session de conception de tache reste en architect/3", () => {
    assert.equal(
      architectPromptVersion(ARCHITECT_SESSION_KIND.TASK_DESIGN_LEGACY),
      ARCHITECT_PROMPT_VERSION,
    );
    const prompt = renderArchitectPrompt(
      input({ sessionKind: ARCHITECT_SESSION_KIND.TASK_DESIGN_LEGACY }),
    );
    assert.equal(prompt.version, ARCHITECT_PROMPT_VERSION);
  });

  it("les deux versions ne portent pas les memes instructions", () => {
    const project = renderArchitectPrompt(input());
    const legacy = renderArchitectPrompt(
      input({ sessionKind: ARCHITECT_SESSION_KIND.TASK_DESIGN_LEGACY }),
    );
    assert.notEqual(project.instructions, legacy.instructions);
  });

  it("une session de conception de tache n'entend jamais parler de mise a jour", () => {
    const legacy = renderArchitectPrompt(
      input({ sessionKind: ARCHITECT_SESSION_KIND.TASK_DESIGN_LEGACY }),
    );
    assert.equal(legacy.instructions.includes("projectUpdate"), false);
    assert.equal(legacy.instructions.includes("UNCHANGED"), false);
  });
});

describe("ordre des sources", () => {
  it("place l'etat structure avant tout le reste", () => {
    const { input: body } = renderArchitectPrompt(input());
    assert.ok(at(body, "Projet") < at(body, "Brief produit actuel"));
    assert.ok(at(body, "Brief produit actuel") < at(body, "Plan de V1 actuel"));
    assert.ok(at(body, "Plan de V1 actuel") < at(body, "Conventions du projet"));
  });

  it("place la memoire et les taches avant la documentation du repository", () => {
    // La regression que ce test attrape : la documentation ordinaire remontant
    // au-dessus de l'etat durable de NOX.
    const { input: body } = renderArchitectPrompt(input());
    assert.ok(at(body, "Memoire du projet") < at(body, "Documentation du projet"));
    assert.ok(at(body, "Taches recentes") < at(body, "Documentation du projet"));
  });

  it("garde les conventions au-dessus de la memoire", () => {
    // `CLAUDE.md` et `AGENTS.md` sont des regles, pas de la documentation : ils
    // conservent leur place.
    const { input: body } = renderArchitectPrompt(input());
    assert.ok(at(body, "Conventions du projet") < at(body, "Memoire du projet"));
  });

  it("termine par la conversation puis le message en attente", () => {
    const { input: body } = renderArchitectPrompt(
      input({
        transcript: [{ role: "USER", content: "Un message d'avant." }],
      }),
    );
    assert.ok(at(body, "Documentation du projet") < at(body, "Conversation"));
    assert.ok(at(body, "Conversation") < at(body, "Message de l'utilisateur"));
  });

  it("garde l'ordre complet attendu", () => {
    const { input: body } = renderArchitectPrompt(
      input({ transcript: [{ role: "USER", content: "Un message d'avant." }] }),
    );
    const order = [
      "Projet",
      "Brief produit actuel",
      "Plan de V1 actuel",
      "Conventions du projet",
      "Memoire du projet",
      "Taches recentes",
      "Documentation du projet",
      "Documents referencables",
      "Conversation",
      "Message de l'utilisateur",
    ];
    const positions = order.map((heading) => at(body, heading));
    assert.deepEqual(
      positions,
      [...positions].sort((left, right) => left - right),
      "les sections se suivent dans l'ordre attendu",
    );
  });
});

describe("instructions architect/4", () => {
  const instructions = renderArchitectPrompt(input()).instructions;

  it("annonce une conversation durable", () => {
    assert.ok(instructions.includes("Cette conversation ne se termine pas"));
  });

  it("autorise un CONTINUE sans proposition", () => {
    assert.ok(instructions.includes("CONTINUE"));
    assert.ok(instructions.includes("Ne force pas une proposition"));
  });

  it("dit que la mise a jour du projet est facultative", () => {
    assert.ok(instructions.includes("projectUpdate"));
    assert.ok(instructions.includes("Laisse-le vide le reste du temps"));
  });

  it("dit que l'etat structure est l'intention produit actuelle", () => {
    assert.ok(instructions.includes("intention"));
    assert.ok(instructions.includes("Project Brief"));
    assert.ok(instructions.includes("Living V1 Plan"));
  });

  it("distingue la memoire de l'etat structure", () => {
    assert.ok(instructions.includes("memoire du projet"));
    assert.ok(instructions.includes("decisions, contraintes, conventions"));
  });

  it("dit que la documentation du repository peut avoir pris du retard", () => {
    assert.ok(instructions.includes("pris du retard"));
  });

  it("demande de signaler une incoherence plutot que de fusionner", () => {
    assert.ok(instructions.includes("signale l'incoherence"));
    assert.ok(instructions.includes("au lieu de fusionner"));
    assert.ok(instructions.includes("c'est l'etat structure qui fait foi"));
  });

  it("interdit de modifier la documentation du repository", () => {
    assert.ok(instructions.includes("Tu ne modifies jamais"));
  });

  it("dit que seul l'utilisateur applique", () => {
    assert.ok(instructions.includes("Seul l'utilisateur peut"));
  });

  it("interdit au modele de pretendre avoir applique", () => {
    // La regle la plus importante du lot : un modele qui croit avoir modifie le
    // projet le racontera, et cette phrase sera fausse.
    assert.ok(instructions.includes("Ne dis jamais que tu as mis a jour"));
    assert.ok(instructions.includes("il n'a pas ete applique"));
  });

  it("explique les deux actions", () => {
    assert.ok(instructions.includes("UNCHANGED"));
    assert.ok(instructions.includes("SET"));
    assert.ok(instructions.includes("etat cible entier"));
  });

  it("distingue une reflexion d'une decision", () => {
    assert.ok(instructions.includes("Une reflexion n'est pas une decision"));
  });

  it("interdit une roadmap de plusieurs taches", () => {
    assert.ok(instructions.includes("ne rends jamais une roadmap structuree"));
  });

  it("limite a une proposition de tache", () => {
    assert.ok(instructions.includes("Une proposition porte **une** tache"));
  });

  it("n'expose ni ne demande de raisonnement interne", () => {
    assert.ok(instructions.includes("Tu n'exposes aucun raisonnement interne"));
  });

  it("dit qu'une etape est une capacite atteinte", () => {
    assert.ok(instructions.includes("capacite atteinte"));
  });
});

describe("etat structure absent", () => {
  it("dit explicitement qu'un brief n'est pas defini", () => {
    const { input: body } = renderArchitectPrompt(input({ projectBrief: null }));
    assert.ok(body.includes("Project Brief : non defini."));
  });

  it("dit explicitement qu'un plan n'est pas defini", () => {
    const { input: body } = renderArchitectPrompt(input({ projectV1Plan: null }));
    assert.ok(body.includes("Living V1 Plan : non defini."));
  });

  it("garde l'ordre meme quand l'etat structure est absent", () => {
    const { input: body } = renderArchitectPrompt(
      input({ projectBrief: null, projectV1Plan: null }),
    );
    assert.ok(at(body, "Brief produit actuel") < at(body, "Memoire du projet"));
    assert.ok(at(body, "Memoire du projet") < at(body, "Documentation du projet"));
  });
});
