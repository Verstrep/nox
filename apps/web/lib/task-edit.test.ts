/**
 * Revision d'un contrat de tache, et traduction du formulaire.
 *
 * ## Ce que ce fichier prouve
 *
 * Que l'empreinte porte le **contrat**, et rien d'autre : elle bouge quand
 * l'objectif change, pas quand le statut change. Sans cela, deux onglets se
 * seraient perimes mutuellement sans que personne n'ait rien modifie.
 *
 * Que le **plan de verification** en fait partie : passer un critere de humain a
 * automatise change ce que NOX fera de la tache — jusqu'a la terminer sans
 * personne — donc c'est une modification du contrat.
 *
 * Que l'ordre des listes compte — un agent les lira dans cet ordre — mais que
 * celui des dependances ne compte pas.
 *
 * Et que l'edition passe exactement par le validateur de la creation : un second
 * format de tache aurait fini par diverger.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  COMMAND_EXECUTION_MODE,
  MAX_HUMAN_INSTRUCTIONS_LENGTH,
  TASK_EDIT_ERROR,
  TASK_PRIORITY,
  TASK_STATUS,
  VERIFICATION_MODE,
} from "@nox/shared";
import type { DevelopmentTaskDetail, VerificationPlan } from "@nox/shared";
import type { TaskEditSnapshot } from "@nox/database";

import {
  readTaskEditSubmission,
  taskEditFormValues,
  taskEditRefusalMessage,
  taskEditRevision,
  taskRevisionOf,
  type TaskEditCommandRow,
  type TaskEditCriterionRow,
  type TaskEditFormValues,
} from "./task-edit.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const EDIT_FORM_PATH = path.join(
  HERE,
  "..",
  "app",
  "projects",
  "[id]",
  "tasks",
  "[taskId]",
  "edit",
  "EditTaskForm.tsx",
);

function snapshot(overrides: Partial<TaskEditSnapshot> = {}): TaskEditSnapshot {
  return {
    title: "Poser le domaine",
    objective: "Un repas se cree et se relit.",
    context: null,
    outOfScope: null,
    priority: TASK_PRIORITY.MEDIUM,
    acceptanceCriteria: [
      {
        text: "Un repas peut etre cree.",
        verificationMode: VERIFICATION_MODE.HUMAN,
        humanInstructions: "Creer un repas depuis l'ecran.",
        commandPositions: [],
      },
    ],
    documentReferences: [],
    validationCommands: [],
    dependsOnTaskIds: [],
    ...overrides,
  };
}

function task(overrides: Partial<DevelopmentTaskDetail> = {}): DevelopmentTaskDetail {
  return {
    id: "task-1",
    code: "TASK-001",
    kind: "NORMAL",
    title: "Poser le domaine",
    status: TASK_STATUS.DRAFT,
    priority: TASK_PRIORITY.MEDIUM,
    documentSyncStatus: "SYNCED",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    projectId: "proj-1",
    objective: "Un repas se cree et se relit.",
    context: null,
    outOfScope: null,
    acceptanceCriteria: ["Un repas peut etre cree."],
    documentReferences: [],
    validationCommands: [],
    documentPath: "tasks/TASK-001.md",
    documentRevision: "a".repeat(64),
    documentSyncError: null,
    ...overrides,
  };
}

/** Plan enregistre, tel que la base le rendrait. */
function plan(overrides: Partial<VerificationPlan> = {}): VerificationPlan {
  return {
    criteria: [
      {
        id: "crit-1",
        position: 0,
        text: "Un repas peut etre cree.",
        verificationMode: VERIFICATION_MODE.HUMAN,
        humanInstructions: "Creer un repas depuis l'ecran.",
        commandIds: [],
      },
    ],
    commands: [],
    ...overrides,
  };
}

const AUTOMATED_PLAN: VerificationPlan = {
  criteria: [
    {
      id: "crit-1",
      position: 0,
      text: "La suite de tests passe.",
      verificationMode: VERIFICATION_MODE.AUTOMATED,
      humanInstructions: null,
      commandIds: ["cmd-1"],
    },
  ],
  commands: [
    {
      id: "cmd-1",
      position: 0,
      command: "npm run test",
      executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS,
    },
  ],
};

function criterionRow(overrides: Partial<TaskEditCriterionRow> = {}): TaskEditCriterionRow {
  return {
    key: "c0",
    text: "Un repas peut etre cree.",
    verificationMode: VERIFICATION_MODE.HUMAN,
    humanInstructions: "Creer un repas depuis l'ecran.",
    commandKeys: [],
    ...overrides,
  };
}

function commandRow(overrides: Partial<TaskEditCommandRow> = {}): TaskEditCommandRow {
  return {
    key: "v0",
    command: "npm run test",
    executionMode: COMMAND_EXECUTION_MODE.AGENT_ONLY,
    ...overrides,
  };
}

function form(overrides: Partial<TaskEditFormValues> = {}): TaskEditFormValues {
  return {
    title: "Poser le domaine",
    priority: TASK_PRIORITY.MEDIUM,
    objective: "Un repas se cree et se relit.",
    context: "",
    outOfScope: "",
    documents: "",
    criteria: [criterionRow()],
    commands: [],
    dependsOnTaskIds: [],
    ...overrides,
  };
}

describe("revision d'un contrat", () => {
  it("est deterministe", () => {
    assert.equal(taskEditRevision(snapshot()), taskEditRevision(snapshot()));
  });

  it("change des que le contrat change", () => {
    const base = taskEditRevision(snapshot());

    for (const overrides of [
      { title: "Autre titre" },
      { objective: "Autre objectif." },
      { context: "Un contexte." },
      { outOfScope: "- Rien." },
      { priority: TASK_PRIORITY.HIGH },
      { acceptanceCriteria: [criterionRow({ text: "Autre critere." })].map(toCriterion) },
      { documentReferences: ["docs/ARCHITECTURE.md"] },
      {
        validationCommands: [
          { command: "npm run test", executionMode: COMMAND_EXECUTION_MODE.AGENT_ONLY },
        ],
      },
      { dependsOnTaskIds: ["task-2"] },
    ] satisfies Partial<TaskEditSnapshot>[]) {
      assert.notEqual(taskEditRevision(snapshot(overrides)), base, JSON.stringify(overrides));
    }
  });

  it("change quand un critere passe de humain a automatise", () => {
    // C'est la modification la plus lourde de consequences de tout l'editeur :
    // elle decide si NOX peut terminer la tache sans personne.
    const human = taskEditRevision(snapshot());
    const automated = taskEditRevision(
      snapshot({
        acceptanceCriteria: [
          {
            text: "Un repas peut etre cree.",
            verificationMode: VERIFICATION_MODE.AUTOMATED,
            humanInstructions: null,
            commandPositions: [0],
          },
        ],
        validationCommands: [
          { command: "npm run test", executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS },
        ],
      }),
    );
    assert.notEqual(automated, human);
  });

  it("change quand une commande devient autonome", () => {
    const agentOnly = snapshot({
      validationCommands: [
        { command: "npm run test", executionMode: COMMAND_EXECUTION_MODE.AGENT_ONLY },
      ],
    });
    const autonomous = snapshot({
      validationCommands: [
        { command: "npm run test", executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS },
      ],
    });
    assert.notEqual(taskEditRevision(autonomous), taskEditRevision(agentOnly));
  });

  it("change quand la preuve d'un critere change", () => {
    const base = snapshot({
      acceptanceCriteria: [
        {
          text: "La suite passe.",
          verificationMode: VERIFICATION_MODE.AUTOMATED,
          humanInstructions: null,
          commandPositions: [0],
        },
      ],
      validationCommands: [
        { command: "npm run test", executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS },
        { command: "npm run lint", executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS },
      ],
    });
    const both = snapshot({
      ...base,
      acceptanceCriteria: [{ ...base.acceptanceCriteria[0]!, commandPositions: [0, 1] }],
    });
    assert.notEqual(taskEditRevision(both), taskEditRevision(base));
  });

  it("ignore une instruction posee sur un critere automatise", () => {
    // Elle n'a aucun effet : la conserver dans l'empreinte ferait croire a une
    // modification la ou rien ne change pour personne.
    const automated = {
      text: "La suite passe.",
      verificationMode: VERIFICATION_MODE.AUTOMATED,
      humanInstructions: null,
      commandPositions: [0],
    };
    const commands = [
      { command: "npm run test", executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS },
    ];
    assert.equal(
      taskEditRevision(
        snapshot({
          acceptanceCriteria: [{ ...automated, humanInstructions: "Ignoree." }],
          validationCommands: commands,
        }),
      ),
      taskEditRevision(
        snapshot({ acceptanceCriteria: [automated], validationCommands: commands }),
      ),
    );
  });

  it("ignore l'ordre des preuves d'un critere", () => {
    // Cocher deux cases dans un ordre ou dans l'autre designe le meme ensemble.
    const commands = [
      { command: "npm run test", executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS },
      { command: "npm run lint", executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS },
    ];
    const withPositions = (commandPositions: number[]): TaskEditSnapshot =>
      snapshot({
        acceptanceCriteria: [
          {
            text: "La suite passe.",
            verificationMode: VERIFICATION_MODE.AUTOMATED,
            humanInstructions: null,
            commandPositions,
          },
        ],
        validationCommands: commands,
      });

    assert.equal(
      taskEditRevision(withPositions([1, 0])),
      taskEditRevision(withPositions([0, 1])),
    );
  });

  it("distingue deux decoupages qui produiraient la meme chaine", () => {
    // Sans prefixe de longueur, « ab » + « c » et « a » + « bc » se
    // confondraient.
    assert.notEqual(
      taskEditRevision(snapshot({ title: "ab", objective: "c" })),
      taskEditRevision(snapshot({ title: "a", objective: "bc" })),
    );
  });

  it("distingue un champ absent d'un champ vide", () => {
    assert.notEqual(
      taskEditRevision(snapshot({ context: null })),
      taskEditRevision(snapshot({ context: " " })),
    );
  });

  it("tient compte de l'ordre des criteres", () => {
    // L'ordre fait partie de la specification : un agent les lira dans cet
    // ordre.
    assert.notEqual(
      taskEditRevision(
        snapshot({ acceptanceCriteria: [criterionRow({ text: "A" }), criterionRow({ text: "B" })].map(toCriterion) }),
      ),
      taskEditRevision(
        snapshot({ acceptanceCriteria: [criterionRow({ text: "B" }), criterionRow({ text: "A" })].map(toCriterion) }),
      ),
    );
  });

  it("ignore l'ordre des dependances", () => {
    // Cocher puis recocher n'est pas une modification.
    assert.equal(
      taskEditRevision(snapshot({ dependsOnTaskIds: ["a", "b"] })),
      taskEditRevision(snapshot({ dependsOnTaskIds: ["b", "a"] })),
    );
  });

  it("ne depend ni du statut, ni des dates, ni du document", () => {
    // C'est exactement ce que `updatedAt` n'aurait pas su faire : une
    // resynchronisation de Markdown aurait perime tous les formulaires ouverts.
    const base = taskRevisionOf(task(), plan(), []);

    assert.equal(taskRevisionOf(task({ status: TASK_STATUS.READY }), plan(), []), base);
    assert.equal(
      taskRevisionOf(task({ updatedAt: "2027-01-01T00:00:00.000Z" }), plan(), []),
      base,
    );
    assert.equal(taskRevisionOf(task({ documentRevision: "f".repeat(64) }), plan(), []), base);
    assert.equal(taskRevisionOf(task({ documentSyncStatus: "CONFLICT" }), plan(), []), base);
  });

  it("ne depend pas des identifiants du plan", () => {
    // Chaque enregistrement recree les lignes : une empreinte qui dependrait de
    // leur identifiant changerait a chaque sauvegarde, meme sans modification.
    const base = taskRevisionOf(task(), AUTOMATED_PLAN, []);
    const renamed: VerificationPlan = {
      criteria: [{ ...AUTOMATED_PLAN.criteria[0]!, id: "autre", commandIds: ["autre-cmd"] }],
      commands: [{ ...AUTOMATED_PLAN.commands[0]!, id: "autre-cmd" }],
    };
    assert.equal(taskRevisionOf(task(), renamed, []), base);
  });

  it("ne depend pas du code ni de la nature", () => {
    // Ils sont immuables : les faire entrer dans l'empreinte n'apprendrait rien.
    const base = taskRevisionOf(task(), plan(), []);
    assert.equal(
      taskRevisionOf(task({ code: "TASK-042", kind: "BOOTSTRAP" }), plan(), []),
      base,
    );
  });
});

describe("prefill du formulaire", () => {
  it("rend une ligne par critere et par commande", () => {
    const values = taskEditFormValues(task(), AUTOMATED_PLAN, ["task-2"]);

    assert.equal(values.criteria.length, 1);
    assert.equal(values.criteria[0]?.text, "La suite de tests passe.");
    assert.equal(values.criteria[0]?.verificationMode, VERIFICATION_MODE.AUTOMATED);
    assert.equal(values.commands.length, 1);
    assert.equal(values.commands[0]?.executionMode, COMMAND_EXECUTION_MODE.AUTONOMOUS);
    assert.deepEqual(values.dependsOnTaskIds, ["task-2"]);
  });

  it("rattache une preuve a la ligne de commande, pas a son texte", () => {
    const values = taskEditFormValues(task(), AUTOMATED_PLAN, []);
    assert.deepEqual(values.criteria[0]?.commandKeys, [values.commands[0]?.key]);
  });

  it("donne a chaque ligne une cle distincte", () => {
    const values = taskEditFormValues(
      task(),
      {
        criteria: [
          { ...AUTOMATED_PLAN.criteria[0]!, id: "a", position: 0 },
          { ...AUTOMATED_PLAN.criteria[0]!, id: "b", position: 1 },
        ],
        commands: AUTOMATED_PLAN.commands,
      },
      [],
    );
    assert.notEqual(values.criteria[0]?.key, values.criteria[1]?.key);
  });

  it("rend une chaine vide pour les champs absents", () => {
    const values = taskEditFormValues(
      task({ context: null, outOfScope: null }),
      plan(),
      [],
    );
    assert.equal(values.context, "");
    assert.equal(values.outOfScope, "");
  });

  it("produit un aller-retour stable", () => {
    // Prefill puis soumission sans modification doit rendre exactement le
    // contrat d'origine : sans quoi ouvrir un formulaire suffirait a changer la
    // tache.
    const original = task({
      context: "Un contexte.",
      outOfScope: "- Rien.",
      documentReferences: ["docs/A.md"],
    });
    const submission = readTaskEditSubmission(
      taskEditFormValues(original, AUTOMATED_PLAN, ["task-2"]),
    );

    assert.ok(submission.ok);
    assert.equal(
      taskEditRevision(submission.input),
      taskRevisionOf(original, AUTOMATED_PLAN, ["task-2"]),
    );
  });
});

describe("validation d'une soumission", () => {
  it("reutilise le validateur de la creation", () => {
    // Meme refus, meme message : il n'existe qu'un seul format de tache.
    const refused = readTaskEditSubmission(form({ criteria: [] }));
    assert.equal(refused.ok, false);
    assert.ok(refused.ok === false && refused.message.includes("critere d'acceptation"));
  });

  it("refuse un chemin de document sortant du repository", () => {
    for (const documents of ["../secrets.md", "/etc/passwd", "C:/Windows/system.ini"]) {
      const refused = readTaskEditSubmission(form({ documents }));
      assert.equal(refused.ok, false, documents);
    }
  });

  it("refuse une commande chainee", () => {
    // Le validateur des commandes vit dans `@nox/shared` et sert au lancement ;
    // celui du formulaire borne la saisie. Les deux restent en place.
    const submission = readTaskEditSubmission(
      form({ commands: [commandRow({ command: "npm run test && rm -rf dist" })] }),
    );
    assert.ok(submission.ok);
    // La commande est enregistrable, mais elle bloquera le lancement : c'est le
    // comportement d'avant TASK-024, inchange.
    assert.deepEqual(submission.input.validationCommands, [
      { command: "npm run test && rm -rf dist", executionMode: COMMAND_EXECUTION_MODE.AGENT_ONLY },
    ]);
  });

  it("ignore les lignes vides sans decaler les classifications", () => {
    // Une ligne vide au milieu est une respiration a la saisie. Si elle
    // disparaissait apres coup, les modes se seraient decales d'un cran.
    const submission = readTaskEditSubmission(
      form({
        criteria: [
          criterionRow({ key: "c0", text: "Premier" }),
          criterionRow({ key: "c1", text: "  " }),
          criterionRow({
            key: "c2",
            text: "Second",
            verificationMode: VERIFICATION_MODE.AUTOMATED,
            commandKeys: ["v0"],
          }),
        ],
        commands: [commandRow({ executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS })],
      }),
    );

    assert.ok(submission.ok);
    assert.equal(submission.input.acceptanceCriteria.length, 2);
    assert.equal(submission.input.acceptanceCriteria[1]?.text, "Second");
    assert.equal(
      submission.input.acceptanceCriteria[1]?.verificationMode,
      VERIFICATION_MODE.AUTOMATED,
    );
    assert.deepEqual(submission.input.acceptanceCriteria[1]?.commandPositions, [0]);
  });

  it("traduit une preuve en position, jamais en identifiant", () => {
    const submission = readTaskEditSubmission(
      form({
        criteria: [
          criterionRow({
            verificationMode: VERIFICATION_MODE.AUTOMATED,
            commandKeys: ["v1"],
          }),
        ],
        commands: [
          commandRow({ key: "v0", command: "npm run lint" }),
          commandRow({ key: "v1", command: "npm run test" }),
        ],
      }),
    );
    assert.ok(submission.ok);
    assert.deepEqual(submission.input.acceptanceCriteria[0]?.commandPositions, [1]);
  });

  it("laisse tomber une preuve qui ne designe aucune ligne soumise", () => {
    // Un formulaire forge peut nommer n'importe quoi ; le resultat est un
    // critere sans preuve, que `Mark ready` refusera. Jamais un lien pendant.
    const submission = readTaskEditSubmission(
      form({
        criteria: [
          criterionRow({
            verificationMode: VERIFICATION_MODE.AUTOMATED,
            commandKeys: ["inconnue"],
          }),
        ],
        commands: [commandRow()],
      }),
    );
    assert.ok(submission.ok);
    assert.deepEqual(submission.input.acceptanceCriteria[0]?.commandPositions, []);
  });

  it("efface l'instruction d'un critere automatise", () => {
    const submission = readTaskEditSubmission(
      form({
        criteria: [
          criterionRow({
            verificationMode: VERIFICATION_MODE.AUTOMATED,
            humanInstructions: "Un texte orphelin.",
            commandKeys: ["v0"],
          }),
        ],
        commands: [commandRow({ executionMode: COMMAND_EXECUTION_MODE.AUTONOMOUS })],
      }),
    );
    assert.ok(submission.ok);
    assert.equal(submission.input.acceptanceCriteria[0]?.humanInstructions, null);
  });

  it("refuse un mode de verification invente", () => {
    const refused = readTaskEditSubmission(
      form({ criteria: [criterionRow({ verificationMode: "PEUT_ETRE" })] }),
    );
    assert.equal(refused.ok, false);
  });

  it("refuse un mode d'execution invente", () => {
    const refused = readTaskEditSubmission(
      form({ commands: [commandRow({ executionMode: "SUDO" })] }),
    );
    assert.equal(refused.ok, false);
  });

  it("refuse une instruction humaine trop longue", () => {
    const refused = readTaskEditSubmission(
      form({
        criteria: [
          criterionRow({ humanInstructions: "x".repeat(MAX_HUMAN_INSTRUCTIONS_LENGTH + 1) }),
        ],
      }),
    );
    assert.equal(refused.ok, false);
  });

  it("accepte un critere automatise sans preuve", () => {
    // Un brouillon a le droit d'etre incomplet. C'est `Mark ready` qui refuse,
    // au seul endroit qui fasse autorite.
    const submission = readTaskEditSubmission(
      form({ criteria: [criterionRow({ verificationMode: VERIFICATION_MODE.AUTOMATED })] }),
    );
    assert.ok(submission.ok);
    assert.deepEqual(submission.input.acceptanceCriteria[0]?.commandPositions, []);
  });

  it("normalise les dependances sans rien valider d'autre", () => {
    const submission = readTaskEditSubmission(
      form({ dependsOnTaskIds: ["a", "", "a", " b "] }),
    );
    assert.ok(submission.ok);
    // L'existence, le projet, la nature et les cycles se verifient en base : le
    // navigateur n'a aucune autorite sur ce point.
    assert.deepEqual(submission.input.dependsOnTaskIds, ["a", "b"]);
  });

  it("refuse une priorite inventee", () => {
    const refused = readTaskEditSubmission(form({ priority: "URGENT" }));
    assert.equal(refused.ok, false);
  });
});

describe("messages de refus", () => {
  it("dit ce qu'il faut faire, pour chaque code", () => {
    for (const code of Object.values(TASK_EDIT_ERROR)) {
      const message = taskEditRefusalMessage(code);
      assert.ok(message.length > 20, code);
      // Aucun code technique ne remonte a l'utilisateur.
      assert.ok(!message.includes("TASK_EDIT_"), code);
    }
  });

  it("oriente une tache figee vers la demande de correction", () => {
    assert.ok(taskEditRefusalMessage(TASK_EDIT_ERROR.FROZEN).includes("Request changes"));
  });

  it("demande de recharger avant d'enregistrer", () => {
    assert.ok(taskEditRefusalMessage(TASK_EDIT_ERROR.STALE).includes("Rechargez"));
  });
});

describe("identites du formulaire d'edition", () => {
  it("ne derive aucune cle React d'un texte modifiable", async () => {
    const source = await readFile(EDIT_FORM_PATH, "utf8");

    // Le defaut de TASK-022 : une cle derivee d'un titre editable remonte le
    // noeud a chaque frappe, et le champ perd le focus. Les cles de ce
    // formulaire viennent d'identifiants, jamais de contenu.
    for (const forbidden of [
      "key={candidate.title}",
      "key={task.title}",
      "key={entry.title}",
      "key={values.title}",
      "key={row.text}",
      "key={row.command}",
      "key={index}",
    ]) {
      assert.ok(!source.includes(forbidden), forbidden);
    }

    assert.ok(source.includes("key={candidate.id}"));

    // Les lignes du plan vivent dans le composant partage : c'est lui qui doit
    // porter la meme garantie, puisque c'est lui qui les rend.
    const plan = await readFile(
      path.join(HERE, "..", "components", "VerificationPlanFields.tsx"),
      "utf8",
    );
    assert.ok(plan.includes("key={row.key}"));
    assert.ok(plan.includes("key={command.key}"));
    for (const forbidden of ["key={index}", "key={row.text}", "key={row.command}"]) {
      assert.ok(!plan.includes(forbidden), forbidden);
    }

    // Et aucun masque : le focus se garde en ne demontant pas le champ, pas en
    // le refocalisant apres coup.
    assert.ok(!source.includes("autoFocus"));
    assert.ok(!source.includes(".focus()"));
  });

  it("n'attribue jamais deux fois la meme cle a deux lignes", async () => {
    const source = await readFile(EDIT_FORM_PATH, "utf8");

    // Une cle derivee de la longueur de la liste se repeterait des qu'une ligne
    // du milieu disparait, et deux lignes partageraient alors leurs champs.
    assert.ok(!source.includes("criteria.length)"));
    assert.ok(source.includes("nextKey.current += 1"));
  });

  it("declare ses champs de texte hors du composant", async () => {
    const source = await readFile(EDIT_FORM_PATH, "utf8");

    // Un composant defini dans le corps du rendu est un nouveau type a chaque
    // frappe : React demonte alors le champ, et le focus part avec lui.
    assert.ok(
      source.indexOf("function TextAreaField") < source.indexOf("export function EditTaskForm"),
    );
  });
});

/** Traduit une ligne de formulaire en critere de contrat, pour les cas de test. */
function toCriterion(row: TaskEditCriterionRow): TaskEditSnapshot["acceptanceCriteria"][number] {
  return {
    text: row.text,
    verificationMode: VERIFICATION_MODE.HUMAN,
    humanInstructions: row.humanInstructions === "" ? null : row.humanInstructions,
    commandPositions: [],
  };
}
