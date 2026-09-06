/**
 * Mises a jour du projet proposees par l'Architecte, cote serveur.
 *
 * ## Ce que ce module fait
 *
 * Il revalide ce qu'un fournisseur a propose, cable le nettoyeur et les
 * revisions, et delegue l'ecriture a la couche de persistance. C'est le seul
 * endroit ou le budget structure d'une **proposition** est verifie.
 *
 * ## Ce qu'il ne fait jamais
 *
 * Aucun appel a OpenAI, aucun appel a Claude Code, aucun appel au runner, aucune
 * ecriture de fichier, aucune commande Git. Appliquer ou ecarter une proposition
 * doit fonctionner runner arrete et sans configuration OpenAI — ce sont des
 * lignes SQLite.
 *
 * Et surtout : une proposition perimee ne declenche **rien**. Il n'existe aucun
 * chemin de code allant d'un conflit vers un appel qui fusionnerait les deux
 * etats. Le refus est local, et il le reste.
 */

import {
  applyArchitectProjectUpdate,
  dismissArchitectProjectUpdate,
  getArchitectProjectUpdate,
  listActiveProjectMemories,
  listArchitectProjectUpdatesForSession,
  sanitizedBrief,
  sanitizedBriefChars,
  sanitizedV1Plan,
  sanitizedV1PlanChars,
  type DatabaseClient,
  type ProjectPlanTools,
  type ProjectStructuredState,
  type ProjectUpdateActionResult,
} from "@nox/database";
import {
  PROJECT_PLAN_LIMITS,
  buildArchitectProjectUpdateReview,
  checkProjectBriefInput,
  checkProjectV1PlanInput,
  projectUpdateTarget,
  type ArchitectPromptMemory,
  type ArchitectProjectUpdateProposal,
  type ProjectMemoryProposal,
  type ProjectUpdateReview,
  type ProjectUpdateTarget,
} from "@nox/shared";

import process from "node:process";

import { projectPlanTools } from "../project-plan.ts";
import { projectMemoryRevision, projectMemorySetRevision } from "./fingerprint.ts";
import { createArchitectSanitizer } from "./sanitize.ts";
import type { TimelineProjectUpdate } from "./timeline.ts";

export type ProjectUpdateCheck =
  | { ok: true }
  | { ok: false; reason: "invalid"; field: string }
  | { ok: false; reason: "budget"; used: number; limit: number };

/**
 * Revalide une proposition contre l'etat courant du projet.
 *
 * ## Pourquoi le budget se mesure sur l'etat resultant
 *
 * Une proposition qui ne touche que le brief laisse le plan en place, et le plan
 * continue d'occuper sa part des seize Kio. Mesurer le seul brief accepterait
 * une proposition impossible a appliquer — et NOX n'enregistre jamais une
 * proposition qu'il faudra refuser plus tard.
 *
 * ## Pourquoi revalider les champs ici aussi
 *
 * `readArchitectProjectUpdate` les a deja valides. Cette fonction les revalide
 * parce qu'elle sert aussi au target **edite par l'utilisateur**, qui n'est
 * jamais passe par le fournisseur. Une seule implementation pour les deux : la
 * validation ne peut pas diverger selon l'origine de la valeur.
 */
export function checkProjectUpdateTarget(
  current: ProjectStructuredState,
  target: ProjectUpdateTarget,
  tools: ProjectPlanTools,
): ProjectUpdateCheck {
  let briefChars = current.brief.chars;
  if (target.brief !== null) {
    const checked = checkProjectBriefInput(target.brief);
    if (!checked.ok) {
      return { ok: false, reason: "invalid", field: checked.refusal.field };
    }
    briefChars = sanitizedBriefChars(sanitizedBrief(checked.values, tools));
  }

  let planChars = current.plan.chars;
  if (target.plan !== null) {
    const checked = checkProjectV1PlanInput(target.plan);
    if (!checked.ok) {
      return { ok: false, reason: "invalid", field: checked.refusal.field };
    }
    planChars = sanitizedV1PlanChars(sanitizedV1Plan(checked.values, tools));
  }

  const used = briefChars + planChars;
  if (used > PROJECT_PLAN_LIMITS.structuredChars) {
    return { ok: false, reason: "budget", used, limit: PROJECT_PLAN_LIMITS.structuredChars };
  }

  return { ok: true };
}

/**
 * Revalide une proposition du fournisseur avant de l'enregistrer.
 *
 * Une proposition hors bornes est traitee comme une sortie invalide, et n'est
 * pas persistee : stocker une proposition impossible a appliquer offrirait a
 * l'utilisateur un bouton qui echouerait toujours.
 */
export function checkProviderProjectUpdate(
  current: ProjectStructuredState,
  proposal: ArchitectProjectUpdateProposal,
  tools: ProjectPlanTools,
): ProjectUpdateCheck {
  return checkProjectUpdateTarget(current, projectUpdateTarget(proposal), tools);
}

/**
 * Construit la revue d'une proposition, a partir de l'etat courant.
 *
 * L'etat courant est relu au moment d'afficher, jamais fige a la proposition :
 * ce que l'utilisateur compare doit etre le projet tel qu'il est maintenant.
 * Que cet etat ait change depuis la proposition est une autre question — celle
 * de la peremption, tranchee a l'application.
 */
export function projectUpdateReview(
  current: ProjectStructuredState,
  proposal: ArchitectProjectUpdateProposal,
): ProjectUpdateReview {
  return buildArchitectProjectUpdateReview(
    {
      brief: current.brief.stored,
      plan: current.plan.stored,
    },
    proposal,
  );
}

/**
 * Applique une proposition avec l'etat cible valide par l'utilisateur.
 *
 * Le navigateur n'apporte que trois choses : le projet, la proposition, et le
 * texte edite. Tout le reste — la proposition elle-meme, son statut, ses
 * revisions de base, l'etat courant du projet — est relu cote serveur, dans la
 * transaction qui ecrit.
 */
export async function applyProjectUpdate(
  db: DatabaseClient,
  project: { id: string; repositoryPath: string },
  updateId: string,
  target: ProjectUpdateTarget,
  /**
   * Regles durables retenues par l'humain.
   *
   * Absent vaut liste vide : une proposition sans regle durable, ou dont
   * l'utilisateur les a toutes retirees, n'ecrit rien en memoire.
   */
  memories: readonly ProjectMemoryProposal[] = [],
  /**
   * Environnement du nettoyeur.
   *
   * Explicite plutot que lu ici : la revision de memoire doit decrire
   * exactement le texte que la preparation du tour a produit, et celle-ci recoit
   * deja son environnement de son appelant. Deux sources differentes donneraient
   * deux revisions pour un meme contenu.
   */
  environment: Record<string, string | undefined> = process.env,
): Promise<ProjectUpdateActionResult> {
  const tools = projectPlanTools(project.repositoryPath);

  // La revision de la memoire **d'aujourd'hui**, reconstruite ici comme
  // l'empreinte de planification d'un backlog l'est avant son application, et
  // pour la meme raison : elle decrit le texte sanitise, et la couche donnees
  // n'a pas le nettoyeur. La comparaison, elle, a lieu dans la transaction.
  const currentMemoryRevision = await currentProjectMemoryRevision(
    db,
    project.id,
    project.repositoryPath,
    environment,
  );

  return applyArchitectProjectUpdate(db, {
    projectId: project.id,
    updateId,
    target,
    tools,
    memories,
    currentMemoryRevision,
  });
}

/**
 * Revision de la memoire active telle qu'elle partirait aujourd'hui.
 *
 * Passe par exactement le meme chemin que la preparation d'un tour : memes
 * entrees actives, meme nettoyeur, meme calcul de revision. Un second chemin
 * decrirait un autre texte que celui que le fournisseur a reellement vu, et la
 * comparaison de peremption cesserait de vouloir dire quelque chose.
 */
export async function currentProjectMemoryRevision(
  db: DatabaseClient,
  projectId: string,
  repositoryPath: string,
  environment: Record<string, string | undefined> = process.env,
): Promise<string> {
  const sanitize = createArchitectSanitizer({ repositoryRoot: repositoryPath, environment });
  const entries = await listActiveProjectMemories(db, projectId);

  return projectMemorySetRevision(
    entries.map((memory) => {
      const prompt: ArchitectPromptMemory = {
        revision: "",
        code: memory.code,
        category: memory.category,
        title: sanitize(memory.title),
        content: sanitize(memory.content),
        rationale: memory.rationale === null ? null : sanitize(memory.rationale),
      };
      prompt.revision = projectMemoryRevision(prompt);
      return prompt;
    }),
  );
}

/** Ecarte une proposition. Aucune ecriture du brief ni du plan. */
export function dismissProjectUpdate(
  db: DatabaseClient,
  project: { id: string; repositoryPath: string },
  updateId: string,
): Promise<ProjectUpdateActionResult> {
  return dismissArchitectProjectUpdate(db, {
    projectId: project.id,
    updateId,
    tools: projectPlanTools(project.repositoryPath),
  });
}

/**
 * Relit une proposition en verifiant qu'elle appartient bien au projet.
 *
 * Un identifiant croise entre deux projets rend `null`, comme une proposition
 * inexistante : distinguer les deux confirmerait l'existence de la ligne.
 */
export async function loadProjectUpdate(
  db: DatabaseClient,
  projectId: string,
  updateId: string,
): Promise<Awaited<ReturnType<typeof getArchitectProjectUpdate>>> {
  const update = await getArchitectProjectUpdate(db, updateId);
  return update === null || update.projectId !== projectId ? null : update;
}

/**
 * Propositions d'une conversation, pretes pour le fil.
 *
 * Les compteurs de changements sont calcules contre l'etat **courant**, par le
 * meme modele de revue que la page de revue : la carte et la page ne peuvent
 * donc pas annoncer deux nombres differents.
 *
 * Aucun appel : une lecture SQLite, et le meme etat structure que le reste de
 * la page.
 */
export async function loadTimelineProjectUpdates(
  db: DatabaseClient,
  project: { id: string; repositoryPath: string },
  sessionId: string,
  current: ProjectStructuredState,
): Promise<TimelineProjectUpdate[]> {
  const updates = await listArchitectProjectUpdatesForSession(db, sessionId);

  return updates
    .filter((update) => update.projectId === project.id)
    .map((update) => {
      const review = projectUpdateReview(current, update.proposed);
      return {
        generationId: update.generationId,
        updateId: update.id,
        status: update.status,
        briefChanges: review.brief.fields.filter((field) => field.changed).length,
        planChanges: review.plan.fields.filter((field) => field.changed).length,
        memoryChanges: update.proposed.memories.length,
      };
    });
}
