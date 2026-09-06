/**
 * HOTFIX-005 (reprise 2) — decouper un contrat detaille en criteres bornes.
 *
 * Aucun appel reseau, aucun fournisseur : ces tests portent sur le contrat de
 * planification et sur les instructions qui l'accompagnent.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ARCHITECT_BACKLOG_LIMITS,
  ARCHITECT_BACKLOG_SCHEMA_VERSION_3,
  BACKLOG_PROMPT_VERSION,
  BACKLOG_PROMPT_VERSION_4,
  TASK_PRIORITY,
  VERIFICATION_MODE,
  buildArchitectBacklogSchemaV3,
  readArchitectBacklogProposalV3,
  renderBacklogPrompt,
} from "../dist/index.js";

/** Retrouve une propriete du schema, quelle que soit sa profondeur. */
function findSchemaProperty(
  node: unknown,
  name: string,
): Record<string, unknown> | null {
  if (typeof node !== "object" || node === null) {
    return null;
  }
  const record = node as Record<string, unknown>;
  const properties = record["properties"];
  if (typeof properties === "object" && properties !== null) {
    const found = (properties as Record<string, unknown>)[name];
    if (found !== undefined) {
      return found as Record<string, unknown>;
    }
  }
  for (const value of Object.values(record)) {
    const nested = findSchemaProperty(value, name);
    if (nested !== null) {
      return nested;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// HOTFIX-005 (reprise 2) — le contrat d'import tient dans les bornes
// ---------------------------------------------------------------------------

/**
 * BACKLOG-004, et pourquoi il a ete refuse.
 *
 * ## Ce que le pilote a observe
 *
 * Les six regles durables etaient posees et appliquees. `backlog/4` a donc fait
 * ce qu'on lui demandait : recopier les regles exactes dans la tache d'import.
 * NOX a refuse la proposition :
 *
 * ```text
 * Tache 2 · Criteres d'acceptation
 * Un critere de Tache 2 est vide ou trop long.
 * ```
 *
 * ## La cause
 *
 * `backlog/4` exigeait des taches autoportantes **sans jamais annoncer que
 * chaque critere est borne**. La borne — 300 caracteres — etait connue du seul
 * validateur : ni le prompt, ni la description du schema ne la mentionnaient.
 * Le modele a donc empile tout le contrat dans un critere unique.
 *
 * C'est exactement la lecon de HOTFIX-003, sur un autre champ : une borne connue
 * d'un seul cote produit un refus deterministe que le modele ne peut pas eviter.
 *
 * ## Ce que ces tests prouvent
 *
 * Que la borne est **suffisante**, et que le correctif est une consigne et non un
 * relevement. Le contrat complet de TicketPulse — les six regles — tient dans
 * huit criteres exacts, tous sous la borne, sans qu'aucune regle ne soit
 * affaiblie ni abandonnee.
 */

/**
 * La tache d'import de TicketPulse, decoupee comme `backlog/5` le demande.
 *
 * Un critere par comportement observable. Chacun se verifie seul, et chacun
 * porte sa regle **en toutes lettres** — aucun ne renvoie a un contrat que
 * l'implementeur n'aura pas.
 */
const IMPORT_TASK_CRITERIA: readonly string[] = [
  "Le classeur importe porte exactement une feuille, quel que soit son nom. Les colonnes sont " +
    "identifiees par intitule exact et non par position, dans n'importe quel ordre. Colonnes " +
    "requises : N° d'Incident, Cree, Site, CI / Application.",
  "La colonne CI / Application doit exister mais sa cellule peut etre vide. Une valeur vide est " +
    "acceptee et s'affiche « Non renseigne » dans l'analytique.",
  "Une ligne entierement vide est ignoree et n'est pas comptee comme rejet. Une ligne dont la " +
    "premiere cellule commence par « Filtres appliques : » est une metadonnee d'export et est " +
    "ignoree. Toute autre ligne non vide est une ligne candidate.",
  "Avant validation, comparaison et stockage, les espaces de debut et de fin sont retires des " +
    "valeurs textuelles ; les espaces internes sont preserves ; une valeur composee uniquement " +
    "d'espaces devient vide.",
  "Si un meme N° d'Incident apparait plusieurs fois dans un classeur, toutes ses occurrences sont " +
    "rejetees : aucune n'est conservee, meme lorsque les lignes sont identiques. Les autres lignes " +
    "valides du fichier restent importees.",
  "Un incident inconnu est cree ; un incident connu dont les valeurs different est mis a jour ; un " +
    "incident connu identique reste inchange. Le dernier export fait autorite pour les champs " +
    "qu'il contient.",
  "Une colonne facultative absente du fichier ne modifie pas la valeur stockee ; une colonne " +
    "facultative presente avec une cellule vide efface la valeur stockee. Champs retenus : Titre, " +
    "Description, Resolution, Priorite, Resolu par (groupe), Cause reelle.",
  "L'import rend un compte rendu : lignes ignorees, lignes rejetees avec leur motif, incidents " +
    "crees, mis a jour et inchanges.",
];

describe("HOTFIX-005 (reprise 2) — le contrat d'import tient dans les bornes", () => {
  it("les huit criteres respectent tous la borne, sans en abandonner aucun", () => {
    // Requirement 8 : la preuve que la borne actuelle suffit. Le correctif est
    // une consigne de decoupage, pas un relevement de limite.
    assert.equal(IMPORT_TASK_CRITERIA.length <= ARCHITECT_BACKLOG_LIMITS.criteria.max, true);
    assert.equal(IMPORT_TASK_CRITERIA.length >= ARCHITECT_BACKLOG_LIMITS.criteria.min, true);

    for (const [index, criterion] of IMPORT_TASK_CRITERIA.entries()) {
      assert.equal(
        criterion.length <= ARCHITECT_BACKLOG_LIMITS.criteria.length,
        true,
        `critere ${String(index + 1)} : ${String(criterion.length)} caracteres`,
      );
    }
  });

  it("concatener les memes regles en un seul critere depasse la borne", () => {
    // Ce que le pilote a reellement obtenu. Le meme contenu, non decoupe, ne
    // passe pas — et c'est bien le decoupage qui fait la difference.
    const concatenated = IMPORT_TASK_CRITERIA.join(" ");

    assert.equal(concatenated.length > ARCHITECT_BACKLOG_LIMITS.criteria.length, true);
  });

  it("la regle des doublons reste exacte apres decoupage", () => {
    // Requirement 9. Repartir ne doit pas affaiblir : « toutes ses occurrences
    // sont rejetees » ne devient pas « les doublons sont empeches ».
    const rule = IMPORT_TASK_CRITERIA.find((text) => text.includes("N° d'Incident apparait"));

    assert.notEqual(rule, undefined);
    assert.match(rule ?? "", /toutes ses occurrences sont\s+rejetees/u);
    assert.match(rule ?? "", /aucune n'est conservee/u);
    assert.equal((rule ?? "").includes("les doublons sont empeches"), false);
  });

  it("la regle colonne absente contre cellule vide reste exacte", () => {
    // Requirement 10 : les deux moities sont opposees, et perdre l'une inverse
    // le comportement sur la moitie des imports.
    const rule = IMPORT_TASK_CRITERIA.find((text) => text.includes("colonne facultative"));

    assert.match(rule ?? "", /absente du fichier ne modifie pas la valeur stockee/u);
    assert.match(rule ?? "", /presente avec une cellule vide efface la valeur stockee/u);
  });

  it("la regle du CI / Application vide reste exacte", () => {
    // Requirement 11 : requise, vide autorisee, affichee « Non renseigne ».
    const rule = IMPORT_TASK_CRITERIA.find((text) => text.includes("CI / Application doit exister"));

    assert.match(rule ?? "", /sa cellule peut etre vide/u);
    assert.match(rule ?? "", /Non renseigne/u);
  });

  it("aucun critere ne renvoie a un contrat que l'implementeur n'aura pas", () => {
    // Requirement 12, et le defaut d'origine de BACKLOG-003.
    for (const criterion of IMPORT_TASK_CRITERIA) {
      for (const forbidden of ["contrat V1", "contrat d'import V1", "selon le contrat", "cf."]) {
        assert.equal(criterion.includes(forbidden), false, `${forbidden} : ${criterion}`);
      }
    }
  });

  it("chaque critere porte un comportement, pas la specification entiere", () => {
    // Requirement 13 : reparti, pas resume. Aucun critere ne recouvre a lui
    // seul plusieurs familles de regles.
    const families = [
      ["une feuille", "intitule exact"],
      ["ligne entierement vide", "Filtres appliques"],
      ["espaces de debut", "espaces internes"],
      ["occurrences sont", "restent importees"],
      ["incident inconnu", "fait autorite"],
    ];

    for (const family of families) {
      const carriers = IMPORT_TASK_CRITERIA.filter((text) =>
        family.every((marker) => text.includes(marker)),
      );
      assert.equal(carriers.length, 1, family.join(" + "));
    }
  });
});

describe("HOTFIX-005 (reprise 2) — les bornes sont annoncees au fournisseur", () => {
  function backlogInstructions(): string {
    return renderBacklogPrompt({
      projectName: "TicketPulse",
      instructionDocuments: [],
      projectBrief: null,
      projectV1Plan: null,
      projectMemory: [],
      existingTasks: [],
      contextDocuments: [],
      availableDocuments: [],
    }).instructions;
  }

  it("annonce la longueur maximale d'un critere, tiree de la meme constante", () => {
    // Requirements 6 et 7. La borne vivait dans le seul validateur : le
    // fournisseur ne pouvait pas la respecter.
    const instructions = backlogInstructions();

    assert.ok(
      instructions.includes(
        `**au plus ${String(ARCHITECT_BACKLOG_LIMITS.criteria.length)} caracteres**`,
      ),
      "la borne exacte est annoncee",
    );
  });

  it("annonce aussi le nombre de criteres", () => {
    const instructions = backlogInstructions();

    assert.match(instructions, new RegExp(String(ARCHITECT_BACKLOG_LIMITS.criteria.max), "u"));
    assert.match(instructions, new RegExp(String(ARCHITECT_BACKLOG_LIMITS.criteria.min), "u"));
  });

  it("annonce la borne du hors perimetre, qui manquait aussi", () => {
    const instructions = backlogInstructions();

    assert.match(
      instructions,
      new RegExp(`${String(ARCHITECT_BACKLOG_LIMITS.outOfScope.length)} caracteres chacun`, "u"),
    );
  });

  it("dit qu'un depassement refuse tout, et que rien n'est tronque", () => {
    // Requirement 15 : aucune troncature silencieuse, et le modele doit le
    // savoir pour ne pas compter dessus.
    const instructions = backlogInstructions();

    assert.match(instructions, /fait refuser toute la/u);
    assert.match(instructions, /rien n'est tronque/u);
  });

  it("enseigne le decoupage plutot que le resume", () => {
    // Requirement C, et le coeur du correctif.
    const instructions = backlogInstructions();

    assert.match(instructions, /Un critere par comportement, pas une specification par critere/u);
    assert.match(instructions, /Un critere prouve un comportement coherent, et un seul/u);
    assert.match(instructions, /repartis-les sur plusieurs criteres/u);
    assert.match(instructions, /plutot que de les concatener/u);
  });

  it("renvoie le contexte et l'objectif pour ce qui est commun", () => {
    const instructions = backlogInstructions();

    assert.match(instructions, /portent ce qui est commun/u);
  });

  it("dit que le decoupage n'affaiblit pas", () => {
    // La regle des doublons est citee comme contre-exemple, exactement comme
    // dans `backlog/4`.
    const instructions = backlogInstructions();

    assert.match(instructions, /decoupage repartit les regles, il ne les affaiblit pas/u);
    assert.match(instructions, /les doublons sont empeches/u);
  });

  it("dit quoi faire si le nombre de criteres devient la contrainte", () => {
    const instructions = backlogInstructions();

    assert.match(instructions, /regroupe des comportements \*\*voisins\*\*/u);
    assert.match(instructions, /sans changer leur sens/u);
  });

  it("la version du prompt suit le changement d'instructions", () => {
    assert.equal(BACKLOG_PROMPT_VERSION, "backlog/5");
    assert.notEqual(BACKLOG_PROMPT_VERSION, BACKLOG_PROMPT_VERSION_4);
  });

  it("la description du schema porte aussi la borne", () => {
    // Le fournisseur lit les deux. Le mode strict ignore `maxLength`, donc la
    // description est le seul endroit du schema qui puisse la dire.
    const schema = buildArchitectBacklogSchemaV3();
    const criteria = findSchemaProperty(schema, "acceptanceCriteria");

    assert.match(
      String(criteria?.["description"] ?? ""),
      new RegExp(String(ARCHITECT_BACKLOG_LIMITS.criteria.length), "u"),
    );
    assert.match(String(criteria?.["description"] ?? ""), /plusieurs criteres/u);
  });
});

describe("HOTFIX-005 (reprise 2) — les bornes restent strictes", () => {
  const CRITERION = {
    verificationMode: VERIFICATION_MODE.HUMAN,
    validationCommandIndexes: [],
    humanInstructions: "Ouvrir un export reel et verifier le comportement decrit.",
  };

  function taskWith(criteria: readonly string[]): Record<string, unknown> {
    return {
      title: "Importer un export d'incidents",
      priority: TASK_PRIORITY.HIGH,
      objective: "Ingerer un classeur d'incidents et le rendre exploitable.",
      context: "Le contrat d'import est fige dans la memoire du projet.",
      acceptanceCriteria: criteria.map((text) => ({ ...CRITERION, text })),
      outOfScope: [],
      documentReferences: [],
      validationCommands: [],
      dependsOn: [],
    };
  }

  function proposalWith(criteria: readonly string[]): Record<string, unknown> {
    return {
      schemaVersion: ARCHITECT_BACKLOG_SCHEMA_VERSION_3,
      message: "Le decoupage couvre le contrat d'import.",
      tasks: [taskWith(criteria)],
    };
  }

  it("accepte le decoupage reel de TicketPulse", () => {
    // Requirement 8, sur le vrai validateur.
    const read = readArchitectBacklogProposalV3(proposalWith(IMPORT_TASK_CRITERIA), []);

    assert.equal(read.ok, true);
    if (read.ok) {
      assert.equal(read.proposal.tasks[0]?.acceptanceCriteria.length, 8);
    }
  });

  it("accepte un critere exactement a la borne", () => {
    // Requirement 2 : la borne est inclusive.
    const exact = "a".repeat(ARCHITECT_BACKLOG_LIMITS.criteria.length);

    assert.equal(readArchitectBacklogProposalV3(proposalWith([exact]), []).ok, true);
  });

  it("refuse un critere d'un caractere de trop, en le nommant", () => {
    // Requirements 1, 3 et 5 : la borne tient, et le diagnostic dit lequel.
    const tooLong = "a".repeat(ARCHITECT_BACKLOG_LIMITS.criteria.length + 1);
    const read = readArchitectBacklogProposalV3(
      proposalWith([IMPORT_TASK_CRITERIA[0]!, tooLong]),
      [],
    );

    assert.equal(read.ok, false);
    if (!read.ok) {
      assert.equal(read.refusal.field, "tasks.0.acceptanceCriteria.1");
      assert.match(read.refusal.message, /Critere 2/u);
      assert.match(read.refusal.message, /too_long/u);
      assert.match(read.refusal.message, new RegExp(String(tooLong.length), "u"));
      // Requirement 5 : le texte refuse n'est pas recopie.
      assert.equal(read.refusal.message.includes(tooLong), false);
    }
  });

  it("distingue un critere vide d'un critere trop long", () => {
    // Requirement 4. « vide ou trop long » ne disait pas dans quel sens
    // corriger, et le pilote a du le deviner.
    const empty = readArchitectBacklogProposalV3(proposalWith(["   "]), []);

    assert.equal(empty.ok, false);
    if (!empty.ok) {
      assert.match(empty.refusal.message, /vide/u);
      assert.equal(empty.refusal.message.includes("too_long"), false);
    }
  });

  it("refuse un neuvieme critere", () => {
    // Requirement 14 : la borne de comptage tient aussi.
    const many = Array.from(
      { length: ARCHITECT_BACKLOG_LIMITS.criteria.max + 1 },
      (_, index) => `Comportement observable numero ${String(index + 1)}.`,
    );

    assert.equal(readArchitectBacklogProposalV3(proposalWith(many), []).ok, false);
  });

  it("ne tronque jamais un critere pour le faire passer", () => {
    // Requirement 15. Un critere ampute decrirait un comportement que personne
    // n'a valide — et il n'existe aucun chemin qui le produise.
    const tooLong = `${IMPORT_TASK_CRITERIA[4]!} ${"x".repeat(ARCHITECT_BACKLOG_LIMITS.criteria.length)}`;
    const read = readArchitectBacklogProposalV3(proposalWith([tooLong]), []);

    assert.equal(read.ok, false, "refuse, jamais raccourci");
  });

  it("un backlog sans regle durable reste valide", () => {
    // Requirement 16 : les projets d'avant HOTFIX-005 n'ont aucune memoire, et
    // leurs backlogs continuent de passer.
    const read = readArchitectBacklogProposalV3(
      proposalWith(["L'export produit un fichier JSON lisible."]),
      [],
    );

    assert.equal(read.ok, true);
  });
});
