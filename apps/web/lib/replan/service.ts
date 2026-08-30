/**
 * Application et abandon d'un changement de projet, cote serveur.
 *
 * ## Ce que ce module fait
 *
 * Il revalide la cible relue par l'humain avec les regles de l'editeur de tache
 * future, delegue l'ecriture a une transaction unique, puis resynchronise les
 * documents Markdown des taches qui ont reellement change.
 *
 * ## Ce qu'il ne fait jamais
 *
 * Aucun appel a OpenAI, aucun lancement de Claude Code, aucune validation
 * autonome, aucune correction, aucune livraison Git, aucun avancement de file.
 * Appliquer un changement de projet ecrit des lignes SQLite et des fichiers
 * Markdown — c'est tout, et un test le verifie sur la source de ce module.
 *
 * ## L'ordre : la base, puis le disque
 *
 * Comme partout ailleurs dans NOX. Il n'existe aucune atomicite entre SQLite et
 * un systeme de fichiers, et pretendre le contraire serait un mensonge cher a
 * payer. Un echec de synchronisation laisse un projet correct et des documents a
 * reprendre — etat que NOX modelise, affiche, et ne masque pas.
 *
 * La synchronisation elle-meme vit dans `document-sync.ts`, et arrive ici en
 * parametre. Ce n'est pas une preference de style : elle touche le runner, donc
 * elle depend de Next, et la garder ici rendrait ce module — le coeur de
 * l'application d'un changement — inexecutable hors du serveur web.
 */

import {
  applyReplanProposal,
  dismissReplanProposal,
  getReplanProposal,
  loadReplanPlanningState,
  type ApplyReplanResult,
  type DatabaseClient,
  type DismissReplanResult,
  type ReplanApplyOutcome,
  type ReplanProposalRecord,
} from "@nox/database";
import type { ProjectUpdateTarget } from "@nox/shared";

import { projectPlanTools } from "../project-plan.ts";
import { knownTaskIds } from "./change.ts";
import { replanPlanningFingerprint } from "./fingerprint.ts";
import {
  readReplanTargetSubmission,
  replanAppliedJson,
  type ReplanReviewItem,
} from "./target.ts";

export type ApplyReplanChangeInput = {
  proposalId: string;
  /** Cible relue par l'humain, dans l'ordre qu'il a valide. */
  items: readonly ReplanReviewItem[];
  /** Brief et plan retenus, quand une mise a jour du projet est liee. */
  projectUpdate: ProjectUpdateTarget | null;
};

export type ApplyReplanChangeOutcome =
  | { ok: true; outcome: ReplanApplyOutcome; documents: ReplanDocumentReport }
  | { ok: false; message: string; stale?: true };

/**
 * La synchronisation des documents, injectee plutot qu'importee.
 *
 * Elle vit **apres** la transaction, et une panne du runner ne remet aucune
 * ecriture en cause. La rendre remplacable permet aux tests de rejouer chaque
 * scenario — document cree, reecrit, supprime, ou pas touche du tout — sans
 * demarrer ni runner ni repository.
 */
export type ReplanDocumentSync = (
  db: DatabaseClient,
  project: { id: string; repositoryPath: string },
  outcome: ReplanApplyOutcome,
) => Promise<ReplanDocumentReport>;

/**
 * Ce que la synchronisation des documents a produit.
 *
 * Distincte du resultat de la transaction, et deliberement : la base est deja
 * ecrite quand elle commence. Confondre les deux ferait dire a NOX qu'une
 * application a echoue alors que le projet est bel et bien modifie.
 */
export type ReplanDocumentReport = {
  created: number;
  rewritten: number;
  removed: number;
  /** Documents que NOX n'a pas pu retirer ou reecrire, avec leur raison. */
  problems: { code: string; message: string }[];
};

/**
 * Applique un changement de projet.
 *
 * ## Ce que le navigateur apporte
 *
 * Un identifiant de proposition, des identifiants de taches, des identifiants
 * temporaires, des champs saisis. Rien d'autre. Il ne dit pas qu'une tache est
 * modifiable, ne propose aucun code, ne transmet aucun chemin, et ne porte aucun
 * drapeau de forcage — il n'en existe pas.
 *
 * ## Ce que le serveur refait
 *
 * Tout. Chaque element repasse par la validation du formulaire de tache et la
 * garde des commandes ; la proposition, son statut, la mise a jour liee, l'etat
 * du projet, la classification des taches, le graphe et l'empreinte de
 * planification sont relus dans la transaction qui ecrit.
 */
export async function applyReplanChange(
  db: DatabaseClient,
  project: { id: string; repositoryPath: string },
  input: ApplyReplanChangeInput,
  sync: ReplanDocumentSync,
): Promise<ApplyReplanChangeOutcome> {
  const proposal = await getReplanProposal(db, project.id, input.proposalId);
  if (proposal === null) {
    return { ok: false, message: UNKNOWN_MESSAGE };
  }

  const planning = await loadReplanPlanningState(db, project.id);
  const submission = readReplanTargetSubmission(input.items, knownTaskIds(planning));
  if (!submission.ok) {
    return { ok: false, message: submission.message };
  }

  // Les taches retirees sont decrites **avant** l'application : une fois la
  // transaction passee, elles n'existent plus, et `appliedJson` ne pourrait plus
  // raconter ce qui a ete supprime.
  const kept = new Set(
    submission.items
      .map((item) => item.existingTaskId)
      .filter((id): id is string => id !== null),
  );
  const removedBefore = planning.tasks
    .filter((task) => task.classified.editable && !kept.has(task.classified.id))
    .flatMap((task) =>
      task.contract === null
        ? []
        : [
            {
              taskId: task.classified.id,
              code: task.classified.code,
              title: task.title,
              contract: task.contract,
            },
          ],
    );

  const applied = await applyReplanProposal(db, {
    projectId: project.id,
    proposalId: input.proposalId,
    target: submission.items,
    projectUpdate: input.projectUpdate,
    appliedJson: replanAppliedJson({
      rationale: proposal.rationale,
      items: submission.items,
      removed: removedBefore,
    }),
    tools: projectPlanTools(project.repositoryPath),
    fingerprint: ({ state, briefRevision, planRevision }) =>
      replanPlanningFingerprint({ briefRevision, planRevision, tasks: state.tasks }),
  });

  if (!applied.ok) {
    return applyRefusal(applied);
  }

  const documents = await sync(db, project, applied.outcome);
  return { ok: true, outcome: applied.outcome, documents };
}

export type DismissReplanChangeOutcome =
  | { ok: true; projectUpdateId: string | null }
  | { ok: false; message: string };

/**
 * Ecarte un changement de projet, mise a jour liee comprise.
 *
 * Aucune tache modifiee, aucun brief ecrit, aucun document touche, aucun appel.
 * La proposition reste lisible : ne pas l'avoir retenue est aussi une
 * information.
 */
export async function dismissReplanChange(
  db: DatabaseClient,
  project: { id: string },
  proposalId: string,
): Promise<DismissReplanChangeOutcome> {
  const dismissed: DismissReplanResult = await dismissReplanProposal(db, {
    projectId: project.id,
    proposalId,
  });
  if (!dismissed.ok) {
    return {
      ok: false,
      message: dismissed.reason === "not_found" ? UNKNOWN_MESSAGE : NOT_PENDING_MESSAGE,
    };
  }
  return { ok: true, projectUpdateId: dismissed.projectUpdateId };
}

/** Relit une proposition en verifiant qu'elle appartient bien au projet. */
export async function loadReplanProposal(
  db: DatabaseClient,
  projectId: string,
  proposalId: string,
): Promise<ReplanProposalRecord | null> {
  return getReplanProposal(db, projectId, proposalId);
}

const UNKNOWN_MESSAGE =
  "Ce changement n'existe pas dans ce projet. Revenez a la conversation et rechargez la page.";

const NOT_PENDING_MESSAGE =
  "Ce changement a deja ete traite. Rechargez la page pour voir son etat actuel.";

const BOOTSTRAP_MESSAGE =
  "TASK-000 prepare les fondations de ce projet a partir du Project Brief et du Living V1 Plan " +
  "actuels, et elle n'a pas encore tourne. Appliquer ce changement la laisserait construire pour " +
  "un projet qui n'existe plus. Lancez-la, terminez-la ou supprimez-la avant d'appliquer : NOX ne " +
  "la reecrit ni ne la supprime a votre place.";

/** Phrase expliquant pourquoi une application a ete refusee. */
function applyRefusal(result: Extract<ApplyReplanResult, { ok: false }>): ApplyReplanChangeOutcome {
  switch (result.reason) {
    case "not_found":
      return { ok: false, message: UNKNOWN_MESSAGE };
    case "not_pending":
      return { ok: false, message: NOT_PENDING_MESSAGE };
    case "stale":
      return { ok: false, message: staleMessage(result.detail), stale: true };
    case "bootstrap":
      return { ok: false, message: BOOTSTRAP_MESSAGE };
    case "graph":
      return { ok: false, message: result.message };
    case "invalid":
      return {
        ok: false,
        message: `Le champ « ${result.field} » est refuse. Corrigez-le avant d'appliquer.`,
      };
    case "budget":
      return {
        ok: false,
        message:
          "Le Project Brief et le Living V1 Plan depasseraient ensemble la place reservee a " +
          "l'etat structure du projet. Raccourcissez-les avant d'appliquer.",
      };
  }
}

/** Dit ce qui a change depuis, aussi precisement que la base le permet. */
function staleMessage(detail: Extract<ApplyReplanResult, { reason: "stale" }>["detail"]): string {
  const causes: string[] = [];
  if (detail.brief) {
    causes.push("le Project Brief a change");
  }
  if (detail.plan) {
    causes.push("le Living V1 Plan a change");
  }
  for (const task of detail.tasks) {
    // Une tache introuvable est nommee sans son identifiant : un cuid n'apprend
    // rien a personne, et une tache d'un autre projet ne doit pas voir son
    // existence confirmee par un message d'erreur.
    causes.push(
      task.reason === "MISSING"
        ? "une tache citee n'existe plus dans ce projet"
        : `${task.code} ${LOCK_CAUSE[task.reason] ?? "a change"}`,
    );
  }
  if (detail.planning) {
    causes.push("le plan des taches futures a change");
  }

  const listed = causes.length === 0 ? "le projet a change" : causes.join(", ");
  return (
    `Ce changement a ete concu a partir d'un etat plus ancien : ${listed}. ` +
    "Rien n'a ete modifie. Relisez l'etat actuel, et demandez un nouveau changement a " +
    "l'Architecte s'il reste utile — NOX ne fusionne jamais deux etats tout seul."
  );
}

const LOCK_CAUSE: Record<string, string> = {
  BOOTSTRAP: "est une tache d'amorcage",
  STARTED: "a acquis une execution",
  STATUS: "a change de statut",
  QUEUED: "a ete inscrite dans la file",
  MISSING: "n'existe plus",
};
