/**
 * Creation d'une tache a partir d'une proposition relue.
 *
 * ## Rien n'est reimplemente
 *
 * La tache est creee par le **pipeline de TASK-007**, sans exception : meme
 * validation de formulaire, meme allocation de numero, meme statut `DRAFT`, meme
 * synchronisation Markdown, meme comportement en cas d'echec du runner. Une
 * seconde implementation aurait fini par diverger, et la tache produite par
 * l'architecte n'aurait plus ete une tache comme les autres.
 *
 * ## L'ordre des ecritures
 *
 * ```text
 * reservation de la session   ← le verrou : une session, une tache
 *        ↓
 * creation de la tache (TASK-007)
 *        ↓
 * rattachement session → tache
 *        ↓
 * synchronisation du document (par l'appelant)
 * ```
 *
 * Reserver d'abord, creer ensuite. L'inverse laisserait un double clic produire
 * deux taches, avec deux numeros et deux documents, dont une seule serait
 * rattachee. Un echec entre les deux rend la main a la session, qui redevient
 * relisable et reappliquable.
 *
 * ## Ce qui est revalide
 *
 * Tout. Les champs affiches ont pu etre modifies par l'utilisateur — c'est le
 * but — et ceux qu'il n'a pas touches viennent d'un modele. Ni les uns ni les
 * autres ne beneficient de la moindre confiance : `readTaskSubmission` valide la
 * forme, et `checkValidationCommand` chaque commande.
 */

import {
  attachArchitectGenerationTask,
  attachArchitectTask,
  claimArchitectGeneration,
  claimArchitectSession,
  createTask,
  releaseArchitectGeneration,
  releaseArchitectSession,
  type DatabaseClient,
} from "@nox/database";
import {
  ARCHITECT_SESSION_KIND,
  checkValidationCommand,
  type ArchitectSessionKind,
  type DevelopmentTaskDetail,
} from "@nox/shared";

import { readTaskSubmission, type TaskFormValues } from "../task-input.ts";

export type ApplyProposalInput = {
  sessionId: string;
  projectId: string;
  /**
   * Role de la conversation : il decide de ce qui est reserve.
   *
   * Le modele historique est la valeur par defaut, comme dans la colonne qui le
   * porte : c'est celui de toutes les sessions deja enregistrees. Une
   * conversation projet, elle, se declare.
   */
  sessionKind?: ArchitectSessionKind;
  /**
   * Generation qui porte la proposition, pour une conversation projet.
   *
   * C'est elle qui est reservee, et non la session : une conversation projet
   * cree plusieurs taches au fil du temps, une proposition n'en cree jamais deux.
   */
  generationId?: string | null;
  /** Champs du formulaire, tels que l'utilisateur les a laisses. */
  values: TaskFormValues;
};

export type ApplyProposalResult =
  | { ok: true; task: DevelopmentTaskDetail }
  | { ok: false; message: string };

const ALREADY_APPLIED_MESSAGE =
  "Cette proposition a deja produit une tache. Continuez la conversation pour en preparer une autre.";

const LEGACY_ALREADY_APPLIED_MESSAGE =
  "Cette session a deja produit une tache. Ouvrez la conversation du projet pour en preparer une autre.";

const NOT_READY_MESSAGE =
  "Cette conversation ne porte aucune proposition prete. Envoyez un message avant de creer la tache.";

const UNKNOWN_MESSAGE = "Cette conversation n'existe plus. Rechargez la page et recommencez.";

/**
 * Cree la tache d'une session, une fois et une seule.
 *
 * Ne leve jamais pour un refus previsible : un message francais est rendu, et la
 * session reste utilisable. Les exceptions inattendues remontent a l'appelant,
 * qui les journalise — apres avoir rendu la main sur la session.
 */
export async function applyArchitectProposal(
  db: DatabaseClient,
  input: ApplyProposalInput,
): Promise<ApplyProposalResult> {
  // La validation precede la reservation : un formulaire refuse ne doit pas
  // consommer la seule creation de tache dont dispose la session.
  const submission = readTaskSubmission(input.values);
  if (!submission.ok) {
    return { ok: false, message: submission.message };
  }

  for (const command of submission.input.validationCommands) {
    // Plus strict que le formulaire de tache ordinaire, et volontairement : ces
    // commandes viennent d'un modele, et NOX a promis de les verifier avant de
    // les enregistrer. La regle appliquee est celle de TASK-008, pas une variante.
    const problem = checkValidationCommand(command);
    if (problem !== null) {
      return { ok: false, message: `« ${command} » ne peut pas etre autorisee : ${problem}` };
    }
  }

  // Deux modeles, deux reservations, et une seule suite : ce qui est reserve
  // differe, ce qui en est fait ne differe pas. Une conversation projet reserve
  // sa **proposition** ; une session historique se reserve elle-meme.
  const project = input.sessionKind === ARCHITECT_SESSION_KIND.PROJECT;
  const generationId = input.generationId ?? null;

  if (project && generationId === null) {
    return { ok: false, message: NOT_READY_MESSAGE };
  }

  const claimed = project
    ? await claimArchitectGeneration(db, generationId as string)
    : await claimArchitectSession(db, input.sessionId);

  if (!claimed.ok) {
    switch (claimed.reason) {
      case "already_applied":
        return {
          ok: false,
          message: project ? ALREADY_APPLIED_MESSAGE : LEGACY_ALREADY_APPLIED_MESSAGE,
        };
      case "not_ready":
        return { ok: false, message: NOT_READY_MESSAGE };
      default:
        return { ok: false, message: UNKNOWN_MESSAGE };
    }
  }

  /** Rend la main sur ce qui a ete reserve, quel que soit le modele. */
  const release = async (): Promise<void> => {
    if (project) {
      await releaseArchitectGeneration(db, generationId as string);
      return;
    }
    await releaseArchitectSession(db, input.sessionId);
  };

  let created;
  try {
    created = await createTask(db, { projectId: input.projectId, ...submission.input });
  } catch (error) {
    await release();
    throw error;
  }

  if (created === null) {
    // Le projet a disparu entre-temps : la reservation est rendue, meme si plus
    // rien ne pourra jamais l'utiliser.
    await release();
    return { ok: false, message: UNKNOWN_MESSAGE };
  }

  if (project) {
    await attachArchitectGenerationTask(db, generationId as string, created.id);
  } else {
    await attachArchitectTask(db, input.sessionId, created.id);
  }

  // A partir d'ici la tache existe, et plus aucun echec ne la remet en cause.
  // La synchronisation de son document appartient a l'appelant, exactement comme
  // dans la creation de TASK-007 : un runner arrete coute un document a recreer,
  // jamais une specification.
  return { ok: true, task: created };
}
