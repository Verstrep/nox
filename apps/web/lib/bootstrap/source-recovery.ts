/**
 * Reparation de transport pour une tache d'amorcage generee avant HOTFIX-007.
 *
 * ## Le probleme, tel qu'il se pose sur une tache deja creee
 *
 * `TASK-000` porte un contrat gele. Il l'est pour de bonnes raisons : une tache
 * qui se reecrit pendant son execution ne prouve plus rien, et NOX refuse
 * partout de fusionner un etat qui a change. Mais la `TASK-000` du premier
 * pilote reel porte un contrat dont la **source** a ete tronquee par NOX
 * lui-meme — direction technique coupee au milieu d'un mot, six elements du
 * perimetre de V1 supprimes, cinq contenus de memoire raccourcis. Claude a
 * recopie ce qu'il avait recu et a refuse d'inventer la suite ; le critere
 * « restituer fidelement le brief et le plan » est donc devenu impossible a
 * approuver, sans que personne n'ait mal travaille.
 *
 * ## Ce que ce module autorise, et rien de plus
 *
 * Restituer la source canonique dans le prompt d'une correction **demandee par
 * un humain**. Pas de reecriture de la tache, pas de reecriture des executions
 * passees, pas de nouveau critere. Le contrat gele reste exactement ce qu'il
 * est ; ce qui change est que l'agent recoit enfin le texte que ce contrat lui
 * demandait de recopier.
 *
 * ## Comment NOX prouve que la source n'a pas change
 *
 * Il n'existe aucun instantane de la source d'une `TASK-000` : ajouter une
 * colonne aujourd'hui n'aiderait que les taches de demain, et laisserait sans
 * recours celle qui a paye le defaut. La preuve se fait donc par **rejeu**.
 *
 * Le generateur est pur et deterministe. Rejouer le rendu de l'epoque sur le
 * brief, le plan et la memoire d'aujourd'hui produit exactement le texte stocke
 * dans la tache — si, et seulement si, cet etat n'a pas bouge. Un caractere de
 * difference fait echouer la comparaison, et le supplement est refuse.
 *
 * C'est plus strict qu'une comparaison de revisions, qui ne dirait rien de ce
 * que la tache a reellement recu.
 */

import {
  BOOTSTRAP_SOURCE_HEADINGS,
  PROJECT_MEMORY_STATUS,
  TASK_KIND,
  TASK_STATUS,
  canonicalBootstrapValues,
  legacyBootstrapSourceMatches,
  renderBootstrapSource,
  renderBootstrapSourceSupplement,
  type ArchitectPromptMemory,
  type BootstrapSourceInput,
  type DevelopmentTaskDetail,
  type ProjectMemoryEntry,
} from "@nox/shared";
import type { ProjectStructuredState } from "@nox/database";

import { projectMemoryRevision } from "../architect/fingerprint.ts";
import { createArchitectSanitizer } from "../architect/sanitize.ts";

/**
 * Pourquoi une tache ne recoit pas de supplement.
 *
 * Chaque valeur est un fait distinct, et le plus utile est `source_changed` :
 * il dit que NOX **a regarde** et que l'etat produit a bouge depuis la creation
 * de la tache. Le confondre avec « pas concerne » enverrait chercher un defaut
 * de NOX la ou le projet a simplement evolue.
 */
export type BootstrapSupplementRefusal =
  /** La tache n'est pas un amorcage. Le cas de l'immense majorite. */
  | "not_bootstrap"
  /** La tache est terminee : son contrat ne se repare plus. */
  | "task_completed"
  /** Le brief ou le plan manque : il n'y a rien a restituer. */
  | "source_missing"
  /** Le contexte de la tache ne vient pas du generateur deterministe. */
  | "not_generated"
  /** L'etat produit a change depuis la creation de la tache. */
  | "source_changed"
  /** La source a bien ete transportee en entier : rien a reparer. */
  | "already_complete";

export type BootstrapSupplementOutcome =
  | {
      ok: true;
      /** Le bloc a inserer dans le prompt de correction. */
      supplement: string;
      /** Les champs canoniques absents du contexte de la tache. */
      missingFields: string[];
    }
  | { ok: false; reason: BootstrapSupplementRefusal };

/** Ce que l'appelant a deja relu en base. Ce module ne va rien chercher. */
export type BootstrapSupplementInput = {
  task: DevelopmentTaskDetail;
  repositoryPath: string;
  structuredState: ProjectStructuredState;
  memories: readonly ProjectMemoryEntry[];
  environment: Record<string, string | undefined>;
};

/**
 * La memoire active, assemblee exactement comme le contexte d'amorcage le fait.
 *
 * Meme filtrage, meme nettoyeur, meme calcul de revision. Une seconde facon de
 * l'assembler ferait echouer le rejeu pour une raison qui n'aurait rien a voir
 * avec un changement de la memoire — c'est la lecon de HOTFIX-006, ou deux
 * assemblages du meme candidat rendaient deux verdicts.
 */
function activeMemories(
  input: BootstrapSupplementInput,
  sanitize: (value: string) => string,
): ArchitectPromptMemory[] {
  const retained: ArchitectPromptMemory[] = [];

  for (const memory of input.memories) {
    if (memory.status !== PROJECT_MEMORY_STATUS.ACTIVE) {
      continue;
    }
    const entry: ArchitectPromptMemory = {
      code: memory.code,
      category: memory.category,
      revision: "",
      title: sanitize(memory.title),
      content: sanitize(memory.content),
      rationale: memory.rationale === null ? null : sanitize(memory.rationale),
    };
    entry.revision = projectMemoryRevision(entry);
    retained.push(entry);
  }

  return retained;
}

/**
 * Les champs canoniques que le contexte de la tache ne porte pas en entier.
 *
 * C'est ce qui distingue une tache reellement abimee d'une tache dont la source
 * tenait dans les anciennes bornes. La seconde n'a rien a recevoir.
 */
function missingCanonicalFields(source: BootstrapSourceInput, context: string): string[] {
  return canonicalBootstrapValues(source)
    .filter((entry) => entry.value !== "" && !context.includes(entry.value))
    .map((entry) => entry.field);
}

/**
 * Cette tache d'amorcage doit-elle recevoir sa source canonique ?
 *
 * Les conditions sont cumulatives et volontairement etroites. Elargir l'une
 * d'elles transformerait une reparation de serialisation en mecanisme generique
 * de reecriture d'un contrat gele — ce qui est exactement ce que ce module ne
 * doit jamais devenir.
 */
export function prepareBootstrapSourceSupplement(
  input: BootstrapSupplementInput,
): BootstrapSupplementOutcome {
  if (input.task.kind !== TASK_KIND.BOOTSTRAP) {
    return { ok: false, reason: "not_bootstrap" };
  }

  // Une tache terminee a ete acceptee telle qu'elle etait. La « reparer » apres
  // coup reecrirait une decision humaine.
  if (input.task.status === TASK_STATUS.COMPLETED) {
    return { ok: false, reason: "task_completed" };
  }

  const brief = input.structuredState.brief.prompt;
  const plan = input.structuredState.plan.prompt;
  if (brief === null || plan === null) {
    return { ok: false, reason: "source_missing" };
  }

  const context = input.task.context ?? "";
  const sanitize = createArchitectSanitizer({
    repositoryRoot: input.repositoryPath,
    environment: input.environment,
  });
  const source: BootstrapSourceInput = {
    brief,
    v1Plan: plan,
    memories: activeMemories(input, sanitize),
  };

  // Le rejeu prouve deux choses d'un coup : que ce contexte vient bien du
  // generateur deterministe, et que la source d'aujourd'hui est celle qui l'a
  // produit. Un `KEEP` sur les revisions ne dirait ni l'un ni l'autre.
  if (!legacyBootstrapSourceMatches(context, source)) {
    // Deux refus, parce qu'ils n'appellent pas le meme geste. Un contexte sans
    // la section du brief n'a pas ete produit par ce generateur : NOX n'a rien
    // a y restituer. Un contexte qui la porte mais ne se rejoue pas dit que le
    // projet a evolue depuis — et completer la tache lui substituerait un
    // contrat que personne n'a valide.
    const generated = context.includes(`### ${BOOTSTRAP_SOURCE_HEADINGS.brief}`);
    return { ok: false, reason: generated ? "source_changed" : "not_generated" };
  }

  const missingFields = missingCanonicalFields(source, context);
  if (missingFields.length === 0) {
    // Le rendu de l'epoque n'a rien perdu sur ce projet-la. Ajouter un
    // supplement qui repete le contrat serait du bruit, et laisserait croire
    // qu'une reparation a eu lieu.
    return { ok: false, reason: "already_complete" };
  }

  return {
    ok: true,
    supplement: renderBootstrapSourceSupplement(source),
    missingFields,
  };
}

/** Le rendu integral de la source, pour l'affichage d'un apercu. */
export function renderCanonicalBootstrapSource(source: BootstrapSourceInput): string {
  return renderBootstrapSource(source);
}
