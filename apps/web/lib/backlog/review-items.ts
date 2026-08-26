/**
 * Identite des elements pendant la revue d'un backlog.
 *
 * ## Pourquoi ce module existe
 *
 * Une carte de backlog est un formulaire vivant : on y tape, on la deplace, on
 * la retire. React a donc besoin de savoir **laquelle** est laquelle entre deux
 * rendus, et cette question n'a qu'une bonne reponse : une identite qui ne
 * depend d'aucune valeur editable.
 *
 * La premiere version derivait la cle du titre. Taper une lettre changeait donc
 * la cle, React demontait la carte, la remontait a l'identique — et le champ
 * perdait le focus a chaque frappe. Le symptome etait le focus ; la cause etait
 * qu'une identite avait ete construite sur une valeur variable.
 *
 * ## Une identite locale, pas une colonne
 *
 * L'identifiant vit le temps de la revue et rien de plus. Il ne part dans aucun
 * formulaire, n'atteint jamais le serveur, et n'existe pas en base : une
 * proposition n'a pas besoin d'identifier ses elements, puisque leur position
 * **est** leur identite cote serveur. Ajouter une colonne pour un probleme de
 * rendu aurait fait payer au schema le prix d'un detail d'interface.
 *
 * ## Position et identite ne sont pas la meme chose
 *
 * Les champs restent nommes d'apres leur position courante — c'est ce qui fait
 * que le serveur lit l'ordre de l'ecran. L'identifiant, lui, suit l'element
 * quand il se deplace. Les deux coexistent parce qu'ils repondent a deux
 * questions differentes : « ou est-ce » et « qu'est-ce ».
 *
 * Pur : ni React, ni base, ni reseau, ni aleatoire.
 */

import type { TaskEditFormValues } from "../verification-fields.ts";

/** Un element de backlog en cours de revue, et son identite d'affichage. */
export type BacklogReviewItem = {
  /**
   * Identite stable pour toute la duree de la revue.
   *
   * Derivee de la position **initiale**, et jamais recalculee ensuite : la
   * revue ne sait qu'editer, deplacer et retirer, donc aucun element nouveau
   * n'apparait et aucune collision n'est possible.
   */
  uid: string;
  values: TaskEditFormValues;
};

/** Attribue une identite a chaque element, une fois pour toutes. */
export function createBacklogReviewItems(
  values: readonly TaskEditFormValues[],
): BacklogReviewItem[] {
  return values.map((item, index) => ({
    uid: `backlog-item-${String(index)}`,
    values: item,
  }));
}

/** Les valeurs seules, dans l'ordre courant. */
export function backlogReviewValues(
  items: readonly BacklogReviewItem[],
): TaskEditFormValues[] {
  return items.map((item) => item.values);
}

/**
 * Modifie un champ d'un element, sans toucher a son identite.
 *
 * C'est tout l'objet du module : la valeur change, l'element reste le meme.
 */
export function setBacklogItemField(
  items: readonly BacklogReviewItem[],
  index: number,
  field: BacklogItemTextField,
  next: string,
): BacklogReviewItem[] {
  return updateBacklogItem(items, index, (values) => ({ ...values, [field]: next }));
}

/** Les champs de texte libre d'un element, par opposition a son plan. */
export type BacklogItemTextField =
  | "title"
  | "priority"
  | "objective"
  | "context"
  | "outOfScope"
  | "documents";

/**
 * Applique une transformation aux valeurs d'un element, sans toucher a son
 * identite.
 *
 * Sert au plan de verification, dont les lignes ne sont pas des champs de texte :
 * ajouter un critere, cocher une preuve et retirer une commande passent tous par
 * ici, donc par une seule facon de remplacer un element.
 */
export function updateBacklogItem(
  items: readonly BacklogReviewItem[],
  index: number,
  transform: (values: TaskEditFormValues) => TaskEditFormValues,
): BacklogReviewItem[] {
  return items.map((item, position) =>
    position === index ? { uid: item.uid, values: transform(item.values) } : item,
  );
}
