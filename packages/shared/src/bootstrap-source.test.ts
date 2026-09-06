/**
 * Fidelite de la source d'amorcage.
 *
 * ## Ce que ce fichier prouve
 *
 * Que ce que `TASK-000` a la charge de materialiser — le brief produit, le plan
 * de V1, la memoire active — traverse **entier** la chaine qui va de l'etat
 * canonique jusqu'au prompt d'execution. Les valeurs de test sont volontairement
 * dimensionnees pres des bornes metier reelles : ecrites plus courtes, elles
 * auraient survecu au rendu tronque d'avant HOTFIX-007, et ces tests seraient
 * passes sur le code qui a produit le defaut.
 *
 * Que ce qui n'est pas contractuel — l'inventaire des taches a venir — reste
 * libre d'etre resume, et qu'un resume ne peut pas repartir comme une source.
 *
 * Et qu'un etat produit hors de ses propres bornes est **refuse en le nommant**,
 * jamais coupe en silence.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  BOOTSTRAP_SOURCE_LIMITS,
  BOOTSTRAP_SUPPLEMENT_HEADING,
  PROJECT_MEMORY_LIMITS,
  PROJECT_PLAN_LIMITS,
  TASK_KIND,
  TASK_PRIORITY,
  TASK_STATUS,
  buildBootstrapTaskSpec,
  canonicalBootstrapValues,
  checkBootstrapSourceFidelity,
  legacyBootstrapSourceMatches,
  legacyTruncate,
  renderBootstrapSource,
  renderBootstrapSourceSupplement,
  renderClaudeExecutionPrompt,
  renderLegacyBootstrapSource,
  renderTaskMarkdown,
  summarizeForDisplay,
  type ArchitectPromptBrief,
  type ArchitectPromptMemory,
  type ArchitectPromptV1Plan,
  type BootstrapSpecInput,
  type BootstrapTaskSpec,
  type DevelopmentTaskDetail,
  type RepositoryInspection,
} from "../dist/index.js";

// --- Sentinelles -------------------------------------------------------------
//
// Chaque valeur longue se termine par une chaine unique. Une troncature les
// emporte en premier, ce qui rend l'echec immediatement lisible : ce n'est pas
// « le texte differe », c'est « la fin manque ».

const DIRECTION_TAIL = "FIN-DIRECTION-TECHNIQUE-7f3a";
const MEMORY_CONTENT_TAIL = "FIN-CONTENU-MEMOIRE-91b2";
const MEMORY_RATIONALE_TAIL = "FIN-RAISON-MEMOIRE-4c8d";

/** Une valeur de `length` caracteres se terminant exactement par `tail`. */
function sized(length: number, tail: string): string {
  const filler = "phrase de remplissage lisible. ".repeat(
    Math.ceil(length / "phrase de remplissage lisible. ".length),
  );
  return filler.slice(0, Math.max(0, length - tail.length)) + tail;
}

const EMPTY_REPOSITORY: RepositoryInspection = {
  manifests: [],
  sourceDirectories: [],
  foundationalDocuments: [],
  hasCommits: false,
  rootEntryCount: 0,
  rootEntryCountTruncated: false,
};

const BRIEF: ArchitectPromptBrief = {
  revision: "brief-1",
  summary: "Un outil de suivi des incidents pour une equipe de support.",
  problem: "Les exports Excel ne se comparent pas d'un site a l'autre.",
  targetUsers: "Les responsables d'exploitation.",
  desiredOutcome: "Preparer une intervention en connaissant le contexte.",
  goals: ["Consolider les exports", "Comparer un site a l'ensemble"],
  nonGoals: ["Remplacer l'outil de ticketing"],
};

/** Un plan dont la direction technique frole la borne metier des 4 Kio. */
const PLAN: ArchitectPromptV1Plan = {
  revision: "plan-1",
  goal: "Livrer une application locale de consolidation et de comparaison.",
  inScope: ["Import controle", "Comparaison par periode"],
  outOfScope: ["Hebergement distant"],
  technicalDirection: sized(PROJECT_PLAN_LIMITS.technicalDirection, DIRECTION_TAIL),
  milestones: ["L'import fonctionne"],
};

/** Une entree de memoire dont le contenu et la raison frolent leurs bornes. */
const MEMORY: ArchitectPromptMemory = {
  code: "MEM-001",
  category: "CONSTRAINT",
  revision: "mem-1",
  title: "Structure obligatoire des classeurs importables",
  content: sized(PROJECT_MEMORY_LIMITS.content, MEMORY_CONTENT_TAIL),
  rationale: sized(PROJECT_MEMORY_LIMITS.rationale, MEMORY_RATIONALE_TAIL),
};

function specOf(overrides: Partial<BootstrapSpecInput> = {}): BootstrapTaskSpec {
  const built = buildBootstrapTaskSpec({
    projectName: "TicketPulse",
    brief: BRIEF,
    v1Plan: PLAN,
    memories: [MEMORY],
    upcomingTasks: [],
    inspection: EMPTY_REPOSITORY,
    ...overrides,
  });
  assert.ok(built.ok, "la construction devait aboutir");
  return built.spec;
}

/** La tache telle qu'elle sera enregistree, a partir de la specification. */
function taskOf(spec: BootstrapTaskSpec): DevelopmentTaskDetail {
  return {
    id: "task-000",
    projectId: "projet-1",
    code: "TASK-000",
    kind: TASK_KIND.BOOTSTRAP,
    title: spec.title,
    status: TASK_STATUS.READY,
    priority: TASK_PRIORITY.HIGH,
    documentSyncStatus: "SYNCED",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    objective: spec.objective,
    context: spec.context,
    outOfScope: spec.outOfScope,
    acceptanceCriteria: spec.acceptanceCriteria,
    documentReferences: spec.documentReferences,
    validationCommands: spec.validationCommands,
    documentPath: "tasks/TASK-000.md",
    documentRevision: null,
    documentSyncError: null,
  };
}

describe("A. la direction technique arrive entiere dans TASK-000", () => {
  it("porte sa sentinelle de fin dans le Markdown de la tache", () => {
    const spec = specOf();
    const markdown = renderTaskMarkdown(taskOf(spec));

    assert.ok(markdown.includes(PLAN.technicalDirection));
    assert.ok(markdown.includes(DIRECTION_TAIL));
  });

  it("aurait ete coupee par le rendu d'avant HOTFIX-007", () => {
    // Sans cette assertion, rien ne prouverait que la valeur de test est assez
    // longue pour que le test A ait un sens.
    const legacy = legacyTruncate(PLAN.technicalDirection, 600);
    assert.equal(legacy.includes(DIRECTION_TAIL), false);
    assert.ok(legacy.endsWith("…"));
  });
});

describe("B. la meme source arrive dans le prompt d'execution", () => {
  it("porte la sentinelle de la direction technique", () => {
    const prompt = renderClaudeExecutionPrompt(taskOf(specOf()), [], null);

    assert.ok(prompt.includes(PLAN.technicalDirection));
    assert.ok(prompt.includes(DIRECTION_TAIL));
  });

  it("ne signale aucune troncature", () => {
    const prompt = renderClaudeExecutionPrompt(taskOf(specOf()), [], null);
    assert.equal(prompt.includes("Contenu tronque par NOX"), false);
  });
});

describe("C. une entree de memoire survit avec sa raison", () => {
  it("transporte le contenu et la justification, entiers", () => {
    const context = specOf().context;

    assert.ok(context.includes(MEMORY.content));
    assert.ok(context.includes(MEMORY_CONTENT_TAIL));
    assert.ok(context.includes(MEMORY.rationale ?? ""));
    assert.ok(context.includes(MEMORY_RATIONALE_TAIL));
  });

  it("distingue le titre, la categorie, le contenu et la raison", () => {
    const context = specOf().context;

    assert.ok(context.includes(`${MEMORY.code} · ${MEMORY.category} · ${MEMORY.title}`));
    assert.ok(context.includes("**Raison**"));
  });

  it("aurait perdu les deux sous le rendu d'avant HOTFIX-007", () => {
    const legacy = renderLegacyBootstrapSource({
      brief: BRIEF,
      v1Plan: PLAN,
      memories: [MEMORY],
    });
    assert.equal(legacy.includes(MEMORY_CONTENT_TAIL), false);
    assert.equal(legacy.includes(MEMORY_RATIONALE_TAIL), false);
  });
});

describe("D. aucune entree de liste ne disparait", () => {
  // Vingt elements par liste, c'est la borne metier du nombre. Leur longueur est
  // choisie pour que les trois listes tiennent dans le budget commun des 16 Kio :
  // les deux bornes ne sont pas saturables en meme temps, et c'est le budget qui
  // fait autorite. Chacun reste bien au-dela des 300 caracteres que le rendu
  // d'avant HOTFIX-007 laissait passer.
  const many = (prefix: string) =>
    Array.from({ length: PROJECT_PLAN_LIMITS.items }, (_, index) =>
      sized(180, `${prefix}-${String(index).padStart(2, "0")}`),
    );

  const plan: ArchitectPromptV1Plan = {
    ...PLAN,
    inScope: many("DANS"),
    outOfScope: many("HORS"),
    milestones: many("ETAPE"),
  };

  it("transporte les vingt elements de chaque liste", () => {
    const context = specOf({ v1Plan: plan }).context;

    for (const entry of [...plan.inScope, ...plan.outOfScope, ...plan.milestones]) {
      assert.ok(context.includes(entry), `element manquant : ${entry.slice(-12)}`);
    }
  });

  it("conserve l'ordre du plan, sans le retrier", () => {
    const context = specOf({ v1Plan: plan }).context;
    const positions = plan.inScope.map((entry) => context.indexOf(entry));

    for (let index = 1; index < positions.length; index += 1) {
      assert.ok(
        (positions[index] ?? -1) > (positions[index - 1] ?? -1),
        "l'ordre des elements du perimetre a change",
      );
    }
  });

  it("aurait supprime huit elements sur vingt sous le rendu d'avant", () => {
    // Le pilote reel en a perdu six sur dix-huit, par ce mecanisme exact : la
    // borne de nombre valait douze, et les elements au-dela disparaissaient
    // entierement — sans point de suspension, sans trace, sans rien.
    const legacy = renderLegacyBootstrapSource({ brief: BRIEF, v1Plan: plan, memories: [] });
    const kept = plan.inScope.filter((entry) => legacy.includes(entry));

    assert.equal(kept.length, 12);
    assert.equal(legacy.includes("DANS-12"), false);
    assert.equal(legacy.includes("DANS-19"), false);
  });
});

describe("E. l'Unicode et la ponctuation Markdown survivent", () => {
  const brief: ArchitectPromptBrief = {
    ...BRIEF,
    summary: "Les accents é, è, ê, ç et l'apostrophe ’ doivent survivre — ainsi que « ceci ».",
    problem: "Du **gras**, de l'`inline code`, un [lien](https://exemple.test) et un # dièse.",
    targetUsers: "Des utilisateurs 日本語 et العربية, avec un emoji 🎯.",
    desiredOutcome: "Une valeur finissant par des points de suspension existants… voila.",
    goals: ["- un tiret initial", "* une etoile initiale", "1. un numero initial"],
    nonGoals: ["Une valeur avec\nun retour a la ligne"],
  };

  it("recopie chaque valeur caractere pour caractere", () => {
    const context = specOf({ brief }).context;

    for (const entry of canonicalBootstrapValues({ brief, v1Plan: null, memories: [] })) {
      assert.ok(context.includes(entry.value), `valeur alteree : ${entry.field}`);
    }
  });

  it("n'ajoute aucun point de suspension qui ne soit pas dans la source", () => {
    // La source en contient un, volontairement : ce test verifie qu'il n'y en a
    // pas d'autre, pas qu'il n'y en a aucun.
    const context = specOf({ brief, v1Plan: null, memories: [] }).context;
    const start = context.indexOf("### Brief produit");
    const section = context.slice(start, context.indexOf("### Plan de V1"));

    assert.equal(section.split("…").length - 1, 1);
  });
});

describe("F. un resume d'affichage ne peut pas repartir comme une source", () => {
  it("raccourcit ce qui lui est confie", () => {
    const summary = summarizeForDisplay(PLAN.technicalDirection, 200);

    assert.equal(summary.length, 200);
    assert.ok(summary.endsWith("…"));
    assert.equal(summary.includes(DIRECTION_TAIL), false);
  });

  it("n'atteint jamais le brief, le plan ni la memoire", () => {
    const spec = specOf({
      upcomingTasks: [
        {
          code: "TASK-001",
          title: summarizeForDisplay(sized(400, "FIN-TITRE"), 200),
          objective: summarizeForDisplay(sized(600, "FIN-OBJECTIF"), 300),
          priority: "HIGH",
          status: "DRAFT",
        },
      ],
    });

    // L'inventaire est resume : il situe, il n'engage pas.
    assert.equal(spec.context.includes("FIN-TITRE"), false);
    assert.equal(spec.context.includes("FIN-OBJECTIF"), false);

    // La source, elle, est integrale.
    assert.ok(spec.context.includes(DIRECTION_TAIL));
    assert.ok(spec.context.includes(MEMORY_CONTENT_TAIL));
  });
});

describe("G. un etat produit de taille maximale passe sans troncature", () => {
  /** Un brief et un plan qui consomment ensemble tout le budget des 16 Kio. */
  const budget = Math.floor(PROJECT_PLAN_LIMITS.structuredChars / 12);
  const maxBrief: ArchitectPromptBrief = {
    revision: "brief-max",
    summary: sized(budget, "S"),
    problem: sized(budget, "P"),
    targetUsers: sized(budget, "U"),
    desiredOutcome: sized(budget, "O"),
    goals: [sized(budget, "G")],
    nonGoals: [sized(budget, "N")],
  };
  const maxPlan: ArchitectPromptV1Plan = {
    revision: "plan-max",
    goal: sized(budget, "B"),
    inScope: [sized(budget, "I")],
    outOfScope: [sized(budget, "X")],
    technicalDirection: sized(budget, DIRECTION_TAIL),
    milestones: [sized(budget, "M")],
  };
  // Sept entrees de taille maximale remplissent presque les 48 Kio du budget de
  // memoire active : c'est le plus gros etat qu'un projet valide puisse porter.
  const maxMemories: ArchitectPromptMemory[] = Array.from({ length: 7 }, (_, index) => ({
    code: `MEM-${String(index + 1).padStart(3, "0")}`,
    category: "DECISION",
    revision: `mem-${String(index)}`,
    title: `Regle durable ${String(index)}`,
    content: sized(PROJECT_MEMORY_LIMITS.content, `FIN-${String(index)}`),
    rationale: sized(PROJECT_MEMORY_LIMITS.rationale, `RAISON-${String(index)}`),
  }));

  it("construit sans rien perdre", () => {
    const spec = specOf({ brief: maxBrief, v1Plan: maxPlan, memories: maxMemories });

    assert.ok(spec.context.includes(DIRECTION_TAIL));
    for (const memory of maxMemories) {
      assert.ok(spec.context.includes(memory.content), `${memory.code} tronquee`);
      assert.ok(spec.context.includes(memory.rationale ?? ""), `${memory.code} sans raison`);
    }
  });

  it("tient dans la borne derivee du contexte", () => {
    const spec = specOf({ brief: maxBrief, v1Plan: maxPlan, memories: maxMemories });
    assert.ok(spec.context.length <= 200_000);
  });

  it("produit un prompt d'execution que rien ne borne", () => {
    const spec = specOf({ brief: maxBrief, v1Plan: maxPlan, memories: maxMemories });
    const prompt = renderClaudeExecutionPrompt(taskOf(spec), [], null);

    assert.equal(prompt.includes("Contenu tronque par NOX"), false);
    assert.ok(prompt.includes(DIRECTION_TAIL));
  });
});

describe("H. un etat produit hors contrat est refuse, jamais coupe", () => {
  it("nomme le refus plutot que de produire une specification", () => {
    const enormous: ArchitectPromptMemory[] = Array.from({ length: 40 }, (_, index) => ({
      code: `MEM-${String(index + 1).padStart(3, "0")}`,
      category: "DECISION",
      revision: `mem-${String(index)}`,
      title: `Regle ${String(index)}`,
      content: "x".repeat(PROJECT_MEMORY_LIMITS.activeChars / 8),
      rationale: null,
    }));

    const built = buildBootstrapTaskSpec({
      projectName: "TicketPulse",
      brief: BRIEF,
      v1Plan: PLAN,
      memories: enormous,
      upcomingTasks: [],
      inspection: EMPTY_REPOSITORY,
    });

    assert.equal(built.ok, false);
    assert.ok(!built.ok && built.refusal.code === "SOURCE_TOO_LARGE");
    assert.ok(!built.ok && built.refusal.field === "memory");
    assert.ok(!built.ok && built.refusal.message.includes("Reduisez-la"));
  });

  it("ne cite jamais le texte fautif dans son message", () => {
    const secret = "VALEUR-CONFIDENTIELLE-A-NE-PAS-CITER";
    const built = buildBootstrapTaskSpec({
      projectName: "TicketPulse",
      brief: BRIEF,
      v1Plan: PLAN,
      memories: [
        {
          code: "MEM-001",
          category: "DECISION",
          revision: "m",
          title: secret,
          content: "y".repeat(PROJECT_MEMORY_LIMITS.activeChars + 1),
          rationale: null,
        },
      ],
      upcomingTasks: [],
      inspection: EMPTY_REPOSITORY,
    });

    assert.equal(built.ok, false);
    assert.ok(!built.ok && !built.refusal.message.includes(secret));
  });
});

describe("la verification de fidelite", () => {
  it("accepte un rendu integral", () => {
    const source = { brief: BRIEF, v1Plan: PLAN, memories: [MEMORY] };
    assert.equal(checkBootstrapSourceFidelity(source, renderBootstrapSource(source)), null);
  });

  it("refuse un rendu ampute, en nommant le champ", () => {
    const source = { brief: BRIEF, v1Plan: PLAN, memories: [MEMORY] };
    const amputated = renderBootstrapSource(source).replace(DIRECTION_TAIL, "");
    const refusal = checkBootstrapSourceFidelity(source, amputated);

    assert.ok(refusal !== null);
    assert.equal(refusal.code, "SOURCE_VALUE_LOST");
    assert.equal(refusal.field, "plan.technicalDirection");
  });

  it("derive ses bornes des bornes metier, sans en choisir", () => {
    assert.equal(BOOTSTRAP_SOURCE_LIMITS.structured, PROJECT_PLAN_LIMITS.structuredChars);
    assert.equal(BOOTSTRAP_SOURCE_LIMITS.memory, PROJECT_MEMORY_LIMITS.activeChars);
  });
});

describe("le rejeu du rendu d'epoque", () => {
  const source = { brief: BRIEF, v1Plan: PLAN, memories: [MEMORY] };

  it("reconnait un contexte produit par ce rendu", () => {
    const legacy = renderLegacyBootstrapSource(source);
    assert.equal(legacyBootstrapSourceMatches(`### Ce que\n\n${legacy}`, source), true);
  });

  it("reconnait un contexte tronque en cours de route", () => {
    const legacy = renderLegacyBootstrapSource(source);
    const cut = `${legacy.slice(0, legacy.length - 500).trimEnd()}…`;
    assert.equal(legacyBootstrapSourceMatches(cut, source), true);
  });

  it("reconnait un contexte qui continue au-dela des sections", () => {
    const legacy = renderLegacyBootstrapSource(source);
    assert.equal(
      legacyBootstrapSourceMatches(`${legacy}\n\n### Taches produit a venir\n\n- TASK-001`, source),
      true,
    );
  });

  it("refuse des que la source a change d'un caractere", () => {
    const legacy = renderLegacyBootstrapSource(source);
    // Un espace final ne suffirait pas : le rendu d'epoque appliquait `trim`.
    // Ce qui se verifie ici est un changement reel du texte, pas de sa marge.
    const changed = { ...source, brief: { ...BRIEF, summary: `${BRIEF.summary} Ajout.` } };
    assert.equal(legacyBootstrapSourceMatches(legacy, changed), false);
  });

  it("refuse un contexte qui ne vient pas du generateur", () => {
    assert.equal(legacyBootstrapSourceMatches("Un contexte ecrit a la main.", source), false);
  });
});

describe("le supplement de source", () => {
  const source = { brief: BRIEF, v1Plan: PLAN, memories: [MEMORY] };

  it("porte la source integrale sous un titre stable", () => {
    const supplement = renderBootstrapSourceSupplement(source);

    assert.ok(supplement.startsWith(`## ${BOOTSTRAP_SUPPLEMENT_HEADING}`));
    assert.ok(supplement.includes(DIRECTION_TAIL));
    assert.ok(supplement.includes(MEMORY_CONTENT_TAIL));
  });

  it("dit qu'il ne change pas le contrat, et qu'il n'ouvre aucune tache", () => {
    const supplement = renderBootstrapSourceSupplement(source);

    assert.ok(supplement.includes("criteres d'acceptation"));
    assert.ok(supplement.includes("inchanges"));
    assert.ok(supplement.includes("TASK-001"));
  });

  it("ne porte aucun critere, aucune commande et aucun perimetre nouveau", () => {
    const supplement = renderBootstrapSourceSupplement(source);
    const spec = specOf();

    for (const criterion of spec.acceptanceCriteria) {
      assert.equal(supplement.includes(criterion), false);
    }
  });
});

describe("le module de source ne contient aucun raccourcisseur", () => {
  it("n'appelle ni slice, ni troncature", async () => {
    const file = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "bootstrap-source.ts",
    );
    const body = (await readFile(file, "utf8"))
      // Les commentaires parlent de troncature : c'est le sujet du module.
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/\/\/.*$/gmu, "");

    for (const forbidden of ["slice(", "substring(", "truncate", "summarize", "…"]) {
      assert.equal(
        body.includes(forbidden),
        false,
        `« ${forbidden} » n'a rien a faire dans le rendu contractuel`,
      );
    }
  });
});
