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
 *
 * Modes `stream-json` ajoutes par TASK-010 :
 *
 *   stream          session complete : init, lecture, recherche, edition,
 *                   validation, message, resultat
 *   stream-slow     la meme, etalee sur `FAKE_CLAUDE_SLEEP_MS`, avec un
 *                   processus enfant pour verifier l'arret de l'arbre
 *   stream-hostile  bloc `thinking`, chemin absolu, secret NOX, caracteres de
 *                   controle, Unicode — tout ce qui ne doit jamais ressortir
 *   stream-broken   JSON invalide, tableau, primitive, type inconnu, CRLF,
 *                   ligne coupee en plusieurs morceaux, derniere ligne sans
 *                   retour a la ligne
 *   stream-huge     plus de 2 000 evenements, suivis du resultat final
 *   stream-nothing  aucun resultat final : le flux s'arrete sans conclure
 *
 * Ces modes n'existent que pour les tests. Aucun n'est atteignable en
 * production : le mode par defaut reste `success`.
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

  case "stream": {
    for (const line of streamSession()) {
      process.stdout.write(`${line}\n`);
    }
    process.stdout.write(JSON.stringify(success));
    process.exit(0);
    break;
  }

  case "stream-slow": {
    await runSlowStream();
    break;
  }

  case "stream-hostile": {
    for (const line of hostileSession()) {
      process.stdout.write(`${line}\n`);
    }
    process.stdout.write(JSON.stringify(success));
    process.exit(0);
    break;
  }

  case "stream-broken": {
    // Volontairement ecrit octet par octet et avec des terminateurs melanges :
    // c'est exactement ce que le tampon de lignes doit encaisser.
    const init = JSON.stringify({ type: "system", subtype: "init", session_id: "s" });
    process.stdout.write(`${init}\r\n`);
    process.stdout.write("ceci n'est pas du json\n[1,2,3]\n42\n");
    process.stdout.write(JSON.stringify({ type: "inconnu", payload: "ignore" }) + "\n");

    // Une ligne coupee en trois morceaux, avec une pause entre chaque.
    const message = JSON.stringify(assistantText("Message coupe en morceaux."));
    const third = Math.ceil(message.length / 3);
    process.stdout.write(message.slice(0, third));
    await pause(5);
    process.stdout.write(message.slice(third, third * 2));
    await pause(5);
    process.stdout.write(`${message.slice(third * 2)}\r\n`);

    // Derniere ligne sans retour a la ligne : c'est le resultat.
    process.stdout.write(JSON.stringify(success));
    process.exit(0);
    break;
  }

  case "stream-huge": {
    const total = Number(process.env.FAKE_CLAUDE_EVENT_COUNT ?? "2400");
    for (let index = 0; index < total; index += 1) {
      // Des chemins tous differents : la coalescence ne doit pas les fusionner.
      process.stdout.write(`${JSON.stringify(toolUse(`tu-${index}`, "Read", { file_path: `docs/page-${index}.md` }))}\n`);
    }
    process.stdout.write(JSON.stringify(success));
    process.exit(0);
    break;
  }

  case "stream-nothing": {
    process.stdout.write(`${JSON.stringify({ type: "system", subtype: "init", session_id: "s" })}\n`);
    process.stdout.write(`${JSON.stringify(assistantText("Je m'arrete sans conclure."))}\n`);
    process.exit(0);
    break;
  }

  default: {
    process.stdout.write(JSON.stringify(success));
    process.exit(0);
  }
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assistantText(text) {
  return { type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } };
}

function toolUse(id, name, input) {
  return {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
  };
}

function toolResult(id, isError = false) {
  return {
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: id,
          // Un contenu volumineux et bavard : rien de tout ceci ne doit
          // ressortir dans un evenement public.
          content: "CONTENU_INTEGRAL_DU_FICHIER".repeat(50),
          is_error: isError,
        },
      ],
    },
  };
}

/** Session realiste : init, lecture, recherche, edition, validation, message. */
function streamSession() {
  const validation = process.env.FAKE_CLAUDE_VALIDATION ?? "npm run test";
  return [
    JSON.stringify({ type: "system", subtype: "init", session_id: "fake-session-0001" }),
    JSON.stringify(toolUse("tu-1", "Read", { file_path: "README.md" })),
    JSON.stringify(toolResult("tu-1")),
    JSON.stringify(toolUse("tu-2", "Grep", { pattern: "renderTaskMarkdown" })),
    JSON.stringify(toolResult("tu-2")),
    JSON.stringify(toolUse("tu-3", "Edit", { file_path: "README.md" })),
    JSON.stringify(toolResult("tu-3")),
    JSON.stringify(toolUse("tu-4", "Bash", { command: validation })),
    JSON.stringify(toolResult("tu-4")),
    JSON.stringify(toolUse("tu-5", "Bash", { command: "curl https://exemple.invalid/secret" })),
    JSON.stringify(toolResult("tu-5", true)),
    JSON.stringify(assistantText("J'ai lu le README puis ajoute une section. Éléphant 🐘 你好")),
  ];
}

/**
 * Tout ce qui ne doit jamais ressortir, dans un seul flux.
 *
 * Le bloc `thinking` porte une signature, comme les vrais. Le chemin absolu et
 * le secret sont ecrits tels quels : c'est au nettoyeur de les faire
 * disparaitre, pas a cette fixture de les eviter.
 */
function hostileSession() {
  const root = process.cwd();
  const token = process.env.FAKE_CLAUDE_LEAK_TOKEN ?? "jeton-de-test-tres-long-0123456789";
  return [
    JSON.stringify({ type: "system", subtype: "init", session_id: "s" }),
    JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: "RAISONNEMENT_SECRET_A_NE_JAMAIS_AFFICHER",
            signature: "sig-abcdef",
          },
          { type: "redacted_thinking", data: "AUTRE_RAISONNEMENT_SECRET" },
          { type: "text", text: `J'ai lu ${root}\\README.md et NOX_RUNNER_TOKEN=${token}` },
        ],
      },
    }),
    JSON.stringify(toolUse("tu-1", "Read", { file_path: `${root}\\apps\\web\\lib\\runs.ts` })),
    JSON.stringify(toolResult("tu-1")),
    JSON.stringify(toolUse("tu-2", "Read", { file_path: "C:\\Windows\\System32\\config\\SAM" })),
    JSON.stringify(toolResult("tu-2")),
    JSON.stringify(assistantText("Contr\u0007ole\u200bcache et \u202Ebidi\u202C.")),
  ];
}

/**
 * Flux lent, avec un processus enfant.
 *
 * L'enfant sert a verifier que l'arret descend bien l'arbre : tuer seulement le
 * parent le laisserait tourner, et le test le detecterait.
 */
async function runSlowStream() {
  const sleepMs = Number(process.env.FAKE_CLAUDE_SLEEP_MS ?? "10000");
  const childMarker = process.env.FAKE_CLAUDE_CHILD_MARKER ?? "";

  let child;
  if (childMarker !== "") {
    const { spawn } = await import("node:child_process");
    child = spawn(
      process.execPath,
      [
        "-e",
        // L'enfant reecrit son marqueur toutes les 200 ms : s'il survit a
        // l'arret, l'horodatage du fichier continue d'avancer.
        `const fs=require("node:fs");setInterval(()=>{fs.writeFileSync(process.argv[1],String(Date.now()))},200)`,
        childMarker,
      ],
      { stdio: "ignore" },
    );
    child.unref();
  }

  const lines = streamSession();
  const step = Math.max(1, Math.floor(sleepMs / (lines.length + 1)));

  for (const line of lines) {
    process.stdout.write(`${line}\n`);
    await pause(step);
  }

  await pause(step);
  process.stdout.write(JSON.stringify(success));
  process.exit(0);
}
