/**
 * Prompt d'execution et son empreinte.
 *
 * Separe des Server Actions et des pages : ce module n'importe ni Prisma, ni
 * Next.js, ni React, et reste donc directement testable.
 *
 * ## Pourquoi une empreinte
 *
 * Le prompt est regenere cote serveur au moment du lancement, a partir de la
 * tache en base — jamais repris du formulaire. L'empreinte sert a deux choses :
 * verifier apres coup que le prompt affiche etait bien celui envoye, et
 * reconnaitre, des mois plus tard, si deux executions sont parties du meme
 * texte alors que la specification de la tache a evolue depuis.
 */

import { createHash } from "node:crypto";

import {
  renderClaudeCorrectionPrompt,
  renderClaudeExecutionPrompt,
  type DevelopmentTaskDetail,
} from "@nox/shared";

export type ExecutionPrompt = {
  prompt: string;
  sha256: string;
};

/** Empreinte SHA-256 des octets UTF-8 du prompt, en hexadecimal minuscule. */
export function fingerprintPrompt(prompt: string): string {
  return createHash("sha256").update(prompt, "utf8").digest("hex");
}

/**
 * Construit le prompt d'execution d'une tache et son empreinte.
 *
 * Deterministe : deux appels sur la meme tache produisent le meme couple. C'est
 * ce qui permet a la page de preparation d'afficher exactement ce que la Server
 * Action enverra.
 */
export function buildExecutionPrompt(task: DevelopmentTaskDetail): ExecutionPrompt {
  const prompt = renderClaudeExecutionPrompt(task);
  return { prompt, sha256: fingerprintPrompt(prompt) };
}

/**
 * Construit le prompt d'une correction ciblee et son empreinte.
 *
 * Les commandes de validation viennent de la **specification actuelle** de la
 * tache, pas du run relu : une correction doit satisfaire ce que la tache exige
 * aujourd'hui, et c'est cette liste-la qui sera recopiee dans le nouveau run. Le
 * run precedent, lui, garde la sienne — c'est le principe de la recopie.
 */
export function buildCorrectionPrompt(input: {
  task: DevelopmentTaskDetail;
  sourceRunCode: string;
  feedback: string;
}): ExecutionPrompt {
  const prompt = renderClaudeCorrectionPrompt({
    taskCode: input.task.code,
    taskTitle: input.task.title,
    sourceRunCode: input.sourceRunCode,
    feedback: input.feedback,
    validationCommands: input.task.validationCommands,
    kind: input.task.kind,
  });
  return { prompt, sha256: fingerprintPrompt(prompt) };
}
