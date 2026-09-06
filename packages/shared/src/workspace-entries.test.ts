/**
 * Ce qu'une divergence de dossier de travail peut dire, et ce qu'elle ne dit pas.
 *
 * La regle a proteger est celle qui empeche ces entrees de devenir un second
 * controle de securite : elles **expliquent** un refus, elles ne le prennent
 * pas. Le refus vient de l'empreinte globale, et lui seul.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  WORKSPACE_ENTRY_LIMITS,
  describeWorkspaceDivergence,
  diffWorkspaceEntries,
  divergenceIsEmpty,
  parseWorkspaceEntries,
  serializeWorkspaceEntries,
  workspaceDivergenceMessage,
  type WorkspaceEntryDigest,
} from "../dist/index.js";

function entry(path: string, digest = "a1b2", code = " M"): WorkspaceEntryDigest {
  return { path, code, digest };
}

describe("serializeWorkspaceEntries", () => {
  it("fait un aller-retour fidele", () => {
    const entries = [entry("src/a.ts"), entry("docs/b.md", "c3d4", "??")];
    const text = serializeWorkspaceEntries(entries);
    assert.ok(text !== null);
    assert.deepEqual(parseWorkspaceEntries(text), entries);
  });

  it("ne conserve rien plutot qu'une liste partielle", () => {
    // Une liste tronquee ferait dire « ce fichier est apparu » d'un fichier
    // simplement absent de la moitie retenue. « Rien » est la reponse sure.
    const many = Array.from({ length: WORKSPACE_ENTRY_LIMITS.maxEntries + 1 }, (_, index) =>
      entry(`f${String(index)}.ts`),
    );
    assert.equal(serializeWorkspaceEntries(many), null);
  });

  it("ne conserve rien devant un chemin demesure", () => {
    const long = entry("x".repeat(WORKSPACE_ENTRY_LIMITS.maxPathLength + 1));
    assert.equal(serializeWorkspaceEntries([long]), null);
  });

  it("rend null pour une liste vide", () => {
    assert.equal(serializeWorkspaceEntries([]), null);
  });

  it("supporte un chemin contenant un retour a la ligne", () => {
    // Un separateur qu'une donnee a le droit de contenir n'est pas un
    // separateur : c'est pourquoi cette colonne est du JSON et non des lignes.
    const odd = entry("dossier/nom\navec-saut.txt");
    const text = serializeWorkspaceEntries([odd]);
    assert.ok(text !== null);
    assert.deepEqual(parseWorkspaceEntries(text), [odd]);
  });
});

describe("parseWorkspaceEntries", () => {
  it("tolere une valeur absente", () => {
    assert.equal(parseWorkspaceEntries(null), null);
    assert.equal(parseWorkspaceEntries("   "), null);
  });

  it("tolere une valeur illisible sans lever", () => {
    // Cette colonne est facultative : une base ecrite autrement doit rester
    // lisible, et une page ne doit pas tomber pour un diagnostic.
    assert.equal(parseWorkspaceEntries("{pas du json"), null);
    assert.equal(parseWorkspaceEntries('{"objet": true}'), null);
    assert.equal(parseWorkspaceEntries('[{"path": 3}]'), null);
    assert.equal(parseWorkspaceEntries('[{"path": "", "code": " M", "digest": "a"}]'), null);
  });
});

describe("diffWorkspaceEntries", () => {
  const before = [entry("a.ts", "1"), entry("b.ts", "2"), entry("c.ts", "3")];

  it("ne trouve rien entre deux etats identiques", () => {
    assert.equal(divergenceIsEmpty(diffWorkspaceEntries(before, before)), true);
  });

  it("nomme un fichier apparu", () => {
    const after = [...before, entry("d.ts", "4")];
    assert.deepEqual(diffWorkspaceEntries(before, after).appeared, ["d.ts"]);
  });

  it("nomme un fichier disparu", () => {
    const after = before.filter((row) => row.path !== "b.ts");
    assert.deepEqual(diffWorkspaceEntries(before, after).disappeared, ["b.ts"]);
  });

  it("nomme un contenu modifie", () => {
    const after = [entry("a.ts", "1"), entry("b.ts", "MODIFIE"), entry("c.ts", "3")];
    const divergence = diffWorkspaceEntries(before, after);
    assert.deepEqual(divergence.modified, ["b.ts"]);
    assert.deepEqual(divergence.restaged, []);
  });

  it("distingue une reindexation d'une modification", () => {
    // Le meme contenu, un etat d'index different. Les confondre ferait accuser
    // l'utilisateur d'une edition qu'il n'a pas faite.
    const after = [entry("a.ts", "1"), entry("b.ts", "2", "M "), entry("c.ts", "3")];
    const divergence = diffWorkspaceEntries(before, after);
    assert.deepEqual(divergence.restaged, ["b.ts"]);
    assert.deepEqual(divergence.modified, []);
  });

  it("rend des listes triees, quel que soit l'ordre recu", () => {
    const after = [entry("z.ts", "9"), ...before, entry("m.ts", "8")];
    assert.deepEqual(diffWorkspaceEntries(before, after).appeared, ["m.ts", "z.ts"]);
  });
});

describe("describeWorkspaceDivergence", () => {
  it("borne le nombre de chemins nommes, et compte le reste", () => {
    const after = Array.from({ length: 9 }, (_, index) => entry(`n${String(index)}.ts`));
    const described = describeWorkspaceDivergence(diffWorkspaceEntries([], after));
    assert.ok(described !== null);
    assert.match(described, /\+4 autres/u);
  });

  it("rend null quand rien ne diverge", () => {
    assert.equal(describeWorkspaceDivergence(diffWorkspaceEntries([], [])), null);
  });
});

describe("workspaceDivergenceMessage", () => {
  it("nomme les chemins quand il les connait", () => {
    const message = workspaceDivergenceMessage(
      diffWorkspaceEntries([entry("a.ts", "1")], [entry("a.ts", "2")]),
    );
    assert.match(message, /a\.ts/u);
    assert.match(message, /modifies/u);
  });

  it("dit qu'il ne peut pas nommer, sans faire semblant", () => {
    const message = workspaceDivergenceMessage(null);
    assert.match(message, /ne peut pas nommer/u);
    // Deux origines possibles, et NOX ne sait pas les distinguer : il le dit.
    assert.match(message, /jeton de runner/u);
  });

  it("maintient le refus quand la liste est identique", () => {
    // Le cas ou les deux signaux se contredisent. L'empreinte gagne, toujours :
    // ce message ne doit jamais laisser croire que « rien n'a change ».
    const message = workspaceDivergenceMessage(diffWorkspaceEntries([], []));
    assert.match(message, /reste refusee/u);
    assert.match(message, /l'empreinte qui fait foi/u);
  });
});
