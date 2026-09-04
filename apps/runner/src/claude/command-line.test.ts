/**
 * La ligne de commande Windows, jeton par jeton.
 *
 * ## Ce que ce fichier prouve
 *
 * Que la citation est **uniforme** — tous les jetons, sans condition —, que la
 * paire exterieure attendue par `/s` est bien la, et surtout que le module
 * **refuse** plutot que d'approximer. Un refus produit une erreur nommee ; une
 * ligne mal citee produirait une commande que personne n'a ecrite.
 *
 * Les commandes de validation ont deja traverse un alphabet ferme qui ne
 * contient aucun metacaractere de `cmd.exe`. Ces assertions verifient la
 * seconde barriere, celle qui ne fait pas confiance a la premiere.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { checkValidationCommand } from "@nox/shared";

import { buildWindowsCommandLine, isSafeWindowsToken } from "./command-line.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe("buildWindowsCommandLine", () => {
  it("cite chaque jeton et ajoute la paire que /s consomme", () => {
    assert.equal(
      buildWindowsCommandLine("C:\\bin\\outil.cmd", ["run", "build"]),
      '""C:\\bin\\outil.cmd" "run" "build""',
    );
  });

  it("cite aussi un programme sans argument", () => {
    assert.equal(buildWindowsCommandLine("C:\\bin\\outil.cmd", []), '""C:\\bin\\outil.cmd""');
  });

  it("rend litterales les espaces d'un chemin", () => {
    // Le cas exact de la panne : `C:\\Program Files\\…` devenait `C:\\Program`.
    const line = buildWindowsCommandLine("C:\\Program Files\\nodejs\\npm.cmd", ["test"]);

    assert.equal(line, '""C:\\Program Files\\nodejs\\npm.cmd" "test""');
  });

  it("rend litteraux les metacaracteres de cmd.exe presents dans un chemin", () => {
    // A l'interieur d'une paire de guillemets, `cmd.exe` ne les interprete pas.
    for (const character of ["&", "|", "<", ">", "^", "(", ")", ";", ",", "="]) {
      const program = `C:\\bin\\ou${character}til.cmd`;
      const line = buildWindowsCommandLine(program, ["test"]);

      assert.equal(line, `""${program}" "test""`, character);
    }
  });

  it("refuse un guillemet, qui romprait la citation", () => {
    assert.equal(buildWindowsCommandLine('C:\\bin\\ou"til.cmd', []), null);
    assert.equal(buildWindowsCommandLine("C:\\bin\\outil.cmd", ['a"b']), null);
  });

  it("refuse un pourcent, que les guillemets ne neutralisent pas", () => {
    // `cmd.exe` developpe `%VAR%` **y compris** entre guillemets : c'est le seul
    // caractere qu'une citation ne rend pas inerte.
    assert.equal(buildWindowsCommandLine("C:\\bin\\outil.cmd", ["%PATH%"]), null);
    assert.equal(buildWindowsCommandLine("C:\\bin\\%TEMP%\\outil.cmd", []), null);
  });

  it("refuse un antislash final, qui echapperait le guillemet fermant", () => {
    assert.equal(buildWindowsCommandLine("C:\\bin\\outil.cmd", ["dossier\\"]), null);
  });

  it("refuse un caractere de controle ou une fin de ligne", () => {
    for (const code of [0, 9, 10, 13, 27, 127]) {
      assert.equal(
        buildWindowsCommandLine("C:\\bin\\outil.cmd", [`a${String.fromCharCode(code)}b`]),
        null,
        String(code),
      );
    }
  });

  it("refuse un jeton vide", () => {
    assert.equal(buildWindowsCommandLine("", ["test"]), null);
    assert.equal(buildWindowsCommandLine("C:\\bin\\outil.cmd", [""]), null);
  });

  it("accepte tout ce que le contrat des commandes laisse passer", () => {
    // Ce que `checkValidationCommand` accepte doit toujours pouvoir etre lance :
    // un refus ici transformerait une commande enregistree en commande
    // inexecutable. Le lien entre les deux est verifie, pas suppose.
    const tokens = [
      "test",
      "run",
      "build",
      "--noEmit",
      "-w0",
      "src/index.ts",
      "a.b_c-d",
      "cle=valeur",
      "scope@1.2.3",
      "a+b",
      "C:/chemin/relatif",
    ];

    for (const token of tokens) {
      assert.equal(checkValidationCommand(`node ${token}`), null, token);
      assert.ok(isSafeWindowsToken(token), token);
      assert.notEqual(buildWindowsCommandLine("C:\\bin\\outil.cmd", [token]), null, token);
    }
  });
});

describe("isSafeWindowsToken", () => {
  it("accepte un chemin ordinaire", () => {
    assert.ok(isSafeWindowsToken("C:\\Program Files\\nodejs\\npm.cmd"));
    assert.ok(isSafeWindowsToken("--no-emit"));
    assert.ok(isSafeWindowsToken("src/index.ts"));
  });

  it("refuse ce que la citation ne protege pas", () => {
    assert.equal(isSafeWindowsToken(""), false);
    assert.equal(isSafeWindowsToken('a"b'), false);
    assert.equal(isSafeWindowsToken("%TEMP%"), false);
    assert.equal(isSafeWindowsToken("fin\\"), false);
  });
});

describe("aucun interprete n'est demande a Node", () => {
  it("ne passe jamais par shell: true, ni par un autre interprete", async () => {
    const source = (await readFile(path.join(HERE, "command-line.ts"), "utf8"))
      .replace(/\/\*[\s\S]*?\*\//gu, " ")
      .replace(/\/\/.*$/gmu, " ");

    // La difference qui compte : NOX **ecrit** la ligne, il ne demande a
    // personne d'en fabriquer une a partir de chaines.
    for (const forbidden of ["shell:", "spawn", "exec", "powershell", "bash -c", "sh -c"]) {
      assert.equal(source.includes(forbidden), false, forbidden);
    }
  });
});
