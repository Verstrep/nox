/**
 * Rafraichissement des plans de verification, apres un amorcage reussi.
 *
 * ## Le declencheur
 *
 * L'acceptation de `TASK-000`, jamais un rendu de page. Une tache d'amorcage
 * qui devient `COMPLETED` est un evenement applicatif ; rouvrir vingt fois la
 * page d'un projet n'en est pas un. C'est la meme regle que la livraison Git et
 * que la correction automatique, et pour la meme raison : ce qui coute de
 * l'argent ne doit pas dependre d'un rafraichissement de navigateur.
 *
 * ## Un appel, au plus, par etat de planification
 *
 * La reservation precede l'appel, et son unicite est une contrainte de base :
 * `(projectId, planningFingerprint)`. Dix acceptations concurrentes n'obtiennent
 * qu'une ligne, donc au plus un appel facture. Aucun reessai automatique,
 * aucun modele de repli, aucune reparation silencieuse : un echec laisse les
 * taches intactes et un diagnostic lisible.
 *
 * Rejouer plus tard reste possible — le plan aura change, donc l'empreinte
 * aussi — et c'est un geste humain.
 *
 * ## Ce qu'un echec ici ne fait pas
 *
 * Il ne fait jamais tomber l'acceptation de l'amorcage. `TASK-000` **est**
 * terminee ; un rafraichissement qui ne part pas laisse un projet correct dont
 * les plans de verification restent ceux d'avant. C'est la meme regle que pour
 * la capture de review, le lot de validations et la livraison.
 */

import {
  applyVerificationRefresh,
  bootstrapRefreshSucceeded,
  claimVerificationRefresh,
  countActiveRepositoryRuns,
  failVerificationRefresh,
  getTaskById,
  loadReplanPlanningState,
  recordVerificationRefreshResponse,
  type DatabaseClient,
  type VerificationRefreshRow,
} from "@nox/database";
import {
  ARCHITECT_ERROR,
  TASK_KIND,
  TASK_STATUS,
  VERIFICATION_MODE,
  VERIFICATION_REFRESH_MAX_OUTPUT_TOKENS,
  VERIFICATION_REFRESH_REFUSAL,
  VERIFICATION_REFRESH_SCHEMA_NAME,
  VERIFICATION_REFRESH_STATUS,
  buildVerificationRefreshSchema,
  readVerificationRefreshProposal,
  renderVerificationRefreshPrompt,
  type ArchitectPromptEditableTask,
  type VerificationRefreshRefusalCode,
  type VerificationRefreshTarget,
} from "@nox/shared";

import { resolvedArchitectHardTimeoutMs } from "../architect/config.ts";
import { createArchitectSanitizer } from "../architect/sanitize.ts";
import type { ArchitectProvider } from "../architect/provider.ts";
import {
  fetchArchitectContext,
  runnerArchitectPorts,
  type ArchitectRepositoryPorts,
} from "../architect/service.ts";
import { loadStructuredState } from "../project-plan.ts";
import { buildReplanPlanningContext } from "../replan/planning-context.ts";
import { verificationRefreshFingerprint } from "./fingerprint.ts";

/** Un projet, tel que ce module en a besoin. */
export type RefreshProject = {
  id: string;
  name: string;
  repositoryPath: string;
};

export type MaybeRefreshResult =
  /** Aucun appel n'a eu lieu, et rien n'a ete ecrit. */
  | { attempted: false; code: VerificationRefreshRefusalCode }
  /** Un appel a eu lieu ; son issue est dans `refresh`. */
  | { attempted: true; refresh: VerificationRefreshRow; changedTaskIds: string[] };

/**
 * La synchronisation des documents, injectee plutot qu'importee.
 *
 * Meme raison que dans le service de replanification : elle touche le runner,
 * donc elle depend de Next. La garder ici rendrait ce module inexecutable hors
 * du serveur web, et donc intestable.
 */
export type RefreshDocumentSync = (
  db: DatabaseClient,
  project: RefreshProject,
  taskIds: readonly string[],
) => Promise<void>;

export type VerificationRefreshInput = {
  project: RefreshProject;
  /** Tache d'amorcage qui vient d'etre acceptee. */
  taskId: string;
  provider: ArchitectProvider;
  /** Modele lu dans la configuration serveur, jamais recu du navigateur. */
  model: string;
  environment: Record<string, string | undefined>;
  ports?: ArchitectRepositoryPorts;
  syncDocuments?: RefreshDocumentSync;
};

/**
 * Rafraichit les plans de verification, si cela a lieu d'etre.
 *
 * ## L'ordre des refus, et ce que chacun protege
 *
 * Du moins couteux au plus couteux, et **tous** avant l'appel. Un
 * rafraichissement qui ne servirait a rien ne doit pas etre paye pour
 * l'apprendre :
 *
 * ```text
 * 1. la tache est-elle une amorce acceptee ?      ← lecture SQLite
 * 2. reste-t-il une tache future modifiable ?     ← lecture SQLite
 * 3. y a-t-il quelque chose a ameliorer ?         ← lecture SQLite
 * 4. le repository est-il libre ?                 ← lecture SQLite
 * 5. le contexte se construit-il ?                ← lecture runner
 * 6. cet etat a-t-il deja ete rafraichi ?         ← ecriture SQLite
 * 7. l'appel                                      ← facture
 * ```
 */
export async function maybeRefreshVerificationPlans(
  db: DatabaseClient,
  input: VerificationRefreshInput,
): Promise<MaybeRefreshResult> {
  const refuse = (code: VerificationRefreshRefusalCode): MaybeRefreshResult => ({
    attempted: false,
    code,
  });

  // 1. Une amorce, et acceptee. Les deux, et dans cet ordre : une tache normale
  //    n'a jamais rien a rafraichir, et une amorce en echec n'a rien installe.
  const task = await getTaskById(db, input.taskId);
  if (task === null || task.projectId !== input.project.id) {
    return refuse(VERIFICATION_REFRESH_REFUSAL.NOT_BOOTSTRAP);
  }
  if (task.kind !== TASK_KIND.BOOTSTRAP) {
    return refuse(VERIFICATION_REFRESH_REFUSAL.NOT_BOOTSTRAP);
  }
  if (task.status !== TASK_STATUS.COMPLETED) {
    return refuse(VERIFICATION_REFRESH_REFUSAL.BOOTSTRAP_NOT_ACCEPTED);
  }

  // Un amorcage ne se rafraichit qu'une fois. L'empreinte, seule, ne le
  // garantirait pas : un rafraichissement reussi change le plan qu'il vient de
  // lire, donc l'empreinte suivante differe, et un amorcage rouvert puis
  // re-accepte paierait un second appel sur un plan que NOX venait de mettre a
  // jour lui-meme.
  if (await bootstrapRefreshSucceeded(db, task.id)) {
    return refuse(VERIFICATION_REFRESH_REFUSAL.ALREADY_DONE);
  }

  // 2 et 3. Le plan de travail, et ce qu'il resterait a gagner.
  const state = await loadReplanPlanningState(db, input.project.id);
  const structuredState = await loadStructuredState(db, input.project);

  const sanitize = createArchitectSanitizer({
    repositoryRoot: input.project.repositoryPath,
    environment: input.environment,
  });

  const context = buildReplanPlanningContext({
    tasks: state.tasks,
    appliedBacklogCount: state.appliedBacklogCount,
    briefRevision: structuredState.brief.prompt?.revision ?? null,
    planRevision: structuredState.plan.prompt?.revision ?? null,
    sanitize,
  });
  if (!context.ok) {
    return refuse(VERIFICATION_REFRESH_REFUSAL.CONTEXT_UNAVAILABLE);
  }

  const editable = context.bundle.promptState.editable;
  if (editable.length === 0) {
    return refuse(VERIFICATION_REFRESH_REFUSAL.NO_FUTURE_TASK);
  }
  if (!hasHumanCriterion(editable)) {
    // Tout est deja automatise : il n'y a rien qu'un appel puisse ameliorer, et
    // le seul effet possible serait de degrader une classification que quelqu'un
    // a peut-etre posee a la main.
    return refuse(VERIFICATION_REFRESH_REFUSAL.NOTHING_TO_IMPROVE);
  }

  // 4. Une execution en cours sur ce repository interdit l'operation : elle
  //    pourrait terminer entre l'appel et l'ecriture, et le plan qu'elle
  //    validera ne serait plus celui qui a ete convenu avant son lancement.
  if ((await countActiveRepositoryRuns(db, input.project.id)) > 0) {
    return refuse(VERIFICATION_REFRESH_REFUSAL.REPOSITORY_BUSY);
  }

  // 5. Le contexte du repository. C'est la seule lecture hors SQLite, et elle
  //    est en lecture seule.
  const fetched = await fetchArchitectContext(
    input.project.repositoryPath,
    input.ports ?? runnerArchitectPorts,
  );
  if (!fetched.ok) {
    return refuse(VERIFICATION_REFRESH_REFUSAL.CONTEXT_UNAVAILABLE);
  }

  const documents = fetched.context.documents.map((document) => ({
    path: document.path,
    revision: document.revision,
    truncated: false,
    content: sanitize(document.content),
  }));

  const markers = fetched.context.inventory.map((entry) => entry.path);

  const prompt = renderVerificationRefreshPrompt({
    projectName: sanitize(input.project.name),
    projectBrief: structuredState.brief.prompt,
    projectV1Plan: structuredState.plan.prompt,
    documents,
    repositoryMarkers: markers,
    knownCommands: knownCommandsOf(state),
    editableTasks: editable,
  });

  const fingerprint = verificationRefreshFingerprint({
    planningFingerprint: context.bundle.planningFingerprint,
    documents,
    markers,
  });

  // 6. La reservation, avant l'appel. C'est ici, et nulle part ailleurs, que
  //    l'idempotence se joue.
  const claimed = await claimVerificationRefresh(db, {
    projectId: input.project.id,
    bootstrapTaskId: task.id,
    planningFingerprint: fingerprint,
    model: input.model,
    promptVersion: prompt.version,
  });
  if (!claimed.ok) {
    return refuse(VERIFICATION_REFRESH_REFUSAL.ALREADY_DONE);
  }

  const refreshId = claimed.refresh.id;
  const targets: VerificationRefreshTarget[] = editable.map((entry) => ({
    id: entry.id,
    code: entry.code,
    criteriaCount: entry.criteria.length,
  }));

  const conclude = async (
    status: (typeof VERIFICATION_REFRESH_STATUS)[keyof typeof VERIFICATION_REFRESH_STATUS],
    detail: {
      errorCode?: string | null;
      errorField?: string | null;
      errorDetail?: string | null;
    } = {},
  ): Promise<MaybeRefreshResult> => {
    const row = await failVerificationRefresh(db, { refreshId, status, ...detail });
    return {
      attempted: true,
      refresh: row ?? claimed.refresh,
      changedTaskIds: [],
    };
  };

  // 7. L'appel. Un seul, sans reessai : `maxRetries` vaut zero cote fournisseur,
  //    et il n'existe pas de modele de repli.
  let result;
  try {
    result = await input.provider.refreshVerification({
      model: input.model,
      instructions: prompt.instructions,
      input: prompt.input,
      schemaName: VERIFICATION_REFRESH_SCHEMA_NAME,
      schema: buildVerificationRefreshSchema(),
      timeoutMs: resolvedArchitectHardTimeoutMs(),
      maxOutputTokens: VERIFICATION_REFRESH_MAX_OUTPUT_TOKENS,
    });
  } catch (error) {
    // Une exception inattendue ne remonte pas telle quelle : elle porterait
    // l'URL du fournisseur et ses en-tetes.
    console.error("[nox] Echec inattendu du rafraichissement de verification :", error);
    return conclude(VERIFICATION_REFRESH_STATUS.FAILED, {
      errorCode: ARCHITECT_ERROR.ARCHITECT_PROVIDER_ERROR,
    });
  }

  if (!result.ok) {
    return conclude(VERIFICATION_REFRESH_STATUS.FAILED, { errorCode: result.code });
  }

  await recordVerificationRefreshResponse(db, {
    refreshId,
    providerResponseId: result.value.responseId,
    usage: result.value.usage,
    providerJson: JSON.stringify(result.value.raw),
  });

  const validated = readVerificationRefreshProposal(result.value.raw, targets);
  if (!validated.ok) {
    // Un seul champ hors contrat condamne toute la proposition. Appliquer les
    // taches valides d'une reponse jugee fautive laisserait un plan que personne
    // n'a relu.
    console.error(
      "[nox] Rafraichissement refuse :",
      validated.refusal.field,
      validated.refusal.message,
    );
    return conclude(VERIFICATION_REFRESH_STATUS.REFUSED, {
      errorCode: ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID,
      errorField: validated.refusal.field,
      errorDetail: validated.refusal.message,
    });
  }

  // 8. L'etat d'aujourd'hui, reconstruit sans aucun appel. La proposition n'est
  //    appliquee que s'il n'a pas bouge — jamais fusionnee.
  const current = await currentFingerprint(db, input, sanitize, documents, markers);
  if (current === null || current !== fingerprint) {
    return conclude(VERIFICATION_REFRESH_STATUS.STALE);
  }

  const applied = await applyVerificationRefresh(db, {
    projectId: input.project.id,
    refreshId,
    currentPlanningFingerprint: fingerprint,
    proposal: validated.proposal,
  });
  if (!applied.ok) {
    return conclude(VERIFICATION_REFRESH_STATUS.STALE);
  }

  // 9. Les documents Markdown suivent la transaction, ils ne la conditionnent
  //    pas. Une panne du runner laisse un projet correct et des documents a
  //    reprendre — jamais une ecriture annulee.
  if (input.syncDocuments !== undefined && applied.changedTaskIds.length > 0) {
    try {
      await input.syncDocuments(db, input.project, applied.changedTaskIds);
    } catch (error) {
      console.error("[nox] Echec de la synchronisation des documents apres rafraichissement :", error);
    }
  }

  return {
    attempted: true,
    refresh: applied.refresh,
    changedTaskIds: applied.changedTaskIds,
  };
}

/** Au moins un critere humain reste-t-il ? Sinon, rien a gagner. */
function hasHumanCriterion(tasks: readonly ArchitectPromptEditableTask[]): boolean {
  return tasks.some((task) =>
    task.criteria.some((criterion) => criterion.verificationMode === VERIFICATION_MODE.HUMAN),
  );
}

/**
 * Les commandes deja enregistrees ailleurs dans le projet.
 *
 * Elles ont ete validees par un humain sur d'autres taches, et constituent la
 * meilleure preuve disponible de ce qui existe reellement dans ce repository.
 * NOX ne lit ni `package.json`, ni aucun manifeste : deviner des scripts serait
 * deviner, et l'amorcage a justement pour contrat de documenter les commandes
 * reellement utilisees.
 */
function knownCommandsOf(state: { tasks: readonly { contract: { validationCommands: readonly { command: string }[] } | null }[] }): string[] {
  const seen = new Set<string>();
  for (const task of state.tasks) {
    for (const command of task.contract?.validationCommands ?? []) {
      seen.add(command.command);
    }
  }
  return [...seen].sort((left, right) => left.localeCompare(right));
}

/**
 * Reconstruit l'empreinte d'aujourd'hui, sans aucun appel au fournisseur.
 *
 * Le repository n'est **pas** relu : ce sont les documents et l'inventaire deja
 * lus qui sont reutilises. Les relire ferait dependre la peremption d'un fichier
 * Markdown enregistre pendant l'appel, et refuserait une proposition
 * parfaitement valable. Ce qui doit ne pas avoir bouge est le **plan de
 * travail** — c'est ce qu'une replanification concurrente, une edition de tache
 * ou une inscription en file changeraient —, et c'est lui qui est relu en base.
 */
async function currentFingerprint(
  db: DatabaseClient,
  input: VerificationRefreshInput,
  sanitize: (value: string) => string,
  documents: readonly { path: string; revision: string | null }[],
  markers: readonly string[],
): Promise<string | null> {
  const state = await loadReplanPlanningState(db, input.project.id);
  const structuredState = await loadStructuredState(db, input.project);
  const context = buildReplanPlanningContext({
    tasks: state.tasks,
    appliedBacklogCount: state.appliedBacklogCount,
    briefRevision: structuredState.brief.prompt?.revision ?? null,
    planRevision: structuredState.plan.prompt?.revision ?? null,
    sanitize,
  });
  if (!context.ok) {
    return null;
  }
  return verificationRefreshFingerprint({
    planningFingerprint: context.bundle.planningFingerprint,
    documents,
    markers,
  });
}
