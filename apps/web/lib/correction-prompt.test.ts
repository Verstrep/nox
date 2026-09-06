/**
 * Un seul assemblage du prompt de correction.
 *
 * ## Ce que ce fichier prouve
 *
 * Que les trois pages de preparation et le lancement passent par la meme
 * fonction. Elles affichent le prompt et son empreinte ; si l'une d'elles
 * assemblait ses entrees a la main, elle finirait par oublier un champ — et
 * l'ecran montrerait un texte pendant que la session en recevrait un autre.
 *
 * Ce n'est pas une precaution abstraite : HOTFIX-006 a paye exactement cette
 * erreur sur `ResumeCandidate`, assemble a la main sur huit surfaces, dont une
 * avait oublie `isLatestRun`.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, "..", "app", "projects", "[id]", "tasks", "[taskId]", "runs", "[runId]");

/** Les quatre surfaces qui produisent un prompt de correction. */
const SURFACES = [
  path.join(HERE, "correction-launch.ts"),
  path.join(APP, "corrections", "[feedbackId]", "page.tsx"),
  path.join(APP, "corrections", "evidence", "page.tsx"),
  path.join(APP, "corrections", "failure", "page.tsx"),
];

async function body(file: string): Promise<string> {
  return (await readFile(file, "utf8"))
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/\/\/.*$/gmu, "");
}

describe("l'assemblage du prompt de correction", () => {
  it("passe par la fonction partagee sur les quatre surfaces", async () => {
    for (const file of SURFACES) {
      assert.ok(
        (await body(file)).includes("buildCorrectionPromptFor("),
        `${path.basename(path.dirname(file))} n'utilise pas l'assemblage partage`,
      );
    }
  });

  it("n'appelle plus le constructeur brut hors de l'assemblage", async () => {
    for (const file of SURFACES) {
      const source = await body(file);
      const raw = source.split("buildCorrectionPrompt(").length - 1;
      assert.equal(
        raw,
        0,
        `${path.basename(path.dirname(file))} appelle encore buildCorrectionPrompt directement`,
      );
    }
  });
});
