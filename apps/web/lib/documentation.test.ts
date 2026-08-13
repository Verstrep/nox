/**
 * Tests des invariants documentaires du repository NOX.
 *
 * Deux garanties, toutes deux invisibles a l'execution :
 *
 * 1. **La liste fermee du contexte Architecte designe des fichiers qui
 *    existent.** Renommer `docs/V1_SCOPE.md` ne casserait rien : la generation
 *    continuerait de fonctionner, avec un document en moins. C'est exactement
 *    le genre de degradation silencieuse qu'un test doit attraper — le contexte
 *    envoye au fournisseur serait amoindri sans qu'aucune erreur ne le dise.
 *
 * 2. **Les liens relatifs entre documents pointent vers des fichiers reels.**
 *    Un lien casse ne se voit qu'au clic. Depuis TASK-018, chaque document
 *    renvoie explicitement vers celui qui possede l'information plutot que de
 *    la recopier : ces renvois sont devenus porteurs, et un renvoi mort couterait
 *    l'information elle-meme.
 *
 * Ces tests lisent le repository NOX, qui est aussi le projet que NOX pilote.
 * Ils ne verifient rien des repositories enregistres par l'utilisateur.
 */

import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ARCHITECT_CONTEXT_DOCUMENTS,
  ARCHITECT_INSTRUCTION_DOCUMENTS,
} from "./architect/context.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** `apps/web/lib` → racine du monorepo. */
const ROOT = path.resolve(HERE, "..", "..", "..");

/** Documents dont TASK-018 a fixe le role. Un renvoi mort y coute une information. */
const MAIN_DOCUMENTS = [
  "README.md",
  "CLAUDE.md",
  "docs/PROJECT_BRIEF.md",
  "docs/V1_SCOPE.md",
  "docs/ARCHITECTURE.md",
  "docs/PROJECT_STATE.md",
  "docs/DECISIONS.md",
  "docs/ROADMAP.md",
];

async function isFile(relativePath: string): Promise<boolean> {
  try {
    return (await stat(path.join(ROOT, relativePath))).isFile();
  } catch {
    return false;
  }
}

/** Un renvoi documentaire peut viser un dossier — `apps/web/` par exemple. */
async function exists(relativePath: string): Promise<boolean> {
  try {
    await stat(path.join(ROOT, relativePath));
    return true;
  } catch {
    return false;
  }
}

/**
 * Liens Markdown relatifs d'un document, ancres retires.
 *
 * Les URL absolues sont ignorees : ce test parle du repository, pas du web. Une
 * ancre seule (`#section`) designe le document courant et n'a pas de fichier a
 * verifier.
 */
function relativeLinks(markdown: string): string[] {
  const links: string[] = [];
  for (const match of markdown.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1] ?? "";
    if (target.startsWith("http") || target.startsWith("#") || target.startsWith("<")) {
      continue;
    }
    const withoutAnchor = target.split("#")[0] ?? "";
    if (withoutAnchor !== "") {
      links.push(withoutAnchor);
    }
  }
  return links;
}

describe("contexte Architecte", () => {
  it("designe des documents qui existent dans le repository NOX", async () => {
    for (const document of ARCHITECT_CONTEXT_DOCUMENTS) {
      assert.equal(await isFile(document), true, `${document} est introuvable`);
    }
  });

  it("designe des conventions dont CLAUDE.md existe", async () => {
    assert.equal(ARCHITECT_INSTRUCTION_DOCUMENTS.includes("CLAUDE.md"), true);
    assert.equal(await isFile("CLAUDE.md"), true);
  });
});

describe("documents principaux", () => {
  it("existent tous", async () => {
    for (const document of MAIN_DOCUMENTS) {
      assert.equal(await isFile(document), true, `${document} est introuvable`);
    }
  });

  it("n'ont aucun lien relatif casse", async () => {
    for (const document of MAIN_DOCUMENTS) {
      const directory = path.dirname(document);
      const markdown = await readFile(path.join(ROOT, document), "utf8");

      for (const link of relativeLinks(markdown)) {
        const resolved = path.posix.normalize(path.posix.join(directory, link));
        assert.equal(
          await exists(resolved),
          true,
          `${document} renvoie vers ${link}, qui n'existe pas (${resolved})`,
        );
      }
    }
  });
});
