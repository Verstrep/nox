/**
 * Projections de la page d'inspection d'une execution.
 *
 * ## D'ou vient ce module
 *
 * Du premier pilote reel. `TASK-001` de TripKit s'est terminee sur
 * `VALIDATION_SPAWN_FAILED`, et Inspect Run ne portait alors que le prompt et
 * deux empreintes. Comprendre ce qui s'etait passe a demande de reproduire
 * `spawn("npm")` a la main dans un terminal, pour retrouver un `ENOENT` que NOX
 * connaissait deja et n'affichait nulle part.
 *
 * Inspect Run devient donc la surface qui repond a « qu'est-ce que NOX a
 * observe, techniquement ». Pas « qu'est-ce qu'il y a dans NOX » : la nuance
 * decide de tout ce qui suit.
 *
 * ## Ce que ce module ne fait pas
 *
 * Il est **pur**. Il ne lit ni base, ni disque, ni runner, n'appelle aucun
 * fournisseur, ne relance aucune commande et ne calcule aucune donnee absente.
 * Tout ce qu'il projette a deja ete persiste par le pipeline d'execution ; une
 * information qui n'a pas ete enregistree n'est pas devinee, elle est dite
 * absente.
 *
 * ## Ce qui n'y entre jamais
 *
 * Aucune valeur d'environnement, aucune cle, aucun jeton, aucun en-tete, aucune
 * trace d'exception. La garantie ne repose pas sur un filtre : ces valeurs ne
 * sont dans aucun des types d'entree ci-dessous, donc elles n'ont aucun chemin
 * vers le rendu. Les diagnostics de panne affiches sont ceux que le runner
 * ecrit lui-meme a partir du seul code systeme — jamais le message de Node, qui
 * porte le chemin absolu de l'executable.
 */

import type {
  AutonomousValidationBatchRow,
  AutonomousValidationResultRow,
} from "@nox/database";
import {
  AUTONOMOUS_VALIDATION_STATUS,
  RUN_VALIDATION_STATUS,
  type RunValidationResultView,
  type RunValidationStatus,
  type ValidationBatchStatus,
} from "@nox/shared";

/**
 * Un fait technique, tel qu'il s'affiche.
 *
 * `value` a `null` signifie « NOX ne l'a pas enregistre ». C'est une reponse, et
 * elle vaut mieux qu'une case vide : sur une page de diagnostic, savoir qu'une
 * information manque oriente autant que l'information elle-meme.
 */
export type InspectFact = {
  label: string;
  value: string | null;
  /** Vrai pour les identifiants, empreintes et codes : ils se comparent a l'oeil. */
  mono: boolean;
};

/** Valeur affichee quand rien n'a ete enregistre. */
export const UNRECORDED = "Non enregistré";

function fact(label: string, value: string | null, mono = false): InspectFact {
  return { label, value, mono };
}

/**
 * Entrees du resume d'execution.
 *
 * Volontairement un type a plat plutot que `DevelopmentRunDetail` : ce module
 * doit pouvoir etre teste sans construire une execution entiere, et surtout,
 * enumerer les champs ici **est** la liste blanche. Un champ ajoute plus tard a
 * l'execution n'apparaitra pas tout seul sur cette page.
 */
export type ExecutionFactsInput = {
  runCode: string;
  taskCode: string;
  taskTitle: string;
  /** Le nom du projet : le repository logique, jamais son chemin sur la machine. */
  projectName: string;
  status: string;
  kind: string;
  branch: string | null;
  headBefore: string | null;
  headAfter: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** Duree rapportee par Claude Code, en millisecondes. */
  durationMs: number | null;
  durationApiMs: number | null;
  numTurns: number | null;
  exitCode: number | null;
  reportedCostUsd: number | null;
  sessionId: string | null;
  errorCode: string | null;
};

/**
 * Le diagnostic de terminaison, ligne a ligne.
 *
 * ## Pourquoi il ne se melange pas au resume d'execution
 *
 * Parce qu'il ne repond pas a la meme question. Le resume dit « ce que
 * l'execution a rapporte » ; celui-ci dit « ce qui a cede ». Les fondre ferait
 * disparaitre le second dans le premier, ce qui est exactement le probleme que
 * le pilote reel a rencontre : `errorCode` etait bien affiche, au milieu de
 * dix-sept autres lignes, et il ne disait rien d'actionnable.
 *
 * ## Rien n'y est deduit
 *
 * Chaque valeur est soit enregistree, soit derivee de valeurs enregistrees par
 * une table explicite. Quand une information n'a pas ete observee, la ligne le
 * **dit** — « non expose par le protocole » n'est pas la meme reponse que « non
 * enregistre », et un utilisateur qui cherche une commande fautive doit pouvoir
 * les distinguer.
 */
export type FailureFactsInput = {
  /** Libelle deja traduit de la categorie. */
  categoryLabel: string;
  /** Phrase ecrite par NOX, ou `null` pour une execution anterieure. */
  detail: string | null;
  errorCode: string | null;
  exitCode: number | null;
  /** Vrai lorsque la categorie a ete lue en base plutot que derivee. */
  categoryPersisted: boolean;
  /** Nombre de fichiers que la review a vus changer. */
  changedFiles: number;
  /** Une queue de sortie d'erreur a-t-elle ete conservee ? */
  hasStderr: boolean;
};

/** Valeur affichee quand le protocole de Claude Code n'expose pas la donnee. */
export const NOT_EXPOSED = "Non exposé par le protocole";

/**
 * Le diagnostic d'un echec, tel qu'Inspect l'affiche.
 *
 * Enumerer les champs ici **est** la liste blanche, comme pour le resume
 * d'execution : rien n'apparait sur cette page sans avoir ete nomme dans cette
 * fonction.
 */
export function failureFacts(input: FailureFactsInput): InspectFact[] {
  return [
    fact("Cause observée", input.categoryLabel),
    fact("Constat de NOX", input.detail),
    fact("Code du contrat runner", input.errorCode, true),
    // `null` et `0` ne disent pas la meme chose : un processus tue par un signal
    // ne rend aucun code, et l'afficher comme « 0 » en ferait une reussite.
    fact(
      "Code de sortie du processus",
      input.exitCode === null ? "Aucun — terminé par un signal" : String(input.exitCode),
      true,
    ),
    // Une execution d'avant HOTFIX-006 n'a pas de categorie en base. Le dire
    // evite de faire croire que le runner de l'epoque l'avait observee.
    fact(
      "Origine de la cause",
      input.categoryPersisted
        ? "Enregistrée par le runner à la conclusion"
        : "Dérivée du code d'erreur et du code de sortie enregistrés",
    ),
    fact("Fichiers laissés modifiés", String(input.changedFiles)),
    fact(
      "Sortie d'erreur conservée",
      input.hasStderr ? "Oui, fin de flux uniquement" : "Aucune",
    ),
  ];
}

/**
 * Le resume d'execution, ligne a ligne.
 *
 * Les formats sont injectes parce qu'ils vivent deja dans `run-display.ts` :
 * une duree et un cout ne se formatent pas deux fois dans NOX, sans quoi la
 * page d'une execution et son inspection afficheraient deux valeurs pour le
 * meme nombre.
 */
export function executionFacts(
  input: ExecutionFactsInput,
  format: {
    duration: (ms: number | null) => string | null;
    cost: (value: number | null) => string | null;
    sha: (value: string | null) => string | null;
    dateTime: (value: string) => string | null;
  },
): InspectFact[] {
  const startedAt = input.startedAt === null ? null : format.dateTime(input.startedAt);
  const finishedAt = input.finishedAt === null ? null : format.dateTime(input.finishedAt);

  return [
    fact("Run", input.runCode, true),
    fact("Task", `${input.taskCode} — ${input.taskTitle}`),
    // Le nom du projet, et non `repositoryPath` : un chemin absolu nomme un
    // disque, un utilisateur et une organisation de machine, et n'apprend rien
    // ici que le nom du projet ne dise deja.
    fact("Repository", input.projectName),
    fact("Statut", input.status),
    fact("Nature", input.kind),
    fact("Branche", input.branch, true),
    fact("HEAD avant", format.sha(input.headBefore), true),
    // Doit etre identique a `HEAD avant` : Claude Code ne commite pas. Les deux
    // lignes sont affichees separement pour que la difference, si elle
    // survenait, se voie.
    fact("HEAD après", format.sha(input.headAfter), true),
    fact("Démarrée", startedAt),
    fact("Terminée", finishedAt),
    fact("Durée", format.duration(input.durationMs)),
    fact("Dont API", format.duration(input.durationApiMs)),
    fact("Tours", input.numTurns === null ? null : String(input.numTurns)),
    fact("Code de sortie", input.exitCode === null ? null : String(input.exitCode), true),
    // Jamais estime : `null` veut dire que Claude Code ne l'a pas fourni.
    fact("Coût rapporté", format.cost(input.reportedCostUsd), true),
    fact("Session Claude", input.sessionId, true),
    fact("Code d'erreur", input.errorCode, true),
  ];
}

/**
 * Une tentative de validation autonome, telle qu'elle s'inspecte.
 *
 * Les resultats gardent le type de la couche de donnees : Inspect les rend avec
 * le meme composant que la review, et une projection intermediaire n'aurait
 * servi qu'a laisser tomber un champ un jour.
 */
export type InspectAttempt = {
  id: string;
  attempt: number;
  status: ValidationBatchStatus;
  /** Code d'erreur stable du contrat runner, lorsque le lot n'a pas pu demarrer. */
  errorCode: string | null;
  /**
   * Diagnostic ecrit par NOX, borne et sans detail systeme.
   *
   * C'est ce champ qui portait deja « Code systeme : ENOENT » pendant le
   * pilote, sans que rien ne l'affiche.
   */
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  results: readonly AutonomousValidationResultRow[];
};

/**
 * Toutes les tentatives d'une execution, de la premiere a la derniere.
 *
 * ## Pourquoi croissant, contrairement au reste de NOX
 *
 * Partout ailleurs, la tentative courante prime : c'est elle qui decide, donc
 * elle vient en premier. Ici on ne decide rien, on **raconte** — et une panne se
 * lit dans l'ordre ou elle s'est produite. « La tentative 1 n'a pas pu demarrer,
 * la tentative 2 est passee » se comprend d'un coup ; l'inverse demande de
 * remonter le temps.
 *
 * ## Pourquoi aucune tentative n'est masquee
 *
 * Une tentative reprise apres une panne n'efface pas celle qui a echoue.
 * C'etait exactement le cas de TripKit, et n'afficher que la derniere aurait
 * fait disparaitre la seule ligne qui expliquait le probleme.
 */
export function inspectAttempts(
  current: AutonomousValidationBatchRow | null,
  previous: readonly AutonomousValidationBatchRow[],
): InspectAttempt[] {
  const all = current === null ? [...previous] : [...previous, current];
  return all
    .slice()
    .sort((left, right) => left.attempt - right.attempt)
    .map((batch) => ({
      id: batch.id,
      attempt: batch.attempt,
      status: batch.status,
      errorCode: batch.errorCode,
      errorMessage: batch.errorMessage,
      startedAt: batch.startedAt,
      completedAt: batch.completedAt,
      results: batch.results,
    }));
}

/**
 * Cette tentative a-t-elle produit au moins une preuve ?
 *
 * Une tentative entierement en `ERROR` n'a rien observe : NOX n'a pas pu
 * regarder, ce qui n'est pas « il a regarde et c'est faux ».
 */
export function attemptProducedEvidence(attempt: InspectAttempt): boolean {
  return attempt.results.some(
    (result) => result.status !== AUTONOMOUS_VALIDATION_STATUS.ERROR,
  );
}

/**
 * Ce que NOX a **observe** de l'execution d'une commande par Claude Code.
 *
 * Une seule question, et elle est binaire : cette commande enregistree a-t-elle
 * ete lancee, telle quelle, par l'agent ?
 */
export type ClaudeObservation = {
  command: string;
  /** Vrai lorsque NOX a reconnu la ligne, mot pour mot. */
  observedExactly: boolean;
  status: RunValidationStatus;
  exitCode: number | null;
};

/**
 * Les commandes enregistrees, et ce que Claude Code en a fait.
 *
 * ## Pourquoi `NOT_RUN` se dit « aucune execution litterale observee »
 *
 * Parce que c'est ce que ce statut veut dire, et rien de plus. Le pilote a
 * marque `npm test` « non lancee » alors que l'agent l'avait lancee sous la
 * forme `npm test 2>&1 | tail -60`. Le refus etait correct — dans un tuyau, le
 * code de sortie observable est celui de `tail` — mais la phrase laissait croire
 * que rien n'avait tourne. « NOX n'a pas vu cette ligne exacte » et « cette
 * commande n'a pas tourne » sont deux affirmations differentes, et seule la
 * premiere est vraie.
 *
 * ## Ce que cette section ne fait jamais
 *
 * Elle ne lit pas le compte rendu final de Claude Code, ne fait aucune
 * correspondance approchee, ne normalise aucun argument. Elle projette les
 * lignes deja enregistrees par `readBashCommand`, qui n'a pas bouge.
 */
export function claudeObservations(
  validations: readonly RunValidationResultView[],
): ClaudeObservation[] {
  return validations
    .slice()
    .sort((left, right) => left.position - right.position)
    .map((validation) => ({
      command: validation.command,
      observedExactly: validation.status !== RUN_VALIDATION_STATUS.NOT_RUN,
      status: validation.status,
      exitCode: validation.exitCode,
    }));
}

/** Ce que dit une observation, en une ligne. */
export function claudeObservationLabel(observation: ClaudeObservation): string {
  if (!observation.observedExactly) {
    return "Aucune exécution littérale observée";
  }
  if (observation.status === RUN_VALIDATION_STATUS.UNKNOWN) {
    return "Lancée, issue indéterminée";
  }
  if (observation.exitCode === null) {
    return `Lancée · ${observation.status}`;
  }
  return `Lancée · ${observation.status} · exit ${String(observation.exitCode)}`;
}

/**
 * L'avertissement qui accompagne la section, et qui ne doit jamais en partir.
 *
 * TASK-027 tient entierement dans cette distinction, et une page de diagnostic
 * est precisement l'endroit ou on serait tente de l'oublier : les deux sections
 * se ressemblent, portent les memes commandes, et l'une des deux ne prouve rien.
 */
export const CLAUDE_OBSERVATION_NOTICE =
  "Informatif uniquement. Ce que Claude Code a lancé ne vérifie aucun critère " +
  "d'acceptation : seules les commandes que NOX a exécutées lui-même, après le " +
  "travail, valent preuve.";

/** Une exécution du cycle de correction, telle qu'elle s'inspecte. */
export type InspectChainEntry = {
  runId: string;
  code: string;
  /** Position dans la chaine, a partir de 0 pour l'execution initiale. */
  depth: number;
  /** Vrai pour l'execution en cours d'inspection. */
  current: boolean;
  status: string;
};

/**
 * La chaine de corrections, de l'execution initiale a la plus recente.
 *
 * Une liste, pas un graphe : un cycle de travail est une suite, et le dessiner
 * comme un arbre suggererait des branches qui n'existent pas — une correction a
 * exactement un parent, et une execution a au plus une correction en vol.
 *
 * L'ordre vient de `readCorrectionChain`, qui remonte les `parentRunId` : il est
 * insensible aux numeros, et c'est ce qui le rend juste apres une reouverture.
 */
export function inspectChain(
  chain: readonly { id: string; code: string; status: string }[],
  currentRunId: string,
): InspectChainEntry[] {
  return chain.map((run, index) => ({
    runId: run.id,
    code: run.code,
    depth: index,
    current: run.id === currentRunId,
    status: run.status,
  }));
}

/** Libelle d'un maillon : « Initial run », « Correction 1 »… */
export function chainEntryLabel(entry: InspectChainEntry): string {
  return entry.depth === 0 ? "Initial run" : `Correction ${String(entry.depth)}`;
}

/** Entrees de la carte de livraison. */
export type DeliveryFactsInput = {
  /** Politique du projet, telle qu'elle vaut aujourd'hui. */
  policyLabel: string;
  /** La livraison rattachee a cette execution, ou `null`. */
  delivery: {
    statusLabel: string;
    triggerLabel: string;
    commitSha: string | null;
    pushedAt: Date | null;
    attempt: number;
    errorCode: string | null;
  } | null;
};

/**
 * Ce que la livraison de cette execution raconte.
 *
 * ## Pourquoi la politique est affichee meme sans livraison
 *
 * Parce que c'est la reponse a « pourquoi rien n'a ete commite ». Une carte
 * absente laisse chercher un bug ; une carte qui dit « Manual » repond.
 *
 * ## Ce que cette carte ne fait pas
 *
 * Elle ne propose aucune action. Inspect est en lecture seule, et un bouton qui
 * ecrirait dans Git depuis une page de diagnostic serait exactement le genre de
 * chemin que TASK-029 a passe une tache entiere a rendre unique.
 */
export function deliveryFacts(input: DeliveryFactsInput): InspectFact[] {
  if (input.delivery === null) {
    return [fact("Politique", input.policyLabel), fact("Livraison", "Aucune")];
  }

  return [
    fact("Politique", input.policyLabel),
    fact("État", input.delivery.statusLabel),
    fact("Déclencheur", input.delivery.triggerLabel),
    fact("Commit", input.delivery.commitSha, true),
    fact(
      "Poussé",
      input.delivery.pushedAt === null ? null : input.delivery.pushedAt.toISOString(),
    ),
    fact("Tentatives", String(input.delivery.attempt), true),
    fact("Code d'erreur", input.delivery.errorCode, true),
  ];
}

/**
 * Le statut fonctionnel d'une tache et l'etat de sa livraison sont deux faits.
 *
 * Invariant de TASK-033, rappele ici parce qu'Inspect affiche les deux cote a
 * cote : c'est la surface ou la confusion « Task failed » / « delivery failed »
 * serait la plus facile a faire.
 */
export const DELIVERY_INDEPENDENCE_NOTICE =
  "L'état de livraison est distinct du résultat fonctionnel : un push refusé ne " +
  "transforme jamais un travail validé en échec.";
