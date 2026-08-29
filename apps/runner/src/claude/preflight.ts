/**
 * Preflight : verifier qu'un lancement est possible, sans rien modifier.
 *
 * Ce module existe pour une raison simple : **apres une execution, il faut
 * pouvoir dire ce que Claude Code a change**. Ce n'est possible que si l'on
 * connait exactement l'etat de depart. Un repository sale melange le travail de
 * l'agent a celui qui trainait deja ; une branche detachee ou desynchronisee
 * rend le `git diff` de fin ininterpretable.
 *
 * Tous les refus sont donc des refus **avant** lancement, jamais des
 * corrections apres coup : NOX ne nettoie pas le repository de l'utilisateur.
 *
 * ## Deux questions distinctes
 *
 * Ce module repond a une seule question : **ce repository peut-il recevoir une
 * autre tache ?** Il ne dit pas si la livraison Git d'un travail precedent est
 * satisfaite — c'est `deliverySatisfied` qui en decide, cote web, et la file
 * pose les deux questions separement.
 *
 * Les confondre a un cout precis : sous `AUTO_COMMIT`, NOX cree un commit local
 * et ne le pousse pas. La branche est alors **en avance** sur son upstream, et
 * c'est l'etat normal de cette politique. Le lui reprocher arreterait la file
 * apres la premiere tache, alors que le repository est parfaitement relisible.
 */

import {
  DELIVERY_POLICY,
  RUNNER_ERROR,
  policyAllowsLocalAhead,
  type ClaudePreflightGit,
  type DeliveryPolicy,
  type RunnerErrorCode,
} from "@nox/shared";

import type { ClaudeConfig } from "../config.ts";
import { resolveRepositoryRoot } from "../repositories/documents/repository-root.ts";
import { readGitState, type GitStateOptions } from "../repositories/git-state.ts";
import {
  CLAUDE_VERSION_TIMEOUT_MS,
  probeClaudeVersion,
  type ClaudeVersionProbe,
} from "./executable.ts";

export type PreflightResult =
  | { ok: true; claudeVersion: string; git: ClaudePreflightGit }
  | { ok: false; code: RunnerErrorCode };

export type PreflightOptions = GitStateOptions & {
  probeVersion?: ClaudeVersionProbe;
  versionTimeoutMs?: number;
  /**
   * Politique de livraison Git du projet, telle que le serveur web l'a relue en
   * base. Absente, elle vaut `MANUAL` : le defaut sur n'assouplit rien.
   */
  deliveryPolicy?: DeliveryPolicy;
};

/**
 * Verifie qu'un repository est pret a recevoir une execution.
 *
 * L'ordre des controles n'est pas indifferent : Git d'abord, Claude Code
 * ensuite. Un repository sale se corrige en quelques secondes, alors qu'une
 * installation manquante demande une intervention — autant signaler d'abord ce
 * que l'utilisateur peut regler tout de suite.
 */
export async function runPreflight(
  repositoryPath: string,
  claude: ClaudeConfig,
  options: PreflightOptions = {},
): Promise<PreflightResult> {
  const repository = resolveRepositoryRoot(repositoryPath);
  if (!repository.ok) {
    return repository;
  }

  const state = await readGitState(repository.root, options);
  if (!state.ok) {
    return state;
  }

  if (!state.state.clean) {
    return { ok: false, code: RUNNER_ERROR.REPOSITORY_DIRTY };
  }

  // Une branche **en retard** rend la relecture ambigue quelle que soit la
  // politique : des commits que la machine connait sans les avoir integres
  // arriveront tot ou tard dans le dossier de travail, et personne ne saura plus
  // dire ce que l'agent y a mis. Aucune politique ne produit cet etat : il vient
  // toujours de l'exterieur.
  if (state.state.behind !== 0) {
    return { ok: false, code: RUNNER_ERROR.GIT_NOT_SYNCHRONIZED };
  }

  // Une branche **en avance**, en revanche, depend de ce que le projet autorise
  // NOX a ecrire. Sous `AUTO_COMMIT`, elle est produite par NOX lui-meme, a
  // chaque tache validee : la refuser rendrait la politique inutilisable des la
  // deuxieme tache. Sous `MANUAL` et `AUTO_COMMIT_PUSH`, elle reste le refus
  // historique — la premiere n'ecrit rien, la seconde n'est satisfaite qu'une
  // fois le commit pousse.
  //
  // C'est la seule chose que la politique assouplit ici. Tout le reste — dossier
  // de travail propre, `HEAD` detache, upstream absent — ne bouge pas d'un iota,
  // et `expectedGitHead` continue de figer l'etat de depart.
  const policy = options.deliveryPolicy ?? DELIVERY_POLICY.MANUAL;
  if (state.state.ahead !== 0 && !policyAllowsLocalAhead(policy)) {
    return { ok: false, code: RUNNER_ERROR.GIT_NOT_SYNCHRONIZED };
  }

  const probe = options.probeVersion ?? probeClaudeVersion;
  const version = await probe(
    claude.executable,
    options.versionTimeoutMs ?? CLAUDE_VERSION_TIMEOUT_MS,
  );

  if (!version.available) {
    return { ok: false, code: RUNNER_ERROR.CLAUDE_NOT_AVAILABLE };
  }

  return { ok: true, claudeVersion: version.version, git: state.state };
}
