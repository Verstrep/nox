/**
 * Arret d'un processus **et de ses descendants**.
 *
 * ## Pourquoi cela ne peut pas etre un simple `child.kill()`
 *
 * Sous Windows, tout ce que NOX lance passe souvent par `cmd.exe` : `claude` est
 * un `claude.cmd`, `npm` un `npm.cmd`. `cmd.exe` lance a son tour le vrai
 * programme. Envoyer un signal a l'enveloppe termine l'enveloppe et laisse le
 * programme tourner — un delai maximal n'aurait alors aucun effet, et une
 * validation abandonnee continuerait d'ecrire dans le repository que
 * l'utilisateur est en train de relire.
 *
 * `taskkill /T` descend l'arbre. Il ne vise jamais qu'un PID que **nous** avons
 * cree : aucun identifiant venu du navigateur, du web ou d'un corps de requete
 * n'atteint cette fonction.
 *
 * ## Pourquoi une seule implementation
 *
 * Deux copies — une pour Claude Code, une pour les validations — auraient fini
 * par diverger, et celle qui aurait tort serait celle qui laisse un processus
 * en vie. C'est exactement le genre de divergence qu'on ne remarque qu'en
 * relisant un repository que personne n'etait cense modifier.
 */

import { execFile } from "node:child_process";
import process from "node:process";

/** Ce dont cette fonction a besoin d'un processus enfant, et rien de plus. */
export type TerminableProcess = {
  readonly pid?: number | undefined;
  kill: (signal?: NodeJS.Signals) => boolean;
};

/**
 * Termine un processus et ses descendants.
 *
 * `force` distingue la demande polie de l'arret sans appel. L'echec est sans
 * consequence et volontairement ignore : soit le processus est deja mort, soit
 * l'arret force qui suivra s'en chargera. Lever ici transformerait un
 * nettoyage en panne.
 */
export function terminateProcessTree(
  child: TerminableProcess,
  force: boolean,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === "win32") {
    const pid = child.pid;
    if (pid === undefined) {
      return;
    }
    const args = ["/pid", String(pid), "/T", ...(force ? ["/F"] : [])];
    execFile("taskkill", args, { windowsHide: true }, () => undefined);
    return;
  }

  child.kill(force ? "SIGKILL" : "SIGTERM");
}
