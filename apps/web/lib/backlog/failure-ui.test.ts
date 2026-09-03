/**
 * L'echec d'une planification, tel que la page Backlog le rend.
 *
 * Faute d'un moteur de rendu React dans cette suite, la presentation est
 * verifiee sur la **source** des composants — meme approche que `chat-ui`.
 * L'assertion utile n'est pas « une balise existe » mais « ce que le HTML peut
 * contenir vient du diagnostic normalise, et de rien d'autre ».
 *
 * Trois garanties, et la troisieme est la plus importante :
 *
 * 1. la cause precise est affichee sur la ligne `FAILED` qui l'a produite ;
 * 2. aucune reponse brute, aucun prompt, aucune cle ne peut y arriver ;
 * 3. **ouvrir cette page ne genere rien**. Un rendu qui relancerait un appel
 *    transformerait un rafraichissement en facture.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const BACKLOG_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "app",
  "projects",
  "[id]",
  "backlog",
);

function source(file: string): Promise<string> {
  return readFile(path.join(BACKLOG_DIR, file), "utf8");
}

/** Retire commentaires et documentation : seul le code compte. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");
}

describe("la cause d'un echec est affichee", () => {
  it("rend le diagnostic sur la ligne de la generation", async () => {
    const page = code(await source("page.tsx"));

    assert.ok(page.includes("describeBacklogFailure"), "traduit le diagnostic");
    assert.ok(page.includes("failureDetail(generation)"), "l'affiche par generation");
    assert.ok(page.includes("generation.diagnostic"), "le lit sur la generation");
  });

  it("montre a la fois la designation lisible et le chemin technique", async () => {
    const page = code(await source("page.tsx"));
    const block = page.slice(page.indexOf("function failureDetail"), page.indexOf("function stateBadge"));

    assert.ok(block.includes("failure.field ?? failure.path"), "designation, sinon chemin");
    assert.ok(block.includes("failure.path"), "le chemin reste visible");
    assert.ok(block.includes("failure.detail"), "la raison est dite");
    assert.ok(block.includes("BACKLOG_FAILURE_FOOTER"), "rappelle qu'aucune tache n'est creee");
  });

  it("preserve les paragraphes du message d'echec", async () => {
    // Le message d'une Server Action porte plusieurs paragraphes : un rendu qui
    // les ecraserait rendrait la cause illisible d'un coup d'oeil.
    const button = code(await source("GenerateBacklogButton.tsx"));
    assert.ok(button.includes("whitespace-pre-line"));
    assert.ok(button.includes('role="alert"'));
  });
});

describe("ce que la page ne peut pas afficher", () => {
  const FORBIDDEN = [
    "providerJson",
    "instructions",
    "apiKey",
    "NOX_OPENAI_API_KEY",
    "process.env",
    "JSON.stringify",
    ".stack",
    "dangerouslySetInnerHTML",
  ];

  for (const file of ["page.tsx", "GenerateBacklogButton.tsx"]) {
    it(`n'a acces a aucune donnee brute — ${file}`, async () => {
      const rendered = code(await source(file));

      for (const forbidden of FORBIDDEN) {
        assert.equal(rendered.includes(forbidden), false, `${file} manipule ${forbidden}`);
      }
    });
  }

  it("ne transporte que des identifiants depuis le navigateur", async () => {
    const button = code(await source("GenerateBacklogButton.tsx"));

    // Ni contexte, ni prompt, ni modele, ni empreinte : un identifiant, et
    // c'est tout.
    const hidden = [...button.matchAll(/name="([^"]+)"/gu)].map((match) => match[1]);
    assert.deepEqual(hidden, ["projectId"]);
  });
});

describe("ouvrir la page ne genere rien", () => {
  it("ne lance aucune planification au rendu", async () => {
    const page = code(await source("page.tsx"));

    assert.equal(page.includes("generateProjectBacklog"), false);
    assert.equal(page.includes("OpenAIArchitectProvider"), false);
    assert.equal(page.includes("generateBacklogAction"), false);
  });

  it("laisse la generation derriere un formulaire humain", async () => {
    const button = code(await source("GenerateBacklogButton.tsx"));

    // Une action de formulaire, declenchee par un `submit`. Aucun `useEffect`,
    // aucun minuteur, aucun rappel automatique apres un echec.
    assert.ok(button.includes("generateBacklogAction"));
    assert.ok(button.includes('type="submit"'));
    assert.equal(button.includes("useEffect"), false);
    assert.equal(button.includes("setTimeout"), false);
    assert.equal(button.includes("setInterval"), false);
  });

  it("annonce son cout avant le clic", async () => {
    const button = code(await source("GenerateBacklogButton.tsx"));
    assert.ok(button.includes("BACKLOG_GENERATE_NOTICE"));
  });

  it("ne reessaie jamais apres un echec", async () => {
    // HOTFIX-001 n'ajoute ni reparation de sortie, ni reessai, ni modele de
    // repli : un echec rend la main, avec sa cause.
    const actions = code(await source("actions.ts"));

    assert.equal(actions.includes("retry"), false);
    assert.equal(actions.includes("fallbackModel"), false);
    assert.equal((actions.match(/generateProjectBacklog\(/gu) ?? []).length, 1);
  });
});
