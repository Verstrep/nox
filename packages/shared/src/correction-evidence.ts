/**
 * Rendu des preuves d'echec transmises a une correction.
 *
 * ## Pourquoi ce texte existe
 *
 * Parce que NOX possede deja tout ce que l'utilisateur allait recopier a la
 * main : le critere qui a echoue, la commande qui le prouvait, son code de
 * sortie, ses sorties. Lui demander de relire les logs, d'en extraire l'erreur
 * et de l'expliquer a Claude Code serait lui faire refaire un travail deja
 * fait — et le faire moins bien, parce qu'un resume perd le detail.
 *
 * ## Ce module est pur
 *
 * Il recoit des faits deja lus en base et rend du texte. Il ne lit rien, ne
 * decide rien, et ne peut donc pas devenir un second endroit ou l'on decide
 * qu'une commande a echoue.
 *
 * ## Ce qui n'entre jamais ici
 *
 * Aucun chemin absolu, aucun jeton, aucune variable d'environnement, aucun
 * contenu de fichier, aucun diff. Les sorties de commandes arrivent deja
 * bornees par le runner ; elles sont **rebornees** ici pour le budget du
 * prompt, et toute coupe est annoncee.
 */

import {
  CORRECTION_EVIDENCE_LIMITS,
  CORRECTION_TRUNCATION_NOTICE,
  type CorrectionSource,
} from "./correction-cycle.js";
import {
  AUTONOMOUS_VALIDATION_STATUS,
  VERIFICATION_MODE,
  type AutonomousValidationStatus,
  type VerificationMode,
} from "./verification.js";

/** Ce qu'une commande executee par NOX a rendu. */
export type CorrectionCommandEvidence = {
  command: string;
  status: AutonomousValidationStatus;
  exitCode: number | null;
  durationMs: number | null;
  stdout: string | null;
  /** Le runner avait deja coupe cette sortie. */
  stdoutTruncated: boolean;
  stderr: string | null;
  stderrTruncated: boolean;
};

/** Un critere du contrat, avec ce que le lot en a dit. */
export type CorrectionCriterionEvidence = {
  text: string;
  verificationMode: VerificationMode;
  /** Commandes qui devaient le prouver, dans l'ordre de la tache. */
  commands: readonly CorrectionCommandEvidence[];
};

/**
 * Ce que NOX a observe de la terminaison, quand c'est elle qui motive la reprise.
 *
 * Rien de plus que ce que la base porte : une categorie, une phrase ecrite par
 * NOX, un code de sortie, la queue de la sortie d'erreur, et la derniere action
 * reconnue. Aucun de ces champs ne vient d'une interpretation — c'est
 * exactement ce que l'ecran affiche, transmis a l'agent qui doit reprendre.
 */
export type ProcessFailureEvidence = {
  /** Valeur de `RunFailureCategory`, deja resolue par l'appelant. */
  category: string;
  /** Phrase ecrite par NOX. `null` pour une execution anterieure a HOTFIX-006. */
  detail: string | null;
  exitCode: number | null;
  /** Queue de la sortie d'erreur, deja bornee a la capture. */
  stderrTail: string | null;
  /**
   * Dernieres actions reconnues avant l'arret, de la plus ancienne a la plus
   * recente.
   *
   * Derivees des evenements deja enregistres, jamais d'un champ denormalise :
   * un compteur de « derniere action » finirait par diverger des lignes qu'il
   * pretend resumer.
   */
  lastActivity: readonly string[];
};

/** Tout ce qu'une correction recoit, deja relu en base. */
export type CorrectionEvidence = {
  source: CorrectionSource;
  /** Rang de la correction automatique, ou `0` pour une demande humaine. */
  automatedAttempt: number;
  maxAutomatedAttempts: number;
  /** Criteres automatises en echec, dans l'ordre du contrat. */
  failedCriteria: readonly CorrectionCriterionEvidence[];
  /** Criteres humains que la review signale, lorsqu'un humain les a designes. */
  humanCriteria: readonly { text: string; instructions: string | null }[];
  /** Une validation autonome a modifie des fichiers suivis par Git. */
  repositoryMutated: boolean;
  /** Fichiers suivis concernes, lorsque NOX a pu les nommer. */
  mutatedFiles: readonly string[];
  /** Texte ecrit par l'utilisateur, ou `null` lorsqu'il n'en a pas ecrit. */
  humanFeedback: string | null;
  /**
   * Diagnostic de la terminaison, pour une reprise apres echec du processus.
   *
   * `null` pour les deux autres origines : rien n'a cede, l'execution s'est
   * terminee normalement et c'est son **resultat** qui est en cause.
   */
  processFailure?: ProcessFailureEvidence | null;
};

/** Ramene une valeur a une seule ligne, sans marges. */
function line(value: string): string {
  return value.replace(/\r\n?/gu, "\n").replace(/\s+/gu, " ").trim();
}

/**
 * Borne un flux, et **annonce** la coupe.
 *
 * Deux troncatures peuvent se cumuler : celle du runner, deja subie, et celle
 * du budget de prompt. Les deux sont dites, parce qu'une sortie coupee sans le
 * dire ferait chercher a Claude Code une erreur qui n'y est plus.
 */
function stream(
  label: string,
  value: string | null,
  alreadyTruncated: boolean,
  limit: number,
): string[] {
  const text = (value ?? "").replace(/\r\n?/gu, "\n").trimEnd();
  if (text === "" && !alreadyTruncated) {
    return [`${label} : (vide)`];
  }

  const kept = text.length > limit ? text.slice(0, limit) : text;
  const notices: string[] = [];
  if (alreadyTruncated) {
    notices.push("sortie deja tronquee a la capture");
  }
  if (text.length > limit) {
    notices.push(CORRECTION_TRUNCATION_NOTICE);
  }

  const suffix = notices.length === 0 ? "" : ` (${notices.join(" ; ")})`;
  return [`${label}${suffix} :`, kept];
}

function statusLabel(status: AutonomousValidationStatus): string {
  switch (status) {
    case AUTONOMOUS_VALIDATION_STATUS.PASSED:
      return "reussie";
    case AUTONOMOUS_VALIDATION_STATUS.FAILED:
      return "en echec";
    case AUTONOMOUS_VALIDATION_STATUS.TIMED_OUT:
      return "arretee par le delai";
    case AUTONOMOUS_VALIDATION_STATUS.ERROR:
      return "non executee";
  }
}

function commandBlock(evidence: CorrectionCommandEvidence, limit: number): string[] {
  const facts = [`commande : ${evidence.command}`, `resultat : ${statusLabel(evidence.status)}`];
  if (evidence.exitCode !== null) {
    facts.push(`code de sortie : ${String(evidence.exitCode)}`);
  }
  if (evidence.durationMs !== null) {
    facts.push(`duree : ${String(Math.round(evidence.durationMs / 1000))} s`);
  }
  return [
    ...facts,
    ...stream("stdout", evidence.stdout, evidence.stdoutTruncated, limit),
    ...stream("stderr", evidence.stderr, evidence.stderrTruncated, limit),
  ];
}

/**
 * Rend la section de preuves d'une correction.
 *
 * ## L'ordre est une priorite, pas une mise en page
 *
 * Ce qui a echoue vient avant ce qui l'a produit, et le detail des sorties
 * vient en dernier. Quand le budget se ferme, c'est donc le detail qui tombe,
 * jamais le critere : Claude Code doit savoir **quoi** satisfaire meme s'il ne
 * voit pas toute la sortie.
 */
export function renderCorrectionEvidence(evidence: CorrectionEvidence): string {
  const blocks: string[] = [];

  if (evidence.source === "AUTOMATED_VALIDATION") {
    blocks.push(
      [
        "Origine de cette correction :",
        `validation autonome de NOX, tentative ${String(evidence.automatedAttempt)} sur ` +
          `${String(evidence.maxAutomatedAttempts)}. Personne n'a relu ce travail : ce sont les ` +
          "commandes que NOX a executees lui-meme, apres ton travail, qui ont echoue.",
      ].join("\n"),
    );
  } else if (evidence.source === "PROCESS_FAILURE") {
    blocks.push(
      [
        "Origine de cette correction :",
        "l'execution precedente s'est arretee avant d'avoir fini. Personne n'a relu ton " +
          "travail, et rien ne lui est reproche : il est inacheve. Le dossier de travail " +
          "porte encore exactement ce que tu y avais ecrit — NOX n'a rien commite, rien " +
          "restaure, rien supprime.",
      ].join("\n"),
    );
  } else {
    blocks.push(
      [
        "Origine de cette correction :",
        "demande humaine apres relecture." +
          (evidence.failedCriteria.length > 0
            ? " Les preuves automatisees ci-dessous ont egalement echoue."
            : ""),
      ].join("\n"),
    );
  }

  const failure = evidence.processFailure ?? null;
  if (failure !== null) {
    const parts: string[] = ["Ce que NOX a observe de l'arret :"];
    parts.push(`categorie : ${failure.category}`);
    if (failure.detail !== null && line(failure.detail) !== "") {
      parts.push(`constat : ${line(failure.detail)}`);
    }
    parts.push(
      failure.exitCode === null
        ? "code de sortie : aucun (processus termine par un signal)."
        : `code de sortie : ${String(failure.exitCode)}`,
    );
    if (failure.lastActivity.length > 0) {
      parts.push("dernieres actions reconnues par NOX, dans l'ordre :");
      for (const entry of failure.lastActivity) {
        parts.push(`- ${line(entry)}`);
      }
    }
    parts.push(
      ...stream("sortie d'erreur du processus", failure.stderrTail, false, CORRECTION_EVIDENCE_LIMITS.perStream),
    );
    parts.push(
      "NOX ne sait pas toujours quelle commande a echoue : le protocole de Claude Code " +
        "n'expose pas systematiquement la ligne ni son code de retour. Commence par relire " +
        "l'etat reel du dossier de travail plutot que par croire ce resume.",
    );
    blocks.push(parts.join("\n"));
  }

  if (evidence.failedCriteria.length > 0) {
    const parts: string[] = [
      "Criteres d'acceptation non prouves, avec ce que NOX a constate :",
    ];
    for (const [index, criterion] of evidence.failedCriteria.entries()) {
      parts.push(`${String(index + 1)}. ${line(criterion.text)}`);
      for (const command of criterion.commands) {
        parts.push(
          ...commandBlock(command, CORRECTION_EVIDENCE_LIMITS.perStream).map(
            (entry) => `   ${entry}`,
          ),
        );
      }
    }
    blocks.push(parts.join("\n"));
  }

  if (evidence.humanCriteria.length > 0) {
    const parts: string[] = ["Criteres humains signales par la relecture :"];
    for (const criterion of evidence.humanCriteria) {
      parts.push(`- ${line(criterion.text)}`);
      if (criterion.instructions !== null && line(criterion.instructions) !== "") {
        parts.push(`  ce qu'il fallait obtenir : ${line(criterion.instructions)}`);
      }
    }
    blocks.push(parts.join("\n"));
  }

  if (evidence.repositoryMutated) {
    const files = evidence.mutatedFiles.slice(0, CORRECTION_EVIDENCE_LIMITS.mutatedFiles);
    const parts: string[] = [
      "Modification du repository par la validation :",
      "une commande de validation a modifie des fichiers suivis par Git pendant qu'elle " +
        "verifiait le travail. Une preuve qui modifie ce qu'elle evalue ne prouve plus rien.",
    ];
    if (files.length > 0) {
      parts.push("fichiers suivis concernes :");
      for (const file of files) {
        parts.push(`- ${file}`);
      }
      if (evidence.mutatedFiles.length > files.length) {
        parts.push(
          `- ${String(evidence.mutatedFiles.length - files.length)} autre(s) fichier(s) non listes.`,
        );
      }
    }
    parts.push(
      "Fais en sorte que la validation n'altere plus involontairement des fichiers suivis. " +
        "Ne restaure rien toi-meme : NOX ne remet jamais un repository en etat a ta place.",
    );
    blocks.push(parts.join("\n"));
  }

  return blocks.join("\n\n");
}

/**
 * Rappelle le contrat gele, en une forme compacte.
 *
 * La session reprise le connait deja ; il est recopie parce qu'une correction
 * doit rester **auditable seule**. Six mois plus tard, relire le prompt d'une
 * correction sans avoir a reconstituer l'etat de la tache a l'epoque est ce qui
 * fait la difference entre une trace et un souvenir.
 */
export function renderFrozenContract(
  criteria: readonly { text: string; verificationMode: VerificationMode }[],
  commands: readonly string[],
): string {
  const parts: string[] = ["Contrat de la tache, inchange :"];
  for (const criterion of criteria) {
    const badge =
      criterion.verificationMode === VERIFICATION_MODE.AUTOMATED
        ? "verifie par commande"
        : "verifie par un humain";
    parts.push(`- ${line(criterion.text)} (${badge})`);
  }
  if (commands.length > 0) {
    parts.push("Commandes de validation enregistrees :");
    for (const command of commands) {
      parts.push(`- ${command}`);
    }
  }
  return parts.join("\n");
}
