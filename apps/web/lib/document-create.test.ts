import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DOCUMENT_DESTINATIONS,
  ROOT_DOCUMENT_CHOICES,
  buildDocumentPath,
  findDestination,
} from "./document-create.ts";

describe("DOCUMENT_DESTINATIONS", () => {
  it("propose les cinq destinations attendues", () => {
    assert.deepEqual(
      DOCUMENT_DESTINATIONS.map((destination) => destination.id),
      ["CORE", "DOCUMENTATION", "DECISION", "PLAN", "TASK"],
    );
  });

  it("associe chaque dossier a la categorie que l'inventaire lui donnera", () => {
    assert.deepEqual(
      DOCUMENT_DESTINATIONS.filter((entry) => entry.kind === "directory").map((entry) => [
        entry.id,
        entry.directory,
      ]),
      [
        ["DOCUMENTATION", "docs"],
        ["DECISION", "decisions"],
        ["PLAN", "plans"],
        ["TASK", "tasks"],
      ],
    );
  });

  it("limite la racine a trois documents", () => {
    assert.deepEqual(ROOT_DOCUMENT_CHOICES, ["README.md", "CLAUDE.md", "AGENTS.md"]);
  });
});

describe("findDestination", () => {
  it("retrouve une destination connue", () => {
    assert.equal(findDestination("DECISION")?.directory, "decisions");
  });

  it("ignore une valeur inconnue", () => {
    for (const value of ["", "AUTRE", "docs", "../", "CORE "]) {
      assert.equal(findDestination(value), null, value);
    }
  });
});

/** Chemin construit, ou `null` si la construction a ete refusee. */
function pathOf(destination: string, name: string): string | null {
  const result = buildDocumentPath(destination, name);
  return result.ok ? result.path : null;
}

describe("buildDocumentPath - destinations a dossier", () => {
  it("prefixe le nom par le dossier de la destination", () => {
    assert.equal(pathOf("DOCUMENTATION", "PRODUCT_VISION.md"), "docs/PRODUCT_VISION.md");
  });

  it("prefixe correctement les quatre dossiers", () => {
    assert.equal(pathOf("DECISION", "ADR-004-database.md"), "decisions/ADR-004-database.md");
    assert.equal(pathOf("PLAN", "CURRENT_PLAN.md"), "plans/CURRENT_PLAN.md");
    assert.equal(pathOf("TASK", "TASK-007.md"), "tasks/TASK-007.md");
  });

  it("accepte un sous-dossier", () => {
    assert.equal(pathOf("DOCUMENTATION", "guides/INSTALLATION.md"), "docs/guides/INSTALLATION.md");
  });

  it("accepte les accents et les espaces", () => {
    assert.equal(pathOf("DOCUMENTATION", "étude détaillée.md"), "docs/étude détaillée.md");
  });

  it("normalise les separateurs Windows et le prefixe `./`", () => {
    assert.equal(pathOf("DOCUMENTATION", "guides\\NOTE.md"), "docs/guides/NOTE.md");
    assert.equal(pathOf("DOCUMENTATION", "./NOTE.md"), "docs/NOTE.md");
  });

  it("retire les espaces qui entourent la saisie", () => {
    assert.equal(pathOf("DOCUMENTATION", "  NOTE.md  "), "docs/NOTE.md");
  });
});

describe("buildDocumentPath - refus", () => {
  it("refuse un nom vide", () => {
    const result = buildDocumentPath("DOCUMENTATION", "   ");
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.message, /nom du document/i);
  });

  it("refuse un nom sans extension `.md`, sans la completer", () => {
    const result = buildDocumentPath("DOCUMENTATION", "PRODUCT_VISION");
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.message, /\.md/);
  });

  it("refuse un chemin absolu ou une URL", () => {
    for (const name of [
      "C:\\secret.md",
      "/etc/passwd.md",
      "\\\\serveur\\partage\\NOTE.md",
      "file:///secret.md",
    ]) {
      const result = buildDocumentPath("DOCUMENTATION", name);
      assert.equal(result.ok, false, name);
    }
  });

  it("refuse une traversee `..`", () => {
    for (const name of ["../secret.md", "guides/../../secret.md", "..\\secret.md"]) {
      const result = buildDocumentPath("DOCUMENTATION", name);
      assert.equal(result.ok, false, name);
      assert.match(result.ok ? "" : result.message, /\.\./, name);
    }
  });

  it("signale un prefixe repete au lieu de le retirer en silence", () => {
    const result = buildDocumentPath("DOCUMENTATION", "docs/NOTE.md");

    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.message, /repeter/i);
  });

  it("refuse une destination inconnue", () => {
    // Une destination falsifiee dans le formulaire ne produit aucun chemin :
    // le serveur ne reconstruit qu'a partir d'une valeur qu'il connait.
    for (const destination of ["", "AUTRE", "docs", "../../"]) {
      const result = buildDocumentPath(destination, "NOTE.md");
      assert.equal(result.ok, false, destination);
    }
  });

  it("refuse un nom se terminant par une barre", () => {
    const result = buildDocumentPath("DOCUMENTATION", "guides/");
    assert.equal(result.ok, false);
  });
});

describe("buildDocumentPath - documents racine", () => {
  it("accepte les trois documents reconnus", () => {
    for (const fileName of ROOT_DOCUMENT_CHOICES) {
      assert.equal(pathOf("CORE", fileName), fileName, fileName);
    }
  });

  it("refuse tout autre nom a la racine", () => {
    for (const name of ["CHANGELOG.md", "docs/NOTE.md", "readme.md", "NOTE.md"]) {
      const result = buildDocumentPath("CORE", name);
      assert.equal(result.ok, false, name);
    }
  });

  it("refuse un choix vide", () => {
    const result = buildDocumentPath("CORE", "");
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.message, /Choisissez/i);
  });

  it("ne laisse pas un chemin arbitraire atteindre la racine", () => {
    for (const name of ["../secret.md", "C:\\secret.md", "sous/README.md"]) {
      const result = buildDocumentPath("CORE", name);
      assert.equal(result.ok, false, name);
    }
  });
});

describe("buildDocumentPath - aucun message sensible", () => {
  it("ne revele ni chemin absolu ni jeton", () => {
    for (const [destination, name] of [
      ["DOCUMENTATION", "C:\\Projets\\secret.md"],
      ["DOCUMENTATION", "../../secret.md"],
      ["CORE", "CHANGELOG.md"],
      ["INCONNUE", "NOTE.md"],
    ] as const) {
      const result = buildDocumentPath(destination, name);
      assert.equal(result.ok, false);
      if (result.ok) continue;

      assert.equal(/[A-Za-z]:\\/.test(result.message), false, name);
      assert.equal(result.message.includes("Bearer"), false, name);
    }
  });
});
