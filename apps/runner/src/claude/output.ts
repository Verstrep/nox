/**
 * Analyse de la sortie de Claude Code.
 *
 * Le mode non interactif produit un objet JSON sur la sortie standard. Ce module
 * le lit **defensivement** : la version installee peut ne pas fournir tous les
 * champs, et une version ulterieure peut en ajouter. Un champ absent reste
 * absent — NOX n'invente ni cout, ni duree, ni nombre de tours.
 *
 * ## La detection de limite d'utilisation
 *
 * C'est le seul endroit de TASK-008 ou NOX interprete du texte libre, et cette
 * interpretation est deliberement prudente. Annoncer a tort « limite Claude
 * atteinte » enverrait l'utilisateur attendre une reinitialisation qui n'a pas
 * lieu d'etre, alors qu'une erreur generique le laisse simplement relire les
 * logs. En cas de doute, on choisit donc l'erreur generique.
 *
 * Aucune heure de reinitialisation n'est jamais deduite : Claude Code n'en
 * fournit pas de facon fiable, et une heure inventee serait pire qu'aucune.
 */

/** Resultat JSON de Claude Code, tous champs facultatifs. */
export type ClaudeJsonResult = {
  type: string | null;
  subtype: string | null;
  isError: boolean | null;
  result: string | null;
  sessionId: string | null;
  durationMs: number | null;
  durationApiMs: number | null;
  numTurns: number | null;
  totalCostUsd: number | null;
};

export type ParsedClaudeOutput =
  | { ok: true; result: ClaudeJsonResult }
  | { ok: false };

/**
 * Les tableaux sont exclus : `[1, 2, 3]` est un JSON valide mais pas un
 * resultat, et le laisser passer produirait un objet dont tous les champs sont
 * absents plutot qu'un refus franc.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

/**
 * Isole l'objet JSON de la sortie standard.
 *
 * Le mode `--output-format json` emet un seul objet, mais rien ne garantit qu'il
 * soit seul sur le flux : un avertissement ou une ligne de progression peut le
 * preceder. On tente donc la sortie entiere, puis, a defaut, la derniere ligne
 * qui ressemble a un objet — la derniere plutot que la premiere, parce que le
 * resultat final vient apres tout le reste.
 */
export function extractJsonPayload(stdout: string): unknown | undefined {
  const trimmed = stdout.trim();
  if (trimmed === "") {
    return undefined;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // Poursuite ci-dessous.
  }

  const lines = trimmed.split("\n").map((line) => line.trim());
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    if (!line.startsWith("{") || !line.endsWith("}")) {
      continue;
    }
    try {
      return JSON.parse(line);
    } catch {
      continue;
    }
  }

  return undefined;
}

/** Lit la sortie JSON de Claude Code, sans exiger de champ particulier. */
export function parseClaudeOutput(stdout: string): ParsedClaudeOutput {
  const payload = extractJsonPayload(stdout);
  if (!isRecord(payload)) {
    return { ok: false };
  }

  return {
    ok: true,
    result: {
      type: readString(payload, "type"),
      subtype: readString(payload, "subtype"),
      isError: readBoolean(payload, "is_error"),
      result: readString(payload, "result"),
      sessionId: readString(payload, "session_id"),
      durationMs: readNumber(payload, "duration_ms"),
      durationApiMs: readNumber(payload, "duration_api_ms"),
      numTurns: readNumber(payload, "num_turns"),
      totalCostUsd: readNumber(payload, "total_cost_usd"),
    },
  };
}

/**
 * Marqueurs de limite d'utilisation.
 *
 * Volontairement plusieurs, et volontairement generiques : dependre d'une phrase
 * exacte reviendrait a casser la detection au premier changement de formulation.
 * Chacun doit rester assez specifique pour ne pas capter une mention anodine
 * dans un compte rendu — d'ou la combinaison de deux familles ci-dessous.
 */
const LIMIT_SUBTYPES = ["usage_limit", "rate_limit", "quota_exceeded", "limit_reached"];

const LIMIT_PHRASES = [
  "usage limit",
  "rate limit",
  "quota exceeded",
  "too many requests",
  "limite d'utilisation",
  "429",
];

const LIMIT_CONTEXT = ["claude", "anthropic", "api", "plan", "subscription", "abonnement"];

function containsAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

/**
 * Determine si une execution a echoue sur une limite d'utilisation.
 *
 * Deux niveaux de confiance :
 *
 * 1. Le **sous-type JSON** l'annonce explicitement. Aucun doute possible.
 * 2. Le texte contient a la fois un marqueur de limite **et** un mot qui rattache
 *    ce marqueur a Claude. Une phrase comme « rate limit » seule, dans un compte
 *    rendu qui parle du code de l'utilisateur, ne suffit pas.
 *
 * Tout le reste retourne `false` : mieux vaut une erreur generique qu'une
 * affirmation fausse.
 */
export function detectUsageLimit(input: {
  parsed: ClaudeJsonResult | null;
  stderrTail: string;
  exitCode: number | null;
}): boolean {
  const subtype = input.parsed?.subtype?.toLowerCase() ?? "";
  if (subtype !== "" && containsAny(subtype, LIMIT_SUBTYPES)) {
    return true;
  }

  // Le compte rendu n'est examine que s'il est signale comme une erreur : un
  // texte qui *decrit* une limite dans un rapport reussi n'en est pas une.
  const reportedError = input.parsed?.isError === true ? (input.parsed.result ?? "") : "";
  const haystack = `${reportedError}\n${input.stderrTail}`.toLowerCase();

  if (haystack.trim() === "") {
    return false;
  }

  return containsAny(haystack, LIMIT_PHRASES) && containsAny(haystack, LIMIT_CONTEXT);
}
