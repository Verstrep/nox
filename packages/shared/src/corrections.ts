/**
 * Correction ciblee : reprendre la session Claude d'une execution relue.
 *
 * ## Le probleme que ce module resout
 *
 * Apres une review, l'utilisateur voit ce qui ne va pas. Jusqu'a TASK-011, il ne
 * pouvait rien en faire depuis NOX : il fallait rouvrir un terminal, reexpliquer
 * le contexte a une conversation neuve, et se debrouiller avec un repository
 * deja modifie par l'execution precedente.
 *
 * Une correction reprend **la** session du run relu — celle qui a produit ce
 * travail, et qui sait donc pourquoi elle l'a produit ainsi.
 *
 * ## Deux natures d'execution, et une seule difference
 *
 * Un run de correction est un run comme les autres : meme lanceur, meme
 * streaming, meme annulation, meme capture Git, meme review. Trois choses le
 * distinguent, et rien d'autre :
 *
 * - il porte `kind = CORRECTION` et un `parentRunId` ;
 * - son prompt est produit par `renderClaudeCorrectionPrompt` ;
 * - son lancement passe `--resume <session du parent>`, et son preflight exige
 *   un dossier de travail **identique** a celui qui a ete relu plutot qu'un
 *   dossier propre.
 *
 * ## Le feedback est du contenu, jamais une instruction
 *
 * Le texte vient de l'utilisateur et peut contenir n'importe quoi — y compris
 * « ignore les regles » ou « fais un git push ». Il est donc **delimite** dans le
 * prompt, et n'a aucune influence sur les permissions : celles-ci sont calculees
 * a partir des commandes de validation enregistrees, exactement comme pour un
 * run initial.
 */

import { categoryMayLeavePartialWork, deriveRunFailureCategory } from "./run-failure.js";

/** Nature d'une execution. Liste fermee, comme tous les statuts de NOX. */
export const RUN_KIND = {
  /** Premiere execution d'une tache, sur un repository propre. */
  INITIAL: "INITIAL",
  /** Reprise ciblee de la session d'une execution relue. */
  CORRECTION: "CORRECTION",
} as const;

export type RunKind = (typeof RUN_KIND)[keyof typeof RUN_KIND];

export const RUN_KINDS: readonly RunKind[] = Object.values(RUN_KIND);

export function isRunKind(value: unknown): value is RunKind {
  return typeof value === "string" && (RUN_KINDS as readonly string[]).includes(value);
}

/**
 * Bornes du feedback de review.
 *
 * Des constantes, jamais des variables d'environnement : une limite qu'on peut
 * desserrer depuis un `.env` n'en est plus une.
 */
export const REVIEW_FEEDBACK_LIMITS = {
  /** 16 Kio : de quoi decrire precisement plusieurs corrections. */
  maxLength: 16_384,
} as const;

export type ReviewFeedbackRefusal =
  | "empty"
  | "blank"
  | "too_long"
  | "control_character";

/**
 * Verifie qu'un texte de feedback peut etre accepte.
 *
 * Retourne la raison du refus, ou `null` si le texte convient. Volontairement
 * permissif sur le **contenu** : Unicode, retours a la ligne, listes et extraits
 * de code sont attendus. Seuls l'absence de substance et les octets qui
 * casseraient une ecriture ou un affichage sont refuses.
 */
export function checkReviewFeedback(text: string): ReviewFeedbackRefusal | null {
  if (text === "") {
    return "empty";
  }
  if (text.trim() === "") {
    return "blank";
  }
  if (text.length > REVIEW_FEEDBACK_LIMITS.maxLength) {
    return "too_long";
  }
  // Tabulation, saut de ligne et retour chariot sont conserves : ils portent la
  // structure du texte. Les autres caracteres de controle ne portent rien, et
  // l'octet nul casserait l'ecriture sur l'entree standard du processus.
  //
  // Le test passe par les points de code plutot que par une expression
  // reguliere : une classe de caracteres de controle litterale est illisible
  // dans le source, et le lint la refuse pour cette raison meme.
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    const printable = code >= 0x20 && code !== 0x7f;
    const structural = code === 0x09 || code === 0x0a || code === 0x0d;
    if (!printable && !structural) {
      return "control_character";
    }
  }
  return null;
}

/**
 * Normalise un feedback avant enregistrement.
 *
 * Les fins de ligne sont ramenees a `\n` et les espaces de bord retires. Rien
 * d'autre : le texte que l'utilisateur relira des mois plus tard doit etre celui
 * qu'il a ecrit, et un prompt reproductible exige une forme unique.
 */
export function normalizeReviewFeedback(text: string): string {
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
}

/** Version de l'algorithme d'empreinte du dossier de travail. */
export const WORKSPACE_FINGERPRINT_VERSION = "v1";

/**
 * Empreinte opaque d'un dossier de travail, telle qu'elle est transportee.
 *
 * `value` est un HMAC hexadecimal, ou `null` lorsque le calcul n'a pas pu
 * aboutir — auquel cas `errorCode` dit pourquoi. Elle ne quitte jamais le
 * serveur : ni page, ni formulaire, ni reponse d'API publique.
 */
export type RunWorkspaceFingerprint = {
  value: string | null;
  version: string;
  errorCode: string | null;
  /**
   * Empreintes par entree, serialisees, ou `null`.
   *
   * Facultatives, et elles doivent le rester. Elles ne decident de rien : c'est
   * `value` qui accorde ou refuse une reprise. Elles servent a **nommer** les
   * chemins d'une divergence, parce qu'un refus qu'on ne peut pas diagnostiquer
   * finit par etre contourne — en general en detruisant le travail qu'il
   * protegeait. Voir `workspace-entries.ts`.
   *
   * `null` quand la liste depasse ses bornes, ou pour toute execution anterieure
   * a HOTFIX-006. Le refus tient alors, sans nommer de chemin.
   */
  entries?: string | null;
};

export function isRunWorkspaceFingerprint(value: unknown): value is RunWorkspaceFingerprint {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const entries: unknown = record["entries"];
  return (
    (record["value"] === null || typeof record["value"] === "string") &&
    typeof record["version"] === "string" &&
    (record["errorCode"] === null || typeof record["errorCode"] === "string") &&
    // Absentes est valide : une capture d'avant HOTFIX-006 n'en porte aucune, et
    // exiger le champ ferait tomber la lecture d'une review parfaitement bonne.
    (entries === undefined || entries === null || typeof entries === "string")
  );
}

/**
 * Raisons pour lesquelles une execution ne peut pas etre reprise.
 *
 * Une liste fermee, et **ordonnee** : l'interface affiche la premiere raison
 * rencontree, celle qui est la plus proche de ce que l'utilisateur peut changer.
 */
export const RESUME_REFUSAL = {
  /** L'execution n'a pas atteint un etat qui laisse un travail a reprendre. */
  RUN_NOT_COMPLETED: "RUN_NOT_COMPLETED",
  /** La tache n'est ni en review, ni en echec. */
  TASK_NOT_IN_REVIEW: "TASK_NOT_IN_REVIEW",
  /**
   * L'execution a echoue avant d'avoir rien produit.
   *
   * Un processus qui n'a jamais demarre, ou une limite d'utilisation atteinte
   * avant tout travail, ne laissent aucun dossier de travail a reprendre.
   * Proposer une correction y serait proposer de continuer le vide.
   */
  NO_PARTIAL_WORK: "NO_PARTIAL_WORK",
  /** L'execution a viole les regles Git : son etat de depart est ambigu. */
  GIT_POLICY_VIOLATION: "GIT_POLICY_VIOLATION",
  /** Claude Code n'a pas rapporte d'identifiant de session. */
  SESSION_MISSING: "SESSION_MISSING",
  /** Aucune review detaillee : execution anterieure a TASK-011. */
  REVIEW_MISSING: "REVIEW_MISSING",
  /** Aucune empreinte : execution anterieure a TASK-012. */
  FINGERPRINT_MISSING: "FINGERPRINT_MISSING",
  /** Une autre execution est deja en cours. */
  RUN_ACTIVE: "RUN_ACTIVE",
  /** Une correction a deja ete lancee depuis cette review. */
  ALREADY_CORRECTED: "ALREADY_CORRECTED",
} as const;

export type ResumeRefusal = (typeof RESUME_REFUSAL)[keyof typeof RESUME_REFUSAL];

/** Ce qu'il faut savoir d'une execution pour dire si elle est reprenable. */
export type ResumeCandidate = {
  runStatus: string;
  taskStatus: string;
  errorCode: string | null;
  claudeSessionId: string | null;
  hasReview: boolean;
  hasFingerprint: boolean;
  hasActiveRun: boolean;
  hasCorrection: boolean;
  /**
   * Code de sortie du processus, quand il y en a un.
   *
   * Sert uniquement a nommer ce qui a cede, via `deriveRunFailureCategory`.
   * Facultatif : une execution `COMPLETED` n'en a pas besoin, et une base
   * anterieure peut ne pas le porter.
   */
  exitCode?: number | null;
  /**
   * Cette execution est-elle encore la plus recente de sa tache ?
   *
   * Sert au seul cas `READY` accepte ci-dessous. Absent, il vaut `false` : le
   * defaut sur refuse, et une surface qui oublierait de le calculer n'ouvre
   * rien par megarde.
   */
  isLatestRun?: boolean;
};

/**
 * Une tache `READY` qui n'a jamais quitte son echec.
 *
 * ## Le cas que cette fonction reconnait
 *
 * Avant HOTFIX-006, une execution en echec n'offrait qu'un geste : `Retry`,
 * c'est-a-dire `FAILED → READY`. Ce geste ne lance rien — le lancement est une
 * seconde action — et il ne verifiait rien. Le pilote reel l'a donc clique, la
 * tache est passee `READY`, et le lancement a ensuite ete refuse : le
 * repository portait le travail partiel de l'echec, et un lancement initial
 * exige un repository propre.
 *
 * Resultat : la tache annonce `READY`, aucune execution n'a demarre, et l'echec
 * reste le dernier fait de son histoire. Sans cette reconnaissance, la reprise
 * serait refusee sur un detail de statut alors que **tout** ce qu'elle protege
 * est intact.
 *
 * ## Pourquoi elle est aussi etroite
 *
 * Parce qu'une tache `READY` est normalement une tache qui attend un lancement
 * neuf, et reprendre une vieille session dessus serait faux. Les trois
 * conditions ci-dessous ne se rencontrent ensemble que dans le cas decrit :
 *
 * - l'execution visee a **echoue** ;
 * - elle est encore la **plus recente** de la tache — un `Retry` qui aurait
 *   reellement demarre en aurait produit une autre ;
 * - aucune correction n'en est deja nee.
 *
 * Elle ne remplace aucun controle : branche, `HEAD` et empreinte du dossier de
 * travail restent verifies par le runner, juste avant le lancement.
 */
export function isStrandedRetry(candidate: {
  runStatus: string;
  taskStatus: string;
  isLatestRun?: boolean;
  hasCorrection: boolean;
}): boolean {
  return (
    candidate.taskStatus === "READY" &&
    candidate.runStatus === "FAILED" &&
    candidate.isLatestRun === true &&
    !candidate.hasCorrection
  );
}

/**
 * Statuts d'execution qui peuvent laisser un travail partiel exploitable.
 *
 * `COMPLETED` y figure depuis TASK-011 : le travail est fini, mais la review
 * demande des changements. `FAILED` s'y ajoute depuis HOTFIX-006, et c'est tout
 * le sujet de ce correctif — le second pilote reel a produit vingt-quatre
 * fichiers et quatre mille lignes avant de sortir en code 1, et NOX ne savait
 * proposer que de tout recommencer depuis un dossier propre.
 *
 * `BLOCKED` et `CANCELLED` n'y sont **pas**, et c'est delibere. Une limite
 * d'utilisation atteinte se resout en attendant ; une annulation est une
 * decision humaine de ne pas continuer, et la reprendre automatiquement
 * contredirait le geste. Les deux laissent un dossier de travail que NOX
 * n'efface pas — il reste relisible, simplement pas repris d'un clic.
 */
const RESUMABLE_RUN_STATUSES: readonly string[] = ["COMPLETED", "FAILED"];

/**
 * Statuts de tache qui autorisent une correction, sans condition.
 *
 * `REVIEW` est le cas historique : un humain relit et demande des changements.
 * `FAILED` est le cas de HOTFIX-006 : personne n'a rien a decider, l'execution
 * a cede toute seule, et le travail partiel est la.
 *
 * `READY` n'y figure pas, et ne doit jamais y figurer : une tache prete attend
 * normalement un lancement **neuf**, et y reprendre une ancienne session serait
 * faux. Le seul `READY` accepte l'est sous conditions, par `isStrandedRetry`.
 */
const RESUMABLE_TASK_STATUSES: readonly string[] = ["REVIEW", "FAILED"];

/**
 * Dit si une execution peut recevoir une correction, et sinon pourquoi.
 *
 * Fonction pure, sans acces a la base ni au disque : c'est la meme qui decide de
 * l'affichage du bouton et qui garde la Server Action. Deux implementations
 * finiraient par diverger, et c'est l'interface qui aurait raison a tort.
 */
export function checkResumeCandidate(candidate: ResumeCandidate): ResumeRefusal | null {
  if (!RESUMABLE_RUN_STATUSES.includes(candidate.runStatus)) {
    return RESUME_REFUSAL.RUN_NOT_COMPLETED;
  }
  if (candidate.errorCode === "GIT_POLICY_VIOLATION") {
    return RESUME_REFUSAL.GIT_POLICY_VIOLATION;
  }
  if (!RESUMABLE_TASK_STATUSES.includes(candidate.taskStatus) && !isStrandedRetry(candidate)) {
    return RESUME_REFUSAL.TASK_NOT_IN_REVIEW;
  }
  // Un echec sans travail derriere lui n'a rien a reprendre. Le controle est
  // separe du precedent parce que la reponse a donner l'est aussi : ici la
  // tache est bien en echec, c'est le contenu de l'echec qui ne s'y prete pas.
  if (
    candidate.runStatus === "FAILED" &&
    !categoryMayLeavePartialWork(
      deriveRunFailureCategory({
        status: candidate.runStatus,
        errorCode: candidate.errorCode,
        exitCode: candidate.exitCode ?? null,
      }),
    )
  ) {
    return RESUME_REFUSAL.NO_PARTIAL_WORK;
  }
  if (candidate.claudeSessionId === null || candidate.claudeSessionId.trim() === "") {
    return RESUME_REFUSAL.SESSION_MISSING;
  }
  if (!candidate.hasReview) {
    return RESUME_REFUSAL.REVIEW_MISSING;
  }
  if (!candidate.hasFingerprint) {
    return RESUME_REFUSAL.FINGERPRINT_MISSING;
  }
  if (candidate.hasCorrection) {
    return RESUME_REFUSAL.ALREADY_CORRECTED;
  }
  if (candidate.hasActiveRun) {
    return RESUME_REFUSAL.RUN_ACTIVE;
  }
  return null;
}
