/**
 * Registre des appels Architecte en vol, pour pouvoir les interrompre.
 *
 * ## Le probleme que ce module resout
 *
 * Marquer une generation `CANCELLED` en base ne coute rien au fournisseur : la
 * requete continue, le raisonnement continue, la facture continue. Un bouton
 * qui ne ferait que cela mentirait sur ce qu'il fait — et NOX prefere ne rien
 * promettre plutot que promettre a moitie.
 *
 * L'interruption reelle demande de retrouver, depuis une **autre** requete HTTP,
 * l'`AbortController` cree par celle qui attend. D'ou ce registre.
 *
 * ## Pourquoi `globalThis`
 *
 * Exactement la raison du cache de client Prisma : Next.js recharge ses modules
 * serveur en developpement, et ne garantit pas qu'un Route Handler et une Server
 * Action partagent la meme instance d'un module. Une `Map` de module vivrait
 * alors en double, et l'arret ne trouverait jamais le controleur qu'il cherche.
 * Un `Symbol.for` est partage par tout le processus, quel que soit le nombre de
 * copies du module.
 *
 * ## Ce que ce registre ne peut pas faire
 *
 * **Il ne survit pas au processus.** Un redemarrage du serveur web perd les
 * controleurs ; les requetes qu'ils tenaient meurent avec le processus, donc
 * rien ne fuit — mais une generation restee `RUNNING` en base ne serait plus
 * interruptible par ce chemin. C'est pourquoi l'arret conclut d'abord la ligne
 * en base et abandonne le controleur ensuite : la partie qui compte pour l'etat
 * du projet ne depend pas de la memoire.
 *
 * Il n'est pas non plus une garantie que le fournisseur a cesse de travailler.
 * NOX ferme sa connexion ; ce que le fournisseur fait ensuite de son cote ne
 * lui est pas observable, et aucun ecran ne pretend le contraire.
 */

/**
 * Cle de registre sur `globalThis`.
 *
 * `Symbol.for` plutot qu'un symbole local : deux copies du module doivent
 * retrouver la meme table, sans quoi l'arret echouerait silencieusement.
 */
const REGISTRY_KEY = Symbol.for("nox.architect.cancellation");

type Registry = Map<string, AbortController>;

type RegistryHost = { [REGISTRY_KEY]?: Registry };

function registry(): Registry {
  const host = globalThis as RegistryHost;
  const existing = host[REGISTRY_KEY];
  if (existing !== undefined) {
    return existing;
  }
  const created: Registry = new Map();
  host[REGISTRY_KEY] = created;
  return created;
}

/** Ce qu'un appelant recoit en s'inscrivant. */
export type ArchitectAbortHandle = {
  /** A joindre a la requete du fournisseur. */
  signal: AbortSignal;
  /**
   * A appeler **dans un `finally`**, quelle que soit l'issue.
   *
   * Reussite, panne, delai depasse, arret : le controleur est retire dans les
   * quatre cas. Une entree oubliee serait pire qu'inutile — la generation
   * suivante porterait un identifiant different, mais la table grossirait sans
   * fin, et un arret tardif viserait un controleur qui ne sert plus.
   */
  release: () => void;
};

/**
 * Inscrit un appel en vol sous une cle, et rend de quoi l'interrompre.
 *
 * La cle est l'identifiant de la generation reservee en base : elle est unique,
 * elle n'est attribuee qu'une fois, et elle est deja ce que l'arret sait
 * retrouver. Une generation suivante recoit donc necessairement une entree
 * distincte — il n'existe aucun chemin ou deux appels partageraient un
 * controleur.
 *
 * Une cle deja presente est **remplacee**, et l'ancienne entree abandonnee : le
 * cas n'est pas atteignable — la reservation en base l'exclut — mais laisser
 * deux controleurs sous une meme cle rendrait l'arret non deterministe.
 */
export function registerArchitectAbort(key: string): ArchitectAbortHandle {
  const controller = new AbortController();
  const table = registry();
  table.set(key, controller);

  let released = false;
  return {
    signal: controller.signal,
    release: () => {
      if (released) {
        return;
      }
      released = true;
      // Uniquement si l'entree est **toujours la notre** : un arret concurrent
      // a pu la retirer, et une inscription ulterieure ne doit pas etre
      // effacee par la liberation d'un appel deja termine.
      if (table.get(key) === controller) {
        table.delete(key);
      }
    },
  };
}

/**
 * Interrompt l'appel inscrit sous cette cle, s'il en existe un.
 *
 * Rend `true` quand un controleur a effectivement ete abandonne — c'est-a-dire
 * quand NOX peut affirmer avoir ferme la connexion. `false` signifie « aucun
 * appel en vol dans ce processus » : deja termine, ou perdu par un
 * redemarrage. Les deux se distinguent, et l'ecran ne doit pas les confondre.
 *
 * Idempotent : le second appel rend `false` et ne leve pas.
 */
export function abortArchitectCall(key: string): boolean {
  const table = registry();
  const controller = table.get(key);
  if (controller === undefined) {
    return false;
  }
  table.delete(key);
  controller.abort(new ArchitectCancelledError());
  return true;
}

/**
 * Nombre d'appels inscrits.
 *
 * Existe pour les tests : c'est la seule facon de prouver qu'aucun controleur
 * ne reste derriere une reussite, une panne, un delai depasse ou un arret.
 */
export function activeArchitectCallCount(): number {
  return registry().size;
}

/**
 * Motif d'abandon, transmis a `AbortController.abort`.
 *
 * Ne porte aucun contenu : ni identifiant, ni chemin, ni message du
 * fournisseur. Le SDK enveloppe cette valeur dans sa propre erreur d'abandon,
 * et c'est cette enveloppe que NOX classe.
 */
export class ArchitectCancelledError extends Error {
  constructor() {
    super("Generation arretee par l'utilisateur.");
    this.name = "ArchitectCancelledError";
  }
}
