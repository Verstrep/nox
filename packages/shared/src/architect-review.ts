/**
 * Contrat de la **review Architecte** d'une execution.
 *
 * ## Pourquoi un contrat distinct de la conversation
 *
 * Une conversation Architecte conçoit une tache ; une review evalue un run. Ce
 * sont deux objets metier differents, avec deux entrees, deux sorties et deux
 * risques. Les faire tenir dans `ArchitectTurn` obligerait a rendre la moitie
 * des champs facultatifs des deux cotes, et la validation ne saurait plus quoi
 * exiger de qui.
 *
 * ## Ce que l'Architecte lit, et ce qu'il ne lit pas
 *
 * Il lit **la review enregistree en base** : la specification de la tache,
 * l'instantane Git immuable de TASK-011, les patches affichables, les resultats
 * de validation. Il ne lit ni le dossier de travail actuel, ni un `git diff`
 * recalcule, ni le compte rendu final de Claude Code — une declaration de
 * l'agent sur son propre travail n'est pas une preuve.
 *
 * ## Il recommande, il ne decide pas
 *
 * `APPROVE_RECOMMENDED` ne fait passer aucune tache en `COMPLETED`. Aucun
 * resultat de ce contrat ne change un statut : la seule chose qu'un verdict
 * puisse produire est un texte affiche, et — pour `CHANGES_RECOMMENDED` — un
 * feedback prerempli que l'utilisateur relira, modifiera et validera lui-meme.
 *
 * Aucune dependance a Prisma, Node ou React.
 */

import { createStatusGuard } from "./statuses.js";

/** Version du contrat de sortie, transmise et persistee. */
export const ARCHITECT_REVIEW_SCHEMA_VERSION = 1;

/**
 * Verdict d'une review Architecte.
 *
 * - `APPROVE_RECOMMENDED` : sur les informations que NOX a pu fournir,
 *   l'architecte n'a identifie aucun probleme necessitant une correction. Ce
 *   n'est **pas** « la tache est terminee » : le clic `Approve` reste humain.
 * - `CHANGES_RECOMMENDED` : un ou plusieurs changements precis devraient etre
 *   apportes avant approbation. Un feedback exploitable accompagne ce verdict.
 * - `HUMAN_REVIEW_REQUIRED` : les donnees disponibles ne permettent pas une
 *   recommandation sure. Le message doit dire **quelle information manque**.
 */
export const ARCHITECT_REVIEW_VERDICT = {
  APPROVE_RECOMMENDED: "APPROVE_RECOMMENDED",
  CHANGES_RECOMMENDED: "CHANGES_RECOMMENDED",
  HUMAN_REVIEW_REQUIRED: "HUMAN_REVIEW_REQUIRED",
} as const;

export type ArchitectReviewVerdict =
  (typeof ARCHITECT_REVIEW_VERDICT)[keyof typeof ARCHITECT_REVIEW_VERDICT];

export const ARCHITECT_REVIEW_VERDICTS: readonly ArchitectReviewVerdict[] =
  Object.values(ARCHITECT_REVIEW_VERDICT);

export const isArchitectReviewVerdict = createStatusGuard(ARCHITECT_REVIEW_VERDICTS);

/**
 * Gravite d'une observation.
 *
 * `NOTE` existe pour que l'architecte puisse dire quelque chose d'utile sans
 * reclamer une correction. Sans elle, toute remarque deviendrait une demande de
 * changement, et le verdict perdrait son sens.
 */
export const ARCHITECT_REVIEW_SEVERITY = {
  BLOCKER: "BLOCKER",
  MAJOR: "MAJOR",
  MINOR: "MINOR",
  NOTE: "NOTE",
} as const;

export type ArchitectReviewSeverity =
  (typeof ARCHITECT_REVIEW_SEVERITY)[keyof typeof ARCHITECT_REVIEW_SEVERITY];

export const ARCHITECT_REVIEW_SEVERITIES: readonly ArchitectReviewSeverity[] =
  Object.values(ARCHITECT_REVIEW_SEVERITY);

export const isArchitectReviewSeverity = createStatusGuard(ARCHITECT_REVIEW_SEVERITIES);

/** Etat d'une analyse enregistree. */
export const ARCHITECT_REVIEW_STATUS = {
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  REFUSED: "REFUSED",
  FAILED: "FAILED",
} as const;

export type ArchitectReviewStatus =
  (typeof ARCHITECT_REVIEW_STATUS)[keyof typeof ARCHITECT_REVIEW_STATUS];

export const ARCHITECT_REVIEW_STATUSES: readonly ArchitectReviewStatus[] =
  Object.values(ARCHITECT_REVIEW_STATUS);

export const isArchitectReviewStatus = createStatusGuard(ARCHITECT_REVIEW_STATUSES);

/**
 * Bornes de la review Architecte.
 *
 * **Independantes des bornes de stockage de TASK-011**, et volontairement plus
 * serrees. `REVIEW_LIMITS` protege SQLite et la page ; celles-ci decident de ce
 * qui quitte la machine et de ce qui est facture. Une review de 4 Mio est
 * parfaitement lisible en local et n'a aucune raison d'etre envoyee entiere.
 *
 * Des constantes, jamais des variables d'environnement : une limite qu'on peut
 * desserrer depuis un `.env` n'en est plus une.
 */
export const ARCHITECT_REVIEW_LIMITS = {
  /** Fichiers envoyes, dans l'ordre de la review. Au-dela, l'omission est dite. */
  files: 100,
  /** Patch d'un fichier, en caracteres. */
  patchPerFile: 131_072,
  /** Somme des patches envoyes, en caracteres. */
  patchTotal: 524_288,
  /** Somme des resumes de validation envoyes, en caracteres. */
  validationChars: 10_240,
  /** Resume rendu par l'architecte. */
  summary: 4_000,
  /** Titre d'une observation. */
  findingTitle: 200,
  /** Detail d'une observation. */
  findingDetail: 2_000,
  /** Observations rendues. */
  findings: 20,
  /**
   * Feedback suggere.
   *
   * Alignee sur `REVIEW_FEEDBACK_LIMITS.maxLength` de TASK-012 : ce texte est
   * destine a preremplir ce champ-la, et une borne plus large produirait un
   * feedback impossible a enregistrer.
   */
  feedback: 16_384,
  /**
   * Analyses d'une meme execution, echecs compris.
   *
   * Cinq : de quoi relire avec un autre modele ou apres un changement de prompt,
   * pas de quoi boucler par accident. Chaque analyse est un appel facture.
   */
  analyses: 5,
} as const;

/**
 * Numerotation des criteres d'acceptation dans le bundle.
 *
 * **1-based**, comme l'affichage : `AC1` designe le premier critere. Un index
 * 0-based obligerait a traduire dans les deux sens entre le modele et la page,
 * et la premiere erreur de traduction serait invisible.
 */
export const ARCHITECT_REVIEW_CRITERION_BASE = 1;

/** Etiquette stable d'un critere, telle qu'elle apparait dans le prompt. */
export function architectCriterionLabel(index: number): string {
  return `AC${String(index)}`;
}

// --- Sortie du modele --------------------------------------------------------

/**
 * Une observation de l'architecte.
 *
 * `filePath` et `acceptanceCriterionIndex` sont **verifies** : un chemin absent
 * de la review ou un critere hors plage font refuser la reponse entiere. Un
 * modele qui invente une reference invente aussi le probleme qu'il y rattache.
 */
export type ArchitectReviewFinding = {
  severity: ArchitectReviewSeverity;
  title: string;
  detail: string;
  /** Chemin exact d'un fichier de la review, ou `null`. */
  filePath: string | null;
  /** Numero **1-based** d'un critere d'acceptation, ou `null`. */
  acceptanceCriterionIndex: number | null;
};

export type ArchitectReviewOutput = {
  schemaVersion: typeof ARCHITECT_REVIEW_SCHEMA_VERSION;
  verdict: ArchitectReviewVerdict;
  summary: string;
  findings: ArchitectReviewFinding[];
  /** Feedback exploitable dans le workflow de TASK-012, ou `null`. */
  feedback: string | null;
};

/** Raison pour laquelle une reponse du fournisseur est refusee. */
export type ArchitectReviewRefusal = { field: string; message: string };

export type ArchitectReviewResult =
  | { ok: true; output: ArchitectReviewOutput }
  | { ok: false; refusal: ArchitectReviewRefusal };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function refuse(field: string, message: string): { ok: false; refusal: ArchitectReviewRefusal } {
  return { ok: false, refusal: { field, message } };
}

/** Normalise un texte rendu par le modele : fins de ligne `\n`, sans marges. */
function readText(value: unknown, max: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.replace(/\r\n?/gu, "\n").trim();
  if (text === "" || text.length > max) {
    return null;
  }
  return text;
}

/** Faits contre lesquels une reponse est verifiee. */
export type ArchitectReviewReferences = {
  /** Chemins exacts des fichiers reellement presents dans la review. */
  filePaths: readonly string[];
  /** Nombre de criteres d'acceptation de la tache. */
  criteriaCount: number;
};

/**
 * Valide une reponse du fournisseur.
 *
 * Ne fait **aucune** confiance au Structured Output : celui-ci garantit une
 * forme, pas des invariants NOX. Un chemin invente, un critere 99, vingt-et-une
 * observations, une approbation accompagnee d'un `BLOCKER` : chacune de ces
 * reponses respecte le schema tout en etant inacceptable.
 *
 * Les incoherences de verdict sont refusees plutot que corrigees. Une reponse
 * qui se contredit ne dit pas ce que le modele pensait ; la « reparer » serait
 * inventer une intention.
 */
export function readArchitectReviewOutput(
  value: unknown,
  references: ArchitectReviewReferences,
): ArchitectReviewResult {
  if (!isRecord(value)) {
    return refuse("output", "La reponse de l'architecte n'est pas une structure lisible.");
  }

  if (value["schemaVersion"] !== ARCHITECT_REVIEW_SCHEMA_VERSION) {
    return refuse(
      "schemaVersion",
      "La reponse de l'architecte ne suit pas la version de contrat attendue.",
    );
  }

  const verdict: unknown = value["verdict"];
  if (!isArchitectReviewVerdict(verdict)) {
    return refuse("verdict", "L'architecte a rendu un verdict inconnu.");
  }

  const summary = readText(value["summary"], ARCHITECT_REVIEW_LIMITS.summary);
  if (summary === null) {
    return refuse("summary", "Le resume rendu par l'architecte est vide ou trop long.");
  }

  const rawFindings: unknown = value["findings"];
  if (rawFindings !== null && rawFindings !== undefined && !Array.isArray(rawFindings)) {
    return refuse("findings", "Les observations rendues par l'architecte sont illisibles.");
  }
  const entries: unknown[] = Array.isArray(rawFindings) ? rawFindings : [];
  if (entries.length > ARCHITECT_REVIEW_LIMITS.findings) {
    return refuse(
      "findings",
      `L'architecte a rendu plus de ${String(ARCHITECT_REVIEW_LIMITS.findings)} observations.`,
    );
  }

  const findings: ArchitectReviewFinding[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) {
      return refuse("findings", "Une observation rendue par l'architecte est illisible.");
    }

    const severity: unknown = entry["severity"];
    if (!isArchitectReviewSeverity(severity)) {
      return refuse("findings", "Une observation porte une gravite inconnue.");
    }

    const title = readText(entry["title"], ARCHITECT_REVIEW_LIMITS.findingTitle);
    if (title === null) {
      return refuse("findings", "Une observation est sans titre, ou son titre est trop long.");
    }

    const detail = readText(entry["detail"], ARCHITECT_REVIEW_LIMITS.findingDetail);
    if (detail === null) {
      return refuse("findings", `« ${title} » est sans detail, ou son detail est trop long.`);
    }

    const rawPath: unknown = entry["filePath"];
    let filePath: string | null = null;
    if (typeof rawPath === "string" && rawPath.trim() !== "") {
      filePath = rawPath.trim();
      if (!references.filePaths.includes(filePath)) {
        return refuse(
          "findings",
          `« ${filePath} » ne fait pas partie des fichiers de cette review : l'architecte ne peut pas en inventer.`,
        );
      }
    } else if (rawPath !== null && rawPath !== undefined && typeof rawPath !== "string") {
      return refuse("findings", "Une observation designe un fichier illisible.");
    }

    const rawIndex: unknown = entry["acceptanceCriterionIndex"];
    let criterionIndex: number | null = null;
    if (typeof rawIndex === "number") {
      if (!Number.isInteger(rawIndex)) {
        return refuse("findings", "Une observation designe un critere qui n'est pas un entier.");
      }
      // Le contrat est 1-based. Zero designerait « le critere avant le premier ».
      if (
        rawIndex < ARCHITECT_REVIEW_CRITERION_BASE ||
        rawIndex > references.criteriaCount - 1 + ARCHITECT_REVIEW_CRITERION_BASE
      ) {
        return refuse(
          "findings",
          `Le critere ${architectCriterionLabel(rawIndex)} n'existe pas dans cette tache.`,
        );
      }
      criterionIndex = rawIndex;
    } else if (rawIndex !== null && rawIndex !== undefined) {
      return refuse("findings", "Une observation designe un critere illisible.");
    }

    findings.push({ severity, title, detail, filePath, acceptanceCriterionIndex: criterionIndex });
  }

  const rawFeedback: unknown = value["feedback"];
  let feedback: string | null = null;
  if (typeof rawFeedback === "string" && rawFeedback.trim() !== "") {
    feedback = readText(rawFeedback, ARCHITECT_REVIEW_LIMITS.feedback);
    if (feedback === null) {
      return refuse("feedback", "Le feedback suggere depasse la taille acceptee par NOX.");
    }
  } else if (rawFeedback !== null && rawFeedback !== undefined && typeof rawFeedback !== "string") {
    return refuse("feedback", "Le feedback suggere est illisible.");
  }

  if (verdict === ARCHITECT_REVIEW_VERDICT.CHANGES_RECOMMENDED && feedback === null) {
    return refuse(
      "feedback",
      "L'architecte recommande des corrections sans dire lesquelles : aucun feedback exploitable n'a ete rendu.",
    );
  }

  if (verdict === ARCHITECT_REVIEW_VERDICT.APPROVE_RECOMMENDED) {
    const blocking = findings.find(
      (finding) => finding.severity === ARCHITECT_REVIEW_SEVERITY.BLOCKER,
    );
    if (blocking !== undefined) {
      return refuse(
        "verdict",
        `L'architecte recommande l'approbation tout en signalant un probleme bloquant : « ${blocking.title} ».`,
      );
    }
  }

  return {
    ok: true,
    output: {
      schemaVersion: ARCHITECT_REVIEW_SCHEMA_VERSION,
      verdict,
      summary,
      findings,
      // Une approbation n'a rien a corriger : un feedback l'accompagnant serait
      // contradictoire, et il est ecarte plutot qu'affiche.
      feedback: verdict === ARCHITECT_REVIEW_VERDICT.APPROVE_RECOMMENDED ? null : feedback,
    },
  };
}

// --- Schema strict -----------------------------------------------------------

/** Nom du format transmis au fournisseur ; doit rester stable. */
export const ARCHITECT_REVIEW_SCHEMA_NAME = "nox_architect_run_review";

/**
 * Schema JSON strict transmis au fournisseur.
 *
 * Comme celui d'une conversation, il ne porte **aucune borne de taille** : le
 * sous-ensemble accepte en mode strict ignore `maxItems`, `maxLength` et
 * `pattern`, et les declarer ferait echouer la requete entiere. Les bornes
 * vivent dans les instructions du prompt et dans `readArchitectReviewOutput`.
 */
export function buildArchitectReviewSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "verdict", "summary", "findings", "feedback"],
    properties: {
      schemaVersion: { type: "integer", enum: [ARCHITECT_REVIEW_SCHEMA_VERSION] },
      verdict: { type: "string", enum: [...ARCHITECT_REVIEW_VERDICTS] },
      summary: {
        type: "string",
        description:
          "Ce que cette execution a produit, evalue contre la tache. Ecrit pour etre lu par un humain.",
      },
      findings: {
        type: "array",
        description: `Observations precises, au plus ${String(ARCHITECT_REVIEW_LIMITS.findings)}.`,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["severity", "title", "detail", "filePath", "acceptanceCriterionIndex"],
          properties: {
            severity: { type: "string", enum: [...ARCHITECT_REVIEW_SEVERITIES] },
            title: { type: "string", description: "Une ligne, sans ponctuation finale." },
            detail: { type: "string", description: "Le fait observe, et pourquoi il compte." },
            filePath: {
              type: ["string", "null"],
              description: "Chemin exact d'un fichier liste dans la review, ou null.",
            },
            acceptanceCriterionIndex: {
              type: ["integer", "null"],
              description: "Numero du critere concerne, tel qu'il est etiquete AC1, AC2…, ou null.",
            },
          },
        },
      },
      feedback: {
        type: ["string", "null"],
        description:
          "Texte de correction adresse a l'implementeur, uniquement si le verdict est CHANGES_RECOMMENDED.",
      },
    },
  };
}

// --- Garde NOX ---------------------------------------------------------------

/**
 * Raison pour laquelle NOX refuse une recommandation d'approbation.
 *
 * Chaque valeur decrit un **fait de la review**, jamais une opinion. C'est ce
 * qui permet de l'afficher : « le run modifie un fichier binaire » se verifie,
 * « l'analyse semble incertaine » ne se verifie pas.
 */
export const ARCHITECT_REVIEW_BLOCKER = {
  RUN_NOT_COMPLETED: "RUN_NOT_COMPLETED",
  REVIEW_UNRELIABLE: "REVIEW_UNRELIABLE",
  REVIEW_ERROR: "REVIEW_ERROR",
  SENSITIVE_FILE: "SENSITIVE_FILE",
  BINARY_FILE: "BINARY_FILE",
  TRUNCATED_PATCH: "TRUNCATED_PATCH",
  OMITTED_FILES: "OMITTED_FILES",
  ARCHITECT_TRUNCATED: "ARCHITECT_TRUNCATED",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  VALIDATION_UNKNOWN: "VALIDATION_UNKNOWN",
  VALIDATION_NOT_RUN: "VALIDATION_NOT_RUN",
} as const;

export type ArchitectReviewBlocker =
  (typeof ARCHITECT_REVIEW_BLOCKER)[keyof typeof ARCHITECT_REVIEW_BLOCKER];

export const ARCHITECT_REVIEW_BLOCKERS: readonly ArchitectReviewBlocker[] =
  Object.values(ARCHITECT_REVIEW_BLOCKER);

export const isArchitectReviewBlocker = createStatusGuard(ARCHITECT_REVIEW_BLOCKERS);

/**
 * Faits de la review qui decident si une approbation est defendable.
 *
 * Tous sont derives de l'instantane enregistre, jamais du texte du modele. Un
 * verdict ne peut donc pas se justifier lui-meme.
 */
export type ArchitectReviewFacts = {
  /** Vrai uniquement pour un run `COMPLETED`. */
  runCompleted: boolean;
  /** Etat Git modifie d'une facon interdite pendant l'execution. */
  unreliable: boolean;
  /** La capture de review a echoue. */
  reviewFailed: boolean;
  sensitiveFiles: number;
  binaryFiles: number;
  /** Patches coupes par les bornes de stockage de TASK-011. */
  truncatedPatches: number;
  /** Fichiers changes mais absents de la review enregistree. */
  omittedFiles: number;
  /** La review contient plus d'informations que le bundle n'en a envoyees. */
  architectTruncated: boolean;
  validationFailed: boolean;
  validationUnknown: boolean;
  /**
   * Une commande attendue n'a jamais tourne.
   *
   * Distinct de `validationFailed` : « pas lancee » et « echouee » sont deux
   * faits differents, et NOX ne transforme jamais l'un en l'autre. Une tache
   * **sans** commande de validation ne produit ni l'un ni l'autre.
   */
  validationNotRun: boolean;
};

export type ArchitectReviewGuardResult = {
  /** Verdict rendu par le modele, conserve tel quel. */
  providerVerdict: ArchitectReviewVerdict;
  /** Verdict que NOX affiche et persiste. */
  finalVerdict: ArchitectReviewVerdict;
  /** Faits qui interdisent une recommandation d'approbation. */
  blockers: ArchitectReviewBlocker[];
};

/**
 * Recense les faits qui interdisent une recommandation d'approbation.
 *
 * L'absence de commande de validation n'en fait **pas** partie. Une tache peut
 * legitimement n'en declarer aucune ; transformer ce choix en echec fictif
 * apprendrait a l'utilisateur a ignorer le verdict.
 */
export function architectReviewBlockers(facts: ArchitectReviewFacts): ArchitectReviewBlocker[] {
  const blockers: ArchitectReviewBlocker[] = [];

  if (!facts.runCompleted) blockers.push(ARCHITECT_REVIEW_BLOCKER.RUN_NOT_COMPLETED);
  if (facts.unreliable) blockers.push(ARCHITECT_REVIEW_BLOCKER.REVIEW_UNRELIABLE);
  if (facts.reviewFailed) blockers.push(ARCHITECT_REVIEW_BLOCKER.REVIEW_ERROR);
  if (facts.sensitiveFiles > 0) blockers.push(ARCHITECT_REVIEW_BLOCKER.SENSITIVE_FILE);
  if (facts.binaryFiles > 0) blockers.push(ARCHITECT_REVIEW_BLOCKER.BINARY_FILE);
  if (facts.truncatedPatches > 0) blockers.push(ARCHITECT_REVIEW_BLOCKER.TRUNCATED_PATCH);
  if (facts.omittedFiles > 0) blockers.push(ARCHITECT_REVIEW_BLOCKER.OMITTED_FILES);
  if (facts.architectTruncated) blockers.push(ARCHITECT_REVIEW_BLOCKER.ARCHITECT_TRUNCATED);
  if (facts.validationFailed) blockers.push(ARCHITECT_REVIEW_BLOCKER.VALIDATION_FAILED);
  if (facts.validationUnknown) blockers.push(ARCHITECT_REVIEW_BLOCKER.VALIDATION_UNKNOWN);
  if (facts.validationNotRun) blockers.push(ARCHITECT_REVIEW_BLOCKER.VALIDATION_NOT_RUN);

  return blockers;
}

/**
 * Applique la garde NOX au verdict du modele.
 *
 * ## Les deux verdicts sont conserves
 *
 * `providerVerdict` dit ce que le modele a propose ; `finalVerdict` ce que NOX
 * retient. Ecraser le premier reecrirait l'histoire — six mois plus tard, on ne
 * saurait plus si l'architecte s'etait trompe ou si NOX l'avait corrige.
 *
 * ## La regle
 *
 * Un fait bloquant ne transforme jamais un `CHANGES_RECOMMENDED` : le modele a
 * vu un defaut certain dans la partie visible, et ce defaut ne disparait pas
 * parce qu'une autre partie manquait. Seule une **approbation** est degradee,
 * vers le minimum sur : `HUMAN_REVIEW_REQUIRED`.
 */
export function guardArchitectReviewVerdict(
  providerVerdict: ArchitectReviewVerdict,
  facts: ArchitectReviewFacts,
): ArchitectReviewGuardResult {
  const blockers = architectReviewBlockers(facts);
  const degraded =
    blockers.length > 0 && providerVerdict === ARCHITECT_REVIEW_VERDICT.APPROVE_RECOMMENDED;

  return {
    providerVerdict,
    finalVerdict: degraded ? ARCHITECT_REVIEW_VERDICT.HUMAN_REVIEW_REQUIRED : providerVerdict,
    blockers,
  };
}

// --- Manifest ----------------------------------------------------------------

/**
 * Description de ce qui a ete envoye pour une analyse.
 *
 * Il ne recopie **pas** les patches : ils existent deja dans `RunFileChange`, et
 * une seconde copie vieillirait mal tout en doublant la taille de la base. Ce
 * manifest repond a une autre question — « avec combien, et complet ou non ? ».
 */
export type ArchitectReviewManifest = {
  schemaVersion: typeof ARCHITECT_REVIEW_SCHEMA_VERSION;
  runId: string;
  runCode: string;
  /** Empreinte de la specification de la tache au moment de l'analyse. */
  taskRevision: string;
  /** Date de capture de la review analysee. */
  reviewCapturedAt: string;
  fileCountAvailable: number;
  fileCountIncluded: number;
  patchCharsIncluded: number;
  /** Vrai des que le bundle contient moins que la review enregistree. */
  truncated: boolean;
  validationCount: number;
};

function isCount(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Verifie qu'un manifest relu en base est encore exploitable. */
export function isArchitectReviewManifest(value: unknown): value is ArchitectReviewManifest {
  return (
    isRecord(value) &&
    value["schemaVersion"] === ARCHITECT_REVIEW_SCHEMA_VERSION &&
    typeof value["runId"] === "string" &&
    typeof value["runCode"] === "string" &&
    typeof value["taskRevision"] === "string" &&
    typeof value["reviewCapturedAt"] === "string" &&
    isCount(value["fileCountAvailable"]) &&
    isCount(value["fileCountIncluded"]) &&
    isCount(value["patchCharsIncluded"]) &&
    typeof value["truncated"] === "boolean" &&
    isCount(value["validationCount"])
  );
}
