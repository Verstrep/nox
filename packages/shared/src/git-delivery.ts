/**
 * Politique de livraison Git, candidat valide, et decision d'ecriture.
 *
 * ## Ce que ce module existe pour empecher
 *
 * Qu'un `git add .` suivi d'un `git commit` parte parce que `Task.status` vaut
 * `COMPLETED`. Un statut dit qu'une decision a ete prise ; il ne dit pas que le
 * repository contient encore, octet pour octet, le travail sur lequel cette
 * decision portait. Entre les deux, il y a un editeur ouvert, un script lance a
 * la main, un `git checkout` malheureux — et un commit automatique livrerait
 * alors quelque chose que personne n'a valide.
 *
 * La reponse de NOX tient en une phrase, et elle n'a pas de variante :
 *
 * > Si le repository ne correspond plus exactement au candidat valide, NOX
 * > n'ecrit pas dans Git.
 *
 * Pas de « NOX essaie de sauver ce qu'il peut », pas de « petite modification
 * innocente », pas de bouton `Commit anyway`.
 *
 * ## L'autorisation est separee de celle de la file
 *
 * `Start queue` autorise NOX a lancer Claude Code sur les taches inscrites, et
 * — depuis TASK-028 — a repondre a un echec de validation par un nombre borne
 * de corrections. Il n'autorise **rien** dans Git. La politique de livraison est
 * une seconde autorisation, prise dans les reglages du projet, et son defaut est
 * `MANUAL` : un projet existant ne se met pas a commiter parce qu'une version a
 * ete installee.
 *
 * ## Ce module est pur
 *
 * Ni base, ni disque, ni Git, ni reseau, ni React. Il porte le vocabulaire, la
 * politique et la decision ; l'execution vit dans le runner, qui rejoue la
 * decision plutot que de faire confiance a celui qui l'appelle.
 */

import { isSensitiveRepositoryPath } from "./review.js";
import { createStatusGuard } from "./statuses.js";

// ---------------------------------------------------------------------------
// 1. Politique
// ---------------------------------------------------------------------------

/**
 * Ce que le projet autorise NOX a ecrire dans Git.
 *
 * Trois valeurs, fermees. Une quatrieme — « demander a chaque fois » — a ete
 * ecartee volontairement : une file qui s'arrete sur une confirmation n'avance
 * pas plus qu'une file arretee, et l'automatisme perdrait son interet. Changer
 * la politique **est** l'autorisation humaine ; elle est donnee une fois, en
 * connaissance de sa consequence, et l'ecran l'annonce avant `Save`.
 */
export const DELIVERY_POLICY = {
  /** NOX ne cree aucun commit et ne pousse rien. */
  MANUAL: "MANUAL",
  /** NOX peut commiter un travail valide, si le repository y correspond encore. */
  AUTO_COMMIT: "AUTO_COMMIT",
  /** Meme regle, puis un push vers l'upstream deja configure de la branche. */
  AUTO_COMMIT_PUSH: "AUTO_COMMIT_PUSH",
} as const;

export type DeliveryPolicy = (typeof DELIVERY_POLICY)[keyof typeof DELIVERY_POLICY];

export const DELIVERY_POLICIES: readonly DeliveryPolicy[] = Object.values(DELIVERY_POLICY);

export const isDeliveryPolicy = createStatusGuard(DELIVERY_POLICIES);

/**
 * Une politique illisible devient `MANUAL`.
 *
 * Le defaut sur, comme partout ailleurs dans NOX : il n'accorde rien. Une valeur
 * qu'on ne sait pas lire ne doit jamais ouvrir un droit d'ecriture dans Git.
 */
export function readDeliveryPolicy(value: string | null | undefined): DeliveryPolicy {
  return typeof value === "string" && isDeliveryPolicy(value) ? value : DELIVERY_POLICY.MANUAL;
}

/** La politique autorise-t-elle NOX a agir sans geste humain ? */
export function policyAllowsAutomatic(policy: DeliveryPolicy): boolean {
  return policy !== DELIVERY_POLICY.MANUAL;
}

/** La politique exige-t-elle un push pour etre satisfaite ? */
export function policyRequiresPush(policy: DeliveryPolicy): boolean {
  return policy === DELIVERY_POLICY.AUTO_COMMIT_PUSH;
}

// ---------------------------------------------------------------------------
// 2. Etats d'une livraison
// ---------------------------------------------------------------------------

/**
 * Ou en est une livraison.
 *
 * Commit et push ne sont **jamais** confondus : `AUTO_COMMIT` est satisfait des
 * `COMMITTED`, `AUTO_COMMIT_PUSH` seulement apres `DELIVERED`. Les fondre dans
 * un seul « fait » ferait avancer la file d'un projet dont le travail n'est
 * jamais parti.
 */
export const DELIVERY_STATUS = {
  /** Candidat reserve, rien d'ecrit. */
  PENDING: "PENDING",
  /** Un commit est engage — ou l'etait, si le serveur s'est arrete. */
  COMMITTING: "COMMITTING",
  /** Le commit existe localement. */
  COMMITTED: "COMMITTED",
  /** Un push est engage. */
  PUSHING: "PUSHING",
  /** Commit **et** push confirmes. */
  DELIVERED: "DELIVERED",
  /** Une ecriture a ete tentee et a echoue. */
  FAILED: "FAILED",
  /** Refusee avant toute ecriture : la precondition ne tenait pas. */
  BLOCKED: "BLOCKED",
} as const;

export type DeliveryStatus = (typeof DELIVERY_STATUS)[keyof typeof DELIVERY_STATUS];

export const DELIVERY_STATUSES: readonly DeliveryStatus[] = Object.values(DELIVERY_STATUS);

export const isDeliveryStatus = createStatusGuard(DELIVERY_STATUSES);

/**
 * Un statut illisible devient `BLOCKED`.
 *
 * Il n'autorise rien et n'affirme rien : ni qu'un commit existe, ni qu'un push
 * a eu lieu. C'est le seul defaut qui ne puisse pas faire avancer une file.
 */
export function readDeliveryStatus(value: string | null | undefined): DeliveryStatus {
  return typeof value === "string" && isDeliveryStatus(value) ? value : DELIVERY_STATUS.BLOCKED;
}

/** Un commit local existe-t-il deja pour cette livraison ? */
export function deliveryHasCommit(status: DeliveryStatus): boolean {
  return (
    status === DELIVERY_STATUS.COMMITTED ||
    status === DELIVERY_STATUS.PUSHING ||
    status === DELIVERY_STATUS.DELIVERED
  );
}

/**
 * La politique applicable est-elle satisfaite par cet etat ?
 *
 * `MANUAL` n'est jamais « satisfaite » par une livraison NOX : ce mode confie la
 * question au preflight Git existant, exactement comme avant TASK-029. C'est ce
 * qui permet a un utilisateur qui prefere son terminal de continuer a travailler
 * sans que NOX ait rien ecrit.
 */
export function deliverySatisfied(policy: DeliveryPolicy, status: DeliveryStatus): boolean {
  switch (policy) {
    case DELIVERY_POLICY.MANUAL:
      return false;
    case DELIVERY_POLICY.AUTO_COMMIT:
      return deliveryHasCommit(status);
    case DELIVERY_POLICY.AUTO_COMMIT_PUSH:
      return status === DELIVERY_STATUS.DELIVERED;
  }
}

/**
 * Qui a demande cette livraison.
 *
 * La politique du projet, ou un clic explicite. La distinction n'est pas
 * decorative : elle decide de la prudence appliquee aux hooks et a la signature,
 * et elle se relit dans l'historique — « pourquoi ce commit existe-t-il ? ».
 */
export const DELIVERY_TRIGGER = {
  /** La politique du projet, sur une tache qui vient d'etre validee. */
  AUTOMATIC: "AUTOMATIC",
  /** Un humain a clique depuis la surface de livraison. */
  MANUAL: "MANUAL",
} as const;

export type DeliveryTrigger = (typeof DELIVERY_TRIGGER)[keyof typeof DELIVERY_TRIGGER];

export const DELIVERY_TRIGGERS: readonly DeliveryTrigger[] = Object.values(DELIVERY_TRIGGER);

export const isDeliveryTrigger = createStatusGuard(DELIVERY_TRIGGERS);

/** Un declencheur illisible devient `MANUAL` : il ne pretend a aucun automatisme. */
export function readDeliveryTrigger(value: string | null | undefined): DeliveryTrigger {
  return typeof value === "string" && isDeliveryTrigger(value)
    ? value
    : DELIVERY_TRIGGER.MANUAL;
}

// ---------------------------------------------------------------------------
// 3. Refus
// ---------------------------------------------------------------------------

/**
 * Pourquoi NOX n'ecrit pas dans Git.
 *
 * Chaque code repond a une question differente, et aucun ne se confond avec un
 * autre. « Le repository a change » et « aucun upstream configure » demandent
 * deux gestes sans rapport ; les afficher tous les deux comme « livraison
 * impossible » ferait chercher au mauvais endroit.
 */
export const DELIVERY_REFUSAL = {
  /** La politique du projet n'autorise aucune ecriture automatique. */
  POLICY_MANUAL: "DELIVERY_POLICY_MANUAL",
  /** La tache n'est pas terminee. */
  TASK_NOT_COMPLETED: "DELIVERY_TASK_NOT_COMPLETED",
  /**
   * Aucune execution validee ne permet de definir un candidat sur.
   *
   * Une tache marquee terminee a la main n'a ni run, ni review, ni etat accepte :
   * il n'existe alors aucun « travail valide » a livrer, et en inventer un
   * reviendrait a commiter ce qui traine.
   */
  NO_COMPLETION_RUN: "DELIVERY_NO_COMPLETION_RUN",
  /** L'execution de reference ne s'est pas terminee normalement. */
  RUN_NOT_COMPLETED: "DELIVERY_RUN_NOT_COMPLETED",
  /** Une livraison est deja engagee sur ce travail. */
  ALREADY_RESERVED: "DELIVERY_ALREADY_RESERVED",
  /** Cette livraison a deja satisfait sa politique. */
  ALREADY_DELIVERED: "DELIVERY_ALREADY_DELIVERED",
  /** Le repository n'a pas pu etre inspecte. */
  REPOSITORY_UNAVAILABLE: "DELIVERY_REPOSITORY_UNAVAILABLE",
  /**
   * Le repository ne correspond plus au candidat valide.
   *
   * Le refus est sans echappatoire, et c'est le coeur de TASK-029 : livrer un
   * etat different reviendrait a signer du code que personne n'a relu.
   */
  REPOSITORY_CHANGED: "DELIVERY_REPOSITORY_CHANGED",
  /**
   * L'index porte deja des changements.
   *
   * Un travail prepare a la main et le travail valide par NOX ne se melangent
   * pas : le commit ne saurait plus dire ce qu'il contient.
   */
  INDEX_NOT_EMPTY: "DELIVERY_INDEX_NOT_EMPTY",
  /** `HEAD` est detache : aucune branche courante a livrer. */
  DETACHED_HEAD: "DELIVERY_DETACHED_HEAD",
  /** La branche n'est plus celle du candidat, et NOX n'en change jamais. */
  BRANCH_CHANGED: "DELIVERY_BRANCH_CHANGED",
  /** `HEAD` a avance depuis la validation. */
  HEAD_CHANGED: "DELIVERY_HEAD_CHANGED",
  /** Il n'y a rien a livrer : le dossier de travail est propre. */
  NOTHING_TO_COMMIT: "DELIVERY_NOTHING_TO_COMMIT",
  /** Le candidat porte plus d'entrees que NOX n'en livre automatiquement. */
  TOO_MANY_ENTRIES: "DELIVERY_TOO_MANY_ENTRIES",
  /** Un fichier manifestement sensible apparaitrait pour la premiere fois. */
  SENSITIVE_PATH: "DELIVERY_SENSITIVE_PATH",
  /** Git ne connait ni nom, ni adresse : NOX n'en invente pas. */
  GIT_IDENTITY_MISSING: "DELIVERY_GIT_IDENTITY_MISSING",
  /**
   * La signature de commit est configuree.
   *
   * NOX ne la desactive pas, et ne peut pas garantir qu'elle aboutisse sans
   * interaction. L'automatique renonce ; un geste humain reste possible.
   */
  SIGNING_CONFIGURED: "DELIVERY_SIGNING_CONFIGURED",
  /**
   * Un hook de commit est installe.
   *
   * NOX ne passe jamais `--no-verify`. Un hook peut modifier le contenu, poser
   * une question, ou durer : rien de tout cela n'est acceptable sans personne
   * devant l'ecran.
   */
  HOOKS_CONFIGURED: "DELIVERY_HOOKS_CONFIGURED",
  /** La branche courante n'a pas d'upstream, et NOX n'en configure jamais. */
  UPSTREAM_MISSING: "DELIVERY_UPSTREAM_MISSING",
  /** L'upstream n'est plus celui enregistre au moment de la validation. */
  UPSTREAM_CHANGED: "DELIVERY_UPSTREAM_CHANGED",
  /** Le commit n'a pas pu etre cree. */
  COMMIT_FAILED: "DELIVERY_COMMIT_FAILED",
  /** Le commit cree ne represente pas le candidat attendu. */
  TREE_MISMATCH: "DELIVERY_TREE_MISMATCH",
  /** Le serveur distant a refuse : l'historique a diverge. */
  PUSH_REJECTED: "DELIVERY_PUSH_REJECTED",
  /** Le push a echoue pour une autre raison : reseau, authentification, delai. */
  PUSH_FAILED: "DELIVERY_PUSH_FAILED",
  /** Aucun commit local a pousser. */
  NOTHING_TO_PUSH: "DELIVERY_NOTHING_TO_PUSH",
} as const;

export type DeliveryRefusalCode = (typeof DELIVERY_REFUSAL)[keyof typeof DELIVERY_REFUSAL];

export const DELIVERY_REFUSAL_CODES: readonly DeliveryRefusalCode[] =
  Object.values(DELIVERY_REFUSAL);

export const isDeliveryRefusalCode = createStatusGuard(DELIVERY_REFUSAL_CODES);

// ---------------------------------------------------------------------------
// 4. Le candidat
// ---------------------------------------------------------------------------

/**
 * Bornes de la livraison.
 *
 * Des constantes, jamais des variables d'environnement : une borne qu'on peut
 * desserrer depuis l'exterieur n'en est plus une. C'est la meme regle que pour
 * les delais de validation autonome et pour la borne de corrections.
 */
export const DELIVERY_LIMITS = {
  /** Entrees d'un candidat livrable automatiquement. */
  maxEntries: 500,
  /** Chemins passes a Git en une seule invocation. */
  pathspecChunk: 40,
  /** Caracteres conserves d'une sortie Git en echec. */
  output: 2_000,
  /** Caracteres du sujet de commit, trailer exclu. */
  subject: 120,
} as const;

/**
 * Une entree du candidat, telle que `git status --porcelain=v1` la rapporte.
 *
 * `code` est le couple de lettres index/dossier de travail — `??` pour un
 * fichier non suivi, ` M` pour une modification, ` D` pour une suppression. Il
 * est conserve parce qu'il repond a une question que le chemin seul ne repond
 * pas : ce fichier apparait-il pour la premiere fois ?
 */
export type DeliveryCandidateEntry = {
  code: string;
  path: string;
};

/** Ce fichier est-il non suivi, c'est-a-dire nouveau pour Git ? */
export function isUntrackedEntry(entry: DeliveryCandidateEntry): boolean {
  return entry.code === "??";
}

/** Ce fichier a-t-il disparu du dossier de travail ? */
export function isDeletedEntry(entry: DeliveryCandidateEntry): boolean {
  return entry.code.includes("D");
}

/**
 * Les chemins que le candidat livrerait, tries et sans doublon.
 *
 * L'ordre est stable et independant de la locale : deux inspections du meme etat
 * produisent la meme liste, donc les memes arguments passes a Git.
 */
export function candidatePaths(
  entries: readonly DeliveryCandidateEntry[],
): string[] {
  const paths = new Set<string>();
  for (const entry of entries) {
    if (entry.path !== "") {
      paths.add(entry.path);
    }
  }
  return [...paths].sort();
}

/**
 * Les fichiers sensibles qui apparaitraient pour la premiere fois.
 *
 * ## Ce que cette garde est, et ce qu'elle n'est pas
 *
 * Ce n'est **pas** un detecteur de secrets. Il n'y a ici ni analyse d'entropie,
 * ni integration avec un coffre, ni lecture du contenu : uniquement une liste
 * conservatrice de noms — `.env`, `*.pem`, `*.key`, `id_rsa`, `id_ed25519`,
 * `credentials.json`. Un secret ecrit dans `src/config.ts` passera, et NOX ne
 * pretend pas le contraire.
 *
 * Son but est plus modeste et parfaitement atteignable : empecher qu'un `.env`
 * cree pendant une execution soit commite automatiquement parce que personne ne
 * regardait. Un fichier deja suivi historiquement, lui, releve du contrat Git
 * reel du repository : il est deja dans l'historique, et le retirer du commit ne
 * le retirerait pas de la ou il est.
 */
export function sensitiveNewPaths(
  entries: readonly DeliveryCandidateEntry[],
): string[] {
  return entries
    .filter((entry) => isUntrackedEntry(entry) && isSensitiveRepositoryPath(entry.path))
    .map((entry) => entry.path)
    .sort();
}

// ---------------------------------------------------------------------------
// 5. Message de commit
// ---------------------------------------------------------------------------

/** Cle du trailer technique pose par NOX. */
export const DELIVERY_TRAILER_KEY = "NOX-Delivery";

/** Le trailer exact d'une livraison. */
export function deliveryTrailer(deliveryId: string): string {
  return `${DELIVERY_TRAILER_KEY}: ${deliveryId}`;
}

/**
 * Retire les caracteres de controle d'un titre.
 *
 * Un sujet de commit tient sur une ligne. Un retour chariot glisse dans un titre
 * de tache ferait passer la suite pour un corps de message — ou, pire, pour un
 * trailer.
 */
function stripControlCharacters(value: string): string {
  let output = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    output += code < 0x20 || code === 0x7f ? " " : character;
  }
  return output;
}

/**
 * Nettoie un titre de tache pour en faire un sujet de commit.
 *
 * Une seule ligne, sans caractere de controle, bornee. Un titre coupe l'est
 * proprement plutot qu'au milieu d'un mot quand c'est possible : un sujet de
 * commit se lit dans un `git log --oneline`, et une coupe brutale s'y voit.
 */
export function deliverySubject(taskCode: string, title: string): string {
  const cleaned = stripControlCharacters(title)
    .replace(/\s+/gu, " ")
    .trim();

  const prefix = `${taskCode}: `;
  const room = Math.max(0, DELIVERY_LIMITS.subject - prefix.length);

  if (cleaned === "") {
    return `${taskCode}: livraison du travail valide`;
  }
  if (cleaned.length <= room) {
    return `${prefix}${cleaned}`;
  }

  const cut = cleaned.slice(0, room - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const kept = lastSpace > room / 2 ? cut.slice(0, lastSpace) : cut;
  return `${prefix}${kept}…`;
}

/**
 * Le message de commit d'une livraison.
 *
 * ## Pourquoi un trailer plutot qu'un identifiant dans le sujet
 *
 * Parce que le sujet est lu par des humains, et qu'un identifiant opaque de
 * vingt-cinq caracteres n'y apprend rien a personne. Le trailer, lui, repond a
 * une question que seule une machine se pose : « ce commit est-il celui que
 * j'etais en train de creer quand le serveur s'est arrete ? ». Sans lui, une
 * reprise apres panne creerait un second commit identique — et personne ne
 * saurait lequel des deux garder.
 *
 * Le message est **fige a la reservation** et jamais recalcule : une reprise
 * commite exactement le meme texte, sinon le trailer ne prouverait plus rien.
 */
export function buildDeliveryCommitMessage(input: {
  taskCode: string;
  title: string;
  deliveryId: string;
}): string {
  return `${deliverySubject(input.taskCode, input.title)}\n\n${deliveryTrailer(input.deliveryId)}\n`;
}

// ---------------------------------------------------------------------------
// 6. Eligibilite
// ---------------------------------------------------------------------------

/**
 * Ce qui permet de definir un candidat, relu en base.
 *
 * Aucun de ces faits ne vient du navigateur. Un onglet ne peut donc ni declarer
 * qu'une tache est terminee, ni designer l'execution qui ferait foi.
 */
export type DeliveryEligibilityFacts = {
  taskCompleted: boolean;
  /** Une decision de review existe sur l'execution de reference. */
  hasCompletionDecision: boolean;
  /** L'execution de reference s'est terminee normalement. */
  runCompleted: boolean;
};

export type DeliveryEligibility =
  | { eligible: true }
  | { eligible: false; code: DeliveryRefusalCode };

/**
 * Un candidat peut-il exister pour cette tache ?
 *
 * Volontairement independante de la politique : `MANUAL` doit pouvoir afficher
 * exactement ce qu'il faudrait livrer, sans quoi la surface de livraison serait
 * vide dans le mode ou elle est la plus utile.
 */
export function checkDeliveryEligibility(
  facts: DeliveryEligibilityFacts,
): DeliveryEligibility {
  if (!facts.taskCompleted) {
    return { eligible: false, code: DELIVERY_REFUSAL.TASK_NOT_COMPLETED };
  }
  if (!facts.hasCompletionDecision) {
    return { eligible: false, code: DELIVERY_REFUSAL.NO_COMPLETION_RUN };
  }
  if (!facts.runCompleted) {
    return { eligible: false, code: DELIVERY_REFUSAL.RUN_NOT_COMPLETED };
  }
  return { eligible: true };
}

// ---------------------------------------------------------------------------
// 7. La revalidation juste avant l'ecriture
// ---------------------------------------------------------------------------

/** L'upstream d'une branche, tel que la configuration Git le declare. */
export type DeliveryUpstream = {
  remote: string;
  /** Reference complete cote distant, par exemple `refs/heads/main`. */
  ref: string;
};

/**
 * Tout ce que l'ecriture exige, relu au dernier moment.
 *
 * Le mot important est **relu** : ces faits viennent d'une inspection effectuee
 * juste avant, pas d'un instantane calcule a la fin de l'execution. Entre les
 * deux, un editeur a pu enregistrer, un script a pu tourner, quelqu'un a pu
 * changer de branche.
 */
export type DeliveryWriteFacts = {
  policy: DeliveryPolicy;
  trigger: DeliveryTrigger;
  status: DeliveryStatus;
  /**
   * Ce commit devra-t-il etre pousse ?
   *
   * Un fait a part, et non une deduction de la politique : `Commit & push
   * validated work` sur un projet `MANUAL` exige exactement les memes
   * garanties d'upstream qu'une politique `AUTO_COMMIT_PUSH`. Manuel ne veut
   * jamais dire « les gardes sont desactivees ».
   */
  requiresPush: boolean;
  detached: boolean;
  branch: string;
  expectedBranch: string;
  head: string;
  expectedHead: string;
  /** L'empreinte relue est identique a celle du candidat. */
  fingerprintMatches: boolean;
  indexDirty: boolean;
  entryCount: number;
  sensitiveAdditions: readonly string[];
  identityComplete: boolean;
  signingConfigured: boolean;
  hooksConfigured: boolean;
  upstream: DeliveryUpstream | null;
  expectedUpstream: DeliveryUpstream | null;
};

export type DeliveryWriteDecision =
  | { ok: true }
  | { ok: false; code: DeliveryRefusalCode };

/**
 * NOX peut-il ecrire ce commit ?
 *
 * ## L'ordre des refus
 *
 * Du plus structurel au plus circonstanciel, comme pour les corrections : une
 * branche detachee demande un geste different d'un upstream absent, et le
 * premier refus rencontre est celui qui s'affiche. On montre d'abord ce qu'il
 * faut regler en premier.
 *
 * ## Pourquoi l'upstream est verifie **avant** le commit
 *
 * Parce qu'une politique `AUTO_COMMIT_PUSH` qui creerait un commit local sans
 * pouvoir le pousser laisserait le repository en avance sur son upstream — donc
 * un preflight en echec, donc une file arretee, pour un travail que NOX savait
 * des le depart ne pas pouvoir livrer. Mieux vaut ne rien ecrire et le dire.
 *
 * ## Hooks et signature
 *
 * NOX ne passe **jamais** `--no-verify`, et ne desactive **jamais** la
 * signature : contourner en silence une protection que le repository s'est
 * donnee serait exactement le genre de service que personne n'a demande. Quand
 * l'une des deux est configuree, l'automatique renonce et le dit ; un geste
 * humain, lui, reste possible — et le hook s'executera alors normalement.
 */
export function checkDeliveryWrite(facts: DeliveryWriteFacts): DeliveryWriteDecision {
  if (facts.trigger === DELIVERY_TRIGGER.AUTOMATIC && !policyAllowsAutomatic(facts.policy)) {
    return refuse(DELIVERY_REFUSAL.POLICY_MANUAL);
  }
  // Cette fonction garde le **commit**, et lui seul : un commit deja cree
  // n'en produit jamais un second, quelle que soit la politique. Le sort du
  // push est decide par `checkDeliveryPush`.
  if (deliveryHasCommit(facts.status)) {
    return refuse(DELIVERY_REFUSAL.ALREADY_DELIVERED);
  }
  if (facts.detached) {
    return refuse(DELIVERY_REFUSAL.DETACHED_HEAD);
  }
  if (facts.branch !== facts.expectedBranch) {
    return refuse(DELIVERY_REFUSAL.BRANCH_CHANGED);
  }
  if (facts.head !== facts.expectedHead) {
    return refuse(DELIVERY_REFUSAL.HEAD_CHANGED);
  }
  if (facts.indexDirty) {
    return refuse(DELIVERY_REFUSAL.INDEX_NOT_EMPTY);
  }
  if (!facts.fingerprintMatches) {
    return refuse(DELIVERY_REFUSAL.REPOSITORY_CHANGED);
  }
  if (facts.entryCount === 0) {
    return refuse(DELIVERY_REFUSAL.NOTHING_TO_COMMIT);
  }
  if (facts.entryCount > DELIVERY_LIMITS.maxEntries) {
    return refuse(DELIVERY_REFUSAL.TOO_MANY_ENTRIES);
  }
  if (facts.sensitiveAdditions.length > 0) {
    return refuse(DELIVERY_REFUSAL.SENSITIVE_PATH);
  }
  if (!facts.identityComplete) {
    return refuse(DELIVERY_REFUSAL.GIT_IDENTITY_MISSING);
  }
  if (facts.trigger === DELIVERY_TRIGGER.AUTOMATIC && facts.signingConfigured) {
    return refuse(DELIVERY_REFUSAL.SIGNING_CONFIGURED);
  }
  if (facts.trigger === DELIVERY_TRIGGER.AUTOMATIC && facts.hooksConfigured) {
    return refuse(DELIVERY_REFUSAL.HOOKS_CONFIGURED);
  }
  // L'upstream est verifie **avant** le commit : une livraison qui devra
  // pousser et ne le pourra manifestement pas laisserait sinon un commit local
  // en avance sur son upstream — donc un preflight en echec, donc une file
  // arretee, pour un travail que NOX savait des le depart ne pas pouvoir
  // livrer. Mieux vaut ne rien ecrire et le dire.
  if (facts.requiresPush) {
    if (facts.upstream === null) {
      return refuse(DELIVERY_REFUSAL.UPSTREAM_MISSING);
    }
    if (
      facts.expectedUpstream !== null &&
      (facts.expectedUpstream.remote !== facts.upstream.remote ||
        facts.expectedUpstream.ref !== facts.upstream.ref)
    ) {
      return refuse(DELIVERY_REFUSAL.UPSTREAM_CHANGED);
    }
  }
  return { ok: true };
}

function refuse(code: DeliveryRefusalCode): DeliveryWriteDecision {
  return { ok: false, code };
}

/** Ce que le push exige, relu au dernier moment. */
export type DeliveryPushFacts = {
  status: DeliveryStatus;
  detached: boolean;
  branch: string;
  expectedBranch: string;
  head: string;
  /** Le commit que cette livraison a cree. */
  commitSha: string | null;
  upstream: DeliveryUpstream | null;
  expectedUpstream: DeliveryUpstream | null;
};

/**
 * NOX peut-il pousser ce commit ?
 *
 * `Retry push` ne recree jamais un commit : il relit la livraison, verifie que
 * `HEAD` est bien le commit attendu, que la branche et l'upstream n'ont pas
 * bouge, et pousse. Zero `git add`, zero commit.
 */
export function checkDeliveryPush(facts: DeliveryPushFacts): DeliveryWriteDecision {
  if (facts.status === DELIVERY_STATUS.DELIVERED) {
    return refuse(DELIVERY_REFUSAL.ALREADY_DELIVERED);
  }
  if (facts.commitSha === null || !deliveryHasCommit(facts.status)) {
    return refuse(DELIVERY_REFUSAL.NOTHING_TO_PUSH);
  }
  if (facts.detached) {
    return refuse(DELIVERY_REFUSAL.DETACHED_HEAD);
  }
  if (facts.branch !== facts.expectedBranch) {
    return refuse(DELIVERY_REFUSAL.BRANCH_CHANGED);
  }
  if (facts.head !== facts.commitSha) {
    return refuse(DELIVERY_REFUSAL.HEAD_CHANGED);
  }
  if (facts.upstream === null) {
    return refuse(DELIVERY_REFUSAL.UPSTREAM_MISSING);
  }
  if (
    facts.expectedUpstream !== null &&
    (facts.expectedUpstream.remote !== facts.upstream.remote ||
      facts.expectedUpstream.ref !== facts.upstream.ref)
  ) {
    return refuse(DELIVERY_REFUSAL.UPSTREAM_CHANGED);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 8. Reconciliation
// ---------------------------------------------------------------------------

/**
 * Le commit deja present est-il celui que cette livraison devait creer ?
 *
 * ## Pourquoi la question se pose
 *
 * Le runner cree le commit, puis repond. Entre les deux, le serveur web peut
 * s'arreter. Au redemarrage, la livraison est `COMMITTING` sans `commitSha` :
 * relancer le commit en creerait un second, identique, que personne ne saurait
 * distinguer du premier.
 *
 * ## Pourquoi la recherche est bornee
 *
 * A `HEAD`, et a lui seul. Le flux normal sait exactement ou le commit devrait
 * se trouver : juste au-dessus de `expectedHead`, sur la branche attendue.
 * Parcourir l'historique pour retrouver une livraison serait a la fois lent et
 * ambigu — deux livraisons d'une meme tache porteraient des trailers differents,
 * mais un `git log --all` finirait par ramener autre chose.
 *
 * Les deux conditions sont exigees ensemble : le trailer prouve l'intention, le
 * parent prouve la place. Un trailer seul pourrait venir d'un `cherry-pick`.
 */
export function reconcilesExistingCommit(facts: {
  headTrailerMatches: boolean;
  headParents: readonly string[];
  expectedHead: string;
}): boolean {
  return (
    facts.headTrailerMatches &&
    facts.headParents.length === 1 &&
    facts.headParents[0] === facts.expectedHead
  );
}

/**
 * Le push a-t-il deja abouti ?
 *
 * La reference de suivi locale est mise a jour par Git **au moment du push**.
 * Si elle designe deja le commit attendu, le serveur distant l'a recu : une
 * reponse a ete perdue, pas un push. Repousser serait techniquement inoffensif,
 * mais reconcilier est plus honnete — et evite de recontacter le reseau pour
 * apprendre ce qu'on sait deja.
 *
 * Ce n'est pas une affirmation sur l'etat du serveur distant a cet instant :
 * c'est une affirmation sur ce que **cette machine** a reussi a y envoyer. NOX
 * ne fait aucun `fetch` pour lever le doute — cela toucherait au reseau et
 * modifierait le repository sans que personne ne l'ait demande.
 */
export function reconcilesExistingPush(facts: {
  trackingRef: string | null;
  commitSha: string;
}): boolean {
  return facts.trackingRef !== null && facts.trackingRef === facts.commitSha;
}
