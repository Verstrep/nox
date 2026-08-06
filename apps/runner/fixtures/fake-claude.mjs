/**
 * Faux Claude Code, pour les tests et le test fonctionnel.
 *
 * Aucun test automatise de NOX ne lance le vrai Claude Code : ce serait
 * consommer du quota, dependre du reseau, et rendre les tests non
 * reproductibles. Ce script en imite le contrat — arguments, entree standard,
 * sortie JSON, code de sortie — et rien de plus.
 *
 * Il enregistre tout ce qu'il a recu dans le fichier designe par
 * `FAKE_CLAUDE_REPORT`, ce qui permet aux tests de verifier le `cwd`, les
 * arguments, l'environnement transmis et le prompt recu sur `stdin`.
 *
 * Comportement pilote par `FAKE_CLAUDE_MODE` :
 *
 *   success       sortie JSON valide, code 0
 *   error-json    sortie JSON avec `is_error`, code 1
 *   non-json      sortie qui n'est pas du JSON, code 0
 *   exit-nonzero  sortie JSON valide, mais code de sortie non nul
 *   limit         sortie JSON annoncant une limite d'utilisation
 *   slow          ne se termine pas avant `FAKE_CLAUDE_SLEEP_MS`
 *   no-cost       sortie JSON valide sans cout ni session
 *   write-file    ecrit `FAKE_CLAUDE_WRITE` dans le repository, puis reussit
 *   commit        cree un commit Git, puis reussit — pour tester le refus
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

// `--version` doit repondre sans lire l'entree standard : le preflight
// l'interroge sans rien lui ecrire, et attendre bloquerait jusqu'au delai.
if (process.argv.includes("--version")) {
  process.stdout.write("1.0.0-faux (fake-claude)\n");
  process.exit(0);
}

/**
 * Le mode peut venir d'un fichier plutot que de l'environnement : le test
 * fonctionnel enchaine plusieurs scenarios sans redemarrer le runner, et un
 * fichier se reecrit entre deux, ce qu'une variable heritee ne permet pas.
 */
function readMode() {
  const modeFile = process.env.FAKE_CLAUDE_MODE_FILE ?? "";
  if (modeFile !== "") {
    try {
      return readFileSync(modeFile, "utf8").trim();
    } catch {
      // Fichier absent : on retombe sur la variable d'environnement.
    }
  }
  return process.env.FAKE_CLAUDE_MODE ?? "success";
}

const mode = readMode();
const reportPath = process.env.FAKE_CLAUDE_REPORT ?? "";

function readStdin() {
  return new Promise((resolve) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("end", () => {
      resolve(input);
    });
    process.stdin.on("error", () => {
      resolve(input);
    });
  });
}

const prompt = await readStdin();

if (reportPath !== "") {
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        argv: process.argv.slice(2),
        cwd: process.cwd(),
        prompt,
        // L'environnement complet est enregistre pour que les tests puissent
        // verifier qu'aucune variable NOX n'a ete transmise.
        environmentNames: Object.keys(process.env).sort(),
      },
      null,
      2,
    ),
    "utf8",
  );
}

const success = {
  type: "result",
  subtype: "success",
  is_error: false,
  result: "## Résultat\n\nTravail simule par le faux Claude.",
  session_id: "fake-session-0001",
  duration_ms: 1234,
  duration_api_ms: 999,
  num_turns: 3,
  total_cost_usd: 0.0421,
};

switch (mode) {
  case "non-json": {
    process.stdout.write("Ceci n'est pas du JSON.\n");
    process.exit(0);
    break;
  }

  case "error-json": {
    process.stdout.write(
      JSON.stringify({ ...success, subtype: "error", is_error: true, result: "Echec simule." }),
    );
    process.stderr.write("trace d'erreur simulee\n");
    process.exit(1);
    break;
  }

  case "exit-nonzero": {
    process.stdout.write(JSON.stringify(success));
    process.stderr.write("sortie non nulle simulee\n");
    process.exit(3);
    break;
  }

  case "limit": {
    process.stdout.write(
      JSON.stringify({
        ...success,
        subtype: "usage_limit",
        is_error: true,
        result: "Claude usage limit reached.",
      }),
    );
    process.exit(1);
    break;
  }

  case "slow": {
    const sleepMs = Number(process.env.FAKE_CLAUDE_SLEEP_MS ?? "10000");
    setTimeout(() => {
      process.stdout.write(JSON.stringify(success));
      process.exit(0);
    }, sleepMs);
    break;
  }

  case "no-cost": {
    process.stdout.write(
      JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Fait." }),
    );
    process.exit(0);
    break;
  }

  case "write-file": {
    const relative = process.env.FAKE_CLAUDE_WRITE ?? "FAKE.md";
    appendFileSync(path.join(process.cwd(), relative), `# Ecrit par le faux Claude\n`, "utf8");
    process.stdout.write(JSON.stringify(success));
    process.exit(0);
    break;
  }

  case "commit": {
    const relative = process.env.FAKE_CLAUDE_WRITE ?? "FAKE.md";
    appendFileSync(path.join(process.cwd(), relative), `# Ecrit puis commite\n`, "utf8");
    execFileSync("git", ["add", "-A"], { cwd: process.cwd() });
    execFileSync("git", ["commit", "-m", "commit interdit"], { cwd: process.cwd() });
    process.stdout.write(JSON.stringify(success));
    process.exit(0);
    break;
  }

  default: {
    process.stdout.write(JSON.stringify(success));
    process.exit(0);
  }
}
