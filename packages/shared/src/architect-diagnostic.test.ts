import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Comme les autres tests de ce package : l'entree publique compilee, jamais la
// source. C'est elle que le web et le runner consomment, et c'est donc elle
// qu'il faut eprouver.
import {
  ARCHITECT_DIAGNOSTIC_FIELD,
  ARCHITECT_DIAGNOSTIC_LIMITS,
  ARCHITECT_ERROR,
  ARCHITECT_TURN_FAILURE,
  ARCHITECT_TURN_FAILURE_CATEGORIES,
  ARCHITECT_TURN_SCHEMA_VERSION_V3,
  ARCHITECT_TURN_STATE,
  ARCHITECT_PROMPT_VERSION,
  ARCHITECT_PROMPT_VERSION_V4,
  ARCHITECT_PROMPT_VERSION_V5,
  ARCHITECT_PROMPT_VERSION_V6,
  ARCHITECT_PROMPT_VERSION_V7,
  ARCHITECT_PROMPT_VERSION_V8,
  ARCHITECT_SESSION_KIND,
  PROJECT_PLAN_LIMITS,
  PROJECT_UPDATE_ACTION,
  architectDiagnosticFieldLabel,
  architectPromptVersion,
  architectTurnSchemaVersion,
  architectTurnFailureCategory,
  architectTurnFailureCode,
  readArchitectTurn,
  renderArchitectPrompt,
  sanitizeArchitectDiagnosticText,
} from "../dist/index.js";

/**
 * Le contrat `architect/4`, tel qu'un tour normal doit continuer de le
 * satisfaire.
 *
 * `architect/4` correspond au **schema 3** : une conversation projet dont le
 * projet n'a pas encore de backlog applique, donc sans replanification. C'est
 * exactement la configuration du pilote TicketPulse, et ces tests existent pour
 * qu'aucun durcissement du diagnostic ne relache ce contrat.
 */
const V3 = ARCHITECT_TURN_SCHEMA_VERSION_V3;

function discussion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: V3,
    state: ARCHITECT_TURN_STATE.CONTINUE,
    message: "Voici comment je decouperais le contrat d'import.",
    questions: [],
    ...overrides,
  };
}

describe("architect/4 — un tour de discussion reste accepte", () => {
  it("accepte une reponse de discussion sans proposition ni mise a jour", () => {
    const result = readArchitectTurn(discussion(), [], V3);

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.turn.state, ARCHITECT_TURN_STATE.CONTINUE);
    assert.equal(result.turn.projectUpdate, null);
    assert.equal(result.turn.proposal, null);
  });

  it("accepte une discussion accompagnee de questions", () => {
    const result = readArchitectTurn(
      discussion({ questions: ["Quel format d'import ?", "Quelle frequence ?"] }),
      [],
      V3,
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.turn.questions.length, 2);
    }
  });

  it("accepte une mise a jour du plan de V1", () => {
    // Le cas exact des tours 8 et 9 du pilote : un ajustement du Living V1
    // Plan, sans aucune tache demandee.
    const result = readArchitectTurn(
      discussion({
        projectUpdate: {
          reason: "Les decisions de contrat d'import changent la direction technique.",
          brief: { action: PROJECT_UPDATE_ACTION.UNCHANGED },
          plan: {
            action: PROJECT_UPDATE_ACTION.SET,
            value: {
              goal: "Ingerer les tickets d'un export CSV et les afficher.",
              technicalDirection: "Import CSV synchrone, sans file d'attente.",
              inScope: ["Import CSV"],
              outOfScope: ["Connecteurs tiers"],
              milestones: ["Contrat d'import", "Ecran de liste"],
            },
          },
        },
      }),
      [],
      V3,
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.notEqual(result.turn.projectUpdate, null);
    }
  });
});

describe("architect/4 — ce qui reste refuse", () => {
  it("refuse une version de contrat differente, en nommant le champ", () => {
    const result = readArchitectTurn(discussion({ schemaVersion: 4 }), [], V3);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.refusal.field, "schemaVersion");
    }
  });

  it("refuse une issue de tour inconnue", () => {
    // Le discriminant du contrat. Une valeur qu'il ne connait pas ne devient
    // jamais un defaut silencieux.
    const result = readArchitectTurn(discussion({ state: "DISCUSSION" }), [], V3);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.refusal.field, "state");
    }
  });

  it("refuse une reponse qui n'est pas une structure", () => {
    for (const value of ["texte", 42, null, [], true]) {
      const result = readArchitectTurn(value, [], V3);
      assert.equal(result.ok, false, JSON.stringify(value));
      if (!result.ok) {
        assert.equal(result.refusal.field, "turn");
      }
    }
  });

  it("refuse un message absent ou vide, en le nommant", () => {
    for (const message of [undefined, "", "   ", 42]) {
      const result = readArchitectTurn(discussion({ message }), [], V3);
      assert.equal(result.ok, false, String(message));
      if (!result.ok) {
        assert.equal(result.refusal.field, "message");
      }
    }
  });

  it("nomme le champ fautif a l'interieur d'une mise a jour de projet", () => {
    const result = readArchitectTurn(
      discussion({
        projectUpdate: {
          reason: "Ajustement.",
          brief: { action: PROJECT_UPDATE_ACTION.UNCHANGED },
          plan: { action: "REWRITE" },
        },
      }),
      [],
      V3,
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      // Le chemin doit designer la mise a jour, pas la racine du tour : c'est
      // ce qui permet de savoir ou regarder sans relancer d'appel.
      assert.match(result.refusal.field, /^projectUpdate/u);
      assert.notEqual(result.refusal.message.trim(), "");
    }
  });

  it("refuse une replanification quand le contrat ne la porte pas", () => {
    // `architect/4` ne replanifie pas. Un fournisseur qui rendrait un `replan`
    // ne doit pas voir ce champ pris en compte par surprise.
    const result = readArchitectTurn(
      discussion({ replan: { mode: "PROPOSED", rationale: "x", futureTasks: [] } }),
      [],
      V3,
    );

    assert.equal(result.ok, true, "le champ est ignore, pas obei");
    if (result.ok) {
      assert.equal(result.turn.replan.mode, "UNCHANGED");
    }
  });
});

describe("categories d'echec", () => {
  it("distingue un budget depasse d'une violation de contrat", () => {
    // C'est la distinction centrale de HOTFIX-003. Une mise a jour trop grosse
    // est une reponse **bien formee** que NOX refuse d'ecrire ; la presenter
    // comme une erreur de format envoie chercher au mauvais endroit.
    assert.equal(
      architectTurnFailureCategory(ARCHITECT_ERROR.ARCHITECT_UPDATE_TOO_LARGE, null),
      ARCHITECT_TURN_FAILURE.UPDATE_TOO_LARGE,
    );
    assert.equal(
      architectTurnFailureCategory(ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID, "projectUpdate.plan"),
      ARCHITECT_TURN_FAILURE.CONTRACT_INVALID,
    );
  });

  it("distingue un JSON illisible d'un contrat viole", () => {
    assert.equal(
      architectTurnFailureCategory(
        ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID,
        ARCHITECT_DIAGNOSTIC_FIELD.JSON,
      ),
      ARCHITECT_TURN_FAILURE.MALFORMED_JSON,
    );
  });

  it("distingue une reponse interrompue de tout le reste", () => {
    assert.equal(
      architectTurnFailureCategory(ARCHITECT_ERROR.ARCHITECT_RESPONSE_INCOMPLETE, null),
      ARCHITECT_TURN_FAILURE.RESPONSE_INCOMPLETE,
    );
  });

  it("classe un delai depasse comme une panne, jamais comme un format invalide", () => {
    // Exigence explicite : un timeout ne doit pas se confondre avec une reponse
    // structurellement refusee. Les tours 5 et 6 du pilote et les tours 8 et 9
    // n'ont pas la meme cause, et ne doivent pas se lire pareil.
    assert.equal(
      architectTurnFailureCategory(ARCHITECT_ERROR.ARCHITECT_TIMEOUT, null),
      ARCHITECT_TURN_FAILURE.PROVIDER_ERROR,
    );
    assert.notEqual(
      architectTurnFailureCategory(ARCHITECT_ERROR.ARCHITECT_TIMEOUT, null),
      architectTurnFailureCategory(ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID, null),
    );
  });

  it("traite toute panne de transport comme une panne", () => {
    for (const code of [
      ARCHITECT_ERROR.ARCHITECT_RATE_LIMITED,
      ARCHITECT_ERROR.ARCHITECT_AUTH_FAILED,
      ARCHITECT_ERROR.ARCHITECT_PROVIDER_ERROR,
      ARCHITECT_ERROR.ARCHITECT_CONTEXT_TOO_LARGE,
    ]) {
      assert.equal(
        architectTurnFailureCategory(code, null),
        ARCHITECT_TURN_FAILURE.PROVIDER_ERROR,
        code,
      );
    }
  });

  it("code et categorie sont inverses l'un de l'autre", () => {
    // Sans cela, la ligne enregistree et la categorie relue pourraient se
    // contredire — et personne ne s'en apercevrait avant le pilote suivant.
    for (const category of ARCHITECT_TURN_FAILURE_CATEGORIES) {
      const code = architectTurnFailureCode(category);
      const field =
        category === ARCHITECT_TURN_FAILURE.MALFORMED_JSON
          ? ARCHITECT_DIAGNOSTIC_FIELD.JSON
          : null;
      assert.equal(architectTurnFailureCategory(code, field), category, category);
    }
  });
});

describe("libelles de champ", () => {
  it("nomme les etapes reservees", () => {
    assert.notEqual(architectDiagnosticFieldLabel(ARCHITECT_DIAGNOSTIC_FIELD.JSON), null);
    assert.notEqual(architectDiagnosticFieldLabel(ARCHITECT_DIAGNOSTIC_FIELD.BUDGET), null);
    assert.notEqual(architectDiagnosticFieldLabel(ARCHITECT_DIAGNOSTIC_FIELD.INCOMPLETE), null);
  });

  it("designe un chemin imbrique par sa racine", () => {
    assert.equal(
      architectDiagnosticFieldLabel("projectUpdate.plan.goal"),
      architectDiagnosticFieldLabel("projectUpdate"),
    );
  });

  it("rend null pour un champ inconnu plutot que d'inventer un libelle", () => {
    assert.equal(architectDiagnosticFieldLabel("inconnu"), null);
    assert.equal(architectDiagnosticFieldLabel(null), null);
  });
});

describe("nettoyage d'un diagnostic", () => {
  it("retire les caracteres de controle", () => {
    const cleaned = sanitizeArchitectDiagnosticText("a\u0000b\u001Fc", 100);

    assert.equal(cleaned, "abc");
  });

  it("ecrase les blancs et borne la longueur en annoncant la coupure", () => {
    const cleaned = sanitizeArchitectDiagnosticText(`${"x".repeat(200)}`, 50);

    assert.notEqual(cleaned, null);
    assert.equal((cleaned ?? "").length <= 50, true);
    assert.match(cleaned ?? "", /\[…\]$/u);
  });

  it("rend null pour un texte vide apres nettoyage", () => {
    // « Cause non enregistree » vaut mieux qu'une ligne vide qui ressemble a
    // une information.
    assert.equal(sanitizeArchitectDiagnosticText("     ", 100), null);
  });

  it("borne les deux champs a des tailles differentes et explicites", () => {
    assert.equal(ARCHITECT_DIAGNOSTIC_LIMITS.field < ARCHITECT_DIAGNOSTIC_LIMITS.message, true);
  });
});

// ---------------------------------------------------------------------------
// HOTFIX-003 (suite) — les bornes de liste, et ce que le fournisseur en sait
// ---------------------------------------------------------------------------

/**
 * Le cas TicketPulse, reproduit exactement.
 *
 * ## Ce que le pilote a observe
 *
 * Apres le premier correctif, le tour 10 a rejoue la demande qui avait echoue
 * deux fois, et le diagnostic a nomme la cause :
 *
 * ```text
 * Contrat non respecte
 * Mise a jour du projet — projectUpdate.plan.inScope
 * La valeur proposee pour « inScope » est refusee : too_many.
 * ```
 *
 * ## La cause reelle
 *
 * Le validateur borne chaque liste a `PROJECT_PLAN_LIMITS.items`, et le prompt
 * ne l'annoncait nulle part — il disait meme l'inverse : « rends le plan complet
 * avec cette etape en plus ». Un plan deja fourni plus cinq decisions nouvelles
 * franchit la borne a coup sur, et le refus est **deterministe**.
 */
describe("HOTFIX-003 — bornes des listes du plan", () => {
  const FULL = Array.from({ length: PROJECT_PLAN_LIMITS.items }, (_, index) => `Regle ${String(index + 1)}`);

  function planUpdate(inScope: readonly string[]): Record<string, unknown> {
    return {
      schemaVersion: ARCHITECT_TURN_SCHEMA_VERSION_V3,
      state: ARCHITECT_TURN_STATE.CONTINUE,
      message: "Voici la mise a jour minimale du plan.",
      questions: [],
      projectUpdate: {
        reason: "Les decisions d'import sont tranchees.",
        brief: { action: PROJECT_UPDATE_ACTION.UNCHANGED },
        plan: {
          action: PROJECT_UPDATE_ACTION.SET,
          value: {
            goal: "Ingerer un export de tickets et les afficher.",
            technicalDirection: "Import synchrone d'un classeur a feuille unique.",
            inScope: [...inScope],
            outOfScope: ["Connecteurs tiers"],
            milestones: ["Contrat d'import", "Ecran de liste"],
          },
        },
      },
    };
  }

  it("accepte une section exactement a la borne", () => {
    const result = readArchitectTurn(planUpdate(FULL), [], ARCHITECT_TURN_SCHEMA_VERSION_V3);

    assert.equal(result.ok, true, "la borne est inclusive");
  });

  it("refuse une entree de trop, en nommant le champ et la raison", () => {
    // Le cas exact du tour 10.
    const result = readArchitectTurn(
      planUpdate([...FULL, "Une decision de trop"]),
      [],
      ARCHITECT_TURN_SCHEMA_VERSION_V3,
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.refusal.field, "projectUpdate.plan.inScope");
      assert.match(result.refusal.message, /too_many/u);
    }
  });

  it("ne tronque jamais pour faire passer une section", () => {
    // Aucune entree n'est ecartee en silence : la proposition entiere est
    // refusee, et l'utilisateur decide quoi consolider.
    const result = readArchitectTurn(
      planUpdate([...FULL, "Une decision de trop"]),
      [],
      ARCHITECT_TURN_SCHEMA_VERSION_V3,
    );

    assert.equal(result.ok, false, "aucune acceptation partielle");
  });

  it("une section deja pleine reste modifiable par consolidation", () => {
    // C'est le geste que le prompt demande desormais : fusionner et reformuler
    // plutot qu'ajouter. Une section pleine n'est pas une impasse.
    const consolide = [
      ...FULL.slice(0, PROJECT_PLAN_LIMITS.items - 1),
      "Import d'un classeur a feuille unique : valeurs textuelles normalisees, " +
        "champs vides affiches comme non renseignes, doublons d'incident rejetes",
    ];
    const result = readArchitectTurn(planUpdate(consolide), [], ARCHITECT_TURN_SCHEMA_VERSION_V3);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.turn.projectUpdate?.plan.value?.inScope.length, PROJECT_PLAN_LIMITS.items);
    }
  });

  it("borne toutes les listes du brief et du plan avec la meme autorite", () => {
    // Une seule constante pour cinq listes. Cinq bornes independantes auraient
    // fini par diverger, et le prompt n'aurait pu en annoncer qu'une.
    const tooMany = Array.from({ length: PROJECT_PLAN_LIMITS.items + 1 }, () => "x");
    const cases: { section: "brief" | "plan"; field: string; value: Record<string, unknown> }[] = [
      {
        section: "plan",
        field: "projectUpdate.plan.outOfScope",
        value: {
          goal: "Un objectif.",
          technicalDirection: "Une direction.",
          inScope: ["Un element"],
          outOfScope: tooMany,
          milestones: ["Une etape"],
        },
      },
      {
        section: "brief",
        field: "projectUpdate.brief.goals",
        value: {
          summary: "Un resume.",
          problem: "Un probleme.",
          targetUsers: "Des utilisateurs.",
          desiredOutcome: "Un resultat.",
          goals: tooMany,
          nonGoals: ["Un hors objectif"],
        },
      },
    ];

    for (const entry of cases) {
      const other = entry.section === "plan" ? "brief" : "plan";
      const result = readArchitectTurn(
        {
          schemaVersion: ARCHITECT_TURN_SCHEMA_VERSION_V3,
          state: ARCHITECT_TURN_STATE.CONTINUE,
          message: "Mise a jour.",
          questions: [],
          projectUpdate: {
            reason: "Une raison.",
            [entry.section]: { action: PROJECT_UPDATE_ACTION.SET, value: entry.value },
            [other]: { action: PROJECT_UPDATE_ACTION.UNCHANGED },
          },
        },
        [],
        ARCHITECT_TURN_SCHEMA_VERSION_V3,
      );

      assert.equal(result.ok, false, entry.field);
      if (!result.ok) {
        assert.equal(result.refusal.field, entry.field);
        assert.match(result.refusal.message, /too_many/u);
      }
    }
  });
});

/**
 * Ce que le fournisseur doit savoir pour repondre juste du premier coup.
 *
 * Le schema strict ne peut pas porter ces bornes — `maxItems` y est ignore, et
 * le declarer ferait echouer la requete entiere. Elles ne peuvent donc vivre
 * qu'a deux endroits : les instructions, et le validateur. C'etait deja la
 * conception ; la section de mise a jour du projet ne l'appliquait pas.
 */
describe("HOTFIX-003 — les instructions annoncent les bornes", () => {
  function projectInstructions(): string {
    return renderArchitectPrompt({
      sessionKind: ARCHITECT_SESSION_KIND.PROJECT,
      projectName: "TicketPulse",
      instructionDocuments: [],
      projectMemory: [],
      projectBrief: null,
      projectV1Plan: null,
      contextDocuments: [],
      recentTasks: [],
      planningState: null,
      availableDocuments: [],
      transcript: [],
      newMessage: "Ajuste le plan de V1, de facon minimale.",
    }).instructions;
  }

  it("annonce le nombre maximal d'entrees, tire de la meme constante", () => {
    const instructions = projectInstructions();

    assert.match(instructions, new RegExp(String(PROJECT_PLAN_LIMITS.items), "u"));
    // Construite depuis la constante : si la borne change, le prompt doit
    // suivre, et ce test echoue tant qu'il ne suit pas.
    assert.ok(
      instructions.includes(`**au plus ${String(PROJECT_PLAN_LIMITS.items)} entrees**`),
      "le prompt annonce la borne exacte",
    );
  });

  it("annonce aussi la taille maximale d'une entree", () => {
    assert.match(projectInstructions(), new RegExp(String(PROJECT_PLAN_LIMITS.item), "u"));
  });

  it("dit qu'un depassement refuse la mise a jour entiere, sans troncature", () => {
    const instructions = projectInstructions();

    assert.match(instructions, /refusee entierement/u);
    assert.match(instructions, /rien n'est tronque/u);
  });

  it("demande de fusionner plutot que d'ajouter quand la section se remplit", () => {
    // La consigne qui manquait. L'ancienne disait « rends le plan complet avec
    // cette etape en plus », c'est-a-dire exactement le geste qui a franchi la
    // borne.
    const instructions = projectInstructions();

    assert.match(instructions, /fusionne et reformule/u);
    assert.match(instructions, /Compte les entrees avant de repondre/u);
  });

  it("distingue une regle produit durable d'un detail de specification", () => {
    const instructions = projectInstructions();

    assert.match(instructions, /Le plan n'est pas une specification/u);
    assert.match(instructions, /appartient aux \*\*taches\*\*/u);
    assert.match(instructions, /minimale/u);
  });

  it("ne demande plus d'ajouter une ligne par decision", () => {
    // L'ancienne phrase est partie : la laisser contredirait la nouvelle.
    assert.equal(projectInstructions().includes("avec cette etape\nen plus"), false);
  });
});

describe("HOTFIX-003 — la version de prompt suit le changement d'instructions", () => {
  it("une conversation projet sans replanification passe en architect/7", () => {
    assert.equal(
      architectPromptVersion(ARCHITECT_SESSION_KIND.PROJECT, false),
      ARCHITECT_PROMPT_VERSION_V7,
    );
  });

  it("une conversation projet replanifiable passe en architect/8", () => {
    assert.equal(
      architectPromptVersion(ARCHITECT_SESSION_KIND.PROJECT, true),
      ARCHITECT_PROMPT_VERSION_V8,
    );
  });

  it("le schema, lui, ne bouge pas", () => {
    // La compatibilite `architect/4` tient ici : le contrat lu est le meme, et
    // seules les instructions ont change.
    assert.equal(
      architectTurnSchemaVersion(ARCHITECT_SESSION_KIND.PROJECT, false),
      ARCHITECT_TURN_SCHEMA_VERSION_V3,
    );
  });

  it("les versions historiques restent lisibles", () => {
    const versions = new Set([
      ARCHITECT_PROMPT_VERSION,
      ARCHITECT_PROMPT_VERSION_V4,
      ARCHITECT_PROMPT_VERSION_V5,
      ARCHITECT_PROMPT_VERSION_V6,
      ARCHITECT_PROMPT_VERSION_V7,
      ARCHITECT_PROMPT_VERSION_V8,
    ]);

    assert.equal(versions.size, 6, "aucune etiquette n'est reutilisee");
  });
});
