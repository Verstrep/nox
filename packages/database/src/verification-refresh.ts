/**
 * Rafraichissement des plans de verification : reservation, conclusion, ecriture.
 *
 * ## Ce que ce module garantit
 *
 * Qu'un meme etat de planification ne produit qu'un seul rafraichissement, donc
 * **au plus un appel au fournisseur**. La garantie n'est pas applicative : elle
 * est l'index unique `(projectId, planningFingerprint)`. Dix finalisations
 * simultanees d'un meme amorcage n'obtiennent qu'une reservation, et les neuf
 * autres apprennent qu'elles ont perdu la course a l'ecriture — jamais apres
 * avoir paye un appel.
 *
 * Et que l'ecriture est **atomique** : les N taches, ou aucune. Un plan de
 * verification a moitie rafraichi decrirait un projet qui n'a jamais existe.
 *
 * ## Ce qu'il ne fait pas
 *
 * Il n'appelle ni OpenAI, ni Claude Code, ni le runner. Il ne touche ni au
 * titre, ni a l'objectif, ni au contexte, ni au hors perimetre, ni au **texte**
 * d'un critere, ni a l'ordre, ni aux dependances, ni au statut, ni a la file :
 * le texte de chaque critere est relu en base et reecrit tel quel, et le contrat
 * de la tache n'a aucun autre chemin vers ce module.
 */

import {
  VERIFICATION_MODE,
  formatTaskCode,
  VERIFICATION_REFRESH_STATUS,
  isVerificationRefreshStatus,
  type ArchitectUsage,
  type VerificationRefreshProposal,
  type VerificationRefreshStatus,
} from "@nox/shared";

import type { DatabaseClient } from "./client.js";
import { writeVerificationPlan } from "./verification-plan.js";

const UNIQUE_CONSTRAINT_CODE = "P2002";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === UNIQUE_CONSTRAINT_CODE
  );
}

/** Un rafraichissement, tel que les ecrans le lisent. */
export type VerificationRefreshRow = {
  id: string;
  projectId: string;
  bootstrapTaskId: string;
  status: VerificationRefreshStatus;
  model: string;
  promptVersion: string;
  planningFingerprint: string;
  usage: ArchitectUsage;
  errorCode: string | null;
  errorField: string | null;
  errorDetail: string | null;
  changedTaskCount: number;
  automatedCount: number;
  humanCount: number;
  /** Resume destine a l'utilisateur, extrait de ce qui a ete applique. */
  message: string | null;
  createdAt: Date;
  finishedAt: Date | null;
};

type Row = {
  id: string;
  projectId: string;
  bootstrapTaskId: string;
  status: string;
  model: string;
  promptVersion: string;
  planningFingerprint: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  errorCode: string | null;
  errorField: string | null;
  errorDetail: string | null;
  appliedJson: string | null;
  changedTaskCount: number;
  automatedCount: number;
  humanCount: number;
  createdAt: Date;
  finishedAt: Date | null;
};

function appliedMessage(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && "message" in parsed) {
      const message = (parsed as { message: unknown }).message;
      return typeof message === "string" ? message : null;
    }
  } catch {
    return null;
  }
  return null;
}

function toRefresh(row: Row): VerificationRefreshRow {
  return {
    id: row.id,
    projectId: row.projectId,
    bootstrapTaskId: row.bootstrapTaskId,
    // Un statut illisible devient `FAILED` : la valeur qui n'affirme aucune
    // ecriture. Une valeur inconnue ne doit jamais faire croire a un succes.
    status: isVerificationRefreshStatus(row.status) ? row.status : VERIFICATION_REFRESH_STATUS.FAILED,
    model: row.model,
    promptVersion: row.promptVersion,
    planningFingerprint: row.planningFingerprint,
    usage: {
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.totalTokens,
      cachedInputTokens: row.cachedInputTokens,
    },
    errorCode: row.errorCode,
    errorField: row.errorField,
    errorDetail: row.errorDetail,
    changedTaskCount: row.changedTaskCount,
    automatedCount: row.automatedCount,
    humanCount: row.humanCount,
    message: appliedMessage(row.appliedJson),
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  };
}

export type ClaimVerificationRefreshResult =
  | { ok: true; refresh: VerificationRefreshRow }
  /** Cet etat de planification a deja ete rafraichi, ou l'est en ce moment. */
  | { ok: false; reason: "already_claimed" };

/**
 * Reserve le droit de rafraichir cet etat de planification.
 *
 * Ecrite **avant** l'appel, jamais apres : l'intervalle entre « NOX decide » et
 * « l'appel existe » est le seul moment ou un arret du serveur pourrait faire
 * perdre — ou dedoubler — une decision facturee.
 *
 * Un refus n'est pas une erreur : c'est exactement ce que la reservation existe
 * pour produire.
 */
export async function claimVerificationRefresh(
  db: DatabaseClient,
  input: {
    projectId: string;
    bootstrapTaskId: string;
    planningFingerprint: string;
    model: string;
    promptVersion: string;
  },
): Promise<ClaimVerificationRefreshResult> {
  try {
    const row = await db.verificationRefresh.create({
      data: {
        projectId: input.projectId,
        bootstrapTaskId: input.bootstrapTaskId,
        planningFingerprint: input.planningFingerprint,
        model: input.model,
        promptVersion: input.promptVersion,
        status: VERIFICATION_REFRESH_STATUS.RUNNING,
      },
    });
    return { ok: true, refresh: toRefresh(row) };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "already_claimed" };
    }
    throw error;
  }
}

/**
 * Conclut un rafraichissement qui n'a rien ecrit.
 *
 * Panne du fournisseur, reponse refusee, ou etat devenu obsolete entre l'appel
 * et l'application. La ligne reste : elle raconte qu'un appel a eu lieu, ce
 * qu'il a coute, et pourquoi il n'a rien produit. Sans elle, relancer serait le
 * seul moyen d'apprendre ce que NOX savait deja.
 */
export async function failVerificationRefresh(
  db: DatabaseClient,
  input: {
    refreshId: string;
    status: VerificationRefreshStatus;
    providerResponseId?: string | null;
    usage?: ArchitectUsage | null;
    errorCode?: string | null;
    errorField?: string | null;
    errorDetail?: string | null;
    providerJson?: string | null;
  },
): Promise<VerificationRefreshRow | null> {
  const row = await db.verificationRefresh.update({
    where: { id: input.refreshId },
    data: {
      status: input.status,
      providerResponseId: input.providerResponseId ?? null,
      inputTokens: input.usage?.inputTokens ?? null,
      outputTokens: input.usage?.outputTokens ?? null,
      totalTokens: input.usage?.totalTokens ?? null,
      cachedInputTokens: input.usage?.cachedInputTokens ?? null,
      errorCode: input.errorCode ?? null,
      errorField: input.errorField ?? null,
      errorDetail: input.errorDetail ?? null,
      providerJson: input.providerJson ?? null,
      finishedAt: new Date(),
    },
  });
  return toRefresh(row);
}

/** Le plan reellement ecrit pour une tache, texte des criteres compris. */
export type AppliedVerificationTask = {
  taskId: string;
  code: string;
  criteria: {
    text: string;
    verificationMode: string;
    humanInstructions: string | null;
    validationCommandIndexes: number[];
  }[];
  validationCommands: { command: string; executionMode: string }[];
};

export type ApplyVerificationRefreshResult =
  | {
      ok: true;
      refresh: VerificationRefreshRow;
      /** Identifiants des taches reellement reecrites. */
      changedTaskIds: string[];
      applied: AppliedVerificationTask[];
    }
  /** Le plan de travail a change depuis l'appel : rien n'est ecrit. */
  | { ok: false; reason: "stale" }
  | { ok: false; reason: "not_found" };

/**
 * Applique un rafraichissement : les N taches, ou aucune.
 *
 * ## Ce que la transaction relit avant d'ecrire
 *
 * Tout ce dont la decision depend : la tache existe, appartient a ce projet,
 * n'a aucune execution, n'est pas inscrite dans la file, porte encore le meme
 * nombre de criteres, et son statut est toujours un statut d'avant-execution. La
 * moindre divergence refuse **l'ensemble** — jamais ne fusionne, jamais
 * n'applique partiellement.
 *
 * ## Ce qu'elle n'ecrit pas
 *
 * Le texte des criteres vient de la base, jamais de la proposition : il est relu
 * ligne par ligne et reecrit tel quel. Titre, priorite, objectif, contexte, hors
 * perimetre, documents, ordre de planification, dependances, statut et
 * inscription dans la file ne sont pas touches — ce module n'a aucun chemin vers
 * eux.
 *
 * ## Ce qu'elle ne garantit pas
 *
 * Les documents `tasks/TASK-0NN.md` ne sont pas ecrits ici : SQLite et le
 * systeme de fichiers ne partagent aucune transaction. Leur synchronisation
 * appartient a l'appelant, qui la fait apres, tache par tache, sous controle de
 * revision.
 */
export async function applyVerificationRefresh(
  db: DatabaseClient,
  input: {
    projectId: string;
    refreshId: string;
    /** Empreinte de l'etat de planification **d'aujourd'hui**, reconstruite sans appel. */
    currentPlanningFingerprint: string;
    proposal: VerificationRefreshProposal;
  },
): Promise<ApplyVerificationRefreshResult> {
  return db.$transaction(async (tx): Promise<ApplyVerificationRefreshResult> => {
    const refresh = await tx.verificationRefresh.findUnique({ where: { id: input.refreshId } });
    if (refresh === null || refresh.projectId !== input.projectId) {
      return { ok: false, reason: "not_found" };
    }
    if (refresh.planningFingerprint !== input.currentPlanningFingerprint) {
      return { ok: false, reason: "stale" };
    }

    const changedTaskIds: string[] = [];
    const applied: AppliedVerificationTask[] = [];
    let automatedCount = 0;
    let humanCount = 0;

    for (const proposed of input.proposal.tasks) {
      const task = await tx.task.findUnique({
        where: { id: proposed.taskId },
        select: { id: true, projectId: true, sequence: true, status: true },
      });
      if (task === null || task.projectId !== input.projectId) {
        return { ok: false, reason: "stale" };
      }

      // Le passe est immuable : une tache qui a commence, qui est inscrite, ou
      // dont le statut n'est plus un statut d'avant-execution ne se rafraichit
      // pas. Relu **ici**, pas seulement au moment de l'appel.
      const [runCount, queued] = await Promise.all([
        tx.run.count({ where: { taskId: task.id } }),
        tx.taskQueueEntry.count({ where: { taskId: task.id } }),
      ]);
      if (runCount > 0 || queued > 0) {
        return { ok: false, reason: "stale" };
      }

      const criterionRows = await tx.taskAcceptanceCriterion.findMany({
        where: { taskId: task.id },
        orderBy: { position: "asc" },
        select: { text: true },
      });
      if (criterionRows.length !== proposed.criteria.length) {
        return { ok: false, reason: "stale" };
      }

      const criteria = proposed.criteria.map((criterion, position) => ({
        // Le texte vient de la base. C'est la garantie qui compte : il n'est pas
        // « verifie identique », il n'a jamais quitte NOX.
        text: criterionRows[position]?.text ?? "",
        verificationMode: criterion.verificationMode,
        humanInstructions: criterion.humanInstructions,
        commandPositions: criterion.validationCommandIndexes,
      }));

      await writeVerificationPlan(tx, task.id, {
        criteria,
        commands: proposed.validationCommands,
      });

      changedTaskIds.push(task.id);
      applied.push({
        taskId: task.id,
        code: formatTaskCode(task.sequence),
        criteria: criteria.map((criterion) => ({
          text: criterion.text,
          verificationMode: criterion.verificationMode,
          humanInstructions: criterion.humanInstructions,
          validationCommandIndexes: [...criterion.commandPositions],
        })),
        validationCommands: proposed.validationCommands.map((command) => ({
          command: command.command,
          executionMode: command.executionMode,
        })),
      });

      for (const criterion of proposed.criteria) {
        if (criterion.verificationMode === VERIFICATION_MODE.AUTOMATED) {
          automatedCount += 1;
        } else {
          humanCount += 1;
        }
      }
    }

    const row = await tx.verificationRefresh.update({
      where: { id: input.refreshId },
      data: {
        status:
          changedTaskIds.length === 0
            ? VERIFICATION_REFRESH_STATUS.NO_CHANGE
            : VERIFICATION_REFRESH_STATUS.APPLIED,
        appliedJson: JSON.stringify({ message: input.proposal.message, tasks: applied }),
        changedTaskCount: changedTaskIds.length,
        automatedCount,
        humanCount,
        finishedAt: new Date(),
      },
    });

    return { ok: true, refresh: toRefresh(row), changedTaskIds, applied };
  });
}

/** Enregistre la reponse brute du fournisseur. Immuable : jamais reecrite. */
export async function recordVerificationRefreshResponse(
  db: DatabaseClient,
  input: {
    refreshId: string;
    providerResponseId: string | null;
    usage: ArchitectUsage | null;
    providerJson: string;
  },
): Promise<void> {
  await db.verificationRefresh.update({
    where: { id: input.refreshId },
    data: {
      providerResponseId: input.providerResponseId,
      inputTokens: input.usage?.inputTokens ?? null,
      outputTokens: input.usage?.outputTokens ?? null,
      totalTokens: input.usage?.totalTokens ?? null,
      cachedInputTokens: input.usage?.cachedInputTokens ?? null,
      providerJson: input.providerJson,
    },
  });
}

/**
 * Un rafraichissement a-t-il deja abouti pour cet amorcage ?
 *
 * ## Pourquoi cette question s'ajoute a l'empreinte
 *
 * L'empreinte garantit qu'un **etat** ne se paie qu'une fois. Elle ne garantit
 * pas qu'un amorcage ne se paie qu'une fois : un rafraichissement reussi change
 * precisement le plan qu'il vient de lire, donc l'empreinte suivante differe. Un
 * amorcage rouvert puis re-accepte declencherait alors un second appel, sur un
 * plan que NOX vient lui-meme de mettre a jour.
 *
 * `APPLIED` et `NO_CHANGE` sont les deux issues qui disent « la question a ete
 * posee, et elle a recu une reponse ». Un echec ou un refus, eux, ne ferment
 * rien de definitif — mais leur propre empreinte reste prise, et c'est elle qui
 * empeche de repayer le meme etat.
 */
export async function bootstrapRefreshSucceeded(
  db: DatabaseClient,
  bootstrapTaskId: string,
): Promise<boolean> {
  const count = await db.verificationRefresh.count({
    where: {
      bootstrapTaskId,
      status: {
        in: [VERIFICATION_REFRESH_STATUS.APPLIED, VERIFICATION_REFRESH_STATUS.NO_CHANGE],
      },
    },
  });
  return count > 0;
}

/** Le dernier rafraichissement d'un projet, ou `null`. */
export async function getLatestVerificationRefresh(
  db: DatabaseClient,
  projectId: string,
): Promise<VerificationRefreshRow | null> {
  const row = await db.verificationRefresh.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });
  return row === null ? null : toRefresh(row);
}

/** L'historique des rafraichissements d'un projet, du plus recent au plus ancien. */
export async function listVerificationRefreshes(
  db: DatabaseClient,
  projectId: string,
  limit = 10,
): Promise<VerificationRefreshRow[]> {
  const rows = await db.verificationRefresh.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(toRefresh);
}
