/**
 * Generateur du prompt d'execution envoye a Claude Code.
 *
 * Fonction pure et deterministe : memes donnees, meme prompt, caractere pour
 * caractere. C'est ce qui permet de le prévisualiser avant lancement, d'en
 * calculer une empreinte, et de le regenerer cote serveur au moment du
 * lancement plutot que de faire confiance a ce que le navigateur renvoie.
 *
 * ## Ce que le prompt ne contient pas
 *
 * Ni chemin absolu, ni jeton, ni variable d'environnement, ni contenu de
 * fichier. Il **reference** les documents du repository au lieu de les recopier :
 * l'agent sait les lire, et un prompt qui embarquerait toute la documentation
 * couterait cher a chaque execution tout en devenant faux des la premiere
 * modification d'un document.
 *
 * Ni statut, ni priorite non plus — pour la meme raison que dans le document de
 * tache : ces valeurs changent sans que la specification change, et un prompt
 * qui en depend n'est plus reproductible.
 *
 * Aucune donnee d'une execution precedente n'y figure : chaque lancement part de
 * la meme base.
 */

import { boundText, RUN_LIMITS } from "./runs.js";
import type { TaskSpecification } from "./tasks.js";

/** Ramene une valeur a une seule ligne, sans marges. */
function toSingleLine(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();
}

/** Normalise un bloc de texte libre : fins de ligne LF, sans marges. */
function normalizeBlock(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

/** Retire les entrees vides d'une liste, en conservant l'ordre de saisie. */
function usableEntries(entries: readonly string[]): string[] {
  return entries.map(toSingleLine).filter((entry) => entry !== "");
}

/**
 * Regles d'execution, constantes.
 *
 * Elles reprennent mot pour mot les contraintes que NOX applique par ailleurs :
 * les permissions d'outils empechent deja techniquement le commit et le push, et
 * le preflight garantit un repository propre. Les redire ici n'est pas une
 * redondance inutile — un agent qui comprend *pourquoi* une action est interdite
 * cherche moins a la contourner qu'un agent qui se heurte a un refus opaque.
 */
function executionRules(taskCode: string): string {
  return [
    `- implémente uniquement ${taskCode} ;`,
    "- ne commence aucune autre tâche ;",
    "- ne crée aucun commit ;",
    "- ne lance aucun push ;",
    "- ne modifie pas l'historique Git ;",
    "- ne change pas de branche ;",
    "- ne lis aucun secret ni fichier .env ;",
    "- ne travaille qu'à l'intérieur du repository ;",
    "- respecte CLAUDE.md et les instructions locales applicables ;",
    "- si une information mineure manque, fais une hypothèse raisonnable et documente-la ;",
    "- si une décision produit réellement bloquante manque, termine avec un statut bloqué et",
    "  explique précisément la décision requise.",
  ].join("\n");
}

const BEFORE_MODIFYING = [
  "1. vérifie git status ;",
  "2. lis le document de tâche ;",
  "3. inspecte les fichiers concernés ;",
  "4. présente brièvement ton plan dans tes propres logs.",
].join("\n");

const REPORT_SECTIONS = [
  "## Résultat",
  "## Fonctionnalités réalisées",
  "## Fichiers modifiés",
  "## Validations exécutées",
  "## Erreurs ou blocages",
  "## Décisions prises",
  "## Dette ou limites",
  "## Git",
].join("\n");

/**
 * Rend le prompt d'execution d'une tache.
 *
 * `documentPath` est le chemin **relatif** du document de tache : le prompt ne
 * doit contenir aucun chemin absolu.
 */
export function renderClaudeExecutionPrompt(
  task: TaskSpecification & { documentPath: string },
): string {
  const code = task.code;
  const title = toSingleLine(task.title);
  const blocks: string[] = [];

  blocks.push("Tu travailles sur le projet associé à cette tâche.");

  blocks.push(`Tâche active :\n${title === "" ? code : `${code} — ${title}`}`);

  // Les documents sont **references**, jamais recopies : l'agent les lira
  // lui-meme, a jour, plutot que d'en recevoir une copie deja perimee.
  const readingList = [
    "CLAUDE.md",
    "AGENTS.md s'il existe",
    task.documentPath,
    ...usableEntries(task.documentReferences),
  ];
  blocks.push(
    `Avant toute modification, lis obligatoirement :\n${readingList
      .map((entry) => `- ${entry}`)
      .join("\n")}`,
  );

  const objective = normalizeBlock(task.objective);
  if (objective !== "") {
    blocks.push(`Objectif :\n${objective}`);
  }

  const context = task.context === null ? "" : normalizeBlock(task.context);
  if (context !== "") {
    blocks.push(`Contexte :\n${context}`);
  }

  const criteria = usableEntries(task.acceptanceCriteria);
  if (criteria.length > 0) {
    blocks.push(
      `Critères d'acceptation :\n${criteria.map((entry) => `- ${entry}`).join("\n")}`,
    );
  }

  const outOfScope = task.outOfScope === null ? "" : normalizeBlock(task.outOfScope);
  if (outOfScope !== "") {
    blocks.push(`Hors périmètre :\n${outOfScope}`);
  }

  blocks.push(`Règles :\n${executionRules(code)}`);

  blocks.push(`Avant de modifier :\n${BEFORE_MODIFYING}`);

  // Les commandes autorisees sont annoncees explicitement : l'agent doit savoir
  // que le reste sera refuse, plutot que de le decouvrir en se heurtant a un
  // refus de permission au milieu de son travail.
  const commands = usableEntries(task.validationCommands);
  const validationStep =
    commands.length === 0
      ? "1. aucune commande de validation n'est enregistrée pour cette tâche : n'en lance aucune ;"
      : [
          "1. exécute uniquement les commandes de validation autorisées ci-dessous, qui sont les",
          "   seules commandes applicatives préautorisées :",
          ...commands.map((entry) => `   - ${entry}`),
        ].join("\n");

  blocks.push(
    [
      "À la fin :",
      validationStep,
      "2. corrige les erreurs directement liées à la tâche ;",
      "3. vérifie git status et git diff --stat ;",
      "4. ne crée aucun commit ;",
      "5. fournis un compte rendu structuré.",
    ].join("\n"),
  );

  blocks.push(`Compte rendu final :\n${REPORT_SECTIONS}`);

  // Une borne, comme partout ailleurs : un prompt demesure serait refuse par le
  // runner, autant qu'il le soit ici de facon lisible et deterministe.
  return boundText(`${blocks.join("\n\n")}\n`, RUN_LIMITS.prompt);
}
