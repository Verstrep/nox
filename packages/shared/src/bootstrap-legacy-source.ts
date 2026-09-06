/**
 * Le rendu **tronque** d'avant HOTFIX-007, conserve pour une seule raison.
 *
 * ## Pourquoi garder du code qu'on vient de corriger
 *
 * Parce qu'une tache d'amorcage deja creee porte ce texte-la, et qu'il est la
 * seule preuve disponible de ce a partir de quoi elle a ete construite. NOX
 * n'enregistre aucun instantane de la source d'une `TASK-000` : ajouter une
 * colonne aujourd'hui n'aiderait que les taches de demain, et laisserait le
 * pilote qui a paye le defaut sans recours.
 *
 * Rejouer ce rendu sur l'etat canonique **actuel** repond exactement a la
 * question qui compte : le brief, le plan et la memoire d'aujourd'hui sont-ils
 * ceux qui ont produit ce texte ? Si le rejeu reproduit ce qui est stocke, la
 * source n'a pas bouge, et NOX peut restituer ce qu'il avait omis. Sinon, la
 * source a change, et completer la tache reviendrait a lui substituer un
 * contrat que personne n'a valide.
 *
 * ## Il ne produit plus rien
 *
 * Aucune tache nouvelle ne passe par ici. Ce module est un lecteur du passe :
 * il ne construit aucun contrat, n'entre dans aucun prompt, et ne doit jamais
 * redevenir un chemin d'ecriture.
 */

import type { ArchitectPromptMemory } from "./project-memory.js";
import type { ArchitectPromptBrief, ArchitectPromptV1Plan } from "./project-plan.js";
import { BOOTSTRAP_SOURCE_HEADINGS, type BootstrapSourceInput } from "./bootstrap-source.js";

/**
 * Bornes du rendu de l'epoque, recopiees telles quelles.
 *
 * Elles ne sont **pas** importees de `BOOTSTRAP_SPEC_LIMITS` : celles-la vont
 * evoluer, et le rejeu doit continuer de reproduire ce qui a reellement ete
 * ecrit. Un rejeu qui suivrait les bornes du jour cesserait de reconnaitre les
 * taches qu'il existe pour reconnaitre.
 */
export const LEGACY_BOOTSTRAP_LIMITS = {
  field: 600,
  list: { max: 12, length: 300 },
  memories: { max: 20, length: 400, title: 200, rationale: 200 },
  context: 12_000,
} as const;

/** Le raccourcisseur de l'epoque, au caractere pres. */
export function legacyTruncate(value: string, limit: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function legacyBulletList(
  values: readonly string[],
  limit: number,
  length: number,
): string[] {
  return values
    .map((value) => legacyTruncate(value, length))
    .filter((value) => value !== "")
    .slice(0, limit);
}

function legacyBlock(title: string, lines: readonly string[]): string {
  return [`### ${title}`, "", ...lines].join("\n");
}

function legacyListLines(values: readonly string[]): string[] {
  return values.length === 0 ? ["- (aucun)"] : values.map((value) => `- ${value}`);
}

function legacyBriefBlock(brief: ArchitectPromptBrief | null): string {
  if (brief === null) {
    return legacyBlock(BOOTSTRAP_SOURCE_HEADINGS.brief, ["Non defini."]);
  }
  const { field, list } = LEGACY_BOOTSTRAP_LIMITS;
  return legacyBlock(BOOTSTRAP_SOURCE_HEADINGS.brief, [
    `Resume : ${legacyTruncate(brief.summary, field)}`,
    `Probleme : ${legacyTruncate(brief.problem, field)}`,
    `Utilisateurs vises : ${legacyTruncate(brief.targetUsers, field)}`,
    `Resultat attendu : ${legacyTruncate(brief.desiredOutcome, field)}`,
    "",
    "Objectifs :",
    ...legacyListLines(legacyBulletList(brief.goals, list.max, list.length)),
    "",
    "Hors objectifs :",
    ...legacyListLines(legacyBulletList(brief.nonGoals, list.max, list.length)),
  ]);
}

function legacyPlanBlock(plan: ArchitectPromptV1Plan | null): string {
  if (plan === null) {
    return legacyBlock(BOOTSTRAP_SOURCE_HEADINGS.plan, ["Non defini."]);
  }
  const { field, list } = LEGACY_BOOTSTRAP_LIMITS;
  return legacyBlock(BOOTSTRAP_SOURCE_HEADINGS.plan, [
    `Objectif de V1 : ${legacyTruncate(plan.goal, field)}`,
    `Direction technique : ${legacyTruncate(plan.technicalDirection, field)}`,
    "",
    "Dans le perimetre :",
    ...legacyListLines(legacyBulletList(plan.inScope, list.max, list.length)),
    "",
    "Hors perimetre :",
    ...legacyListLines(legacyBulletList(plan.outOfScope, list.max, list.length)),
    "",
    "Etapes :",
    ...legacyListLines(legacyBulletList(plan.milestones, list.max, list.length)),
  ]);
}

function legacyMemoryBlock(memories: readonly ArchitectPromptMemory[]): string {
  if (memories.length === 0) {
    return legacyBlock(BOOTSTRAP_SOURCE_HEADINGS.memory, ["Aucune entree active."]);
  }
  const limits = LEGACY_BOOTSTRAP_LIMITS.memories;
  const lines = memories.slice(0, limits.max).map((memory) => {
    const rationale =
      memory.rationale === null
        ? ""
        : ` (${legacyTruncate(memory.rationale, limits.rationale)})`;
    return (
      `- ${memory.code} · ${memory.category} · ` +
      `${legacyTruncate(memory.title, limits.title)} : ` +
      `${legacyTruncate(memory.content, limits.length)}${rationale}`
    );
  });
  return legacyBlock(BOOTSTRAP_SOURCE_HEADINGS.memory, [
    "Decisions, contraintes et conventions enregistrees explicitement. Elles",
    "s'appliquent des l'amorcage.",
    "",
    ...lines,
  ]);
}

/**
 * Les trois sections contractuelles telles que le rendu de l'epoque les ecrivait.
 *
 * L'ordre est celui du contexte d'amorcage — brief, plan, memoire — et les
 * separateurs sont ceux de l'assemblage d'alors.
 */
export function renderLegacyBootstrapSource(input: BootstrapSourceInput): string {
  return [
    legacyBriefBlock(input.brief),
    legacyPlanBlock(input.v1Plan),
    legacyMemoryBlock(input.memories),
  ].join("\n\n");
}

/**
 * L'etat canonique actuel a-t-il produit ce texte-la ?
 *
 * Le contexte stocke est le rendu complet de l'epoque, **tronque** a douze mille
 * caracteres : la comparaison doit donc accepter que l'un des deux s'arrete plus
 * tot. Comme la troncature ne retire que des caracteres de fin, ce qui reste est
 * un vrai prefixe — et deux prefixes du meme texte sont toujours prefixe l'un de
 * l'autre. C'est exactement ce qui est verifie, dans les deux sens :
 *
 * - la tache s'arrete avant la fin des sections de source ;
 * - la tache continue au-dela, sur les sections de presentation.
 *
 * Un seul caractere de difference dans le brief, le plan ou la memoire fait
 * echouer les deux — et c'est le but.
 */
export function legacyBootstrapSourceMatches(
  storedContext: string,
  input: BootstrapSourceInput,
): boolean {
  const anchor = `### ${BOOTSTRAP_SOURCE_HEADINGS.brief}`;
  const start = storedContext.indexOf(anchor);
  if (start === -1) {
    return false;
  }

  const stored = storedContext.slice(start);
  // La troncature de l'epoque signalait sa coupe par un point de suspension.
  // Il n'appartient pas au texte d'origine : le retirer avant de comparer.
  const cut = stored.endsWith("…") ? stored.slice(0, -1) : stored;
  const replayed = renderLegacyBootstrapSource(input);

  return replayed.startsWith(cut) || cut.startsWith(replayed);
}
