/**
 * Le modele de l'Architecte a une seule autorite.
 *
 * ## Pourquoi ce fichier existe
 *
 * Parce que le premier pilote reel a decide un backlog de V1 entier sur
 * `gpt-5-mini`, sans que personne ne l'ait choisi : `NOX_ARCHITECT_MODEL` etait
 * obligatoire, la valeur venait d'un exemple recopie, et aucun ecran ne disait
 * que c'etait la un choix. HOTFIX-001 rend ce choix a NOX, et le concentre en
 * un seul endroit.
 *
 * Le risque, apres un tel changement, n'est pas qu'il ne fonctionne pas : c'est
 * qu'une quatrieme surface apparaisse un jour avec son propre identifiant de
 * modele en dur, et reste en arriere sans que rien ne le signale. Ces tests
 * lisent la **source** pour l'interdire.
 *
 * Ils lisent aussi ce qui n'a **pas** ete remplace : un identifiant de modele
 * dans une fixture historique raconte un appel qui a eu lieu, et le reecrire
 * transformerait l'historique en publicite.
 */

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ARCHITECT_ENVIRONMENT_VARIABLES,
  ARCHITECT_OPTIONAL_ENVIRONMENT_VARIABLES,
  DEFAULT_ARCHITECT_MODEL,
  DEFAULT_ARCHITECT_REASONING_EFFORT,
  architectReasoningEffort,
  loadArchitectConfig,
} from "./config.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY = path.join(HERE, "..", "..", "..", "..");

/** Le fichier qui detient l'autorite, et le seul autorise a nommer un modele. */
const AUTHORITY = path.join(HERE, "config.ts");

/** Dossiers que ce balayage ne traverse jamais. */
const SKIPPED = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "generated",
  "data",
]);

/** Toutes les sources TypeScript du monorepo, tests exclus. */
async function productionSources(root: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (SKIPPED.has(entry.name)) {
        continue;
      }
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!/\.tsx?$/u.test(entry.name) || entry.name.endsWith(".test.ts")) {
        continue;
      }
      if (entry.name.endsWith(".test.tsx")) {
        continue;
      }
      found.push(full);
    }
  }

  for (const workspace of ["apps", "packages"]) {
    await walk(path.join(root, workspace));
  }
  return found;
}

/**
 * Reconnait un identifiant de modele.
 *
 * Volontairement large : `gpt-`, `o3`, `o4-mini`, `claude-`. Un motif etroit
 * laisserait passer exactement le cas que ce test existe pour attraper.
 */
const MODEL_PATTERN = /["'`](gpt-[\w.-]+|o[34](?:-[\w.-]+)?|claude-[\w.-]+)["'`]/u;

describe("une seule autorite pour le modele de l'Architecte", () => {
  it("nomme le modele par defaut, et il n'est pas gpt-5-mini", () => {
    assert.equal(DEFAULT_ARCHITECT_MODEL, "gpt-5.6-sol");
    assert.notEqual(DEFAULT_ARCHITECT_MODEL, "gpt-5-mini");
    assert.equal(DEFAULT_ARCHITECT_REASONING_EFFORT, "high");
  });

  it("est le seul module de production a ecrire un identifiant de modele", async () => {
    const offenders: string[] = [];

    for (const file of await productionSources(REPOSITORY)) {
      if (path.resolve(file) === path.resolve(AUTHORITY)) {
        continue;
      }
      const source = await readFile(file, "utf8");
      // Les commentaires ont le droit de citer un modele : ils expliquent.
      const stripped = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");
      if (MODEL_PATTERN.test(stripped)) {
        offenders.push(path.relative(REPOSITORY, file));
      }
    }

    assert.deepEqual(offenders, []);
  });

  it("derive l'effort du modele, et de rien d'autre", () => {
    assert.equal(architectReasoningEffort(DEFAULT_ARCHITECT_MODEL), "high");
    assert.equal(architectReasoningEffort("gpt-5-mini"), null);
    assert.equal(architectReasoningEffort("gpt-4.1"), null);
    assert.equal(architectReasoningEffort(""), null);
  });

  it("ne rend obligatoire que la cle", () => {
    assert.deepEqual([...ARCHITECT_ENVIRONMENT_VARIABLES], ["NOX_OPENAI_API_KEY"]);
    assert.deepEqual([...ARCHITECT_OPTIONAL_ENVIRONMENT_VARIABLES], ["NOX_ARCHITECT_MODEL"]);

    const result = loadArchitectConfig({ NOX_OPENAI_API_KEY: "cle" });
    assert.ok(result.ok);
  });
});

describe("les surfaces a forte consequence lisent cette autorite", () => {
  /**
   * Les trois flux vises, et le module qui lit leur configuration.
   *
   * `replan/1` n'a pas d'entree propre : une replanification est un tour de la
   * conversation projet, donc la meme Server Action et la meme lecture de
   * configuration. La preuve en est faite ci-dessous plutot qu'affirmee.
   */
  const FLOWS: readonly { flow: string; file: string }[] = [
    {
      flow: "Project Architect conversation, et replan/1",
      file: path.join(REPOSITORY, "apps", "web", "app", "projects", "[id]", "architect", "[sessionId]", "actions.ts"),
    },
    {
      flow: "backlog/2",
      file: path.join(REPOSITORY, "apps", "web", "lib", "backlog.ts"),
    },
    {
      flow: "architect-review/1",
      file: path.join(REPOSITORY, "apps", "web", "app", "projects", "[id]", "tasks", "[taskId]", "runs", "[runId]", "architect-review", "actions.ts"),
    },
  ];

  for (const { flow, file } of FLOWS) {
    it(`lit le modele par loadArchitectConfig — ${flow}`, async () => {
      const source = await readFile(file, "utf8");

      assert.ok(source.includes("loadArchitectConfig"), "lit l'autorite centrale");
      assert.ok(source.includes("config.model"), "en tire le modele");
      assert.equal(
        MODEL_PATTERN.test(source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "")),
        false,
        "n'ecrit aucun identifiant de modele",
      );
    });
  }

  it("prouve que la replanification passe par la conversation projet", async () => {
    const conversation = await readFile(
      path.join(REPOSITORY, "apps", "web", "app", "projects", "[id]", "architect", "[sessionId]", "actions.ts"),
      "utf8",
    );

    // Le tour qui peut porter une replanification est envoye par cette action,
    // avec le modele de l'autorite : il n'existe pas de second chemin d'appel.
    assert.ok(conversation.includes("sendArchitectMessage"));
    assert.ok(conversation.includes("planningState"));
    assert.ok(conversation.includes("OpenAIArchitectProvider"));
  });

  it("ne laisse aucun autre module construire le fournisseur OpenAI", async () => {
    const builders: string[] = [];

    for (const file of await productionSources(REPOSITORY)) {
      const source = await readFile(file, "utf8");
      if (source.includes("new OpenAIArchitectProvider(")) {
        builders.push(path.relative(REPOSITORY, file).split(path.sep).join("/"));
      }
    }

    // Trois Server Actions et un declencheur applicatif, et eux seuls. Un
    // cinquieme apparaitrait ici.
    //
    // `verification-refresh.ts` n'est pas une Server Action : c'est TASK-033,
    // declenchee par l'acceptation d'un amorcage. Elle figure dans cette liste
    // pour la meme raison que les trois autres — c'est bien un endroit d'ou un
    // appel facture peut partir, et il doit rester compte.
    assert.deepEqual(builders.sort(), [
      "apps/web/app/projects/[id]/architect/[sessionId]/actions.ts",
      "apps/web/app/projects/[id]/backlog/actions.ts",
      "apps/web/app/projects/[id]/tasks/[taskId]/runs/[runId]/architect-review/actions.ts",
      "apps/web/lib/verification-refresh.ts",
    ]);
  });
});

describe("l'historique n'a pas ete reecrit", () => {
  it("garde les identifiants de modele des fixtures historiques", async () => {
    // Un remplacement global naif aurait transforme ces lignes — qui decrivent
    // des appels passes — en `gpt-5.6-sol`. Elles doivent rester ce qu'elles
    // sont : la trace de ce qui a reellement tourne.
    const fixtures = [
      "git-delivery-migration.test.ts",
      "execution-queue-migration.test.ts",
      "architect-backlog-migration.test.ts",
    ];

    for (const fixture of fixtures) {
      const source = await readFile(
        path.join(REPOSITORY, "packages", "database", "src", fixture),
        "utf8",
      );
      assert.ok(source.includes("gpt-5-mini"), `${fixture} a perdu son modele historique`);
    }
  });

  it("ne touche pas au modele de Claude Code", async () => {
    // HOTFIX-001 ne concerne que les appels OpenAI de l'Architecte. Le runner ne
    // choisit aucun modele, et ce hotfix ne lui en donne pas.
    const launcher = await readFile(
      path.join(REPOSITORY, "apps", "runner", "src", "claude", "launcher.ts"),
      "utf8",
    );

    assert.equal(launcher.includes(DEFAULT_ARCHITECT_MODEL), false);
    assert.equal(launcher.includes("--model"), false);
  });
});
