/**
 * Ce qu'un changement de projet ne declenche jamais.
 *
 * ## Pourquoi ce fichier lit des sources
 *
 * Les garanties verifiees ici sont des **absences**. Une absence ne se voit pas
 * en lisant un resultat : elle se perd le jour ou quelqu'un ajoute un import
 * « pour enchainer proprement », et le test qui vérifiait le comportement
 * continue de passer.
 *
 * Trois promesses, et elles sont couteuses a reprendre si on les perd :
 *
 * - Relire, editer, appliquer ou ecarter un changement **n'appelle jamais
 *   OpenAI**. Un clic est un appel ; une revue n'en est pas un.
 * - Rien de tout cela ne lance Claude Code, ne valide, ne corrige, ni ne fait
 *   avancer une file. Une replanification decrit le futur ; elle ne le declenche
 *   pas.
 * - Rien de tout cela n'ecrit dans Git. Les documents Markdown des taches
 *   changent — c'est le comportement historique de TASK-007 et TASK-024 — et le
 *   repository peut rester modifie. C'est un fait annonce, pas un probleme a
 *   reparer par un commit.
 *
 * Le comportement, lui, est verifie ailleurs : `replan-apply.test.ts` sur une
 * vraie base, `diff.test.ts` et `target.test.ts` sur les modules purs.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(HERE, "..", "..");
const DATABASE = path.join(WEB, "..", "..", "packages", "database", "src");

/** Les modules et surfaces qui composent le parcours d'un changement de projet. */
const SOURCES = [
  path.join(HERE, "service.ts"),
  path.join(HERE, "change.ts"),
  path.join(HERE, "diff.ts"),
  path.join(HERE, "target.ts"),
  path.join(HERE, "display.ts"),
  path.join(HERE, "document-sync.ts"),
  path.join(DATABASE, "replan-apply.ts"),
  path.join(WEB, "app", "projects", "[id]", "architect", "changes", "[proposalId]", "actions.ts"),
  path.join(WEB, "app", "projects", "[id]", "architect", "changes", "[proposalId]", "page.tsx"),
  path.join(WEB, "app", "projects", "[id]", "architect", "changes", "page.tsx"),
];

/**
 * Le **code** d'un module, sans ses commentaires.
 *
 * Les entetes de ces modules expliquent longuement ce qu'ils ne font pas :
 * « aucun appel a OpenAI », « aucun `git add` ». Scanner la prose ferait donc
 * echouer le test sur la documentation qui enonce la garantie — l'exact
 * contraire de ce qu'on veut. Ce qui est verifie ici est ce qui s'execute.
 */
async function read(file: string): Promise<string> {
  const source = await readFile(file, "utf8");
  return source.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/(^|[^:])\/\/.*$/gmu, "$1");
}

describe("aucun appel au fournisseur", () => {
  it("ne mentionne ni OpenAI, ni un fournisseur d'architecte", async () => {
    for (const file of SOURCES) {
      const source = await read(file);
      for (const forbidden of ["openai", "OpenAIArchitectProvider", "ArchitectProvider"]) {
        assert.equal(
          source.toLowerCase().includes(forbidden.toLowerCase()),
          false,
          `${path.basename(file)} mentionne « ${forbidden} »`,
        );
      }
    }
  });
});

describe("aucune execution", () => {
  it("ne lance ni Claude Code, ni validation, ni correction, ni file", async () => {
    for (const file of SOURCES) {
      const source = await read(file);
      for (const forbidden of [
        "run-launch",
        "correction-launch",
        "startClaudeRun",
        "launchTaskRun",
        "advanceQueue",
        "startQueue",
        "runAutonomousValidation",
        "checkAutoCompletion",
      ]) {
        assert.equal(
          source.includes(forbidden),
          false,
          `${path.basename(file)} mentionne « ${forbidden} »`,
        );
      }
    }
  });
});

describe("aucune ecriture Git", () => {
  it("ne commite pas, ne pousse pas, ne repare pas un repository", async () => {
    for (const file of SOURCES) {
      const source = await read(file);
      for (const forbidden of [
        "git-delivery",
        "deliverTask",
        "gitCommit",
        "git add",
        "git commit",
        "git push",
        "git reset",
        "git restore",
        "git checkout",
        "git clean",
      ]) {
        assert.equal(
          source.includes(forbidden),
          false,
          `${path.basename(file)} mentionne « ${forbidden} »`,
        );
      }
    }
  });
});

describe("aucun forcage", () => {
  it("n'expose ni force, ni contournement de peremption", async () => {
    // Une borne qu'on peut desserrer n'en est plus une, et une peremption qu'on
    // peut ignorer non plus. Ces mots ne doivent apparaitre nulle part dans le
    // chemin d'application.
    for (const file of [path.join(DATABASE, "replan-apply.ts"), path.join(HERE, "service.ts")]) {
      const source = await read(file);
      for (const forbidden of [
        "ignoreStale",
        "applyAnyway",
        "forceApply",
        "skipValidation",
        "overrideStale",
        "mergeWithCurrent",
      ]) {
        assert.equal(
          source.includes(forbidden),
          false,
          `${path.basename(file)} porte « ${forbidden} »`,
        );
      }
      assert.equal(/\bforce\s*[?:]/u.test(source), false, `${path.basename(file)} porte un parametre « force »`);
    }
  });
});

describe("une seule autorite pour le contrat d'une tache", () => {
  it("la revue reutilise le validateur de l'editeur de tache future", async () => {
    const source = await read(path.join(HERE, "target.ts"));
    assert.ok(
      source.includes("readTaskEditSubmission"),
      "la cible doit passer par le validateur de TASK-024",
    );
    assert.ok(
      source.includes("checkValidationCommand"),
      "chaque commande doit passer la garde de TASK-027",
    );
  });

  it("la comparaison reutilise la definition de « ce contrat a change »", async () => {
    const source = await read(path.join(HERE, "diff.ts"));
    assert.ok(
      source.includes("taskContractChanged"),
      "le diff doit deriver de la comparaison de TASK-024",
    );
    assert.ok(
      source.includes("normalizeTaskEditSnapshot"),
      "les deux cotes doivent etre canonicalises avant comparaison",
    );
  });

  it("l'application rejoue l'autorite de graphe de PART 1", async () => {
    const source = await read(path.join(DATABASE, "replan-apply.ts"));
    assert.ok(
      source.includes("checkReplanTargetGraph"),
      "le graphe final doit etre verifie par la fonction de PART 1",
    );
    assert.ok(
      source.includes("taskStatusAfterEdit"),
      "la degradation READY vers DRAFT doit suivre la regle de TASK-024",
    );
    assert.ok(
      source.includes("reserveTaskSequences"),
      "les codes doivent venir de l'attribution atomique de Project.nextTaskSequence",
    );
  });
});

describe("le navigateur ne porte aucune autorite", () => {
  it("l'action ne lit ni statut, ni code, ni nature, ni empreinte du formulaire", async () => {
    const source = await read(
      path.join(WEB, "app", "projects", "[id]", "architect", "changes", "[proposalId]", "actions.ts"),
    );
    for (const forbidden of [
      'readField(formData, "status")',
      'readField(formData, "sequence")',
      'readField(formData, "kind")',
      'readField(formData, "runCount")',
      'readField(formData, "planningFingerprint")',
      'readField(formData, "repositoryPath")',
    ]) {
      assert.equal(source.includes(forbidden), false, `l'action lit « ${forbidden} »`);
    }
  });

  it("les sections du projet a ecrire viennent de la proposition enregistree", async () => {
    const source = await read(
      path.join(WEB, "app", "projects", "[id]", "architect", "changes", "[proposalId]", "actions.ts"),
    );
    assert.ok(
      source.includes("update.proposed.brief.action === PROJECT_UPDATE_ACTION.SET"),
      "le brief n'est ecrit que si la proposition enregistree le declare",
    );
    assert.ok(
      source.includes("update.proposed.plan.action === PROJECT_UPDATE_ACTION.SET"),
      "le plan n'est ecrit que si la proposition enregistree le declare",
    );
  });
});
