/**
 * Annulation controlee d'une execution.
 *
 * ## Aucune seconde implementation de l'arret
 *
 * L'arret de l'arbre de processus a ete ecrit une fois, pour le delai maximal,
 * dans `launcher.ts` : demande polie, delai de grace, puis arret force, et sous
 * Windows un `taskkill /T` qui ne vise **que** le PID cree par NOX. Ce module ne
 * le reecrit pas — il appelle exactement la meme fonction, via le registre.
 * Deux implementations d'un arret de processus divergeraient, et c'est celle qui
 * n'est pas testee qui tournerait le jour ou ca compte.
 *
 * Aucun identifiant de processus ne circule ici. La seule chose qu'un appelant
 * peut designer est un `runId` connu du registre ; le PID reste dans la fermeture
 * de la fonction d'arret, hors d'atteinte.
 *
 * ## NOX ne repare rien, meme apres une annulation
 *
 * Claude Code a pu ecrire la moitie d'un fichier avant de mourir. NOX capture
 * l'etat Git — c'est `finishRun` qui s'en charge, comme pour n'importe quelle
 * fin — et s'arrete la. Pas de `reset`, pas de `restore`, pas de `checkout` :
 * restaurer detruirait justement le travail partiel que l'utilisateur doit
 * relire pour decider quoi en faire.
 *
 * ## Quand l'arret echoue
 *
 * Un processus peut ignorer les deux signaux. NOX ne fait alors pas semblant :
 * passe un delai, l'execution est marquee `BLOCKED` avec `CLAUDE_CANCEL_FAILED`,
 * et le message dit que le processus peut encore vivre. Annoncer `CANCELLED`
 * pour un processus toujours en train d'ecrire serait la pire des reponses.
 */

import {
  CLAUDE_RUN_EVENT_KIND,
  RUNNER_ERROR,
  RUN_STATUS,
  type RunnerErrorCode,
} from "@nox/shared";

import { readGitChanges, type GitStateOptions } from "../repositories/git-state.ts";
import { GRACEFUL_SHUTDOWN_MS } from "./launcher.ts";
import type { ClaudeRunRegistry } from "./registry.ts";

/**
 * Delai au-dela duquel un processus qui n'a pas ferme est declare hors de
 * controle.
 *
 * Genereusement au-dela du delai de grace du lanceur : entre la demande polie et
 * l'arret force, il y a deja `GRACEFUL_SHUTDOWN_MS`, puis le systeme doit
 * effectivement terminer l'arbre. Conclure trop tot produirait des faux echecs
 * sur une machine chargee.
 */
export const CANCELLATION_DEADLINE_MS = GRACEFUL_SHUTDOWN_MS * 3;

export type CancelRunResult =
  | { ok: true; requestedAt: Date }
  | { ok: false; code: RunnerErrorCode };

export type CancelRunOptions = GitStateOptions & {
  /** Delai avant de declarer l'arret hors de controle. */
  deadlineMs?: number;
  /** Ordonnanceur injectable : les tests n'attendent pas quinze secondes. */
  setTimeoutFn?: (callback: () => void, ms: number) => { unref?: () => void };
};

/**
 * Demande l'arret d'une execution active.
 *
 * Retourne des que la demande est enregistree et l'arret engage — sans attendre
 * la mort du processus. C'est ce qui permet a la route de repondre `202` tout de
 * suite : l'utilisateur voit `Cancelling` immediatement, plutot qu'une page
 * figee pendant le delai de grace.
 */
export function cancelClaudeRun(
  runId: string,
  registry: ClaudeRunRegistry,
  options: CancelRunOptions = {},
): CancelRunResult {
  const requested = registry.requestCancellation(runId);

  if (!requested.ok) {
    switch (requested.reason) {
      case "not_found":
        return { ok: false, code: RUNNER_ERROR.CLAUDE_RUN_NOT_FOUND };
      case "already_final":
        return { ok: false, code: RUNNER_ERROR.CLAUDE_RUN_ALREADY_FINISHED };
      case "already_cancelling":
        // Un second clic ne relance pas l'arret : il est deja engage, et le
        // relancer ne ferait qu'envoyer un signal de plus a un processus qui
        // est peut-etre en train de fermer proprement.
        return { ok: false, code: RUNNER_ERROR.CLAUDE_RUN_CANCELLING };
    }
  }

  // La meme fonction que celle du delai maximal, ni plus ni moins.
  registry.kill(runId);

  armDeadline(runId, registry, options);

  return { ok: true, requestedAt: requested.requestedAt };
}

/**
 * Arme la surveillance de l'arret.
 *
 * Si le processus n'a toujours pas ferme passe le delai, `finishRun` n'a jamais
 * repris la main : c'est ce cas-la, et lui seul, que cette fonction conclut.
 * Elle capture l'etat Git comme n'importe quelle autre fin — un processus encore
 * vivant a deja pu modifier le repository, et l'ignorer serait pire.
 */
function armDeadline(
  runId: string,
  registry: ClaudeRunRegistry,
  options: CancelRunOptions,
): void {
  const schedule = options.setTimeoutFn ?? setTimeout;
  const timer = schedule(() => {
    void concludeFailedCancellation(runId, registry, options);
  }, options.deadlineMs ?? CANCELLATION_DEADLINE_MS);

  // Ce minuteur ne doit pas maintenir le runner en vie a lui seul.
  timer.unref?.();
}

async function concludeFailedCancellation(
  runId: string,
  registry: ClaudeRunRegistry,
  options: GitStateOptions,
): Promise<void> {
  const snapshot = registry.snapshot(runId);
  if (snapshot === null || snapshot.status !== RUN_STATUS.CANCELLING) {
    // Le processus a fini par fermer, et `finishRun` a deja conclu. C'est le cas
    // nominal : le minuteur n'avait qu'a ne rien faire.
    return;
  }

  const context = registry.context(runId);
  let git = {};
  if (context !== null) {
    try {
      const changes = await readGitChanges(context.repositoryRoot, options);
      git = {
        git: {
          branch: changes.branch,
          upstream: snapshot.git.upstream,
          headBefore: context.headBefore,
          headAfter: changes.head,
          diffStat: changes.diffStat,
          changedFiles: changes.changedFiles,
        },
      };
    } catch {
      // Un repository devenu illisible ne doit pas empecher de conclure : sans
      // conclusion, l'execution resterait active pour toujours.
    }
  }

  registry.finish(runId, RUN_STATUS.BLOCKED, {
    ...git,
    errorCode: RUNNER_ERROR.CLAUDE_CANCEL_FAILED,
  });

  registry.appendEvents(runId, [
    {
      kind: CLAUDE_RUN_EVENT_KIND.ERROR,
      label: "Cancellation failed",
      detail:
        "NOX a demande l'arret mais n'a pas pu constater la fin du processus. " +
        "Celui-ci peut encore modifier le repository : verifiez-le vous-meme.",
      toolName: null,
      isError: true,
    },
  ]);
}
