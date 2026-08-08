/**
 * Traduction d'un message Claude Code en evenements publics.
 *
 * C'est ici que se joue la promesse de TASK-010 : **rien de ce que Claude Code
 * emet ne traverse cette fonction intact**. Chaque evenement produit est
 * construit par NOX, champ par champ, a partir de valeurs choisies. Il n'existe
 * aucun chemin par lequel un fragment du message d'origine puisse ressortir sans
 * avoir ete decide ici.
 *
 * ## Le raisonnement interne n'arrive jamais jusqu'a une chaine
 *
 * Les blocs `thinking`, `redacted_thinking`, `reasoning`, `analysis` et tout ce
 * qui porte une `signature` sont ecartes **avant** d'etre lus. Ils ne sont pas
 * resumes, pas comptes, pas mentionnes par un « Claude reflechit » — un tel
 * evenement serait deja une information sur un contenu qui ne doit pas sortir.
 * Ils n'existent pas pour la suite du programme.
 *
 * Meme regle pour un type de bloc inconnu : NOX ne sait pas ce qu'il contient,
 * donc il ne l'affiche pas. La liste des blocs affichables est **fermee**, jamais
 * une liste d'exclusions — une liste d'exclusions laisse passer tout ce qu'on n'a
 * pas prevu, et c'est precisement ce qu'on n'a pas prevu qui est dangereux.
 *
 * ## Les outils sont decrits, jamais rapportes
 *
 * Un `tool_use` porte l'integralite de ce que l'agent envoie a l'outil : le
 * contenu qu'il va ecrire, la commande complete, le motif de recherche. On n'en
 * garde qu'une phrase construite par NOX — « Editing README.md » — et jamais la
 * valeur elle-meme lorsqu'elle peut etre volumineuse ou sensible.
 *
 * Un `tool_result` porte la sortie de l'outil : le fichier lu en entier, la
 * sortie de la commande. On n'en garde que l'issue — reussi, echoue.
 *
 * ## Une commande Bash n'arrive jamais nue
 *
 * Claude Code 2.1.223 prefixe ses commandes de son repertoire de travail :
 * `cd "D:/…/depot" && git diff --check`. La lecture de cette ligne vit dans
 * `bash-command.ts`, avec ses raisons ; ici, on se contente d'en utiliser le
 * resultat — un texte affichable, et la liste des validations reconnues.
 */

import {
  CLAUDE_RUN_EVENT_KIND,
  REVIEW_LIMITS,
  type ClaudeRunEventDraft,
} from "@nox/shared";

import { readBashCommand } from "./bash-command.ts";
import {
  readArray,
  readBoolean,
  readNumber,
  readRecord,
  readString,
  type ClaudeStreamMessage,
} from "./parse-event.ts";

/**
 * Blocs d'un message assistant que NOX accepte de regarder.
 *
 * Volontairement deux. `text` est la reponse publique ; `tool_use` est une
 * action observable. Tout le reste — raisonnement, signatures, blocs futurs — est
 * hors de cette liste, donc ignore.
 */
const VISIBLE_ASSISTANT_BLOCKS = new Set(["text", "tool_use"]);

/** Longueur au-dela de laquelle un motif de recherche n'est plus affiche. */
const MAX_PATTERN_LENGTH = 120;

/** Ce qu'on retient d'un outil appele, en attendant son resultat. */
type PendingTool = {
  name: string;
  /**
   * Commandes de validation enregistrees reconnues dans cet appel.
   *
   * Renseignee uniquement par correspondance **exacte** d'un segment avec une
   * commande enregistree. Une commande Git en lecture seule est affichable sans
   * etre une validation : elle ne porte aucun verdict sur le code — sauf si la
   * tache l'a justement enregistree comme validation, et c'est precisement le
   * cas que TASK-011 corrective a rendu possible.
   */
  validationCommands: readonly string[];
};

/**
 * Longueur brute conservee d'une sortie de validation avant nettoyage.
 *
 * Quatre fois la borne finale : le nettoyage retire des caracteres, et couper
 * trop tot priverait le resume de sa fin — la partie qui porte generalement le
 * verdict.
 */
const MAX_RAW_VALIDATION_OUTPUT = REVIEW_LIMITS.validationSummary * 4;

/**
 * Ce que le flux apprend d'une commande de validation.
 *
 * `output` est **brut** : le collecteur le nettoie et le borne avant qu'il
 * n'aille plus loin. La sanitation vit a un seul endroit, et ce n'est pas ici.
 */
export type ValidationObservation =
  | { kind: "started"; command: string }
  | {
      kind: "finished";
      command: string;
      outcome: ValidationOutcome;
      exitCode: number | null;
      output: string | null;
    };

/**
 * Issue d'une commande de validation, telle que le flux permet de la connaitre.
 *
 * `unknown` n'est pas un echec : c'est l'aveu que le resultat unique d'un
 * enchainement `a && b` ne dit pas **laquelle** des deux a echoue. Inventer un
 * verdict serait pire que de ne pas en donner.
 */
export type ValidationOutcome = "passed" | "failed" | "unknown";

/** Libelle de timeline, par issue. */
const VALIDATION_LABELS: Record<ValidationOutcome, string> = {
  passed: "Validation succeeded",
  failed: "Validation failed",
  unknown: "Validation result unclear",
};

/**
 * Nombre maximal d'appels d'outils suivis simultanement.
 *
 * Un `tool_result` sans `tool_use` correspondant est possible — flux tronque,
 * message perdu — et sans borne la table grandirait indefiniment sur une
 * execution longue.
 */
const MAX_PENDING_TOOLS = 512;

export type NormalizerOptions = {
  /**
   * Commandes de validation autorisees pour cette execution.
   *
   * Une commande Bash n'est affichee que si **chacun de ses segments**
   * correspond exactement a l'une d'elles, ou a une commande Git en lecture
   * seule. Tout le reste devient « Running an allowed command » : le prompt peut
   * contenir une valeur, un chemin ou un secret, et NOX ne cherche pas a
   * distinguer les cas.
   *
   * Ces memes commandes servent a reconnaitre les validations. Une commande Git
   * en lecture seule n'est **pas** une validation par nature — mais elle le
   * devient des lors que la tache l'a enregistree comme telle. La classification
   * generique ne prime jamais sur la liste de la tache.
   */
  allowedCommands: readonly string[];
  /**
   * Recoit ce que le flux apprend des commandes de validation.
   *
   * ## Une exception etroite, et assumee
   *
   * TASK-010 pose que le contenu d'un `tool_result` n'est jamais transmis : seule
   * son issue l'est. TASK-011 ouvre **une** breche, aussi etroite que possible :
   * la sortie d'un `tool_result` peut etre resumee, mais uniquement lorsque son
   * `tool_use` correspond **mot pour mot** a une commande de validation que
   * l'utilisateur a lui-meme enregistree. Cette sortie ne devient jamais un
   * evenement de timeline — elle n'existe que dans la review, ou l'utilisateur
   * vient precisement chercher « pourquoi le test a echoue ».
   *
   * Tout autre `tool_result` reste ce qu'il etait : une issue, et rien de plus.
   */
  onValidation?: (observation: ValidationObservation) => void;
};

/**
 * Traducteur d'un flux, avec la memoire des outils en cours.
 *
 * Une classe plutot que des fonctions libres : relier un `tool_result` a son
 * `tool_use` demande de se souvenir, et cet etat doit vivre le temps d'une
 * execution — ni plus, ni moins.
 */
export class ClaudeEventNormalizer {
  readonly #pending = new Map<string, PendingTool>();
  readonly #allowedCommands: readonly string[];
  readonly #onValidation: ((observation: ValidationObservation) => void) | null;

  constructor(options: NormalizerOptions) {
    this.#allowedCommands = options.allowedCommands;
    this.#onValidation = options.onValidation ?? null;
  }

  /**
   * Traduit un message en zero, un ou plusieurs evenements publics.
   *
   * Zero est un resultat normal et frequent : un message de raisonnement, un
   * type inconnu, ou un message assistant ne contenant qu'un bloc ignore ne
   * produisent rien. Ne leve jamais.
   */
  next(message: ClaudeStreamMessage): ClaudeRunEventDraft[] {
    const type = readString(message, "type");

    switch (type) {
      case "system":
        return this.#fromSystem(message);
      case "assistant":
        return this.#fromAssistant(message);
      case "user":
        return this.#fromUser(message);
      case "result":
        return this.#fromResult(message);
      default:
        // Type inconnu : ignore. NOX ne sait pas ce qu'il contient, donc il
        // n'en affiche rien — pas meme le nom du type, qui pourrait etre choisi.
        return [];
    }
  }

  /** `system` / `init` : le seul moment ou l'on sait que le processus a demarre. */
  #fromSystem(message: ClaudeStreamMessage): ClaudeRunEventDraft[] {
    if (readString(message, "subtype") !== "init") {
      return [];
    }
    // « Started » est emis par NOX au lancement du processus ; celui-ci dit
    // autre chose — que Claude Code a bel et bien demarre sa session, ce qui
    // n'est pas garanti par le simple fait d'avoir lance un executable.
    return [
      {
        kind: CLAUDE_RUN_EVENT_KIND.STATUS,
        label: "Claude Code ready",
        detail: null,
        toolName: null,
        isError: false,
      },
    ];
  }

  #fromAssistant(message: ClaudeStreamMessage): ClaudeRunEventDraft[] {
    const envelope = readRecord(message, "message");
    if (envelope === null) {
      return [];
    }

    const drafts: ClaudeRunEventDraft[] = [];

    for (const raw of readArray(envelope, "content")) {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        continue;
      }
      const block = raw as Record<string, unknown>;
      const blockType = readString(block, "type");

      // La liste est fermee : ce qui n'y figure pas est ignore, y compris et
      // surtout `thinking` et `redacted_thinking`.
      if (blockType === null || !VISIBLE_ASSISTANT_BLOCKS.has(blockType)) {
        continue;
      }

      // Ceinture et bretelles : un bloc qui porte une signature est un bloc de
      // raisonnement, quel que soit le nom qu'il se donne.
      if ("signature" in block || "thinking" in block) {
        continue;
      }

      if (blockType === "text") {
        const text = readString(block, "text") ?? "";
        if (text.trim() === "") {
          continue;
        }
        drafts.push({
          kind: CLAUDE_RUN_EVENT_KIND.ASSISTANT_MESSAGE,
          label: "Assistant message",
          detail: text,
          toolName: null,
          isError: false,
        });
        continue;
      }

      drafts.push(this.#fromToolUse(block));
    }

    return drafts;
  }

  #fromToolUse(block: Record<string, unknown>): ClaudeRunEventDraft {
    const name = readString(block, "name") ?? "Tool";
    const input = readRecord(block, "input") ?? {};
    const id = readString(block, "id");

    const reading =
      name === "Bash"
        ? readBashCommand(readString(input, "command") ?? "", this.#allowedCommands)
        : { display: null, validations: [] as readonly string[] };

    if (id !== null) {
      this.#remember(id, { name, validationCommands: reading.validations });
    }

    for (const command of reading.validations) {
      this.#onValidation?.({ kind: "started", command });
    }

    return {
      kind: CLAUDE_RUN_EVENT_KIND.TOOL_STARTED,
      label: describeToolUse(name, input, () => reading.display),
      detail: null,
      toolName: name,
      isError: false,
    };
  }

  #fromUser(message: ClaudeStreamMessage): ClaudeRunEventDraft[] {
    const envelope = readRecord(message, "message");
    if (envelope === null) {
      return [];
    }

    const drafts: ClaudeRunEventDraft[] = [];

    for (const raw of readArray(envelope, "content")) {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        continue;
      }
      const block = raw as Record<string, unknown>;
      if (readString(block, "type") !== "tool_result") {
        continue;
      }

      const id = readString(block, "tool_use_id");
      const pending = id === null ? undefined : this.#pending.get(id);
      if (id !== null) {
        this.#pending.delete(id);
      }

      const failed = readBoolean(block, "is_error") === true;
      const toolName = pending?.name ?? null;

      // Une validation merite son propre type : c'est le seul evenement de la
      // timeline qui porte un verdict sur le code, et non sur l'agent.
      const validations = pending?.validationCommands ?? [];
      if (validations.length > 0) {
        // Avec un chainage `&&`, une reussite prouve que **tous** les segments
        // ont tourne et reussi. Un echec, lui, ne dit pas lequel a echoue :
        // quand la ligne portait plusieurs validations, l'issue reste inconnue.
        const outcome: ValidationOutcome = !failed
          ? "passed"
          : validations.length === 1
            ? "failed"
            : "unknown";

        for (const command of validations) {
          this.#onValidation?.({
            kind: "finished",
            command,
            outcome,
            // Aucun code de sortie n'est deduit du booleen d'erreur : « echoue »
            // ne veut pas dire « code 1 ». S'il n'est pas rapporte, il reste nul.
            exitCode: readNumber(block, "exit_code") ?? readNumber(block, "exitCode"),
            output: readToolResultText(block),
          });
        }

        drafts.push({
          kind: CLAUDE_RUN_EVENT_KIND.VALIDATION,
          label: VALIDATION_LABELS[outcome],
          detail: null,
          toolName,
          isError: outcome === "failed",
        });
        continue;
      }

      drafts.push({
        kind: failed ? CLAUDE_RUN_EVENT_KIND.ERROR : CLAUDE_RUN_EVENT_KIND.TOOL_COMPLETED,
        // Le contenu du resultat n'est jamais transmis : seule son issue l'est.
        label: failed ? `${toolName ?? "Tool"} failed` : `${toolName ?? "Tool"} completed`,
        detail: null,
        toolName,
        isError: failed,
      });
    }

    return drafts;
  }

  #fromResult(message: ClaudeStreamMessage): ClaudeRunEventDraft[] {
    const isError = readBoolean(message, "is_error") === true;
    return [
      {
        kind: CLAUDE_RUN_EVENT_KIND.RESULT,
        label: isError ? "Finished with an error" : "Completed",
        // Le compte rendu complet a sa propre section sur la page ; le repeter
        // dans la timeline doublerait la donnee la plus volumineuse du run.
        detail: null,
        toolName: null,
        isError,
      },
    ];
  }

  #remember(id: string, tool: PendingTool): void {
    if (this.#pending.size >= MAX_PENDING_TOOLS) {
      // Le plus ancien part : un `tool_use` sans resultat apres des centaines
      // d'appels ne recevra plus jamais le sien.
      const oldest = this.#pending.keys().next();
      if (!oldest.done) {
        this.#pending.delete(oldest.value);
      }
    }
    this.#pending.set(id, tool);
  }

}

/**
 * Extrait le texte d'un `tool_result`, sans jamais depasser une borne.
 *
 * Le champ `content` prend deux formes selon les versions : une chaine, ou une
 * liste de blocs typés. Les deux sont lues ; tout le reste est ignore. Aucun
 * bloc autre que `text` n'est regarde — une image ou un contenu inconnu n'a rien
 * a faire dans un resume de validation.
 */
function readToolResultText(block: Record<string, unknown>): string | null {
  const content: unknown = block["content"];

  if (typeof content === "string") {
    return bound(content);
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const pieces: string[] = [];
  let length = 0;

  for (const raw of content) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      continue;
    }
    const piece = raw as Record<string, unknown>;
    if (readString(piece, "type") !== "text") {
      continue;
    }
    const text = readString(piece, "text");
    if (text === null) {
      continue;
    }
    pieces.push(text);
    length += text.length;
    if (length >= MAX_RAW_VALIDATION_OUTPUT) {
      break;
    }
  }

  return pieces.length === 0 ? null : bound(pieces.join("\n"));
}

function bound(value: string): string {
  return value.length <= MAX_RAW_VALIDATION_OUTPUT
    ? value
    : value.slice(0, MAX_RAW_VALIDATION_OUTPUT);
}

/**
 * Phrase decrivant un appel d'outil.
 *
 * Isolee et pure : c'est elle que les tests interrogent pour verifier qu'aucun
 * contenu de fichier, aucune commande non autorisee et aucun motif demesure n'y
 * apparait.
 */
export function describeToolUse(
  name: string,
  input: Record<string, unknown>,
  describeCommand: (command: string) => string | null,
): string {
  switch (name) {
    case "Read":
    case "NotebookRead":
      return withTarget("Reading", readString(input, "file_path") ?? readString(input, "path"));

    case "Edit":
    case "NotebookEdit":
      return withTarget("Editing", readString(input, "file_path") ?? readString(input, "path"));

    case "Write":
      return withTarget("Writing", readString(input, "file_path") ?? readString(input, "path"));

    case "Grep": {
      const pattern = readString(input, "pattern");
      return pattern === null || pattern.length > MAX_PATTERN_LENGTH
        ? "Searching the repository"
        : `Searching for ${JSON.stringify(pattern)}`;
    }

    case "Glob": {
      const pattern = readString(input, "pattern");
      return pattern === null || pattern.length > MAX_PATTERN_LENGTH
        ? "Scanning files"
        : `Scanning ${pattern}`;
    }

    case "Bash": {
      // Le seul cas ou une commande est reproduite : chacun de ses segments a
      // ete valide mot pour mot en amont, donc elle ne peut rien contenir que
      // NOX n'ait deja accepte. Le prefixe de navigation, lui, a disparu — il
      // porte un chemin absolu de la machine.
      const shown = describeCommand(readString(input, "command") ?? "");
      return shown === null ? "Running an allowed command" : `Running ${shown}`;
    }

    default:
      // Un outil inconnu est nomme, jamais decrit : son entree peut contenir
      // n'importe quoi, et NOX n'a aucune regle pour la lire sans risque.
      return `Using ${name}`;
  }
}

/**
 * « Reading README.md », ou « Reading a file » quand le chemin manque.
 *
 * Le chemin n'est pas rendu relatif ici : c'est le nettoyeur qui s'en charge,
 * pour toutes les chaines a la fois. Deux endroits qui reecrivent des chemins
 * finiraient par diverger, et l'un des deux serait oublie.
 */
function withTarget(verb: string, target: string | null): string {
  const trimmed = target?.trim() ?? "";
  return trimmed === "" ? `${verb} a file` : `${verb} ${trimmed}`;
}
