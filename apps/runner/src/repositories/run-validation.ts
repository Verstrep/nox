/**
 * Execution d'une commande de validation, par NOX lui-meme.
 *
 * ## Ce que ce module n'utilise jamais
 *
 * Aucun interpreteur de commandes. Pas de `shell: true`, pas de `bash -c`, et
 * jamais la ligne recue passee a un interprete. La commande arrive deja validee
 * — donc sans guillemet, sans chainage, sans redirection, sans substitution — et
 * se decoupe par une simple separation sur l'espace. Il n'y a aucune syntaxe a
 * interpreter, donc aucune raison d'invoquer quelque chose qui saurait
 * l'interpreter.
 *
 * ## Le cas Windows
 *
 * `npm` et `npx` y sont des scripts que seul l'interprete de Windows sait
 * lancer, et Node refuse depuis CVE-2024-27980 de les lancer autrement. Le plan
 * de lancement est donc construit par `executable.ts`, qui ecrit lui-meme la
 * ligne, jeton par jeton, apres les avoir tous verifies. Ce module ne compose
 * aucune chaine : il recoit un plan et le lance. `shell: false` reste vrai
 * partout — la difference entre « demander un shell » et « lancer un programme
 * avec une ligne qu'on a ecrite » est exactement celle qui separe une injection
 * d'une commande.
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

import { spawn, type ChildProcess } from "node:child_process";
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
  type SpawnPlan,
} from "../claude/executable.ts";
import { terminateProcessTree } from "../claude/terminate.ts";
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

/**
 * Lanceur de processus, injectable.
 *
 * Le seul point de substitution du systeme dans ce module. Il existe pour que
 * l'echec de creation d'un processus, le depassement de delai et l'annulation
 * soient testables sans dependre de la plateforme qui execute les tests.
 */
export type ProcessSpawner = (plan: SpawnPlan, cwd: string, env: NodeJS.ProcessEnv) => ChildProcess;

export type RunValidationOptions = {
  runGit?: GitRunner;
  timeoutMs?: number;
  /** Environnement de reference, remplace dans les tests. */
  environment?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  /** Lanceur de processus, remplace dans les tests. */
  spawnProcess?: ProcessSpawner;
  /** Signal d'annulation, quand l'appelant en fournit un. */
  signal?: AbortSignal;
};

/**
 * Traduit une panne de lancement en phrase sure.
 *
 * Le message d'origine de Node porte le **chemin absolu** de l'executable —
 * `spawn C:\Program Files\nodejs\npm ENOENT` — et aucun chemin de la machine ne
 * doit sortir du runner. Seul le code systeme est conserve : il suffit a
 * distinguer un programme introuvable d'un lancement refuse, et il ne decrit ni
 * l'arborescence, ni l'environnement, ni un secret.
 */
function describeSpawnError(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  const known = /^[A-Z][A-Z0-9_]{1,31}$/u.test(code);
  return known
    ? `Le systeme a refuse de demarrer la commande de validation. Code systeme : ${code}.`
    : "Le systeme a refuse de demarrer la commande de validation.";
}

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

  // Le dossier de reference d'un chemin relatif — `./gradlew` — est le
  // repository, jamais le dossier depuis lequel le runner a ete lance.
  const executable = resolveExecutablePath(parsed.program, environment, platform, {
    cwd: resolved.canonicalPath,
  });
  if (executable === null) {
    return {
      ok: false,
      code: RUNNER_ERROR.VALIDATION_SPAWN_FAILED,
      detail: `Le programme « ${parsed.program} » est introuvable sur cette machine.`,
    };
  }

  const plan = buildSpawnPlan(executable, parsed.args, environment, platform);
  if (plan === null) {
    return {
      ok: false,
      code: RUNNER_ERROR.VALIDATION_SPAWN_FAILED,
      detail:
        "La ligne de commande n'a pas pu etre construite sans risque pour cette plateforme.",
    };
  }

  return execute(plan, resolved.canonicalPath, environment, {
    timeoutMs: options.timeoutMs ?? VALIDATION_TIMEOUT_MS,
    platform,
    spawnProcess: options.spawnProcess,
    signal: options.signal,
  });
}

/** Lanceur par defaut : le seul endroit du module qui touche le systeme. */
const defaultSpawner: ProcessSpawner = (plan, cwd, env) =>
  spawn(plan.command, plan.args, {
    cwd,
    // Le dossier de travail est la racine canonique, jamais un chemin recu.
    // L'environnement est celui du runner **prive de toute variable `NOX_*`** :
    // le filtre porte sur le prefixe entier, donc une variable ajoutee plus tard
    // est couverte d'office.
    env,
    // Jamais de shell. Node ne fabrique aucune ligne de commande : celle de
    // l'enveloppe Windows a ete ecrite et verifiee par `command-line.ts`.
    shell: false,
    windowsHide: true,
    windowsVerbatimArguments: plan.windowsVerbatimArguments,
    stdio: ["ignore", "pipe", "pipe"],
  });

type ExecuteOptions = {
  timeoutMs: number;
  platform: NodeJS.Platform;
  spawnProcess?: ProcessSpawner;
  signal?: AbortSignal;
};

function execute(
  plan: SpawnPlan,
  cwd: string,
  environment: Record<string, string | undefined>,
  options: ExecuteOptions,
): Promise<RunValidationOutcome> {
  const { timeoutMs, platform } = options;

  return new Promise((resolve) => {
    const startedAt = Date.now();

    let child;
    try {
      child = (options.spawnProcess ?? defaultSpawner)(
        plan,
        cwd,
        sanitizeEnvironment(environment),
      );
    } catch (error) {
      resolve({
        ok: false,
        code: RUNNER_ERROR.VALIDATION_SPAWN_FAILED,
        detail: describeSpawnError(error),
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

    /**
     * Arret en deux temps de l'arbre du processus.
     *
     * L'arbre, et pas seulement le processus : sous Windows la commande est
     * lancee par une enveloppe, et signaler l'enveloppe laisserait le vrai
     * programme continuer de travailler dans le repository que l'utilisateur
     * est en train de relire.
     */
    const stop = (): void => {
      terminateProcessTree(child, false, platform);
      killTimer = setTimeout(() => {
        terminateProcessTree(child, true, platform);
      }, VALIDATION_KILL_GRACE_MS);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);

    // L'annulation ne produit pas un resultat : elle arrete le processus, et
    // c'est la fermeture qui conclut. Un lot annule n'invente aucun code de
    // sortie.
    //
    // Un signal deja declenche est traite comme un signal qui arrive : entre la
    // resolution du repository et cette ligne, il s'ecoule un appel a Git, et un
    // abandon survenu pendant ce temps ne doit pas etre perdu — le processus
    // tournerait alors jusqu'au delai maximal.
    if (options.signal?.aborted === true) {
      stop();
    } else {
      options.signal?.addEventListener("abort", stop, { once: true });
    }

    child.on("error", (error: Error) => {
      finish({
        ok: false,
        code: RUNNER_ERROR.VALIDATION_SPAWN_FAILED,
        detail: describeSpawnError(error),
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
