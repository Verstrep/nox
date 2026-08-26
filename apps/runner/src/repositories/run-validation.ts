/**
 * Execution d'une commande de validation, par NOX lui-meme.
 *
 * ## Ce que ce module n'utilise jamais
 *
 * Aucun interpreteur de commandes. Pas de `shell: true`, pas de `cmd /c` sur la
 * ligne recue, pas de `bash -c`. La commande arrive deja validee — donc sans
 * guillemet, sans chainage, sans redirection, sans substitution — et se decoupe
 * par une simple separation sur l'espace. Il n'y a aucune syntaxe a interpreter,
 * donc aucune raison d'invoquer quelque chose qui saurait l'interpreter.
 *
 * ## La double validation est voulue
 *
 * Le serveur web a deja verifie la politique avant d'appeler. Ce module la
 * reverifie. Ce n'est pas de la redondance : c'est ici que la machine est
 * reellement touchee, et cette frontiere ne fait confiance a personne — pas
 * meme au serveur web de NOX. Si un jour un appelant est compromis, c'est cette
 * verification-la qui tient.
 *
 * ## Le dossier de travail
 *
 * Toujours la racine canonique du repository, obtenue de Git. Jamais un chemin
 * recu tel quel, jamais un sous-dossier, jamais rien qui vienne du navigateur —
 * qui, de toute facon, n'atteint jamais cette route.
 *
 * ## Ce qu'il ne fait pas
 *
 * Il ne touche pas a Git, ne nettoie rien, et ne restaure rien apres coup. Une
 * validation qui produit un `dist/` le laisse : NOX constate l'etat du disque,
 * il ne le repare pas. C'est la meme regle que pour une execution de Claude Code.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

import {
  RUNNER_ERROR,
  TRACKED_STATE_FILE_LIMIT,
  VALIDATION_OUTPUT_LIMIT,
  boundOutput,
  checkAutonomousCommand,
  parseValidationCommand,
  type RunValidationSuccess,
  type RunnerErrorCode,
} from "@nox/shared";

import {
  buildSpawnPlan,
  resolveExecutablePath,
  sanitizeEnvironment,
} from "../claude/executable.ts";
import { GIT_STATE_TIMEOUT_MS, runGitCommand } from "./git-state.ts";
import { resolveRepository, type GitRunner } from "./resolve-repository.ts";

/**
 * Delai maximal d'une validation.
 *
 * Une constante du code, jamais une variable d'environnement : une borne de
 * securite qu'on peut desserrer depuis l'exterieur n'en est plus une. C'est la
 * meme regle que pour les limites d'evenements du runner.
 */
export const VALIDATION_TIMEOUT_MS = 300_000;

/** Delai laisse au processus pour s'arreter proprement avant d'etre tue. */
const VALIDATION_KILL_GRACE_MS = 5_000;

export type RunValidationOutcome =
  | { ok: true; result: RunValidationSuccess }
  | { ok: false; code: RunnerErrorCode; detail: string };

export type RunValidationOptions = {
  runGit?: GitRunner;
  timeoutMs?: number;
  /** Environnement de reference, remplace dans les tests. */
  environment?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
};

/**
 * Execute une commande de validation dans un repository.
 *
 * Retourne un resultat meme quand la commande echoue : un code de sortie non nul
 * **est** une reponse, et c'est precisement celle qu'une validation cherche a
 * obtenir. Seule l'impossibilite d'executer produit un refus.
 */
export async function runRepositoryValidation(
  repositoryPath: string,
  command: string,
  options: RunValidationOptions = {},
): Promise<RunValidationOutcome> {
  // La politique d'abord : inutile de resoudre un repository pour une commande
  // qui ne sera de toute facon pas lancee.
  const refusal = checkAutonomousCommand(command);
  if (refusal !== null) {
    return { ok: false, code: RUNNER_ERROR.VALIDATION_COMMAND_REFUSED, detail: refusal };
  }

  const parsed = parseValidationCommand(command);
  if (parsed === null) {
    return {
      ok: false,
      code: RUNNER_ERROR.VALIDATION_COMMAND_REFUSED,
      detail: "La commande ne peut pas etre decoupee en programme et arguments.",
    };
  }

  const resolved = await resolveRepository(repositoryPath, { runGit: options.runGit });
  if (!resolved.ok) {
    return {
      ok: false,
      code: resolved.code,
      detail: "Le repository n'a pas pu etre resolu.",
    };
  }

  const environment = options.environment ?? process.env;
  const platform = options.platform ?? process.platform;

  const executable = resolveExecutablePath(parsed.program, environment, platform);
  if (executable === null) {
    return {
      ok: false,
      code: RUNNER_ERROR.VALIDATION_SPAWN_FAILED,
      detail: `Le programme « ${parsed.program} » est introuvable sur cette machine.`,
    };
  }

  const plan = buildSpawnPlan(executable, parsed.args, environment, platform);

  return execute(plan, resolved.canonicalPath, environment, options.timeoutMs ?? VALIDATION_TIMEOUT_MS);
}

function execute(
  plan: { command: string; args: string[] },
  cwd: string,
  environment: Record<string, string | undefined>,
  timeoutMs: number,
): Promise<RunValidationOutcome> {
  return new Promise((resolve) => {
    const startedAt = Date.now();

    let child;
    try {
      child = spawn(plan.command, plan.args, {
        cwd,
        // Le dossier de travail est la racine canonique, jamais un chemin recu.
        // L'environnement est celui du runner **prive de toute variable
        // `NOX_*`** : le filtre porte sur le prefixe entier, donc une variable
        // ajoutee plus tard est couverte d'office.
        env: sanitizeEnvironment(environment),
        // Jamais de shell. La commande est deja decoupee ; lui en donner un
        // rouvrirait exactement ce que la validation de commande a ferme.
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({
        ok: false,
        code: RUNNER_ERROR.VALIDATION_SPAWN_FAILED,
        detail: error instanceof Error ? error.message : "Demarrage impossible.",
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let stdoutOverflow = false;
    let stderrOverflow = false;
    let settled = false;
    let timedOut = false;

    // La lecture **continue** apres la limite : couper le flux laisserait le
    // processus se bloquer sur un tuyau plein. Seule la conservation s'arrete.
    const collect = (chunk: Buffer, stream: "out" | "err"): void => {
      const text = chunk.toString("utf8");
      if (stream === "out") {
        if (stdout.length >= VALIDATION_OUTPUT_LIMIT * 2) {
          stdoutOverflow = true;
          stdout = stdout.slice(stdout.length - VALIDATION_OUTPUT_LIMIT);
        }
        stdout += text;
      } else {
        if (stderr.length >= VALIDATION_OUTPUT_LIMIT * 2) {
          stderrOverflow = true;
          stderr = stderr.slice(stderr.length - VALIDATION_OUTPUT_LIMIT);
        }
        stderr += text;
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      collect(chunk, "out");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      collect(chunk, "err");
    });

    const finish = (outcome: RunValidationOutcome): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve(outcome);
    };

    let killTimer: NodeJS.Timeout = setTimeout(() => undefined, 0);
    clearTimeout(killTimer);

    // Le delai depasse tue l'arbre du processus. Un processus laisse vivant
    // apres un timeout continuerait de travailler dans le repository que
    // l'utilisateur est en train de relire.
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, VALIDATION_KILL_GRACE_MS);
    }, timeoutMs);

    child.on("error", (error: Error) => {
      finish({
        ok: false,
        code: RUNNER_ERROR.VALIDATION_SPAWN_FAILED,
        detail: error.message,
      });
    });

    child.on("close", (code: number | null) => {
      const outBound = boundOutput(stdout);
      const errBound = boundOutput(stderr);
      finish({
        ok: true,
        result: {
          ok: true,
          // Un processus tue n'a pas de code de sortie qui veuille dire quelque
          // chose : `null` accompagne du drapeau dit la verite, la ou un `1`
          // invente ferait passer une interruption pour un resultat.
          exitCode: timedOut ? null : code,
          timedOut,
          durationMs: Date.now() - startedAt,
          stdout: outBound.text,
          stdoutTruncated: outBound.truncated || stdoutOverflow,
          stderr: errBound.text,
          stderrTruncated: errBound.truncated || stderrOverflow,
        },
      });
    });
  });
}

/**
 * Empreinte de l'etat **suivi** d'un repository.
 *
 * ## Pourquoi `-uno`
 *
 * Les fichiers non suivis sont volontairement exclus. Une validation a le droit
 * de produire un `dist/`, un `coverage/` ou un cache : ce sont des artefacts,
 * normalement ignores, et les compter ferait echouer toute tache dont la preuve
 * est une compilation. Ce qu'on cherche a detecter est different et plus grave :
 * la preuve a-t-elle **reecrit le travail** qu'elle evaluait ?
 *
 * ## Pourquoi une empreinte plutot qu'une liste
 *
 * Parce que la question est binaire — quelque chose a-t-il bouge ? La liste
 * detaillee de ce qui a change appartient a la review Git, qui la produit deja.
 *
 * `HEAD` entre dans l'empreinte : une validation qui creerait un commit
 * changerait l'etat suivi sans changer le `status`.
 */
export async function readTrackedState(
  repositoryPath: string,
  options: { runGit?: GitRunner } = {},
): Promise<
  { ok: true; digest: string; files: string[] } | { ok: false; code: RunnerErrorCode }
> {
  const resolved = await resolveRepository(repositoryPath, { runGit: options.runGit });
  if (!resolved.ok) {
    return { ok: false, code: resolved.code };
  }

  const head = await runGitCommand(resolved.canonicalPath, ["rev-parse", "HEAD"], GIT_STATE_TIMEOUT_MS);
  const status = await runGitCommand(
    resolved.canonicalPath,
    ["status", "--porcelain=v1", "-uno"],
    GIT_STATE_TIMEOUT_MS,
  );

  if (head.status !== "ok" || status.status !== "ok") {
    // Ne pas savoir n'est pas « rien n'a change ». Le refus remonte, et
    // l'appelant refusera l'auto-completion plutot que de la supposer sure.
    return { ok: false, code: RUNNER_ERROR.GIT_NOT_AVAILABLE };
  }

  const digest = createHash("sha256")
    .update(`${head.stdout.trim()}
${status.stdout}`, "utf8")
    .digest("hex");
  return { ok: true, digest, files: trackedPathsOf(status.stdout) };
}

/**
 * Chemins suivis qu'un `git status --porcelain=v1 -uno` a signales.
 *
 * Les deux premiers caracteres sont les codes d'index et de dossier de travail,
 * le troisieme une espace. Le reste est le chemin, **relatif** au repository :
 * `--no-renames` n'etant pas passe ici, une ligne de renommage porte
 * `ancien -> nouveau`, et c'est la destination qui est retenue — c'est elle qui
 * existe sur le disque.
 *
 * La liste est bornee et triee : elle sert a nommer ce qui a bouge, pas a
 * remplacer une review.
 */
function trackedPathsOf(status: string): string[] {
  const paths = new Set<string>();
  for (const line of status.split(/\r?\n/u)) {
    if (line.length < 4) {
      continue;
    }
    const raw = line.slice(3).trim();
    const arrow = raw.lastIndexOf(" -> ");
    const candidate = arrow === -1 ? raw : raw.slice(arrow + 4);
    const cleaned = candidate.replace(/^"(.*)"$/u, "$1").trim();
    if (cleaned !== "") {
      paths.add(cleaned);
    }
  }
  return [...paths].sort().slice(0, TRACKED_STATE_FILE_LIMIT);
}
