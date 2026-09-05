/**
 * Affichage de la livraison Git.
 *
 * Ce module ne decide de rien : il traduit des etats deja derives en URL, en
 * libelles et en phrases. Les preconditions, les verrous et l'ecriture
 * appartiennent au serveur ; les redire ici les ferait diverger le jour ou l'une
 * des deux changerait.
 *
 * Pur et sans dependance : ni base, ni React, ni reseau, ni Git.
 */

import {
  DELIVERY_POLICY,
  DELIVERY_REFUSAL,
  DELIVERY_STATUS,
  DELIVERY_TRIGGER,
  MAX_AUTOMATED_CORRECTION_ATTEMPTS,
  deliveryHasCommit,
  type DeliveryPolicy,
  type DeliveryRefusalCode,
  type DeliveryStatus,
  type DeliveryTrigger,
} from "@nox/shared";

/** Surface de livraison d'une tache. */
export function deliveryUrl(projectId: string, taskId: string): string {
  return `/projects/${projectId}/tasks/${taskId}/delivery`;
}

/** Reglages du projet, ou la politique se change. */
export function deliverySettingsUrl(projectId: string): string {
  return `/projects/${projectId}/settings`;
}

// ---------------------------------------------------------------------------
// 1. La politique
// ---------------------------------------------------------------------------

/**
 * Libelle d'une politique.
 *
 * En anglais, comme les autres etiquettes techniques de NOX, et exactement le
 * texte que l'utilisateur lit dans les reglages : deux formulations pour la meme
 * chose feraient douter qu'il s'agisse de la meme chose.
 */
const POLICY_LABELS: Record<DeliveryPolicy, string> = {
  [DELIVERY_POLICY.MANUAL]: "Manual",
  [DELIVERY_POLICY.AUTO_COMMIT]: "Auto commit validated",
  [DELIVERY_POLICY.AUTO_COMMIT_PUSH]: "Auto commit + push validated",
};

export function deliveryPolicyLabel(policy: DeliveryPolicy): string {
  return POLICY_LABELS[policy];
}

/**
 * Ce que la politique autorise, dite avant le clic.
 *
 * Chaque phrase nomme ce que NOX ecrira, et la condition qui l'en empechera.
 * Une autorisation dont on decouvre la portee apres l'avoir donnee n'en est pas
 * une.
 */
const POLICY_EXPLANATIONS: Record<DeliveryPolicy, string> = {
  [DELIVERY_POLICY.MANUAL]:
    "NOX ne crée aucun commit et ne pousse rien. Après une tâche validée, il affiche " +
    "exactement ce qu'il y aurait à livrer, et vous livrez — depuis cette interface ou " +
    "depuis votre terminal.",
  [DELIVERY_POLICY.AUTO_COMMIT]:
    "Après une tâche validée, NOX peut créer un commit — mais uniquement si le repository " +
    "correspond encore exactement à l'état qui a été validé. Aucun push. Une modification " +
    "faite entre-temps bloque la livraison au lieu d'être emportée avec.",
  [DELIVERY_POLICY.AUTO_COMMIT_PUSH]:
    "Même règle, puis un push vers l'upstream déjà configuré de la branche courante. NOX ne " +
    "configure jamais un upstream, ne change jamais de branche, et ne force jamais un push.",
};

export function deliveryPolicyExplanation(policy: DeliveryPolicy): string {
  return POLICY_EXPLANATIONS[policy];
}

/**
 * Ce que le choix engage, annonce au-dessus du bouton `Save`.
 *
 * ## Pourquoi ce texte existe
 *
 * Parce que changer la politique **est** l'autorisation humaine. NOX ne
 * redemandera pas confirmation a chaque tache — une file qui s'arrete sur une
 * modale n'avance pas plus qu'une file arretee. La consequence doit donc etre
 * lisible avant le clic, et non decouverte au premier commit.
 */
export const DELIVERY_POLICY_NOTICE =
  "Choisir un mode automatique est l'autorisation : NOX ne redemandera pas confirmation " +
  "tâche par tâche. Il n'écrira dans Git qu'après une tâche validée, et seulement si le " +
  "repository correspond encore exactement au travail qui a été validé.";

/**
 * Ce que la politique de livraison n'autorise pas.
 *
 * `Start queue` et la politique de livraison sont deux autorisations distinctes,
 * et les confondre est l'erreur que cette phrase existe pour empecher. La
 * premiere lance Claude Code et borne ses corrections ; la seconde ecrit dans
 * Git. Une file active sur un projet `Manual` continue de s'arreter sur un
 * repository modifie, exactement comme avant.
 */
export const DELIVERY_INDEPENDENT_NOTICE =
  `Ce réglage est indépendant de la file d'exécution. « Start queue » autorise NOX à lancer ` +
  `Claude Code et à corriger au plus ${String(MAX_AUTOMATED_CORRECTION_ATTEMPTS)} fois une ` +
  `validation en échec ; il n'autorise rien dans Git.`;

// ---------------------------------------------------------------------------
// 2. L'etat d'une livraison
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<DeliveryStatus, string> = {
  [DELIVERY_STATUS.PENDING]: "Ready to deliver",
  [DELIVERY_STATUS.COMMITTING]: "Committing",
  [DELIVERY_STATUS.COMMITTED]: "Committed",
  [DELIVERY_STATUS.PUSHING]: "Pushing",
  [DELIVERY_STATUS.DELIVERED]: "Pushed",
  [DELIVERY_STATUS.FAILED]: "Delivery failed",
  [DELIVERY_STATUS.BLOCKED]: "Delivery blocked",
};

export function deliveryStatusLabel(status: DeliveryStatus): string {
  return STATUS_LABELS[status];
}

/**
 * L'etat d'une livraison, en tenant compte de son dernier refus.
 *
 * « Le commit existe, le push a échoué » n'est pas « la livraison a échoué » :
 * les deux appellent des gestes differents — l'un se reprend par un push seul,
 * l'autre par une livraison entiere. Les confondre ferait recreer un commit.
 */
export function deliveryStateLabel(
  status: DeliveryStatus,
  errorCode: string | null,
): string {
  if (deliveryHasCommit(status) && errorCode !== null && status !== DELIVERY_STATUS.DELIVERED) {
    return "Commit created, push failed";
  }
  return deliveryStatusLabel(status);
}

const TRIGGER_LABELS: Record<DeliveryTrigger, string> = {
  [DELIVERY_TRIGGER.AUTOMATIC]: "Delivered by project policy",
  [DELIVERY_TRIGGER.MANUAL]: "Delivered on an explicit request",
};

export function deliveryTriggerLabel(trigger: DeliveryTrigger): string {
  return TRIGGER_LABELS[trigger];
}

/** `main → origin/main`, ou `null` quand la branche n'a pas d'upstream. */
export function upstreamLabel(
  branch: string,
  remote: string | null,
  ref: string | null,
): string | null {
  if (remote === null || ref === null) {
    return null;
  }
  // La reference complete est repliee sur son nom court : `refs/heads/main` ne
  // dit rien de plus que `main` a un lecteur. L'URL du remote, elle, n'est
  // jamais affichee — elle peut porter des identifiants, et ne sert a rien ici.
  const short = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
  return `${branch} → ${remote}/${short}`;
}

// ---------------------------------------------------------------------------
// 3. Les refus
// ---------------------------------------------------------------------------

/**
 * Ce que chaque refus veut dire, et ce qu'il reste a faire.
 *
 * Chaque phrase dit un fait **et** l'issue. Un blocage qu'on ne sait pas lever
 * se lit comme une panne ; un blocage qui semble tout arreter alors qu'il suffit
 * d'un commit se lit comme un bug.
 */
const REFUSAL_MESSAGES: Record<DeliveryRefusalCode, string> = {
  [DELIVERY_REFUSAL.POLICY_MANUAL]:
    "La politique de livraison de ce projet est « Manual » : NOX n'écrit rien dans Git. " +
    "Livrez depuis cette page, depuis votre terminal, ou changez la politique dans les réglages.",
  [DELIVERY_REFUSAL.TASK_NOT_COMPLETED]:
    "Cette tâche n'est pas terminée. Il n'y a pas encore de travail validé à livrer.",
  [DELIVERY_REFUSAL.NO_COMPLETION_RUN]:
    "Cette tâche n'a pas d'exécution validée : ni run, ni review, ni décision. NOX ne sait donc " +
    "pas quel travail livrer, et ne commite pas ce qui se trouve dans le dossier de travail.",
  [DELIVERY_REFUSAL.RUN_NOT_COMPLETED]:
    "L'exécution de référence ne s'est pas terminée normalement : il n'y a pas de travail validé " +
    "à livrer.",
  [DELIVERY_REFUSAL.ALREADY_RESERVED]:
    "Une livraison est déjà engagée sur ce travail — dans un autre onglet, ou par la politique du " +
    "projet. Rechargez la page pour voir où elle en est.",
  [DELIVERY_REFUSAL.ALREADY_DELIVERED]:
    "Ce travail a déjà été livré. NOX ne crée jamais un second commit pour la même livraison.",
  [DELIVERY_REFUSAL.REPOSITORY_UNAVAILABLE]:
    "Le repository n'a pas pu être inspecté : le runner est peut-être arrêté. Aucune écriture Git " +
    "n'a eu lieu.",
  [DELIVERY_REFUSAL.REPOSITORY_CHANGED]:
    "Repository changed after validation. NOX ne commite pas des changements qui n'ont pas été " +
    "validés. Revenez à l'état validé, ou livrez vous-même depuis votre terminal.",
  [DELIVERY_REFUSAL.INDEX_NOT_EMPTY]:
    "L'index Git porte déjà des changements préparés. NOX ne mélange pas un travail préparé à la " +
    "main avec le travail qu'il a validé : videz l'index, ou livrez vous-même.",
  [DELIVERY_REFUSAL.DETACHED_HEAD]:
    "HEAD est détaché. NOX ne change jamais de branche pour livrer : replacez-vous sur la branche " +
    "du travail validé.",
  [DELIVERY_REFUSAL.BRANCH_CHANGED]:
    "La branche courante n'est plus celle du travail validé. NOX ne change jamais de branche : " +
    "revenez dessus, ou livrez vous-même.",
  [DELIVERY_REFUSAL.HEAD_CHANGED]:
    "HEAD a avancé depuis la validation : un commit a été créé entre-temps. NOX ne livre que " +
    "l'état exact qui a été validé.",
  [DELIVERY_REFUSAL.NOTHING_TO_COMMIT]:
    "Le dossier de travail est propre : il n'y a rien à livrer. Le travail est déjà dans " +
    "l'historique Git.",
  [DELIVERY_REFUSAL.TOO_MANY_ENTRIES]:
    "Le travail validé porte plus de fichiers que NOX n'en livre automatiquement. Livrez-le " +
    "depuis votre terminal.",
  [DELIVERY_REFUSAL.SENSITIVE_PATH]:
    "Un fichier manifestement sensible apparaîtrait pour la première fois dans ce commit. NOX ne " +
    "le livre pas automatiquement. Vérifiez-le, ignorez-le, ou livrez vous-même si vous l'assumez.",
  [DELIVERY_REFUSAL.GIT_IDENTITY_MISSING]:
    "Git n'a ni user.name ni user.email configuré pour ce repository. NOX n'en invente aucun et " +
    "ne modifie aucune configuration : configurez votre identité Git, puis reprenez la livraison.",
  [DELIVERY_REFUSAL.SIGNING_CONFIGURED]:
    "La signature de commit est activée sur ce repository. NOX ne la désactive jamais et ne peut " +
    "pas garantir qu'elle aboutisse sans interaction : la livraison automatique renonce. Livrez " +
    "depuis cette page ou depuis votre terminal.",
  [DELIVERY_REFUSAL.HOOKS_CONFIGURED]:
    "Un hook de commit est installé sur ce repository. NOX ne passe jamais --no-verify : la " +
    "livraison automatique renonce plutôt que d'exécuter sans surveillance un script qui peut " +
    "modifier le contenu ou poser une question. Livrez depuis cette page ou depuis votre terminal.",
  [DELIVERY_REFUSAL.UPSTREAM_MISSING]:
    "La branche courante n'a pas d'upstream configuré. NOX n'en configure jamais : aucun commit " +
    "n'a été créé, puisque la politique exigeait de le pousser. Configurez l'upstream, puis " +
    "reprenez la livraison.",
  [DELIVERY_REFUSAL.UPSTREAM_CHANGED]:
    "L'upstream de la branche n'est plus celui enregistré au moment de la validation. NOX ne " +
    "pousse que vers la destination qu'il avait constatée.",
  [DELIVERY_REFUSAL.COMMIT_FAILED]:
    "Git n'a pas pu créer le commit. Rien n'a été défait : ce qui avait été préparé reste dans " +
    "l'index, et NOX ne le nettoie pas à votre place.",
  [DELIVERY_REFUSAL.TREE_MISMATCH]:
    "Le commit a été créé, mais le dossier de travail n'est pas revenu à l'état attendu — un hook " +
    "l'a probablement modifié. NOX ne prétend pas que la livraison a réussi, et ne défait rien.",
  [DELIVERY_REFUSAL.PUSH_REJECTED]:
    "Le serveur distant a refusé le push : l'historique a divergé. Le commit local est conservé. " +
    "NOX ne force jamais, ne tire jamais et ne rebase jamais — c'est à vous de décider comment " +
    "réconcilier.",
  [DELIVERY_REFUSAL.PUSH_FAILED]:
    "Le push a échoué : réseau, authentification ou délai dépassé. Le commit local est conservé, " +
    "et « Retry push » ne recréera pas de commit.",
  [DELIVERY_REFUSAL.NOTHING_TO_PUSH]:
    "Aucun commit local n'a été créé par cette livraison : il n'y a rien à pousser.",
};

export function deliveryRefusalMessage(code: DeliveryRefusalCode | string): string {
  return code in REFUSAL_MESSAGES
    ? REFUSAL_MESSAGES[code as DeliveryRefusalCode]
    : "La livraison a été refusée. Rechargez la page pour voir l'état enregistré.";
}

/**
 * Etiquette courte d'un refus, pour une file ou une carte de projet.
 *
 * Distincte du message : une pastille de file doit tenir sur une ligne, et une
 * phrase de trois lignes y devient illisible. Le message complet reste a un clic.
 */
const REFUSAL_LABELS: Partial<Record<DeliveryRefusalCode, string>> = {
  [DELIVERY_REFUSAL.POLICY_MANUAL]: "Manual delivery required",
  [DELIVERY_REFUSAL.REPOSITORY_CHANGED]: "Repository changed after validation",
  [DELIVERY_REFUSAL.INDEX_NOT_EMPTY]: "Staged changes block delivery",
  [DELIVERY_REFUSAL.DETACHED_HEAD]: "Detached HEAD",
  [DELIVERY_REFUSAL.BRANCH_CHANGED]: "Branch changed after validation",
  [DELIVERY_REFUSAL.HEAD_CHANGED]: "HEAD changed after validation",
  [DELIVERY_REFUSAL.SENSITIVE_PATH]: "Sensitive file blocks delivery",
  [DELIVERY_REFUSAL.GIT_IDENTITY_MISSING]: "Git identity missing",
  [DELIVERY_REFUSAL.SIGNING_CONFIGURED]: "Auto delivery blocked — commit signing",
  [DELIVERY_REFUSAL.HOOKS_CONFIGURED]: "Auto delivery blocked — commit hooks",
  [DELIVERY_REFUSAL.UPSTREAM_MISSING]: "No upstream configured",
  [DELIVERY_REFUSAL.UPSTREAM_CHANGED]: "Upstream changed",
  [DELIVERY_REFUSAL.COMMIT_FAILED]: "Commit failed",
  [DELIVERY_REFUSAL.TREE_MISMATCH]: "Commit created, tree unexpected",
  [DELIVERY_REFUSAL.PUSH_REJECTED]: "Push rejected",
  [DELIVERY_REFUSAL.PUSH_FAILED]: "Push failed",
  [DELIVERY_REFUSAL.NOTHING_TO_COMMIT]: "Nothing to deliver",
};

export function deliveryRefusalLabel(code: string | null): string | null {
  if (code === null) {
    return null;
  }
  return REFUSAL_LABELS[code as DeliveryRefusalCode] ?? "Delivery blocked";
}

// ---------------------------------------------------------------------------
// 4. Les actions
// ---------------------------------------------------------------------------

/** Libelle du bouton qui crée le commit sans le pousser. */
export const DELIVERY_COMMIT_ACTION = "Commit validated work";

/** Libelle du bouton qui crée le commit puis le pousse. */
export const DELIVERY_COMMIT_PUSH_ACTION = "Commit & push validated work";

/** Libelle du bouton qui reprend une livraison interrompue. */
export const DELIVERY_RESUME_ACTION = "Resume delivery";

/** Libelle du bouton qui rejoue le seul push. */
export const DELIVERY_RETRY_PUSH_ACTION = "Retry push";

/** Libelle du bouton qui reinspecte le repository. */
export const DELIVERY_REFRESH_ACTION = "Refresh delivery";

/**
 * Ce que `Retry push` ne fait pas, dit a cote du bouton.
 *
 * Reprendre la livraison entiere apres un push refuse creerait un second commit
 * identique. La distinction n'est pas un detail d'implementation : c'est ce que
 * l'utilisateur doit comprendre pour choisir le bon bouton.
 */
export const DELIVERY_RETRY_PUSH_NOTICE =
  "« Retry push » ne recrée aucun commit : il vérifie que HEAD est bien le commit de cette " +
  "livraison, puis pousse. Zéro git add, zéro nouveau commit.";

/** Ce que la surface de livraison n'ecrit jamais, dit une fois. */
export const DELIVERY_SAFETY_NOTICE =
  "NOX ne fait jamais de reset, restore, checkout, clean, pull, merge, rebase ni push forcé. " +
  "Si le repository ne correspond plus au travail validé, il refuse d'écrire plutôt que de " +
  "tenter de rattraper la situation.";

// ---------------------------------------------------------------------------
// 5. Ce qu'une acceptation va declencher
// ---------------------------------------------------------------------------

/**
 * Ce qu'accepter cette execution fera dans Git.
 *
 * ## Pourquoi ce texte est calcule et non ecrit une fois
 *
 * Parce que « Approve ne crée aucun commit » etait vrai avant TASK-029 et ne
 * l'est plus dans deux modes sur trois. Une phrase rassurante devenue fausse
 * est pire qu'une phrase absente : elle fait cliquer quelqu'un sur une action
 * dont il croit connaitre la portee.
 */
export function approveDeliveryNotice(policy: DeliveryPolicy): string {
  switch (policy) {
    case DELIVERY_POLICY.MANUAL:
      return (
        "Aucun commit, aucun git add, aucun push : la politique Git de ce projet est " +
        "« Manual », et le commit reste votre geste."
      );
    case DELIVERY_POLICY.AUTO_COMMIT:
      return (
        "La politique Git de ce projet est « Auto commit validated » : après acceptation, NOX " +
        "peut créer un commit de ce travail — uniquement si le repository correspond encore " +
        "exactement à l'état validé. Aucun push."
      );
    case DELIVERY_POLICY.AUTO_COMMIT_PUSH:
      return (
        "La politique Git de ce projet est « Auto commit + push validated » : après " +
        "acceptation, NOX peut créer un commit de ce travail et le pousser vers l'upstream " +
        "déjà configuré de la branche — uniquement si le repository correspond encore " +
        "exactement à l'état validé."
      );
  }
}

/**
 * Ce qu'un passage en force ne suspend pas.
 *
 * Un `HUMAN_OVERRIDE` reste une decision humaine explicite : quelqu'un a accepte
 * le resultat malgre une preuve en echec. La politique du projet s'applique donc
 * normalement — et il faut le dire **avant** le clic, parce que c'est
 * exactement le moment ou l'on se demande si NOX va livrer un travail dont une
 * validation a echoue.
 *
 * `null` en mode `Manual` : il n'y a rien a annoncer, et une phrase de plus
 * n'apprendrait rien.
 */
export function overrideDeliveryNotice(policy: DeliveryPolicy): string | null {
  if (policy === DELIVERY_POLICY.MANUAL) {
    return null;
  }
  return (
    "Project Git delivery policy will still apply after this override. After approval, the " +
    "project Git delivery policy may automatically commit" +
    (policy === DELIVERY_POLICY.AUTO_COMMIT_PUSH ? " or push" : "") +
    " this work."
  );
}

/**
 * Ce qui s'est passe dans Git juste apres une acceptation.
 *
 * Ecrit au futur immediat plutot qu'au passe : la livraison est tentee dans la
 * meme action, mais son resultat vit sur la surface de livraison, qui le dit
 * exactement. Promettre ici un commit qui a pu etre bloque serait faux.
 */
export function approvedDeliveryNotice(policy: DeliveryPolicy): string {
  return policy === DELIVERY_POLICY.MANUAL
    ? "Tâche acceptée. Aucun commit n'a été créé : les modifications sont toujours dans votre " +
      "dossier de travail, et c'est à vous de les commiter."
    : "Tâche acceptée. La politique Git de ce projet s'applique : ouvrez « Git delivery » pour " +
      "voir ce que NOX a écrit, ou ce qui l'en a empêché."
  ;
}

/**
 * Ce qui reste a faire, quand la carte de livraison s'affiche.
 *
 * ## Pourquoi cette phrase existe
 *
 * Parce que le premier pilote reel a renvoye son utilisateur dans PowerShell
 * apres chaque tache. La cause n'etait pas l'absence des boutons de TASK-029 :
 * ils existaient. C'etait qu'une tache terminee sans **ligne** de livraison
 * n'affichait aucune carte, donc aucun chemin vers eux — et rien ne disait que
 * la politique du projet etait `Manual`.
 *
 * La carte s'affiche donc desormais des qu'une tache est terminee, et cette
 * phrase dit ce que la politique implique, avec ou sans livraison enregistree.
 */
export function noDeliveryNotice(policy: DeliveryPolicy, hasDelivery: boolean): string {
  if (policy === DELIVERY_POLICY.MANUAL) {
    return hasDelivery
      ? "La politique de ce projet est manuelle : ouvrez « Git delivery » pour commiter — ou " +
          "commiter et pousser — avec exactement les mêmes garde-fous que la livraison automatique."
      : "La politique de ce projet est manuelle, et aucun candidat de livraison n'a été " +
          "enregistré : le dossier de travail était propre, ou le repository n'a pas pu être lu. " +
          "Ouvrez « Git delivery » pour voir ce que NOX en dit.";
  }
  return hasDelivery
    ? "La politique de ce projet écrit dans Git après une tâche validée. Ouvrez « Git delivery » " +
        "pour le détail, ou pour reprendre ce qui a échoué."
    : "La politique de ce projet écrit dans Git après une tâche validée, mais aucun candidat " +
        "n'a été enregistré pour ce travail. Ouvrez « Git delivery » pour savoir pourquoi.";
}
