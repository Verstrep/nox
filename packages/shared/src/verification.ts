/**
 * Plan de verification d'une tache.
 *
 * ## Ce que ce module existe pour empecher
 *
 * Qu'on decide **apres coup** qu'un critere etait automatisable. Le
 * raisonnement « Claude a fini, regardons ce qui est passe, appelons ca une
 * validation » produit une classification qui s'adapte au resultat — donc qui ne
 * prouve rien. Ici, la classification appartient au **contrat** de la tache et
 * existe avant l'execution.
 *
 * ## Deux modes, fermes
 *
 * `AUTOMATED` ou `HUMAN`. Pas de `MAYBE`, pas d'`UNKNOWN`, pas d'`AI_GUESS` : un
 * troisieme mode serait, en pratique, l'endroit ou l'on rangerait ce qu'on n'a
 * pas su trancher — et il faudrait bien le trancher au moment de decider si la
 * tache peut se terminer seule.
 *
 * ## Ce qu'une preuve n'est pas
 *
 * Le compte rendu de Claude Code. « J'ai lance `npm test` » est une information
 * utile ; ce n'est pas une preuve independante. Seule une commande que **NOX**
 * a executee lui-meme apres le travail peut soutenir un critere `AUTOMATED`.
 * C'est toute la distinction entre `CLAUDE_OBSERVED` et `NOX_AUTONOMOUS`.
 *
 * ## Ce module est pur
 *
 * Ni base, ni disque, ni reseau, ni React. Il porte le vocabulaire, la politique
 * des commandes autonomes, la validation du plan et la derivation des
 * resultats — tout ce qu'un test peut verifier sans rien executer.
 */

import {
  CLAUDE_BOOTSTRAP_DENIED_COMMANDS,
  checkValidationCommand,
} from "./claude-commands.js";
import { TASK_KIND, type TaskKind } from "./tasks.js";
import {
  RUN_STATUS,
  TASK_STATUS,
  createStatusGuard,
  type RunStatus,
  type TaskStatus,
} from "./statuses.js";

// ---------------------------------------------------------------------------
// 1. Vocabulaire
// ---------------------------------------------------------------------------

/**
 * Comment un critere d'acceptation se verifie.
 *
 * Le choix est fait a l'ecriture de la tache, pas apres l'execution.
 */
export const VERIFICATION_MODE = {
  /** NOX peut en obtenir une preuve en executant des commandes enregistrees. */
  AUTOMATED: "AUTOMATED",
  /** Une observation ou un jugement humain est reellement necessaire. */
  HUMAN: "HUMAN",
} as const;

export type VerificationMode = (typeof VERIFICATION_MODE)[keyof typeof VERIFICATION_MODE];

export const VERIFICATION_MODES: readonly VerificationMode[] = Object.values(VERIFICATION_MODE);

export const isVerificationMode = createStatusGuard(VERIFICATION_MODES);

/**
 * Ce que NOX a le droit de faire d'une commande de validation.
 *
 * `AGENT_ONLY` est le comportement historique — et le defaut sur : la commande
 * est autorisee a Claude Code pendant son travail, et NOX ne la lance jamais de
 * lui-meme. `AUTONOMOUS` ajoute une permission, elle n'en retire aucune.
 */
export const COMMAND_EXECUTION_MODE = {
  /** Transmise a Claude Code. NOX ne l'execute pas. */
  AGENT_ONLY: "AGENT_ONLY",
  /** Transmise a Claude Code **et** executable par NOX apres l'execution. */
  AUTONOMOUS: "AUTONOMOUS",
} as const;

export type CommandExecutionMode =
  (typeof COMMAND_EXECUTION_MODE)[keyof typeof COMMAND_EXECUTION_MODE];

export const COMMAND_EXECUTION_MODES: readonly CommandExecutionMode[] =
  Object.values(COMMAND_EXECUTION_MODE);

export const isCommandExecutionMode = createStatusGuard(COMMAND_EXECUTION_MODES);

/**
 * Qui a execute une commande.
 *
 * La distinction entiere de TASK-027 tient dans ces deux valeurs. Les deux sont
 * conservees et affichees ; une seule sert de preuve.
 */
export const VALIDATION_EVIDENCE_SOURCE = {
  /** Claude Code l'a lancee pendant son travail, et NOX l'a lu dans sa sortie. */
  CLAUDE_OBSERVED: "CLAUDE_OBSERVED",
  /** NOX l'a executee lui-meme apres l'execution. */
  NOX_AUTONOMOUS: "NOX_AUTONOMOUS",
} as const;

export type ValidationEvidenceSource =
  (typeof VALIDATION_EVIDENCE_SOURCE)[keyof typeof VALIDATION_EVIDENCE_SOURCE];

export const VALIDATION_EVIDENCE_SOURCES: readonly ValidationEvidenceSource[] =
  Object.values(VALIDATION_EVIDENCE_SOURCE);

export const isValidationEvidenceSource = createStatusGuard(VALIDATION_EVIDENCE_SOURCES);

/**
 * Issue d'une commande executee par NOX.
 *
 * `FAILED` et `ERROR` ne disent pas la meme chose, et les confondre ferait
 * chercher un bug la ou il n'y a qu'un runner arrete. `TIMED_OUT` est **une
 * forme d'echec de validation**, pas une panne d'infrastructure : la commande a
 * bien demarre, elle n'a simplement pas prouve ce qu'elle devait prouver dans le
 * temps imparti. C'est la convention retenue, et elle est unique.
 */
export const AUTONOMOUS_VALIDATION_STATUS = {
  /** Code de sortie zero. */
  PASSED: "PASSED",
  /** La commande a tourne et rendu un code de sortie non nul. */
  FAILED: "FAILED",
  /** La commande a depasse son delai et a ete arretee. Compte comme un echec. */
  TIMED_OUT: "TIMED_OUT",
  /** NOX n'a pas pu obtenir de preuve : runner injoignable, demarrage impossible. */
  ERROR: "ERROR",
} as const;

export type AutonomousValidationStatus =
  (typeof AUTONOMOUS_VALIDATION_STATUS)[keyof typeof AUTONOMOUS_VALIDATION_STATUS];

export const AUTONOMOUS_VALIDATION_STATUSES: readonly AutonomousValidationStatus[] =
  Object.values(AUTONOMOUS_VALIDATION_STATUS);

export const isAutonomousValidationStatus = createStatusGuard(AUTONOMOUS_VALIDATION_STATUSES);

/** Un timeout est un echec de validation, jamais une panne. */
export function isValidationFailure(status: AutonomousValidationStatus): boolean {
  return (
    status === AUTONOMOUS_VALIDATION_STATUS.FAILED ||
    status === AUTONOMOUS_VALIDATION_STATUS.TIMED_OUT
  );
}

/**
 * Etat d'un lot de validations autonomes.
 *
 * Cinq valeurs, et pas une de plus : `PENDING` (reserve, rien n'a demarre),
 * `RUNNING`, puis trois issues finales. Une machine a etats plus riche
 * demanderait a etre tenue a jour partout sans rien apprendre a personne.
 */
export const VALIDATION_BATCH_STATUS = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  /** Toutes les commandes ont rendu zero. */
  PASSED: "PASSED",
  /** Au moins une a echoue ou depasse son delai. */
  FAILED: "FAILED",
  /** Au moins une n'a pas pu etre executee. */
  ERROR: "ERROR",
} as const;

export type ValidationBatchStatus =
  (typeof VALIDATION_BATCH_STATUS)[keyof typeof VALIDATION_BATCH_STATUS];

export const VALIDATION_BATCH_STATUSES: readonly ValidationBatchStatus[] =
  Object.values(VALIDATION_BATCH_STATUS);

export const isValidationBatchStatus = createStatusGuard(VALIDATION_BATCH_STATUSES);

/** Un lot en cours interdit toute decision de review. */
export function isBatchFinal(status: ValidationBatchStatus): boolean {
  return (
    status === VALIDATION_BATCH_STATUS.PASSED ||
    status === VALIDATION_BATCH_STATUS.FAILED ||
    status === VALIDATION_BATCH_STATUS.ERROR
  );
}

/**
 * Ce qu'on peut dire d'un critere apres un lot.
 *
 * `NOT_VERIFIED` couvre l'absence de preuve — infrastructure en panne, lot
 * jamais lance. Il ne se confond pas avec `FAILED` : « je n'ai pas pu regarder »
 * n'est pas « j'ai regarde et c'est faux ».
 */
export const CRITERION_VERIFICATION_RESULT = {
  PASSED: "PASSED",
  FAILED: "FAILED",
  NOT_VERIFIED: "NOT_VERIFIED",
  /** Critere humain : aucune machine n'en decide. */
  HUMAN: "HUMAN",
} as const;

export type CriterionVerificationResult =
  (typeof CRITERION_VERIFICATION_RESULT)[keyof typeof CRITERION_VERIFICATION_RESULT];

/**
 * Ce qu'on peut dire de la tache entiere.
 *
 * Derive du plan et des resultats ; jamais stocke, jamais compte.
 */
export const TASK_VERIFICATION_OUTCOME = {
  /** Tout est automatise, et tout est prouve. Seul cas ouvrant l'auto-completion. */
  AUTO_PASSED: "AUTO_PASSED",
  /** Au moins une preuve automatisee manque a l'appel. */
  AUTO_FAILED: "AUTO_FAILED",
  /** Au moins une preuve n'a pas pu etre obtenue. */
  AUTO_ERROR: "AUTO_ERROR",
  /** Un humain doit regarder : au moins un critere le demande. */
  HUMAN_REQUIRED: "HUMAN_REQUIRED",
} as const;

export type TaskVerificationOutcome =
  (typeof TASK_VERIFICATION_OUTCOME)[keyof typeof TASK_VERIFICATION_OUTCOME];

export const TASK_VERIFICATION_OUTCOMES: readonly TaskVerificationOutcome[] =
  Object.values(TASK_VERIFICATION_OUTCOME);

export const isTaskVerificationOutcome = createStatusGuard(TASK_VERIFICATION_OUTCOMES);

/**
 * Qui a conclu une review.
 *
 * Ecrire « approuve par l'utilisateur » quand personne n'a clique serait un
 * mensonge dans l'historique — celui qu'on decouvre six mois plus tard en
 * cherchant qui a valide quoi.
 */
export const REVIEW_DECISION_SOURCE = {
  /** NOX, parce que toutes les preuves pre-approuvees sont passees. */
  AUTOMATED: "AUTOMATED",
  /** Un humain, apres avoir confirme ce qui lui revenait. */
  HUMAN: "HUMAN",
  /** Un humain, malgre une validation automatisee en echec. */
  HUMAN_OVERRIDE: "HUMAN_OVERRIDE",
} as const;

export type ReviewDecisionSource =
  (typeof REVIEW_DECISION_SOURCE)[keyof typeof REVIEW_DECISION_SOURCE];

export const REVIEW_DECISION_SOURCES: readonly ReviewDecisionSource[] =
  Object.values(REVIEW_DECISION_SOURCE);

export const isReviewDecisionSource = createStatusGuard(REVIEW_DECISION_SOURCES);

/**
 * Pourquoi une tache en review n'avance pas.
 *
 * ## Pourquoi ce n'est pas un etat de file
 *
 * `deriveQueueState` est pure et ne lit ni base, ni disque : elle ne peut donc
 * pas savoir ou en est un lot de validations. Ajouter ces cas a `QUEUE_STATE`
 * obligerait a lui passer des faits qu'elle n'a pas, ou a les persister — deux
 * facons de faire mentir un etat derive.
 *
 * La file reste donc en `WAITING_REVIEW` ; c'est l'**affichage** qui precise ce
 * qu'on attend, a partir de la review deja chargee.
 */
export const REVIEW_WAIT = {
  /** Un lot tourne encore : personne ne peut decider. */
  VALIDATION_RUNNING: "VALIDATION_RUNNING",
  /** Une preuve automatisee a echoue. */
  VALIDATION_FAILED: "VALIDATION_FAILED",
  /** Une preuve n'a pas pu etre obtenue. */
  VALIDATION_ERROR: "VALIDATION_ERROR",
  /** Des criteres attendent une confirmation humaine. */
  HUMAN_CHECKS: "HUMAN_CHECKS",
  /** Rien de particulier : la review attend simplement une relecture. */
  REVIEW: "REVIEW",
} as const;

export type ReviewWaitKind = (typeof REVIEW_WAIT)[keyof typeof REVIEW_WAIT];

export const REVIEW_WAIT_KINDS: readonly ReviewWaitKind[] = Object.values(REVIEW_WAIT);

export type ReviewWait = {
  kind: ReviewWaitKind;
  /** Nombre de criteres humains restant a confirmer. */
  humanCheckCount: number;
};

// ---------------------------------------------------------------------------
// 2. Bornes
// ---------------------------------------------------------------------------

/**
 * Delai maximal d'une commande autonome.
 *
 * Une constante, pas une variable d'environnement : une limite de securite
 * qu'on peut desserrer n'en est plus une, et c'est deja la regle des bornes du
 * runner.
 */
export const AUTONOMOUS_VALIDATION_TIMEOUT_MS = 300_000;

/** Taille conservee de chaque flux, par commande. Au-dela, troncature annoncee. */
export const AUTONOMOUS_VALIDATION_OUTPUT_LIMIT = 16_000;

/**
 * Instruction posee sur un critere cree sans classification explicite.
 *
 * ## Pourquoi une valeur plutot que rien
 *
 * Un critere `HUMAN` sans instruction est un plan incomplet : `Mark ready` le
 * refuse, et c'est voulu. Mais un appelant qui ne classe rien — l'ancien
 * formulaire de creation, un script — ne doit pas produire une tache
 * inutilisable pour autant. NOX pose donc le defaut **sur** et le dit en toutes
 * lettres : un humain devra regarder.
 *
 * Ce n'est pas une consigne inventee : c'est exactement ce que `HUMAN` signifie.
 * L'auteur de la tache la precisera dans l'editeur, et rien ici n'ouvre la
 * moindre porte vers une completion automatique.
 *
 * ## Ce que ce defaut ne fait pas
 *
 * Il ne s'applique **pas** aux lignes migrees : celles-la restent a `null`,
 * parce que reecrire l'histoire d'une tache deja executee lui attribuerait une
 * consigne que personne n'avait donnee a l'epoque.
 */
export const DEFAULT_HUMAN_INSTRUCTIONS =
  "Verifier manuellement ce critere d'acceptation.";

/** Longueur maximale d'une instruction destinee au testeur humain. */
export const MAX_HUMAN_INSTRUCTIONS_LENGTH = 500;

/** Longueur maximale de la raison d'un passage en force. */
export const MAX_OVERRIDE_REASON_LENGTH = 1_000;

/** Nombre maximal de commandes autonomes executables pour une seule execution. */
export const MAX_AUTONOMOUS_COMMANDS_PER_RUN = 20;

// ---------------------------------------------------------------------------
// 3. Politique des commandes autonomes
// ---------------------------------------------------------------------------

/**
 * Programmes que NOX accepte de lancer lui-meme.
 *
 * Liste fermee, et volontairement **distincte** de celle de l'amorcage. Les deux
 * se ressemblent parce que les ecosystemes sont les memes, mais elles repondent
 * a deux questions differentes : `TASK-023` demande « cette tache exceptionnelle
 * peut-elle installer sa fondation ? », celle-ci demande « NOX peut-il lancer
 * ceci tout seul, sans surveillance, apres chaque execution ? ». Les fusionner
 * ferait qu'une tache `NORMAL` gagnerait un jour, sans qu'on l'ait voulu, les
 * droits de `TASK-000`.
 */
export const AUTONOMOUS_VALIDATION_PROGRAMS: readonly string[] = [
  // JavaScript et TypeScript.
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "node",
  "tsc",
  "eslint",
  "prettier",
  "jest",
  "vitest",
  // Python.
  "python",
  "python3",
  "pytest",
  "ruff",
  "mypy",
  // Rust.
  "cargo",
  // Go.
  "go",
  // JVM.
  "mvn",
  "gradle",
  "./gradlew",
  // Ruby.
  "bundle",
  "rake",
  "rspec",
  // PHP.
  "php",
  "composer",
  // .NET.
  "dotnet",
  // Generique.
  "make",
];

/**
 * Sous-commandes et options qui designent un processus qui ne s'arrete pas.
 *
 * Le critere n'est pas « ce mot apparait quelque part » — `npm run test-server`
 * n'est pas un serveur, et refuser sur une sous-chaine produirait des faux
 * positifs absurdes. Le controle porte sur le **jeton entier** en position de
 * script ou d'option, ce qui rend le refus explicable.
 */
const NON_TERMINATING_TOKENS: readonly string[] = [
  "dev",
  "start",
  "serve",
  "server",
  "preview",
  "watch",
  "storybook",
  "--watch",
  "-w",
  "--serve",
  "--hot",
  "--interactive",
  "-i",
];

/**
 * Sous-commandes d'installation.
 *
 * Preparer un repository n'est pas le valider. `TASK-023` installe ; une
 * validation autonome constate. Une commande qui installe avant de tester
 * masquerait une fondation absente derriere un test vert.
 */
const INSTALL_TOKENS: readonly string[] = [
  "install",
  "i",
  "ci",
  "add",
  "update",
  "upgrade",
  "uninstall",
  "remove",
  "link",
  "publish",
  "login",
  "adduser",
  "token",
  "init",
  "create",
];

/**
 * Refus supplementaires, partages avec l'amorcage.
 *
 * La liste est **reutilisee**, pas recopiee : deux grandes listes de refus
 * finiraient par diverger, et c'est toujours celle qu'on a oublie de mettre a
 * jour qui laisse passer quelque chose. Ce qu'elle couvre — elevation de
 * privileges, machines distantes, deploiement, publication, lecture de fichiers
 * hors outil — vaut exactement autant ici.
 */
const AUTONOMOUS_EXTRA_REFUSALS: readonly string[] = CLAUDE_BOOTSTRAP_DENIED_COMMANDS;

/** Une commande validee, decoupee en programme et arguments. */
export type ParsedCommand = { program: string; args: readonly string[] };

/**
 * Decoupe une commande en programme et arguments.
 *
 * Ce decoupage est trivial **parce que** `checkValidationCommand` a deja refuse
 * tout ce qui rendrait un decoupage difficile : guillemets, chainage,
 * redirection, substitution, espaces multiples. Une commande acceptee est donc
 * une suite de jetons separes par une espace, et rien d'autre.
 *
 * C'est ce qui permet de ne jamais passer par un interpreteur de commandes :
 * il n'y a pas de syntaxe a interpreter.
 */
export function parseValidationCommand(command: string): ParsedCommand | null {
  if (checkValidationCommand(command) !== null) {
    return null;
  }
  const [program, ...args] = command.split(" ");
  return program === undefined || program === "" ? null : { program, args };
}

function matchesEntry(command: string, entry: string): boolean {
  const lowered = command.toLowerCase();
  const target = entry.toLowerCase();
  return lowered === target || lowered.startsWith(`${target} `);
}

/**
 * Cette commande peut-elle etre executee par NOX sans surveillance ?
 *
 * Retourne la raison du refus, ou `null` si elle est acceptable.
 *
 * Le premier controle est celui qui existait deja : une commande qui ne peut pas
 * etre autorisee a Claude Code ne peut pas davantage etre lancee par NOX. Les
 * suivants ajoutent ce que l'execution autonome exige en propre — un programme
 * connu, une fin, aucune installation.
 */
export function checkAutonomousCommand(command: string): string | null {
  const base = checkValidationCommand(command);
  if (base !== null) {
    return base;
  }

  const refused = AUTONOMOUS_EXTRA_REFUSALS.find((entry) => matchesEntry(command, entry));
  if (refused !== undefined) {
    return `« ${refused} » ne peut pas etre executee par NOX : publication, deploiement, acces distant et elevation de privileges restent hors de portee d'une validation.`;
  }

  const parsed = parseValidationCommand(command);
  if (parsed === null) {
    return "La commande ne peut pas etre decoupee en programme et arguments.";
  }

  if (!AUTONOMOUS_VALIDATION_PROGRAMS.includes(parsed.program)) {
    return `NOX ne lance pas « ${parsed.program} » de lui-meme. Les programmes executables sans surveillance sont une liste fermee ; cette commande peut rester autorisee a Claude Code.`;
  }

  const lowered = parsed.args.map((argument) => argument.toLowerCase());

  const install = lowered.find((argument) => INSTALL_TOKENS.includes(argument));
  if (install !== undefined) {
    return `« ${install} » installe ou publie plutot que de verifier. Preparer le repository appartient a l'amorcage, pas a une validation.`;
  }

  const endless = lowered.find((argument) => NON_TERMINATING_TOKENS.includes(argument));
  if (endless !== undefined) {
    return `« ${endless} » designe un processus qui ne se termine pas de lui-meme. Une validation autonome doit finir ; celle-ci peut rester autorisee a Claude Code.`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// 4. Le plan
// ---------------------------------------------------------------------------

/** Une commande de validation enregistree sur une tache. */
export type VerificationPlanCommand = {
  id: string;
  position: number;
  command: string;
  executionMode: CommandExecutionMode;
};

/** Un critere d'acceptation, avec la facon dont il se verifie. */
export type VerificationPlanCriterion = {
  id: string;
  position: number;
  text: string;
  verificationMode: VerificationMode;
  /** Instruction destinee au testeur. Obligatoire pour un critere humain. */
  humanInstructions: string | null;
  /** Identifiants des commandes qui prouvent ce critere. Vide pour un critere humain. */
  commandIds: readonly string[];
};

/** Le contrat de verification d'une tache, tel qu'il est enregistre. */
export type VerificationPlan = {
  criteria: readonly VerificationPlanCriterion[];
  commands: readonly VerificationPlanCommand[];
};

/** Refus possibles d'un plan de verification. */
export const VERIFICATION_PLAN_ERROR = {
  NO_CRITERIA: "VERIFICATION_NO_CRITERIA",
  MODE_UNKNOWN: "VERIFICATION_MODE_UNKNOWN",
  AUTOMATED_WITHOUT_COMMAND: "VERIFICATION_AUTOMATED_WITHOUT_COMMAND",
  AUTOMATED_COMMAND_UNKNOWN: "VERIFICATION_AUTOMATED_COMMAND_UNKNOWN",
  AUTOMATED_COMMAND_NOT_AUTONOMOUS: "VERIFICATION_AUTOMATED_COMMAND_NOT_AUTONOMOUS",
  HUMAN_WITHOUT_INSTRUCTIONS: "VERIFICATION_HUMAN_WITHOUT_INSTRUCTIONS",
  HUMAN_INSTRUCTIONS_TOO_LONG: "VERIFICATION_HUMAN_INSTRUCTIONS_TOO_LONG",
  HUMAN_WITH_COMMANDS: "VERIFICATION_HUMAN_WITH_COMMANDS",
  COMMAND_NOT_AUTONOMOUS: "VERIFICATION_COMMAND_NOT_AUTONOMOUS",
  TOO_MANY_AUTONOMOUS_COMMANDS: "VERIFICATION_TOO_MANY_AUTONOMOUS_COMMANDS",
} as const;

export type VerificationPlanErrorCode =
  (typeof VERIFICATION_PLAN_ERROR)[keyof typeof VERIFICATION_PLAN_ERROR];

/** Un defaut du plan, rattache a ce qui le porte. */
export type VerificationPlanIssue = {
  code: VerificationPlanErrorCode;
  /** Critere concerne, lorsque le defaut lui appartient. */
  criterionId: string | null;
  /** Commande concernee, lorsque le defaut lui appartient. */
  commandId: string | null;
  detail: string;
};

export type VerificationPlanCheck =
  | { ok: true }
  | { ok: false; issues: readonly VerificationPlanIssue[] };

function issue(
  code: VerificationPlanErrorCode,
  detail: string,
  ids: { criterionId?: string; commandId?: string } = {},
): VerificationPlanIssue {
  return {
    code,
    criterionId: ids.criterionId ?? null,
    commandId: ids.commandId ?? null,
    detail,
  };
}

/**
 * Le plan est-il complet et coherent ?
 *
 * Appele avant `Mark ready`, et refait avant chaque lancement : un plan valide
 * est une precondition d'execution, pas une politesse de formulaire. Tous les
 * defauts sont rendus ensemble — corriger un critere pour en decouvrir un autre
 * au clic suivant serait une facon lente de dire la meme chose.
 *
 * Une tache `DRAFT` peut etre incomplete ; c'est le passage a `READY` qui exige
 * ce contrat.
 */
export function checkVerificationPlan(plan: VerificationPlan): VerificationPlanCheck {
  const issues: VerificationPlanIssue[] = [];

  if (plan.criteria.length === 0) {
    issues.push(
      issue(
        VERIFICATION_PLAN_ERROR.NO_CRITERIA,
        "Une tache prete doit porter au moins un critere d'acceptation.",
      ),
    );
  }

  const byId = new Map(plan.commands.map((command) => [command.id, command]));

  // Une commande declaree autonome doit l'etre reellement : la politique est
  // revalidee ici, et pas seulement au moment ou l'utilisateur la saisit.
  for (const command of plan.commands) {
    if (command.executionMode !== COMMAND_EXECUTION_MODE.AUTONOMOUS) {
      continue;
    }
    const refusal = checkAutonomousCommand(command.command);
    if (refusal !== null) {
      issues.push(
        issue(
          VERIFICATION_PLAN_ERROR.COMMAND_NOT_AUTONOMOUS,
          `« ${command.command} » ne peut pas etre executee par NOX : ${refusal}`,
          { commandId: command.id },
        ),
      );
    }
  }

  const autonomous = plan.commands.filter(
    (command) => command.executionMode === COMMAND_EXECUTION_MODE.AUTONOMOUS,
  );
  if (autonomous.length > MAX_AUTONOMOUS_COMMANDS_PER_RUN) {
    issues.push(
      issue(
        VERIFICATION_PLAN_ERROR.TOO_MANY_AUTONOMOUS_COMMANDS,
        `Une execution ne peut pas declencher plus de ${String(MAX_AUTONOMOUS_COMMANDS_PER_RUN)} validations autonomes.`,
      ),
    );
  }

  for (const criterion of plan.criteria) {
    if (!isVerificationMode(criterion.verificationMode)) {
      issues.push(
        issue(
          VERIFICATION_PLAN_ERROR.MODE_UNKNOWN,
          "Ce critere n'est ni automatise ni humain.",
          { criterionId: criterion.id },
        ),
      );
      continue;
    }

    if (criterion.verificationMode === VERIFICATION_MODE.HUMAN) {
      const instructions = criterion.humanInstructions?.trim() ?? "";
      if (instructions === "") {
        issues.push(
          issue(
            VERIFICATION_PLAN_ERROR.HUMAN_WITHOUT_INSTRUCTIONS,
            "Un critere humain doit dire ce qu'il faut verifier, et comment.",
            { criterionId: criterion.id },
          ),
        );
      } else if (instructions.length > MAX_HUMAN_INSTRUCTIONS_LENGTH) {
        issues.push(
          issue(
            VERIFICATION_PLAN_ERROR.HUMAN_INSTRUCTIONS_TOO_LONG,
            `L'instruction depasse ${String(MAX_HUMAN_INSTRUCTIONS_LENGTH)} caracteres.`,
            { criterionId: criterion.id },
          ),
        );
      }
      if (criterion.commandIds.length > 0) {
        issues.push(
          issue(
            VERIFICATION_PLAN_ERROR.HUMAN_WITH_COMMANDS,
            "Un critere humain ne s'appuie sur aucune commande : s'il en avait une, il serait automatise.",
            { criterionId: criterion.id },
          ),
        );
      }
      continue;
    }

    // AUTOMATED : au moins une preuve, et chaque preuve doit en etre une.
    if (criterion.commandIds.length === 0) {
      issues.push(
        issue(
          VERIFICATION_PLAN_ERROR.AUTOMATED_WITHOUT_COMMAND,
          "Un critere automatise doit nommer la ou les commandes qui le prouvent. Le lien n'est jamais deduit du texte.",
          { criterionId: criterion.id },
        ),
      );
      continue;
    }

    for (const commandId of criterion.commandIds) {
      const command = byId.get(commandId);
      if (command === undefined) {
        issues.push(
          issue(
            VERIFICATION_PLAN_ERROR.AUTOMATED_COMMAND_UNKNOWN,
            "Ce critere reference une commande qui n'existe pas sur cette tache.",
            { criterionId: criterion.id, commandId },
          ),
        );
        continue;
      }
      if (command.executionMode !== COMMAND_EXECUTION_MODE.AUTONOMOUS) {
        issues.push(
          issue(
            VERIFICATION_PLAN_ERROR.AUTOMATED_COMMAND_NOT_AUTONOMOUS,
            `« ${command.command} » n'est autorisee qu'a Claude Code. NOX ne l'executant pas, elle ne peut pas prouver un critere.`,
            { criterionId: criterion.id, commandId },
          ),
        );
      }
    }
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

/**
 * Les commandes que NOX executera, dans l'ordre, chacune une fois.
 *
 * Deux criteres qui s'appuient sur `npm test` ne produisent pas deux
 * executions : la preuve est la meme, et la lancer deux fois couterait le double
 * pour rien — voire donnerait deux resultats differents, ce qui serait pire.
 *
 * L'ordre est celui de la tache, donc stable et previsible.
 */
export function autonomousCommandsFor(plan: VerificationPlan): VerificationPlanCommand[] {
  const proven = new Set<string>();
  for (const criterion of plan.criteria) {
    if (criterion.verificationMode !== VERIFICATION_MODE.AUTOMATED) {
      continue;
    }
    for (const commandId of criterion.commandIds) {
      proven.add(commandId);
    }
  }

  return plan.commands
    .filter(
      (command) =>
        command.executionMode === COMMAND_EXECUTION_MODE.AUTONOMOUS && proven.has(command.id),
    )
    .sort((left, right) => left.position - right.position);
}

/** Le plan demande-t-il au moins une observation humaine ? */
export function planRequiresHuman(plan: VerificationPlan): boolean {
  return plan.criteria.some(
    (criterion) => criterion.verificationMode === VERIFICATION_MODE.HUMAN,
  );
}

/** Les criteres qu'un humain doit confirmer, dans l'ordre d'affichage. */
export function humanCriteriaOf(plan: VerificationPlan): VerificationPlanCriterion[] {
  return plan.criteria
    .filter((criterion) => criterion.verificationMode === VERIFICATION_MODE.HUMAN)
    .sort((left, right) => left.position - right.position);
}

// ---------------------------------------------------------------------------
// 5. Derivation des resultats
// ---------------------------------------------------------------------------

/** Ce que NOX a obtenu pour une commande. */
export type AutonomousCommandOutcome = {
  commandId: string;
  status: AutonomousValidationStatus;
};

/**
 * Ce qu'on peut dire d'un critere, apres un lot.
 *
 * La precedence est deterministe et va du plus grave au moins grave : un echec
 * l'emporte sur une absence de preuve, qui l'emporte sur une reussite. Il faut
 * **toutes** les preuves pour conclure a une reussite ; il en suffit d'une
 * mauvaise pour conclure a un echec.
 */
export function deriveCriterionResult(
  criterion: VerificationPlanCriterion,
  outcomes: readonly AutonomousCommandOutcome[],
): CriterionVerificationResult {
  if (criterion.verificationMode === VERIFICATION_MODE.HUMAN) {
    return CRITERION_VERIFICATION_RESULT.HUMAN;
  }

  if (criterion.commandIds.length === 0) {
    // Un plan valide l'interdit. Si on y arrive quand meme, l'absence de preuve
    // est la seule reponse honnete — surtout pas une reussite.
    return CRITERION_VERIFICATION_RESULT.NOT_VERIFIED;
  }

  const byId = new Map(outcomes.map((outcome) => [outcome.commandId, outcome.status]));
  const statuses = criterion.commandIds.map((commandId) => byId.get(commandId));

  if (statuses.some((status) => status !== undefined && isValidationFailure(status))) {
    return CRITERION_VERIFICATION_RESULT.FAILED;
  }
  if (
    statuses.some(
      (status) => status === undefined || status === AUTONOMOUS_VALIDATION_STATUS.ERROR,
    )
  ) {
    return CRITERION_VERIFICATION_RESULT.NOT_VERIFIED;
  }
  return CRITERION_VERIFICATION_RESULT.PASSED;
}

/** Un critere, accompagne de ce que le lot en a dit. */
export type CriterionVerificationView = {
  criterion: VerificationPlanCriterion;
  result: CriterionVerificationResult;
};

/** Resultat par critere, dans l'ordre de la tache. */
export function deriveCriterionResults(
  plan: VerificationPlan,
  outcomes: readonly AutonomousCommandOutcome[],
): CriterionVerificationView[] {
  return [...plan.criteria]
    .sort((left, right) => left.position - right.position)
    .map((criterion) => ({ criterion, result: deriveCriterionResult(criterion, outcomes) }));
}

/**
 * Ce qu'on peut dire de la tache entiere.
 *
 * L'ordre des tests est celui de l'action a mener : un echec se corrige, une
 * panne se relance, une observation humaine s'effectue. Une tache mixte dont le
 * build echoue annonce donc l'echec plutot que l'attente humaine — corriger le
 * build passe avant, et afficher « en attente de relecture » y ferait perdre du
 * temps.
 */
export function deriveTaskVerificationOutcome(
  results: readonly CriterionVerificationView[],
): TaskVerificationOutcome {
  if (results.some((entry) => entry.result === CRITERION_VERIFICATION_RESULT.FAILED)) {
    return TASK_VERIFICATION_OUTCOME.AUTO_FAILED;
  }
  if (results.some((entry) => entry.result === CRITERION_VERIFICATION_RESULT.NOT_VERIFIED)) {
    return TASK_VERIFICATION_OUTCOME.AUTO_ERROR;
  }
  if (results.some((entry) => entry.result === CRITERION_VERIFICATION_RESULT.HUMAN)) {
    return TASK_VERIFICATION_OUTCOME.HUMAN_REQUIRED;
  }
  if (results.length === 0) {
    // Rien a verifier n'est pas une preuve. Une tache sans critere ne se termine
    // jamais seule sous pretexte qu'il n'y avait rien a regarder.
    return TASK_VERIFICATION_OUTCOME.HUMAN_REQUIRED;
  }
  return TASK_VERIFICATION_OUTCOME.AUTO_PASSED;
}

// ---------------------------------------------------------------------------
// 6. Auto-completion
// ---------------------------------------------------------------------------

/** Raisons pour lesquelles une tache ne peut pas se terminer seule. */
export const AUTO_COMPLETION_REFUSAL = {
  BOOTSTRAP: "AUTO_COMPLETION_BOOTSTRAP",
  RUN_NOT_COMPLETED: "AUTO_COMPLETION_RUN_NOT_COMPLETED",
  TASK_NOT_IN_REVIEW: "AUTO_COMPLETION_TASK_NOT_IN_REVIEW",
  PLAN_INVALID: "AUTO_COMPLETION_PLAN_INVALID",
  HUMAN_REQUIRED: "AUTO_COMPLETION_HUMAN_REQUIRED",
  VALIDATION_FAILED: "AUTO_COMPLETION_VALIDATION_FAILED",
  VALIDATION_INCOMPLETE: "AUTO_COMPLETION_VALIDATION_INCOMPLETE",
  BATCH_NOT_FINAL: "AUTO_COMPLETION_BATCH_NOT_FINAL",
  REPOSITORY_MUTATED: "AUTO_COMPLETION_REPOSITORY_MUTATED",
} as const;

export type AutoCompletionRefusalCode =
  (typeof AUTO_COMPLETION_REFUSAL)[keyof typeof AUTO_COMPLETION_REFUSAL];

/** Tout ce dont la decision depend, relu au moment de decider. */
export type AutoCompletionFacts = {
  taskKind: TaskKind;
  taskStatus: TaskStatus;
  runStatus: RunStatus;
  planValid: boolean;
  outcome: TaskVerificationOutcome;
  batchStatus: ValidationBatchStatus | null;
  /** Une validation autonome a modifie des fichiers suivis par Git. */
  trackedFilesMutated: boolean;
};

export type AutoCompletionDecision =
  | { eligible: true }
  | { eligible: false; code: AutoCompletionRefusalCode };

/**
 * Cette tache peut-elle se terminer sans clic humain ?
 *
 * ## Ce que cette fonction n'a pas
 *
 * Aucun parametre `force`, `override` ou `ignoreFailure`. Le chemin automatique
 * n'a qu'une issue favorable — toutes les preuves pre-approuvees sont passees —
 * et toutes les autres menent a une relecture humaine. Un passage en force est
 * un geste humain ; il n'a rien a faire ici.
 *
 * ## L'ordre des refus
 *
 * Du plus structurel au plus circonstanciel. Une tache d'amorcage ne sera jamais
 * eligible, quoi qu'il arrive ensuite ; un depot modifie par la validation
 * pourrait l'etre une autre fois.
 */
export function checkAutoCompletion(facts: AutoCompletionFacts): AutoCompletionDecision {
  // L'amorcage ne se termine jamais seul : permissions elargies, choix
  // structurants, operation exceptionnelle. Verifie en premier, pour qu'aucune
  // suite de conditions ne puisse un jour l'y amener.
  if (facts.taskKind === TASK_KIND.BOOTSTRAP) {
    return { eligible: false, code: AUTO_COMPLETION_REFUSAL.BOOTSTRAP };
  }
  if (facts.runStatus !== RUN_STATUS.COMPLETED) {
    return { eligible: false, code: AUTO_COMPLETION_REFUSAL.RUN_NOT_COMPLETED };
  }
  if (facts.taskStatus !== TASK_STATUS.REVIEW) {
    return { eligible: false, code: AUTO_COMPLETION_REFUSAL.TASK_NOT_IN_REVIEW };
  }
  if (!facts.planValid) {
    return { eligible: false, code: AUTO_COMPLETION_REFUSAL.PLAN_INVALID };
  }
  if (facts.batchStatus === null || !isBatchFinal(facts.batchStatus)) {
    return { eligible: false, code: AUTO_COMPLETION_REFUSAL.BATCH_NOT_FINAL };
  }

  switch (facts.outcome) {
    case TASK_VERIFICATION_OUTCOME.HUMAN_REQUIRED:
      return { eligible: false, code: AUTO_COMPLETION_REFUSAL.HUMAN_REQUIRED };
    case TASK_VERIFICATION_OUTCOME.AUTO_FAILED:
      return { eligible: false, code: AUTO_COMPLETION_REFUSAL.VALIDATION_FAILED };
    case TASK_VERIFICATION_OUTCOME.AUTO_ERROR:
      return { eligible: false, code: AUTO_COMPLETION_REFUSAL.VALIDATION_INCOMPLETE };
    case TASK_VERIFICATION_OUTCOME.AUTO_PASSED:
      break;
  }

  // La preuve a modifie le travail qu'elle evaluait : ce qui a ete valide n'est
  // plus tout a fait ce qui sera livre. Un humain doit regarder.
  if (facts.trackedFilesMutated) {
    return { eligible: false, code: AUTO_COMPLETION_REFUSAL.REPOSITORY_MUTATED };
  }

  return { eligible: true };
}

/**
 * Cette tache pourrait-elle, en principe, se terminer seule ?
 *
 * Repond avant toute execution, a partir du seul contrat — c'est ce que la page
 * d'une tache annonce avant `Mark ready`, pour que l'acceptation du contrat soit
 * eclairee. « Pourrait » et « peut » restent deux questions : celle-ci ne dit
 * rien des preuves, qui n'existent pas encore.
 */
export function planAllowsAutoCompletion(plan: VerificationPlan, kind: TaskKind): boolean {
  if (kind === TASK_KIND.BOOTSTRAP) {
    return false;
  }
  if (plan.criteria.length === 0) {
    return false;
  }
  return (
    !planRequiresHuman(plan) && checkVerificationPlan(plan).ok
  );
}
