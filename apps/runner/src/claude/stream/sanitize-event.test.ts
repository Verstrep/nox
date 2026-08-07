/**
 * Tests du nettoyage des chaines publiques.
 *
 * C'est le fichier qui garde la promesse la plus forte de TASK-010 : ce qui
 * sort du runner ne contient ni chemin de la machine, ni secret. Chaque test
 * ci-dessous decrit une chose qui, si elle passait, serait une fuite.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EXTERNAL_PATH_PLACEHOLDER,
  SECRET_PLACEHOLDER,
  boundDetail,
  createEventSanitizer,
} from "./sanitize-event.ts";

const ROOT = "D:\\Projets\\Dev\\nox";

function sanitizer(environment: Record<string, string | undefined> = {}) {
  return createEventSanitizer({
    repositoryRoot: ROOT,
    environment,
    caseInsensitivePaths: true,
  });
}

describe("createEventSanitizer — chemins du repository", () => {
  it("rend relatif un chemin du repository", () => {
    const clean = sanitizer();
    assert.equal(clean(`Reading ${ROOT}\\README.md`, 1_000), "Reading README.md");
  });

  it("uniformise les separateurs en barres obliques", () => {
    const clean = sanitizer();
    assert.equal(
      clean(`Editing ${ROOT}\\apps\\web\\lib\\runs.ts`, 1_000),
      "Editing apps/web/lib/runs.ts",
    );
  });

  it("accepte le repository ecrit avec des barres obliques", () => {
    const clean = sanitizer();
    assert.equal(clean("Reading D:/Projets/Dev/nox/docs/A.md", 1_000), "Reading docs/A.md");
  });

  it("ignore la casse du chemin sous Windows", () => {
    const clean = sanitizer();
    assert.equal(clean("Reading d:\\projets\\dev\\NOX\\README.md", 1_000), "Reading README.md");
  });

  it("designe la racine elle-meme par un point", () => {
    const clean = sanitizer();
    assert.equal(clean(`cwd ${ROOT}`, 1_000), "cwd .");
  });

  it("traite plusieurs chemins dans la meme chaine", () => {
    const clean = sanitizer();
    assert.equal(
      clean(`de ${ROOT}\\a.md vers ${ROOT}\\b.md`, 1_000),
      "de a.md vers b.md",
    );
  });
});

describe("createEventSanitizer — chemins exterieurs", () => {
  it("masque un chemin Windows hors du repository", () => {
    const clean = sanitizer();
    assert.equal(
      clean("Reading C:\\Windows\\System32\\config\\SAM", 1_000),
      `Reading ${EXTERNAL_PATH_PLACEHOLDER}`,
    );
  });

  it("masque un chemin UNC", () => {
    const clean = sanitizer();
    assert.equal(
      clean("Reading \\\\serveur\\partage\\secret.txt", 1_000),
      `Reading ${EXTERNAL_PATH_PLACEHOLDER}`,
    );
  });

  it("masque un chemin POSIX absolu", () => {
    const clean = sanitizer();
    assert.equal(
      clean("Reading /home/theo/.ssh/id_rsa", 1_000),
      `Reading ${EXTERNAL_PATH_PLACEHOLDER}`,
    );
  });

  it("ne masque pas un chemin relatif", () => {
    const clean = sanitizer();
    assert.equal(clean("Editing docs/ARCHITECTURE.md", 1_000), "Editing docs/ARCHITECTURE.md");
  });

  it("ne masque pas une URL", () => {
    const clean = sanitizer();
    assert.equal(
      clean("Voir https://exemple.invalid/docs", 1_000),
      "Voir https://exemple.invalid/docs",
    );
  });
});

describe("createEventSanitizer — secrets", () => {
  const token = "jeton-runner-tres-long-0123456789";

  it("retire la valeur d'une variable NOX", () => {
    const clean = sanitizer({ NOX_RUNNER_TOKEN: token });
    const result = clean(`Authorization: Bearer ${token}`, 1_000);

    assert.equal(result.includes(token), false);
    assert.equal(result.includes(SECRET_PLACEHOLDER), true);
  });

  it("retire le nom d'une variable NOX", () => {
    const clean = sanitizer();
    const result = clean("La variable NOX_DATABASE_URL vaut quelque chose", 1_000);

    assert.equal(result.includes("NOX_DATABASE_URL"), false);
  });

  it("retire toutes les occurrences, pas seulement la premiere", () => {
    const clean = sanitizer({ NOX_RUNNER_TOKEN: token });
    const result = clean(`${token} puis ${token} puis ${token}`, 1_000);

    assert.equal(result.includes(token), false);
  });

  it("couvre toute variable NOX, pas une liste nominative", () => {
    const secret = "valeur-inventee-plus-tard-9876";
    const clean = sanitizer({ NOX_UNE_VARIABLE_FUTURE: secret });

    assert.equal(clean(`fuite ${secret}`, 1_000).includes(secret), false);
  });

  it("ignore les valeurs trop courtes, qui masqueraient des mots ordinaires", () => {
    const clean = sanitizer({ NOX_MODE: "dev" });
    assert.equal(clean("mode developpement", 1_000), "mode developpement");
  });

  it("ne touche pas aux variables qui ne sont pas de NOX", () => {
    const clean = sanitizer({ PATH: "C:\\Program Files\\nodejs" });
    assert.equal(clean("chemin ordinaire", 1_000), "chemin ordinaire");
  });
});

describe("createEventSanitizer — caracteres et bornes", () => {
  it("retire les caracteres de controle", () => {
    const clean = sanitizer();
    assert.equal(clean("Contr\u0007ole\u0000", 1_000), "Controle");
  });

  it("retire les caracteres invisibles et les marques de direction", () => {
    const clean = sanitizer();
    assert.equal(clean("a\u200bb\u202Ec\u202Cd", 1_000), "abcd");
  });

  it("preserve accents, ideogrammes et emoji", () => {
    const clean = sanitizer();
    assert.equal(clean("Éléphant 🐘 你好", 1_000), "Éléphant 🐘 你好");
  });

  it("borne une chaine trop longue et signale la coupe", () => {
    const clean = sanitizer();
    const result = clean("x".repeat(500), 100);

    assert.equal(result.length <= 100, true);
    assert.equal(result.endsWith("[…]"), true);
  });

  it("laisse intacte une chaine plus courte que la borne", () => {
    assert.equal(boundDetail("court", 100), "court");
  });

  it("rend une chaine vide pour une entree vide", () => {
    const clean = sanitizer();
    assert.equal(clean("", 1_000), "");
  });
});
