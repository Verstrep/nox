"use server";

import { getDatabaseClient } from "@nox/database";
import process from "node:process";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { loadArchitectConfig } from "@/lib/architect/config";
import { describeArchitectError } from "@/lib/architect/errors";
import { OpenAIArchitectProvider } from "@/lib/architect/openai";
import { loadBacklogInput } from "@/lib/backlog";
import {
  backlogRefusalMessage,
  backlogReviewUrl,
  backlogUrl,
} from "@/lib/backlog/display";
import {
  applyProjectBacklog,
  dismissProjectBacklog,
  generateProjectBacklog,
} from "@/lib/backlog/service";
import { loadProject } from "@/lib/projects";
import { applyTaskDocumentSync } from "@/lib/tasks";
import { readPlanRows } from "@/lib/verification-fields";

import type {
  BacklogApplyState,
  BacklogDismissState,
  BacklogGenerateState,
  BacklogItemValues,
} from "./form-state";

const UNKNOWN_PROJECT_MESSAGE =
  "Ce projet n'existe pas. Revenez au tableau de bord et rouvrez-le.";

const UNEXPECTED_ERROR_MESSAGE =
  "Une erreur inattendue est survenue. Consultez les logs du serveur pour le detail.";

function readField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

function revalidateBacklog(projectId: string): void {
  revalidatePath(`/projects/${projectId}/backlog`);
  revalidatePath(`/projects/${projectId}/plan`);
  revalidatePath(`/projects/${projectId}`);
}

/**
 * Genere un backlog de V1.
 *
 * ## Un clic, au plus un appel
 *
 * Toutes les preconditions — plan defini, aucune planification en vol, aucune
 * proposition en attente — sont verifiees **avant** que la requete ne parte. Un
 * refus coute donc zero appel et zero jeton.
 *
 * ## Rien ne vient du navigateur
 *
 * Ni le contexte, ni le prompt, ni le modele, ni l'etat du projet, ni
 * l'inventaire des taches. Le formulaire ne transporte qu'un identifiant de
 * projet ; tout le reste est relu cote serveur au moment du clic.
 */
export async function generateBacklogAction(
  _previousState: BacklogGenerateState,
  formData: FormData,
): Promise<BacklogGenerateState> {
  const projectId = readField(formData, "projectId");
  let proposalId: string;

  try {
    const project = await loadProject(projectId);
    if (project === null) {
      return { error: UNKNOWN_PROJECT_MESSAGE };
    }

    const db = getDatabaseClient();
    const input = await loadBacklogInput(db, project);
    if (!input.ok) {
      return {
        error: `L'Architecte n'est pas configure : ${input.missing.join(", ")} manque.`,
      };
    }

    const config = loadArchitectConfig(process.env);
    if (!config.ok) {
      return { error: `L'Architecte n'est pas configure : ${config.missing.join(", ")} manque.` };
    }

    const generated = await generateProjectBacklog(db, {
      ...input.input,
      provider: new OpenAIArchitectProvider({ apiKey: config.config.apiKey }),
    });
    if (!generated.ok) {
      if ("refusal" in generated) {
        return { error: backlogRefusalMessage(generated.refusal) };
      }
      return {
        error: "code" in generated ? describeArchitectError(generated.code) : generated.message,
      };
    }

    proposalId = generated.proposal.id;
    revalidateBacklog(project.id);
  } catch (error) {
    console.error("[nox] Echec de la planification du backlog :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE };
  }

  // Hors du `try` : `redirect` leve une exception de controle que Next.js
  // intercepte, et l'attraper la traiterait comme un echec.
  redirect(backlogReviewUrl(projectId, proposalId));
}

/**
 * Lit le backlog relu par l'humain.
 *
 * Le formulaire numerote ses champs : `items.0.title`, `items.1.criteria`… Le
 * nombre d'elements est declare, et borne a la lecture — un compteur falsifie ne
 * peut donc produire qu'une liste vide ou tronquee, jamais une boucle.
 */
function readItems(formData: FormData): BacklogItemValues[] {
  const declared = Number.parseInt(readField(formData, "itemCount"), 10);
  if (!Number.isInteger(declared) || declared <= 0) {
    return [];
  }

  const items: BacklogItemValues[] = [];
  for (let index = 0; index < Math.min(declared, 100); index += 1) {
    const prefix = `items.${String(index)}.`;
    const at = (field: string): string => readField(formData, `${prefix}${field}`);
    // Le plan passe par le lecteur partage : l'editeur de tache et cette revue
    // envoient exactement les memes champs, a leur prefixe pres.
    const plan = readPlanRows(formData, prefix);
    items.push({
      title: at("title"),
      priority: at("priority"),
      objective: at("objective"),
      context: at("context"),
      outOfScope: at("outOfScope"),
      documents: at("documents"),
      criteria: plan.criteria,
      commands: plan.commands,
      // Le planificateur ne propose aucune dependance, et cette revue n'en pose
      // aucune : elles se placent a la main, apres l'application.
      dependsOnTaskIds: [],
    });
  }
  return items;
}

/**
 * Applique un backlog relu par un humain.
 *
 * ## Ce que cette action ne fait pas
 *
 * Aucun appel a OpenAI, aucun lancement de Claude Code, aucun `git add`, aucun
 * commit, aucun push. Elle cree des taches `DRAFT` et leurs documents Markdown,
 * exactement comme la creation unitaire de TASK-007.
 *
 * ## Ce que le serveur refait
 *
 * Tout. Chaque element repasse par la validation d'un formulaire de tache, la
 * garde des commandes, la liste fermee des documents, le preflight du
 * repository et le controle de peremption. Ce que l'humain a modifie n'a pas
 * plus de credit que ce que le modele avait propose.
 *
 * ## L'ordre applique est celui de l'ecran
 *
 * Les positions viennent de l'ordre des champs, donc de ce que l'utilisateur a
 * valide — jamais de l'ordre d'origine du fournisseur.
 */
export async function applyBacklogAction(
  previousState: BacklogApplyState,
  formData: FormData,
): Promise<BacklogApplyState> {
  const projectId = readField(formData, "projectId");
  const proposalId = readField(formData, "proposalId");
  const items = readItems(formData);
  const failed = (error: string, stale = false): BacklogApplyState => ({
    items: items.length === 0 ? previousState.items : items,
    error,
    stale,
  });

  try {
    const project = await loadProject(projectId);
    if (project === null) {
      return failed(UNKNOWN_PROJECT_MESSAGE);
    }

    const db = getDatabaseClient();
    const input = await loadBacklogInput(db, project);
    if (!input.ok) {
      return failed(`L'Architecte n'est pas configure : ${input.missing.join(", ")} manque.`);
    }

    const applied = await applyProjectBacklog(db, { ...input.input, proposalId, items });
    if (!applied.ok) {
      return "stale" in applied ? failed("", true) : failed(applied.message);
    }

    // Les documents sont crees **apres** la transaction, un par un, avec la
    // primitive de TASK-007 : creation exclusive, adoption d'un fichier
    // identique, conflit sinon. Un echec ici ne remet aucune tache en cause —
    // il laisse un document a reprendre, etat que NOX modelise et affiche.
    for (const task of applied.tasks) {
      await applyTaskDocumentSync(task, project.repositoryPath);
    }

    revalidateBacklog(project.id);
  } catch (error) {
    console.error("[nox] Echec de l'application du backlog :", error);
    return failed(UNEXPECTED_ERROR_MESSAGE);
  }

  redirect(backlogUrl(projectId));
}

/**
 * Ecarte une proposition de backlog.
 *
 * Zero appel, zero tache creee, zero ecriture dans le repository. La
 * proposition reste lisible : ce que le modele avait propose, et le fait qu'on
 * ne l'ait pas retenu, sont deux informations.
 */
export async function dismissBacklogAction(
  _previousState: BacklogDismissState,
  formData: FormData,
): Promise<BacklogDismissState> {
  const projectId = readField(formData, "projectId");
  const proposalId = readField(formData, "proposalId");

  try {
    const project = await loadProject(projectId);
    if (project === null) {
      return { error: UNKNOWN_PROJECT_MESSAGE };
    }

    const dismissed = await dismissProjectBacklog(getDatabaseClient(), {
      projectId: project.id,
      proposalId,
    });
    if (!dismissed.ok) {
      return { error: dismissed.message };
    }

    revalidateBacklog(project.id);
  } catch (error) {
    console.error("[nox] Echec de l'abandon du backlog :", error);
    return { error: UNEXPECTED_ERROR_MESSAGE };
  }

  redirect(backlogUrl(projectId));
}
