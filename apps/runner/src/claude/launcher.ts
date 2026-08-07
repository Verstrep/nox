/**
 * Lancement du processus Claude Code.
 *
 * ## Ce qui est passe, et comment
 *
 * - **Le prompt part par l'entree standard**, jamais en argument. Un prompt fait
 *   des milliers de caracteres : le mettre sur une ligne de commande le
 *   exposerait a toutes les limites de longueur du systeme et a tous les
 *   problemes d'echappement. `stdin` n'a ni l'une ni l'autre, et est ferme des
 *   qu'il est ecrit.
 * - **Les arguments sont une liste fixe**, construite ici a partir de la
 *   configuration du runner et des permissions calculees. Rien de ce que le
 *   navigateur envoie n'y entre.
 * - **`--dangerously-skip-permissions` n'est jamais passe.** C'est precisement
 *   le drapeau qui annulerait tout le travail de `claude-commands.ts`.
 * - **`cwd` vaut la racine canonique du repository**, et aucun dossier
 *   supplementaire n'est autorise.
 *
 * ## Arguments et version installee
 *
 * `--max-turns` est reconnu par l'analyseur d'arguments de Claude Code `2.1.223`
 * bien qu'il n'apparaisse plus dans `--help`.
 *
 * **`--verbose` est obligatoire avec `-p --output-format stream-json`.** Le
 * premier run reel l'a montre : le binaire refuse la combinaison avec
 * `When using --print, --output-format=stream-json requires --verbose`. Un probe
 * ecrit pendant TASK-010 avait conclu l'inverse, mais il alimentait `stdin` avec
 * une entree vide : le binaire s'arretait plus tot, sur `Input must be provided`,
 * sans jamais atteindre cette precondition. Un probe qui n'emprunte pas le vrai
 * chemin d'execution ne prouve rien — c'est le run reel qui fait autorite.
 *
 * `--verbose` n'est ajoute **que** pour `stream-json`. Le format `json` ne le
 * demande pas, et l'ajouter partout changerait la verbosite sans necessite.
 *
 * `--include-partial-messages` n'est deliberement pas passe. Il ferait emettre un
 * evenement par fragment de token : plusieurs milliers d'evenements pour un run
 * de deux minutes, dont aucun n'apporterait plus que le message complet qui les
 * suit. Un evenement par message ou par action suffit a suivre le travail.
 *
 * `buildClaudeArguments` reste isolee et pure : si une version ulterieure attend
 * autre chose, c'est la seule fonction a corriger, et elle est directement
 * testable.
 */

import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import process from "node:process";

import { RUN_LIMITS, boundTail, boundText } from "@nox/shared";

import type { ClaudeConfig } from "../config.ts";
import {
  buildSpawnPlan,
  resolveExecutablePath,
  sanitizeEnvironment,
} from "./executable.ts";

export type LaunchOutcome = {
  /** Code de sortie, ou `null` si le processus a ete termine par un signal. */
  exitCode: number | null;
  stdout: string;
  stderrTail: string;
  /** Vrai si le delai maximal a ete atteint et le processus arrete. */
  timedOut: boolean;
  /** Renseigne lorsque le processus n'a pas pu etre lance du tout. */
  spawnError: string | null;
};

export type LaunchRequest = {
  repositoryRoot: string;
  prompt: string;
  allowedTools: readonly string[];
  disallowedTools: readonly string[];
  claude: ClaudeConfig;
  /**
   * Recoit chaque morceau de `stdout` des son arrivee.
   *
   * Lorsqu'il est fourni, la sortie n'est **plus accumulee** : en `stream-json`,
   * elle peut depasser plusieurs megaoctets, et la borner en memoire inserait une
   * marque de troncature au milieu du flux — donc au milieu d'une ligne JSON,
   * potentiellement celle du resultat final. Le consommateur garde ce dont il a
   * besoin ; le lanceur ne garde rien.
   */
  onChunk?: (chunk: string) => void;
};

export type LaunchHandle = {
  /** Resolue a la fin du processus, quelle qu'en soit la cause. */
  completed: Promise<LaunchOutcome>;
  /** Arrete le processus : demande polie, puis arret force. */
  kill: () => void;
};

/** Delai laisse au processus pour s'arreter proprement avant l'arret force. */
export const GRACEFUL_SHUTDOWN_MS = 5_000;

/**
 * Construit la liste d'arguments de Claude Code.
 *
 * Isolee et pure : c'est elle que les tests inspectent pour verifier qu'aucun
 * drapeau dangereux n'apparait et que les permissions sont bien celles
 * calculees.
 */
export function buildClaudeArguments(request: {
  allowedTools: readonly string[];
  disallowedTools: readonly string[];
  maxTurns: number;
}): string[] {
  // `stream-json` remplace `json` depuis TASK-010 : la meme information finale
  // arrive, precedee de tout ce qui permet de suivre le travail en cours. Le
  // dernier message du flux est le meme objet `result` qu'auparavant.
  //
  // `--verbose` est une precondition du binaire, pas un choix : avec `-p`, le
  // format `stream-json` est refuse sans lui. Il accompagne donc le format, et
  // seulement lui.
  const args = ["-p", "--output-format", "stream-json", "--verbose"];
  args.push("--max-turns", String(request.maxTurns));

  // Les regles sont jointes par des virgules ; `claude-commands.ts` garantit
  // qu'aucune commande autorisee n'en contient.
  if (request.allowedTools.length > 0) {
    args.push("--allowedTools", request.allowedTools.join(","));
  }
  if (request.disallowedTools.length > 0) {
    args.push("--disallowedTools", request.disallowedTools.join(","));
  }

  return args;
}

/** Signature d'un lanceur, remplacable dans les tests. */
export type ClaudeLauncher = (request: LaunchRequest) => LaunchHandle;

function failedHandle(message: string): LaunchHandle {
  return {
    completed: Promise.resolve({
      exitCode: null,
      stdout: "",
      stderrTail: "",
      timedOut: false,
      spawnError: message,
    }),
    kill: () => undefined,
  };
}

/**
 * Lance Claude Code et retourne immediatement.
 *
 * Le processus n'est pas lie a la duree d'une requete HTTP : c'est ce qui permet
 * a l'utilisateur de fermer son navigateur sans interrompre l'execution.
 */
export const launchClaude: ClaudeLauncher = (request) => {
  const resolvedPath = resolveExecutablePath(request.claude.executable);
  if (resolvedPath === null) {
    return failedHandle("Executable Claude Code introuvable.");
  }

  const args = buildClaudeArguments({
    allowedTools: request.allowedTools,
    disallowedTools: request.disallowedTools,
    maxTurns: request.claude.maxTurns,
  });
  const plan = buildSpawnPlan(resolvedPath, args);

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(plan.command, plan.args, {
      cwd: request.repositoryRoot,
      // L'environnement est nettoye de toutes les variables NOX : Claude Code
      // n'a pas a connaitre le jeton du runner ni l'URL de la base.
      env: sanitizeEnvironment(),
      windowsHide: true,
      // `"pipe"` plutot que le triplet : la forme courte designe exactement le
      // meme montage et se type sans ambiguite dans les deux configurations
      // TypeScript qui compilent ce fichier.
      stdio: "pipe",
    });
  } catch (error) {
    return failedHandle(error instanceof Error ? error.message : "Lancement impossible.");
  }

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let settled = false;
  let forceTimer: NodeJS.Timeout | null = null;

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  // Les sorties sont bornees a la volee : un processus bavard ne doit pas
  // pouvoir remplir la memoire du runner. En mode streaming, rien n'est
  // accumule du tout — le consommateur decide de ce qu'il garde.
  const onChunk = request.onChunk;
  child.stdout.on("data", (chunk: string) => {
    if (onChunk === undefined) {
      stdout = boundText(stdout + chunk, RUN_LIMITS.stdout);
      return;
    }
    try {
      onChunk(chunk);
    } catch {
      // Une erreur du consommateur ne doit pas interrompre la lecture : cesser
      // de consommer `stdout` remplirait le tampon du systeme et figerait
      // Claude Code au milieu de son travail.
    }
  });
  child.stderr.on("data", (chunk: string) => {
    stderr = boundTail(stderr + chunk, RUN_LIMITS.stderrTail);
  });

  const stopForceTimer = (): void => {
    if (forceTimer !== null) {
      clearTimeout(forceTimer);
      forceTimer = null;
    }
  };

  /**
   * Termine le processus **et ses descendants**.
   *
   * Sous Windows, `claude` est generalement un `claude.cmd` lance par `cmd.exe`,
   * qui lance a son tour le vrai programme. Envoyer un signal au `cmd.exe`
   * termine l'enveloppe et laisse le programme tourner : le delai maximal
   * n'aurait alors aucun effet. `taskkill /T` descend l'arbre — et il ne vise
   * jamais qu'un PID que **nous** avons cree, jamais un identifiant venu de
   * l'exterieur.
   */
  const terminate = (force: boolean): void => {
    if (process.platform === "win32") {
      const pid = child.pid;
      if (pid === undefined) {
        return;
      }
      const args = ["/pid", String(pid), "/T", ...(force ? ["/F"] : [])];
      // L'echec est sans consequence : soit le processus est deja mort, soit
      // l'arret force qui suit s'en chargera.
      execFile("taskkill", args, { windowsHide: true }, () => undefined);
      return;
    }

    child.kill(force ? "SIGKILL" : "SIGTERM");
  };

  /** Arret en deux temps : une demande polie, puis un arret force. */
  const kill = (): void => {
    if (settled || child.killed) {
      return;
    }
    terminate(false);
    stopForceTimer();
    forceTimer = setTimeout(() => {
      if (!settled) {
        terminate(true);
      }
    }, GRACEFUL_SHUTDOWN_MS);
    forceTimer.unref();
  };

  const timeoutMs = request.claude.timeoutMinutes * 60 * 1000;
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    kill();
  }, timeoutMs);
  timeoutTimer.unref();

  const completed = new Promise<LaunchOutcome>((resolve) => {
    const settle = (exitCode: number | null, spawnError: string | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutTimer);
      stopForceTimer();
      resolve({ exitCode, stdout, stderrTail: stderr, timedOut, spawnError });
    };

    child.on("error", (error: Error) => {
      settle(null, error.message);
    });

    child.on("close", (code: number | null) => {
      settle(code, null);
    });
  });

  // Le prompt part par l'entree standard, puis celle-ci est fermee : sans
  // fermeture, le mode non interactif attendrait indefiniment.
  child.stdin.on("error", () => undefined);
  child.stdin.end(boundText(request.prompt, RUN_LIMITS.prompt), "utf8");

  return { completed, kill };
};
