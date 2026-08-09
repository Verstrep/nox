/**
 * Tests de la sanitation Architecte.
 *
 * Deux exigences opposees, et c'est tout l'interet de cette suite :
 *
 * 1. **Rien de sensible ne sort.** Chemins, jetons, cles reconnaissables.
 * 2. **Le Markdown survit.** Un nettoyeur qui ecraserait les indentations, les
 *    blocs de code ou les lignes vides detruirait ce que l'architecte doit lire.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EXTERNAL_PATH_PLACEHOLDER,
  SECRET_PLACEHOLDER,
  collectArchitectSecrets,
  sanitizeArchitectContext,
} from "./sanitize.ts";

const ROOT = "D:/Projets/Dev/nox";

const ENVIRONMENT: Record<string, string | undefined> = {
  NOX_RUNNER_TOKEN: "jeton-runner-de-test-0123456789",
  NOX_OPENAI_API_KEY: "cle-architecte-de-test-9876543210",
  NOX_DATABASE_URL: "file:D:/Projets/Dev/nox/data/nox-dev.db",
  PATH: "C:/Windows/System32",
};

function clean(value: string): string {
  return sanitizeArchitectContext(value, {
    repositoryRoot: ROOT,
    environment: ENVIRONMENT,
    caseInsensitivePaths: true,
  });
}

describe("sanitizeArchitectContext — chemins", () => {
  it("rend relatif un chemin du repository", () => {
    assert.equal(clean("Voir D:/Projets/Dev/nox/apps/web/lib/runs.ts"), "Voir apps/web/lib/runs.ts");
  });

  it("reconnait les separateurs Windows", () => {
    assert.equal(clean("Voir D:\\Projets\\Dev\\nox\\apps\\web"), "Voir apps/web");
  });

  it("reduit la racine seule a un point", () => {
    assert.equal(clean("Le repository est D:/Projets/Dev/nox."), "Le repository est ..");
  });

  it("masque un chemin exterieur", () => {
    assert.equal(
      clean("Lu depuis C:/Users/theo/AppData/secret.txt"),
      `Lu depuis ${EXTERNAL_PATH_PLACEHOLDER}`,
    );
  });

  it("masque un chemin POSIX exterieur", () => {
    assert.ok(clean("Voir /home/theo/.ssh/id_rsa").includes(EXTERNAL_PATH_PLACEHOLDER));
  });

  it("ne casse pas une URL", () => {
    assert.equal(clean("Voir https://example.invalid/docs"), "Voir https://example.invalid/docs");
  });
});

describe("sanitizeArchitectContext — secrets connus de NOX", () => {
  it("masque la valeur du jeton du runner", () => {
    const cleaned = clean("Le jeton vaut jeton-runner-de-test-0123456789 aujourd'hui.");
    assert.equal(cleaned.includes("jeton-runner-de-test-0123456789"), false);
    assert.ok(cleaned.includes(SECRET_PLACEHOLDER));
  });

  it("masque la valeur de la cle Architecte", () => {
    const cleaned = clean("cle-architecte-de-test-9876543210");
    assert.equal(cleaned.includes("cle-architecte-de-test-9876543210"), false);
  });

  it("masque aussi le nom d'une variable NOX", () => {
    const cleaned = clean("Renseignez NOX_OPENAI_API_KEY dans le fichier.");
    assert.equal(cleaned.includes("NOX_OPENAI_API_KEY"), false);
  });

  it("collecte toute variable NOX suffisamment longue", () => {
    const secrets = collectArchitectSecrets({ NOX_A: "court", NOX_B: "valeur-assez-longue" });
    assert.deepEqual(secrets, ["valeur-assez-longue"]);
  });

  it("ignore les variables qui ne sont pas de NOX", () => {
    assert.deepEqual(collectArchitectSecrets({ AUTRE_TOKEN: "valeur-assez-longue" }), []);
  });
});

describe("sanitizeArchitectContext — secrets reconnaissables", () => {
  it("masque une cle a prefixe stable", () => {
    const cleaned = clean("La cle sk-abcdefghijklmnopqrstuvwxyz0123 est active.");
    assert.equal(cleaned.includes("sk-abcdefghijklmnopqrstuvwxyz0123"), false);
    assert.ok(cleaned.includes(SECRET_PLACEHOLDER));
  });

  it("masque un jeton de forge", () => {
    assert.equal(clean("ghp_0123456789abcdefghijklmnopqrstuvwxyz").includes("ghp_0123"), false);
  });

  it("masque un en-tete d'autorisation", () => {
    assert.equal(
      clean("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789").includes("abcdefghij"),
      false,
    );
  });

  it("masque la valeur d'une affectation dont le nom annonce un secret", () => {
    const cleaned = clean("STRIPE_SECRET_KEY=sk_live_valeur_tres_confidentielle");
    assert.equal(cleaned.includes("valeur_tres_confidentielle"), false);
    // Le nom, lui, reste : savoir qu'une variable existe n'est pas la connaitre.
    assert.ok(cleaned.includes("STRIPE_SECRET_KEY"));
  });

  it("masque un bloc de cle privee", () => {
    const pem = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEpAIBAAKCAQEA1234567890",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");
    assert.equal(clean(`Voici la cle :\n${pem}\nFin.`).includes("MIIEpAIBAAKCAQEA"), false);
  });

  it("ne masque pas un identifiant ordinaire", () => {
    // Un SHA de commit et un code de tache doivent rester lisibles : les masquer
    // rendrait le contexte incomprehensible pour un gain nul.
    const text = "Commit 5a49841 sur TASK-012, revision abc123def456.";
    assert.equal(clean(text), text);
  });
});

describe("sanitizeArchitectContext — Markdown preserve", () => {
  it("conserve les lignes vides et l'indentation", () => {
    const markdown = "# Titre\n\n- Un\n  - Imbrique\n\n```ts\nconst a = 1;\n```\n";
    assert.equal(clean(markdown), markdown);
  });

  it("conserve les tabulations", () => {
    assert.equal(clean("colonne\tcolonne"), "colonne\tcolonne");
  });

  it("conserve l'Unicode", () => {
    assert.equal(clean("Éléphant 🐘 你好"), "Éléphant 🐘 你好");
  });

  it("retire les caracteres de controle invisibles", () => {
    const hidden = `visible${String.fromCodePoint(0x200b)}${String.fromCodePoint(0x202e)}texte`;
    assert.equal(clean(hidden), "visibletexte");
  });

  it("retire un caractere de controle C0", () => {
    assert.equal(clean(`a${String.fromCodePoint(0x07)}b`), "ab");
  });

  it("rend la chaine vide telle quelle", () => {
    assert.equal(clean(""), "");
  });
});
