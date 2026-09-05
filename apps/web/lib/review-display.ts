/**
 * Logique d'affichage d'une review, sans React.
 *
 * Tout ce qui decide *quoi* montrer vit ici ; les composants ne font que rendre.
 * C'est ce qui rend testable la partie la plus delicate de TASK-011 : le choix du
 * fichier affiche a partir d'un parametre d'URL que n'importe qui peut reecrire.
 *
 * ## La review ne lit jamais le disque
 *
 * Aucune fonction de ce module, ni de ceux qu'il appelle, n'ouvre un fichier.
 * Une review se lit **entierement** dans SQLite. Le parametre `?file=` ne
 * designe donc pas un chemin a ouvrir : il selectionne une ligne deja
 * enregistree, et une valeur inconnue ne selectionne rien du tout.
 */

import {
  RUNNER_ERROR,
  RUN_STATUS,
  RUN_VALIDATION_SUMMARY,
  summarizeRunValidations,
  type RunFileChange,
  type RunStatus,
  type RunValidationResultView,
  type RunValidationSummary,
} from "@nox/shared";

/** URL de la page de review d'une execution. */
export function reviewUrl(
  projectId: string,
  taskId: string,
  runId: string,
  file?: string,
): string {
  const base = `/projects/${projectId}/tasks/${taskId}/runs/${runId}/review`;
  return file === undefined ? base : `${base}?file=${encodeURIComponent(file)}`;
}

/**
 * Choisit le fichier affiche.
 *
 * ## Pourquoi cette fonction est le point sensible de la page
 *
 * `?file=` vient de l'URL, donc de n'importe ou : un lien colle, un signet
 * modifie, une tentative deliberee. La regle est qu'une valeur non reconnue
 * **ne selectionne rien** — elle n'est ni corrigee, ni approchee, ni utilisee
 * pour ouvrir quoi que ce soit. La comparaison porte sur les chemins deja
 * enregistres en base, et il n'existe aucun chemin de code par lequel cette
 * valeur pourrait atteindre un systeme de fichiers.
 *
 * Une valeur falsifiee produit donc un etat parfaitement ordinaire : « aucun
 * fichier selectionne », le meme qu'a l'arrivee sur la page.
 */
export function selectReviewFile(
  files: readonly RunFileChange[],
  requested: string | undefined,
): RunFileChange | null {
  if (requested === undefined || requested === "") {
    return files[0] ?? null;
  }
  return files.find((file) => file.path === requested) ?? null;
}

/** Vrai lorsque `?file=` designait quelque chose qui n'existe pas dans la review. */
export function isUnknownReviewFile(
  files: readonly RunFileChange[],
  requested: string | undefined,
): boolean {
  return (
    requested !== undefined &&
    requested !== "" &&
    !files.some((file) => file.path === requested)
  );
}

/** Une ligne de diff, prete a etre rendue. */
export type PatchLine = {
  /** Numero d'ordre dans le patch, pour une cle React stable. */
  index: number;
  /** `+`, `-`, `@`, `\` ou ` ` — conserve **dans le texte** pour l'accessibilite. */
  kind: "addition" | "deletion" | "hunk" | "meta" | "context";
  text: string;
};

/**
 * Decoupe un patch en lignes typees.
 *
 * Le signe n'est **pas** retire du texte. La couleur seule ne suffit pas : elle
 * disparait a l'impression, ne se prononce pas, et un daltonien ne la distingue
 * pas. Le `+` et le `-` restent donc la ou Git les a mis, et le type ne sert
 * qu'a les colorer en plus.
 */
export function toPatchLines(patch: string): PatchLine[] {
  const raw = patch.split("\n");
  // Un patch se termine par un saut de ligne : la derniere case est vide et ne
  // correspond a aucune ligne du fichier.
  const lines = raw.length > 0 && raw[raw.length - 1] === "" ? raw.slice(0, -1) : raw;

  return lines.map((text, index) => ({ index, kind: patchLineKind(text), text }));
}

function patchLineKind(line: string): PatchLine["kind"] {
  if (line.startsWith("@@")) {
    return "hunk";
  }
  // L'ordre compte : `+++` et `---` sont des en-tetes, pas des lignes ajoutees
  // ou supprimees, et ils commencent pourtant par `+` et `-`.
  if (line.startsWith("+++") || line.startsWith("---")) {
    return "meta";
  }
  if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("\\")) {
    return "meta";
  }
  if (line.startsWith("+")) {
    return "addition";
  }
  if (line.startsWith("-")) {
    return "deletion";
  }
  return "context";
}

/** Raison pour laquelle un fichier n'a pas de patch affichable. */
export type MissingPatchReason = "binary" | "sensitive" | "truncated" | "unavailable" | null;

/**
 * Pourquoi ce fichier n'affiche-t-il pas de diff ?
 *
 * L'ordre des tests est celui de l'information la plus utile : « sensible » dit
 * que NOX a **choisi** de ne pas montrer, « binaire » que le montrer n'aurait
 * aucun sens, « tronque » qu'il en manque un morceau. Les confondre laisserait
 * croire a une panne la ou il y a une decision.
 */
export function missingPatchReason(file: RunFileChange): MissingPatchReason {
  if (file.isSensitive) {
    return "sensitive";
  }
  if (file.isBinary) {
    return "binary";
  }
  if (file.patch === null) {
    return file.isTruncated ? "truncated" : "unavailable";
  }
  return null;
}

const MISSING_PATCH_MESSAGES: Record<Exclude<MissingPatchReason, null>, string> = {
  sensitive: "Sensitive file — content hidden",
  binary: "Binary file changed",
  truncated: "Diff truncated",
  unavailable: "Diff unavailable for this file",
};

export function missingPatchMessage(reason: Exclude<MissingPatchReason, null>): string {
  return MISSING_PATCH_MESSAGES[reason];
}

/** Etat global des validations, derive et jamais stocke. */
export function reviewValidationSummary(
  validations: readonly RunValidationResultView[],
): RunValidationSummary {
  return summarizeRunValidations(validations);
}

/**
 * Une review peut-elle etre consultee ?
 *
 * Trois etats distincts, et les distinguer est tout l'interet de la fonction :
 * une execution encore active n'a pas de review **encore**, une execution
 * anterieure a TASK-011 n'en aura **jamais**, et une capture ratee est un
 * incident qui se raconte autrement.
 */
export type ReviewAvailability = "available" | "active" | "legacy" | "failed";

export function reviewAvailability(
  status: RunStatus,
  capturedAt: string | null,
  errorCode: string | null,
): ReviewAvailability {
  if (capturedAt !== null) {
    return "available";
  }
  // Le runner ne connait pas cette execution : soit elle est anterieure a la
  // review integree, soit le runner a redemarre depuis. Dans les deux cas il
  // n'y a rien a capturer, et jamais rien a capturer — ce n'est donc pas un
  // incident, c'est l'absence definitive d'une review. « Echec » ferait croire
  // a une panne reparable.
  if (errorCode === RUNNER_ERROR.CLAUDE_RUN_NOT_FOUND) {
    return "legacy";
  }
  if (errorCode !== null) {
    return "failed";
  }
  if (!isFinalStatus(status)) {
    return "active";
  }
  return "legacy";
}

function isFinalStatus(status: RunStatus): boolean {
  return (
    status === RUN_STATUS.COMPLETED ||
    status === RUN_STATUS.FAILED ||
    status === RUN_STATUS.BLOCKED ||
    status === RUN_STATUS.CANCELLED
  );
}

/** Message affiche a la place de la review, selon la raison de son absence. */
const UNAVAILABLE_MESSAGES: Record<Exclude<ReviewAvailability, "available">, string> = {
  active:
    "Cette execution n'est pas terminee. La review sera capturee au moment ou elle le sera.",
  legacy: "Detailed review unavailable for this legacy run.",
  failed:
    "NOX n'a pas pu capturer le detail des changements de cette execution. Le compte rendu de " +
    "Claude Code et l'etat Git ci-dessous restent valides ; pour le diff, utilisez " +
    "« git status » et « git diff ».",
};

export function reviewUnavailableMessage(
  availability: Exclude<ReviewAvailability, "available">,
): string {
  return UNAVAILABLE_MESSAGES[availability];
}

/**
 * Avertissement propre a l'issue de l'execution.
 *
 * `null` pour une reussite : il n'y a rien a signaler, et une banniere permanente
 * finirait par ne plus etre lue.
 */
export function reviewOutcomeNotice(status: RunStatus, unreliable: boolean): string | null {
  if (unreliable) {
    return (
      "L'etat Git a ete modifie d'une maniere interdite pendant l'execution. Verifiez le " +
      "repository manuellement avant toute autre action : les changements ci-dessous sont " +
      "compares a l'etat de depart, et melangent donc ce qui a ete commite et ce qui ne l'a pas ete."
    );
  }

  switch (status) {
    case RUN_STATUS.CANCELLED:
      return (
        "Cette execution a ete interrompue. Les changements affiches peuvent etre partiels : " +
        "NOX n'a restaure aucun fichier."
      );
    case RUN_STATUS.FAILED:
      return "Cette execution a echoue. Les changements affiches peuvent etre partiels.";
    case RUN_STATUS.BLOCKED:
      return (
        "Cette execution est bloquee. Les changements affiches sont ceux constates au moment " +
        "ou NOX a cesse de la suivre, et peuvent etre partiels."
      );
    default:
      return null;
  }
}

/** Vrai lorsque l'issue de l'execution rend les changements potentiellement partiels. */
export function hasPartialChanges(status: RunStatus): boolean {
  return status !== RUN_STATUS.COMPLETED;
}

/** Tonalite d'affichage de l'etat global des validations. */
export function validationSummaryTone(
  summary: RunValidationSummary,
): "positive" | "negative" | "neutral" {
  switch (summary) {
    case RUN_VALIDATION_SUMMARY.PASSED:
      return "positive";
    case RUN_VALIDATION_SUMMARY.FAILED:
      return "negative";
    default:
      return "neutral";
  }
}

/**
 * L'agent a-t-il modifie le document de sa propre tache ?
 *
 * ## D'ou vient cette question
 *
 * Du premier pilote reel. `tasks/TASK-002.md` avait ete modifie pendant
 * l'execution — uniquement pour cocher des cases `[ ]` en `[x]`. Le contrat
 * n'avait pas change, et rien de dangereux n'est arrive.
 *
 * Ce n'etait pourtant pas anodin. Ce document est une **projection a sens
 * unique** du contrat que NOX detient : il est ecrit par NOX, relu par NOX sous
 * controle de revision, et il ne porte aucun resultat — pas une case cochee, pas
 * un « passe », pas un « echoue ». Un agent qui l'edite reecrit l'enonce de ce
 * qu'on lui demande, pendant qu'il y repond.
 *
 * ## Ce que cette fonction fait, et ce qu'elle ne fait pas
 *
 * Elle constate, a partir des lignes **deja enregistrees** de la review. Elle
 * n'ouvre aucun fichier, ne compare aucun texte, et ne bloque rien : le contrat
 * qui fait autorite vit en base, et il n'a pas bouge. Ce qu'elle apporte est que
 * la divergence soit **dite**, plutot que noyee dans une liste de fichiers.
 *
 * La prevention, elle, est dans le prompt : les regles d'execution disent
 * desormais de ne pas modifier ce document. Faire de cette constatation un
 * verrou du systeme de fichiers serait construire un moteur de protection pour
 * un invariant que la base tient deja.
 */
export function taskDocumentWasModified(
  files: readonly RunFileChange[],
  documentPath: string | null,
): boolean {
  if (documentPath === null || documentPath === "") {
    return false;
  }
  // Les deux cotes sont deja des chemins relatifs a separateurs `/` : celui de
  // la tache est construit par NOX, celui de la review vient de Git. Normaliser
  // ici laisserait croire qu'ils pourraient differer de forme.
  return files.some((file) => file.path === documentPath);
}

/**
 * Ce que la review dit quand le document de la tache a bouge.
 *
 * Une phrase, sans dramatisation : le contrat n'a pas change, et NOX le sait
 * parce qu'il ne l'a jamais relu depuis ce fichier.
 */
export const TASK_DOCUMENT_MODIFIED_NOTICE =
  "L'exécution a modifié le document de cette tâche. Le contrat qui fait autorité vit dans " +
  "NOX, pas dans ce fichier : il n'a donc pas changé. Le document sera réécrit tel que NOX le " +
  "connaît à la prochaine synchronisation, et il n'y a rien à réparer à la main.";
