/**
 * Frontiere avec le fournisseur de l'Architecte.
 *
 * Une interface volontairement etroite : deux methodes, qui recoivent du texte
 * et un schema, et rendent une structure ou un code d'erreur. Ce n'est pas un
 * cadre multi-fournisseurs — il n'en existe qu'un — mais le seul point ou les
 * tests peuvent se substituer au reseau.
 *
 * ## Deux methodes, et pas un `generate(...)` fourre-tout
 *
 * Concevoir une tache et relire une execution sont deux surfaces distinctes :
 * deux prompts, deux schemas, deux validations, deux facons de mal tourner. Les
 * nommer separement permet a un test de dire « la review n'a declare aucun
 * outil » sans avoir a deviner ce qu'un appel generique transportait, et rend
 * visible le jour ou l'une des deux divergerait de l'autre.
 *
 * Aucun test automatise de NOX ne joint `api.openai.com`. Ce serait consommer un
 * quota, dependre du reseau, et rendre les tests non reproductibles — exactement
 * les raisons pour lesquelles le faux Claude existe depuis TASK-008.
 *
 * ## Ce que le fournisseur ne decide pas
 *
 * Ni le modele, ni le schema, ni les instructions, ni les outils : tout lui est
 * donne. Il n'a aucune latitude, et notamment aucun moyen de reessayer tout seul
 * — un retour d'erreur remonte a l'utilisateur, qui recliquera s'il le souhaite.
 */

import type { ArchitectErrorCode, ArchitectUsage } from "@nox/shared";

export type ArchitectProviderInput = {
  model: string;
  /** Message systeme : les regles de l'architecte. */
  instructions: string;
  /** Contexte projet, demande et precisions, deja nettoyes et delimites. */
  input: string;
  /** Nom du format de sortie, stable. */
  schemaName: string;
  /** Schema JSON strict de la proposition. */
  schema: Record<string, unknown>;
  /** Delai maximal accorde a l'appel. */
  timeoutMs: number;
};

export type ArchitectProviderSuccess = {
  /** Objet JSON rendu par le modele, **non valide**. */
  raw: unknown;
  /** Identifiant de reponse du fournisseur, lorsqu'il en fournit un. */
  responseId: string | null;
  usage: ArchitectUsage;
};

export type ArchitectProviderResult =
  | { ok: true; value: ArchitectProviderSuccess }
  | { ok: false; code: ArchitectErrorCode };

export interface ArchitectProvider {
  /** Un tour de conversation, dont peut sortir une proposition de tache. */
  generateTaskTurn(input: ArchitectProviderInput): Promise<ArchitectProviderResult>;
  /** Une analyse de review, dont sort une recommandation. */
  analyzeRunReview(input: ArchitectProviderInput): Promise<ArchitectProviderResult>;
}

/**
 * Faux fournisseur, pour les tests et le test fonctionnel.
 *
 * Il enregistre ce qu'il a recu — c'est ainsi que les tests verifient qu'aucun
 * outil n'est declare, que le modele vient du serveur et qu'aucune cle ne figure
 * dans l'entree — et rend les reponses programmees, dans l'ordre.
 *
 * `calls` porte les deux surfaces confondues, et `turnCalls` / `reviewCalls` les
 * separent : un test qui veut prouver que zero appel de review a ete fait ne
 * doit pas avoir a filtrer lui-meme.
 */
export class FakeArchitectProvider implements ArchitectProvider {
  readonly calls: ArchitectProviderInput[] = [];
  readonly turnCalls: ArchitectProviderInput[] = [];
  readonly reviewCalls: ArchitectProviderInput[] = [];
  #responses: ArchitectProviderResult[];

  constructor(responses: readonly ArchitectProviderResult[]) {
    this.#responses = [...responses];
  }

  #next(input: ArchitectProviderInput): Promise<ArchitectProviderResult> {
    this.calls.push(input);
    const next = this.#responses.shift();
    if (next === undefined) {
      throw new Error("FakeArchitectProvider : aucune reponse programmee restante.");
    }
    return Promise.resolve(next);
  }

  generateTaskTurn(input: ArchitectProviderInput): Promise<ArchitectProviderResult> {
    this.turnCalls.push(input);
    return this.#next(input);
  }

  analyzeRunReview(input: ArchitectProviderInput): Promise<ArchitectProviderResult> {
    this.reviewCalls.push(input);
    return this.#next(input);
  }
}
