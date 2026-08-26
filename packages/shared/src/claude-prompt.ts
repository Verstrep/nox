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
import type { TaskDependencyRef } from "./task-dependencies.js";
import { TASK_KIND, type TaskKind, type TaskSpecification } from "./tasks.js";
import { VERIFICATION_MODE, type VerificationPlan } from "./verification.js";

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
function executionRules(taskCode: string, kind: TaskKind): string {
  return [
    `- implémente uniquement ${taskCode} ;`,
    "- ne commence aucune autre tâche ;",
    "- ne crée aucun commit ;",
    "- ne lance aucun push ;",
    "- ne modifie pas l'historique Git ;",
    "- ne change pas de branche ;",
    "- ne lis aucun secret ni fichier .env ;",
    "- ne travaille qu'à l'intérieur du repository ;",
    // Une tache d'amorcage a le droit d'installer ; elle n'a pas pour autant le
    // droit d'installer ailleurs, ni de publier ce qu'elle vient de creer.
    ...(kind === TASK_KIND.BOOTSTRAP
      ? [
          "- n'installe et ne modifie rien en dehors du repository ;",
          "- ne publie, ne déploie et ne provisionne rien ;",
        ]
      : []),
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

/**
 * Sections du compte rendu, selon la nature de la tache.
 *
 * L'amorcage en demande deux la ou les autres n'en demandent qu'une. La raison
 * est apparue au premier run reel : une tache d'amorcage n'a **aucune** commande
 * de validation enregistree avant son lancement, et pourtant elle installe,
 * construit et teste la fondation qu'elle vient de choisir. Une seule section
 * « Validations exécutées » aurait alors affiche « aucune » juste apres que
 * l'agent a lance une build et une suite de tests — un compte rendu faux.
 *
 * Les deux sections repondent donc a deux questions distinctes : ce qui etait
 * **connu avant**, et ce qui a **reellement tourne**.
 */
export function validationReportSections(kind: TaskKind): string[] {
  return kind === TASK_KIND.BOOTSTRAP
    ? [
        "## Validations structurées configurées avant l'exécution",
        "## Installation et vérification de la fondation réellement exécutées",
      ]
    : ["## Validations exécutées"];
}

function reportSections(kind: TaskKind): string {
  const validationSections = validationReportSections(kind);

  return [
    "## Résultat",
    "## Fonctionnalités réalisées",
    "## Fichiers modifiés",
    ...validationSections,
    "## Erreurs ou blocages",
    "## Décisions prises",
    "## Dette ou limites",
    "## Git",
  ].join("\n");
}

/**
 * Ce que l'agent doit lancer, ou ne pas lancer, a la fin de son travail.
 *
 * Les commandes autorisees sont annoncees explicitement : l'agent doit savoir ce
 * qui sera refuse, plutot que de le decouvrir en se heurtant a un refus de
 * permission au milieu de son travail.
 *
 * ## Pourquoi l'amorcage lit autre chose
 *
 * Le premier run reel de TASK-000 a bute exactement ici. Le prompt disait « aucune
 * commande de validation n'est enregistrée pour cette tâche : n'en lance aucune »,
 * et l'agent a livre un repository dont les dependances n'etaient pas installees,
 * sans fichier de verrouillage, dont ni la build ni les tests n'avaient tourne.
 *
 * La phrase etait juste pour ce qu'elle designait — les validations structurees —
 * et fausse pour ce qu'elle laissait entendre. Une tache d'amorcage **choisit sa
 * pile pendant son execution** : ses commandes d'installation ne pouvaient pas
 * etre enregistrees avant, et leur absence ne veut donc pas dire qu'il n'y a rien
 * a lancer.
 *
 * Les deux idees restent distinctes, et le texte les separe : ne pas inventer de
 * validation structuree, et pouvoir installer puis verifier ce que l'on vient de
 * creer.
 */
export const BOOTSTRAP_SETUP_STEP = [
  "1. aucune commande de validation structurée n'était connue avant cette exécution :",
  "   n'invente aucune validation étrangère à l'amorçage. Tu peux en revanche exécuter,",
  "   dans ce repository, les commandes d'installation et de vérification devenues",
  "   nécessaires pour établir puis vérifier la fondation que tu viens de choisir ou de",
  "   constater :",
  "   - installe les dépendances de la pile retenue ;",
  "   - produis le fichier de verrouillage lorsque l'écosystème en utilise un ;",
  "   - lance la build si la pile en possède une ;",
  "   - lance les tests si une commande de test existe ;",
  "   - vérifie raisonnablement le démarrage, sans laisser tourner un serveur permanent",
  "     qui bloquerait l'exécution ;",
  "   - corrige les erreurs liées à cette installation ;",
  "   - si une commande t'est refusée, ne cherche pas à la contourner : dis-le dans ton",
  "     compte rendu, et indique ce qui reste non vérifié ;",
].join("\n");

function finalValidationStep(kind: TaskKind, commands: readonly string[]): string {
  if (kind === TASK_KIND.BOOTSTRAP) {
    // Une tache d'amorcage peut malgre tout porter des commandes enregistrees, si
    // l'utilisateur en a ajoute avant de lancer. Elles s'ajoutent au setup ; elles
    // ne le remplacent pas.
    return commands.length === 0
      ? BOOTSTRAP_SETUP_STEP
      : [
          BOOTSTRAP_SETUP_STEP,
          "   Exécute également les commandes de validation enregistrées avec la tâche :",
          ...commands.map((entry) => `   - ${entry}`),
        ].join("\n");
  }

  return commands.length === 0
    ? "1. aucune commande de validation n'est enregistrée pour cette tâche : n'en lance aucune ;"
    : [
        "1. exécute uniquement les commandes de validation autorisées ci-dessous, qui sont les",
        "   seules commandes applicatives préautorisées :",
        ...commands.map((entry) => `   - ${entry}`),
      ].join("\n");
}
/**
 * Rend le prompt d'execution d'une tache.
 *
 * `documentPath` est le chemin **relatif** du document de tache : le prompt ne
 * doit contenir aucun chemin absolu.
 */
/**
 * Dependances revalidees juste avant ce lancement.
 *
 * Elles sont **toutes** terminees : le serveur refuse le lancement sinon. Le
 * bloc n'existe donc pas pour informer d'une attente, mais pour rendre le
 * prompt historique explicite — dans six mois, il dira sur quoi cette execution
 * s'appuyait.
 *
 * Codes et titres seulement. Recopier leurs specifications completes ferait
 * grossir le prompt sans rien apprendre : l'agent sait lire `tasks/TASK-xxx.md`
 * s'il en a besoin.
 */
function dependencyBlock(dependencies: readonly TaskDependencyRef[]): string | null {
  if (dependencies.length === 0) {
    return null;
  }
  const lines = dependencies.map((entry) => {
    const title = toSingleLine(entry.title);
    return title === "" ? `- ${entry.code}` : `- ${entry.code} — ${title}`;
  });
  return [
    "Dépendances satisfaites avant cette exécution :",
    ...lines,
    "",
    "Leur travail est déjà en place dans le repository : appuie-toi dessus plutôt que",
    "de le refaire.",
  ].join("\n");
}

/**
 * Le plan de verification, tel qu'il est annonce a Claude Code.
 *
 * Il dit trois choses, et la troisieme est la plus importante : NOX executera
 * ces commandes **lui-meme**. Les lancer pendant le travail reste utile — c'est
 * la facon la plus simple de savoir ou on en est — mais leur resultat ne
 * remplace pas la verification independante qui suivra.
 */
function verificationPlanBlock(plan: VerificationPlan): string | null {
  const criteria = [...plan.criteria].sort((left, right) => left.position - right.position);
  if (criteria.length === 0) {
    return null;
  }

  const commandsById = new Map(plan.commands.map((command) => [command.id, command.command]));
  const lines: string[] = ["Plan de vérification convenu avant cette exécution :"];

  const automated = criteria.filter(
    (criterion) => criterion.verificationMode === VERIFICATION_MODE.AUTOMATED,
  );
  const human = criteria.filter(
    (criterion) => criterion.verificationMode === VERIFICATION_MODE.HUMAN,
  );

  if (automated.length > 0) {
    lines.push("");
    lines.push("Vérifié automatiquement par NOX après ton travail :");
    for (const criterion of automated) {
      lines.push(`- ${toSingleLine(criterion.text)}`);
      for (const id of criterion.commandIds) {
        const command = commandsById.get(id);
        if (command !== undefined && command !== "") {
          lines.push(`  - ${command}`);
        }
      }
    }
  }

  if (human.length > 0) {
    lines.push("");
    lines.push("Validation humaine :");
    for (const criterion of human) {
      lines.push(`- ${toSingleLine(criterion.text)}`);
      const instructions = toSingleLine(criterion.humanInstructions ?? "");
      if (instructions !== "") {
        lines.push(`  - ${instructions}`);
      }
    }
  }

  if (automated.length > 0) {
    lines.push("");
    lines.push(
      "NOX exécutera lui-même les commandes ci-dessus après la fin de ton exécution. " +
        "Tu peux les lancer pendant ton travail, et c'est recommandé — mais ce résultat ne " +
        "remplace pas la vérification indépendante de NOX, qui seule fait foi.",
    );
  }

  return lines.join("\n");
}

export function renderClaudeExecutionPrompt(
  task: TaskSpecification & { documentPath: string; kind: TaskKind },
  dependencies: readonly TaskDependencyRef[] = [],
  plan: VerificationPlan | null = null,
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

  // Le plan de verification convenu **avant** cette execution.
  //
  // Claude Code doit savoir ce que NOX verifiera lui-meme apres son travail, et
  // ce qu'un humain testera encore. Le lui dire l'encourage a produire du code
  // verifiable et des tests appropries — et lui retire toute raison de croire
  // qu'un compte rendu optimiste suffirait.
  const planBlock = plan === null ? null : verificationPlanBlock(plan);
  if (planBlock !== null) {
    blocks.push(planBlock);
  }

  const dependencyLines = dependencyBlock(dependencies);
  if (dependencyLines !== null) {
    blocks.push(dependencyLines);
  }

  blocks.push(`Règles :\n${executionRules(code, task.kind)}`);

  blocks.push(`Avant de modifier :\n${BEFORE_MODIFYING}`);

  const commands = usableEntries(task.validationCommands);
  const validationStep = finalValidationStep(task.kind, commands);

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

  blocks.push(`Compte rendu final :\n${reportSections(task.kind)}`);

  // Une borne, comme partout ailleurs : un prompt demesure serait refuse par le
  // runner, autant qu'il le soit ici de facon lisible et deterministe.
  return boundText(`${blocks.join("\n\n")}\n`, RUN_LIMITS.prompt);
}
