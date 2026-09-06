/**
 * Ce que NOX affiche d'une execution qui ne s'est pas terminee normalement.
 *
 * ## Pourquoi ce module existe
 *
 * Le second pilote reel a produit un ecran qui disait, en tout et pour tout,
 * `CLAUDE_PROCESS_FAILED` et `exit 1`. Onze minutes de travail, vingt-quatre
 * fichiers modifies, et une seule action proposee : `Retry` — qui exige un
 * repository propre, donc qui commencait par demander de se debarrasser du
 * travail.
 *
 * ## Trois questions, trois reponses
 *
 * Un utilisateur devant une execution en echec se demande trois choses, et
 * l'ecran doit y repondre sans qu'il ait a deduire :
 *
 * ```text
 * qu'est-ce qui a cede ?        →  categorie, constat, code de sortie
 * qu'est-ce qui reste ?         →  travail partiel, ou rien
 * qu'est-ce que je peux faire ? →  Retry, Correct, Mark blocked
 * ```
 *
 * ## Ce module ne decide rien
 *
 * Il traduit. La disponibilite d'une reprise est decidee par
 * `checkProcessFailureCorrection` et `checkResumeCandidate`, et **re-verifiee**
 * par le runner sur l'etat reel du disque. Ce qui est ecrit ici n'autorise rien.
 */

import {
  RUN_FAILURE_CATEGORY,
  RUN_STATUS,
  type RunFailureCategory,
  type RunStatus,
} from "@nox/shared";

/** Ce que la categorie annonce, en quelques mots. */
export function runFailureCategoryLabel(category: RunFailureCategory): string {
  switch (category) {
    case RUN_FAILURE_CATEGORY.SPAWN_FAILED:
      return "Le processus n'a pas demarre";
    case RUN_FAILURE_CATEGORY.PROCESS_EXIT_NONZERO:
      return "Le processus s'est termine sur un code non nul";
    case RUN_FAILURE_CATEGORY.AGENT_REPORTED_ERROR:
      return "Claude Code s'est declare en erreur";
    case RUN_FAILURE_CATEGORY.TIMEOUT:
      return "Le plafond de duree a ete atteint";
    case RUN_FAILURE_CATEGORY.CANCELLED:
      return "L'arret a ete demande";
    case RUN_FAILURE_CATEGORY.STREAM_UNREADABLE:
      return "Le flux de sortie n'etait pas lisible";
    case RUN_FAILURE_CATEGORY.USAGE_LIMIT:
      return "Une limite d'utilisation Claude a ete atteinte";
    case RUN_FAILURE_CATEGORY.GIT_POLICY_VIOLATION:
      return "L'etat Git a ete modifie sans autorisation";
    case RUN_FAILURE_CATEGORY.TRANSPORT_FAILED:
      return "NOX a perdu le contact avec le runner";
    case RUN_FAILURE_CATEGORY.UNKNOWN:
      return "Cause non determinee";
  }
}

/**
 * Ce que la categorie implique, et ce qui s'applique.
 *
 * Chaque phrase dit une chose que l'utilisateur ne peut pas deviner du libelle.
 * `UNKNOWN` dit qu'on ne sait pas, et le dit franchement : c'est une reponse,
 * et elle vaut mieux qu'une hypothese habillee en constat.
 */
export function runFailureCategoryMeaning(category: RunFailureCategory): string {
  switch (category) {
    case RUN_FAILURE_CATEGORY.SPAWN_FAILED:
      return (
        "Rien n'a tourne, donc rien n'a ete produit. Ce n'est pas un travail rate, " +
        "c'est une installation ou une configuration a reparer."
      );
    case RUN_FAILURE_CATEGORY.PROCESS_EXIT_NONZERO:
      return (
        "Claude Code a travaille, puis le processus s'est arrete sur une erreur. " +
        "Ce qu'il avait deja ecrit est reste dans le dossier de travail : NOX n'a rien restaure."
      );
    case RUN_FAILURE_CATEGORY.AGENT_REPORTED_ERROR:
      return (
        "Le processus s'est termine normalement, mais Claude Code a lui-meme declare " +
        "un echec dans son compte rendu. Lisez ce compte rendu avant de decider."
      );
    case RUN_FAILURE_CATEGORY.TIMEOUT:
      return (
        "NOX a arrete le processus. Le travail deja ecrit est intact, et il est souvent " +
        "plus proche de la fin qu'on ne le croit."
      );
    case RUN_FAILURE_CATEGORY.CANCELLED:
      return "Quelqu'un a decide de ne pas attendre. Rien n'a lache, rien n'a ete viole.";
    case RUN_FAILURE_CATEGORY.STREAM_UNREADABLE:
      return (
        "Le processus a parle, mais NOX n'a pas retrouve sa ligne de resultat. " +
        "Son compte rendu manque ; l'etat du dossier de travail, lui, est bien reel."
      );
    case RUN_FAILURE_CATEGORY.USAGE_LIMIT:
      return "Le geste qui s'applique est d'attendre, pas de corriger.";
    case RUN_FAILURE_CATEGORY.GIT_POLICY_VIOLATION:
      return (
        "Un commit ou un changement de branche a eu lieu alors que c'etait interdit. " +
        "Le point de depart n'est plus identifiable : relisez le repository avant toute suite."
      );
    case RUN_FAILURE_CATEGORY.TRANSPORT_FAILED:
      return (
        "Le processus a pu continuer, reussir, ou mourir : NOX ne le sait pas. " +
        "Verifiez l'etat du repository vous-meme avant de relancer quoi que ce soit."
      );
    case RUN_FAILURE_CATEGORY.UNKNOWN:
      return (
        "Aucun fait enregistre ne permet de trancher. NOX prefere le dire plutot que " +
        "de proposer une explication qu'il n'a pas."
      );
  }
}

/**
 * Le geste qu'une categorie appelle en premier.
 *
 * Une **recommandation**, jamais une autorisation : `Retry` reste offert meme
 * quand la reprise l'est aussi, et l'inverse. Le seul cas ou NOX ecarte
 * franchement une option est celui ou elle ne trouverait rien a faire.
 */
export const FAILURE_RECOVERY = {
  /** Repartir d'un repository propre. */
  RETRY: "RETRY",
  /** Continuer le travail partiel, dans la meme session. */
  CORRECT: "CORRECT",
  /** Ce n'est pas un probleme de processus : c'est un blocage produit. */
  MARK_BLOCKED: "MARK_BLOCKED",
  /** Rien a faire tout de suite. */
  WAIT: "WAIT",
} as const;

export type FailureRecovery = (typeof FAILURE_RECOVERY)[keyof typeof FAILURE_RECOVERY];

export function recommendedRecovery(category: RunFailureCategory): FailureRecovery {
  switch (category) {
    case RUN_FAILURE_CATEGORY.USAGE_LIMIT:
      return FAILURE_RECOVERY.WAIT;
    case RUN_FAILURE_CATEGORY.SPAWN_FAILED:
      return FAILURE_RECOVERY.RETRY;
    case RUN_FAILURE_CATEGORY.GIT_POLICY_VIOLATION:
    case RUN_FAILURE_CATEGORY.TRANSPORT_FAILED:
      // NOX ne sait pas ce que le repository contient : proposer de continuer
      // dessus reviendrait a batir sur un etat qu'il n'a pas su lire.
      return FAILURE_RECOVERY.MARK_BLOCKED;
    case RUN_FAILURE_CATEGORY.PROCESS_EXIT_NONZERO:
    case RUN_FAILURE_CATEGORY.AGENT_REPORTED_ERROR:
    case RUN_FAILURE_CATEGORY.TIMEOUT:
    case RUN_FAILURE_CATEGORY.STREAM_UNREADABLE:
    case RUN_FAILURE_CATEGORY.CANCELLED:
    case RUN_FAILURE_CATEGORY.UNKNOWN:
      return FAILURE_RECOVERY.CORRECT;
  }
}

/**
 * Une option de reprise, telle que l'ecran la propose.
 *
 * `available` a `false` n'efface pas l'option : elle reste affichee, avec la
 * raison. Cacher une action qu'on attend transforme un refus explicable en
 * absence inexplicable — c'est exactement ce que le pilote reel a vecu.
 */
export type RecoveryOption = {
  kind: FailureRecovery;
  label: string;
  description: string;
  href: string | null;
  available: boolean;
  /** Pourquoi elle n'est pas disponible. `null` quand elle l'est. */
  unavailableReason: string | null;
  recommended: boolean;
};

/**
 * Les options offertes devant une execution qui a echoue.
 *
 * L'ordre est celui de la recommandation : ce que NOX conseille vient en
 * premier. Les trois sont toujours presentes — un utilisateur doit pouvoir
 * choisir autre chose que ce qui lui est conseille sans chercher ou.
 */
export function failureRecoveryOptions(input: {
  category: RunFailureCategory;
  /** Le dossier de travail porte-t-il des changements ? */
  hasPartialWork: boolean;
  /** URL de la reprise, ou `null` quand elle n'est pas proposable. */
  correctHref: string | null;
  /** Pourquoi la reprise n'est pas proposable. */
  correctBlockedReason: string | null;
  retryHref: string | null;
  markBlockedHref: string | null;
}): RecoveryOption[] {
  const recommended = recommendedRecovery(input.category);

  const correct: RecoveryOption = {
    kind: FAILURE_RECOVERY.CORRECT,
    label: "Correct failed run",
    description:
      "Reprend la session Claude sur le travail deja produit. Le dossier de travail n'est " +
      "ni nettoye, ni commite, ni restaure — et NOX verifie qu'il est encore exactement celui " +
      "que l'execution a laisse.",
    href: input.correctHref,
    available: input.correctHref !== null,
    unavailableReason: input.correctHref === null ? input.correctBlockedReason : null,
    recommended: recommended === FAILURE_RECOVERY.CORRECT,
  };

  const retry: RecoveryOption = {
    kind: FAILURE_RECOVERY.RETRY,
    label: "Retry",
    description: input.hasPartialWork
      ? "Repart de zero, depuis un repository propre. Le travail partiel ci-dessus devra " +
        "etre commite, mis de cote ou abandonne par vos soins — NOX ne touche jamais a Git."
      : "Remet la tache en file pour une nouvelle execution, depuis un repository propre.",
    href: input.retryHref,
    available: input.retryHref !== null,
    unavailableReason: null,
    recommended: recommended === FAILURE_RECOVERY.RETRY,
  };

  const blocked: RecoveryOption = {
    kind: FAILURE_RECOVERY.MARK_BLOCKED,
    label: "Mark blocked",
    description:
      "Pour un obstacle exterieur — une decision produit, une dependance, un acces manquant — " +
      "plutot qu'un incident de processus. La tache sort de la file et attend.",
    href: input.markBlockedHref,
    available: input.markBlockedHref !== null,
    unavailableReason: null,
    recommended: recommended === FAILURE_RECOVERY.MARK_BLOCKED,
  };

  const options = [correct, retry, blocked];
  return [
    ...options.filter((option) => option.recommended),
    ...options.filter((option) => !option.recommended),
  ];
}

/**
 * Cette execution merite-t-elle une section de diagnostic ?
 *
 * `COMPLETED` non : il n'y a rien a diagnostiquer. Les quatre autres etats
 * finaux, oui — y compris `CANCELLED`, ou la question « qu'est-ce qui restait
 * en cours ? » se pose exactement de la meme facon.
 */
export function hasFailureDiagnostics(status: RunStatus): boolean {
  return (
    status === RUN_STATUS.FAILED ||
    status === RUN_STATUS.BLOCKED ||
    status === RUN_STATUS.CANCELLED
  );
}

/**
 * Texte de l'option `Retry` quand elle repartirait du meme repository sale.
 *
 * Le pilote reel a clique `Retry` sans savoir qu'il exigeait un repository
 * propre. L'annoncer **avant** le clic est la moitie la plus utile du
 * correctif : l'autre moitie — ne plus changer le statut pour rien — repare ce
 * qui a deja eu lieu.
 */
export const RETRY_NEEDS_CLEAN_NOTICE =
  "Un « Retry » exige un repository propre. Tant que le travail partiel est la, il sera " +
  "refuse — et la tache restera en echec, sans qu'aucune execution ne demarre.";

/**
 * Ce que NOX n'est pas capable d'observer, dit explicitement.
 *
 * Cette phrase est affichee dans la section de diagnostic, en permanence. Elle
 * existe parce que l'absence d'une information se lit trop facilement comme un
 * oubli de NOX, alors que c'est une limite du protocole — et que la difference
 * change ce qu'on va chercher ensuite.
 */
/**
 * Pourquoi une reprise est offerte devant une tache qui affiche « Prete ».
 *
 * Sans cette phrase, l'ecran se contredit : la tache dit qu'elle attend une
 * execution neuve, et un bouton propose de continuer une ancienne. C'est
 * pourtant l'etat exact qu'un `Retry` d'avant HOTFIX-006 laissait derriere lui,
 * et l'utilisateur doit pouvoir le reconnaitre plutot que de le subir.
 */
export const STRANDED_RETRY_NOTICE =
  "Cette tache affiche « Prete » parce qu'un « Retry » l'y a menee, mais aucune execution " +
  "n'a jamais demarre : le lancement a ete refuse ensuite. L'echec ci-dessus reste donc le " +
  "dernier fait de cette tache, et son travail partiel est toujours sur le disque.";

/**
 * Ce que NOX ne pourra pas nommer sur une execution ancienne.
 *
 * L'empreinte globale, elle, decide exactement comme pour une execution
 * recente : c'est la localisation d'une divergence qui manque, jamais la
 * garantie. Les confondre laisserait croire que la reprise est moins sure ici,
 * alors qu'elle est aussi sure et seulement moins bavarde en cas de refus.
 */
export const NO_ENTRY_DIAGNOSTICS_NOTICE =
  "Cette execution est anterieure au diagnostic par chemin : NOX verifiera que le dossier de " +
  "travail est exactement celui qu'elle a laisse, mais ne pourra pas nommer les fichiers " +
  "concernes si ce n'est plus le cas.";

export const PROTOCOL_LIMITS_NOTICE =
  "Claude Code n'expose pas systematiquement la commande qui a echoue ni son code de retour. " +
  "Quand NOX ne les a pas observes, il l'ecrit ici plutot que de les deduire. La sortie " +
  "complete du processus n'est jamais conservee : seule la fin de sa sortie d'erreur l'est.";
