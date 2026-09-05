/**
 * Diagnostic sur d'un tour d'Architecte qui a echoue.
 *
 * ## Pourquoi ce module existe
 *
 * HOTFIX-001 avait donne un diagnostic a la **planification** : le validateur
 * de backlog savait « le troisieme critere de la tache 1 est vide », et cette
 * phrase partait dans `console.error` pendant que l'utilisateur lisait « la
 * reponse ne respecte pas le format attendu ». La conversation projet, elle,
 * est restee sans diagnostic.
 *
 * Le second pilote reel l'a payé. Deux tours consecutifs ont echoue avec la
 * meme phrase generique, sur une demande d'ajustement du Living V1 Plan. Quatre
 * causes de code distinctes produisent ce meme message, et rien de ce qui est
 * enregistre ne permet de dire laquelle :
 *
 * ```text
 * reponse vide ou tronquee par le fournisseur   ← openai.ts
 * JSON illisible                                 ← openai.ts
 * contrat de tour refuse par NOX                 ← readArchitectTurn
 * mise a jour de projet hors budget              ← checkProviderProjectUpdate
 * ```
 *
 * La derniere n'est meme pas un probleme de format : la reponse etait
 * parfaitement formee, et NOX l'a refusee parce que le brief et le plan
 * cumules auraient depasse seize Kio. La presenter comme une erreur de format
 * envoie chercher au mauvais endroit, et relancer n'y change rien — c'est
 * deterministe.
 *
 * ## Ce qui est sur, et ce qui ne l'est pas
 *
 * Ne sortent d'ici que trois choses : une **categorie** decidee par NOX, le
 * **chemin** du champ fautif — produit par le validateur de NOX, jamais par le
 * fournisseur — et une **phrase** ecrite pour l'utilisateur.
 *
 * Le JSON brut de la reponse, le prompt, la trace d'exception, les details du
 * SDK, les en-tetes et la cle ne traversent jamais cette frontiere. Ils ne sont
 * pas filtres ici : ils n'y entrent pas. C'est la meme garantie que pour le
 * diagnostic de planification, et elle est structurelle — le type ci-dessous
 * n'a aucun champ ou les mettre.
 *
 * Quelques phrases citent une **valeur produite par NOX** : un nombre de
 * caracteres, une borne. Ce sont des nombres que NOX a calcules lui-meme, pas
 * des fragments de la reponse. Elles passent quand meme par le nettoyeur :
 * borne ne veut pas dire propre.
 *
 * Pur et sans dependance : ni base, ni React, ni reseau.
 */

import { ARCHITECT_ERROR, type ArchitectErrorCode } from "./architect.js";

/**
 * Nature d'un echec de tour.
 *
 * Cinq valeurs, et elles ne se confondent pas. Un contrat viole, une reponse
 * coupee et une proposition trop grosse appellent trois gestes differents :
 * signaler, relancer, raccourcir. Les presenter avec le meme vocabulaire — ce
 * que NOX faisait — envoie chercher au mauvais endroit deux fois sur trois.
 */
export const ARCHITECT_TURN_FAILURE = {
  /** Le texte recu n'etait pas du JSON lisible. */
  MALFORMED_JSON: "MALFORMED_JSON",
  /** Le JSON etait lisible et ne respecte pas le contrat de tour. */
  CONTRACT_INVALID: "CONTRACT_INVALID",
  /**
   * La reponse s'est arretee avant d'etre complete.
   *
   * Distincte d'un JSON malforme : le fournisseur a repondu, et il dit lui-meme
   * que sa reponse est incomplete. Relancer peut suffire ; raccourcir la demande
   * aussi. « Le modele s'est tu » et « le modele a mal repondu » ne se corrigent
   * pas pareil.
   */
  RESPONSE_INCOMPLETE: "RESPONSE_INCOMPLETE",
  /**
   * La mise a jour de projet proposee ne tient pas dans le budget structure.
   *
   * Ce n'est **pas** une violation de contrat. La reponse etait bien formee ;
   * elle demandait a ecrire plus que ce que NOX accepte de stocker.
   */
  UPDATE_TOO_LARGE: "UPDATE_TOO_LARGE",
  /** Aucune reponse exploitable : reseau, quota, delai, refus du modele. */
  PROVIDER_ERROR: "PROVIDER_ERROR",
} as const;

export type ArchitectTurnFailureCategory =
  (typeof ARCHITECT_TURN_FAILURE)[keyof typeof ARCHITECT_TURN_FAILURE];

export const ARCHITECT_TURN_FAILURE_CATEGORIES: readonly ArchitectTurnFailureCategory[] =
  Object.values(ARCHITECT_TURN_FAILURE);

/**
 * Ce que NOX conserve d'un tour echoue, et rien de plus.
 *
 * `field` et `message` valent `null` pour une panne du fournisseur — il n'y a
 * pas de champ fautif — et pour toute generation anterieure a ce correctif,
 * dont la cause n'a jamais ete enregistree. « Pas de diagnostic » est un etat,
 * pas une occasion d'en inventer un.
 */
export type ArchitectTurnDiagnostic = {
  category: ArchitectTurnFailureCategory;
  /** Chemin technique du champ refuse, tel que le validateur l'a nomme. */
  field: string | null;
  /** Phrase francaise, deja destinee a l'utilisateur. */
  message: string | null;
};

/** Bornes de stockage et d'affichage d'un diagnostic. */
export const ARCHITECT_DIAGNOSTIC_LIMITS = {
  field: 120,
  message: 600,
} as const;

/** Marqueur de troncature : une phrase coupee doit dire qu'elle l'a ete. */
const TRUNCATION_MARKER = " […]";

/**
 * Nettoie un texte de diagnostic avant qu'il n'atteigne la base ou l'ecran.
 *
 * Caracteres de controle retires, blancs ecrases, longueur bornee et troncature
 * annoncee. Un texte vide apres nettoyage rend `null` : mieux vaut « cause non
 * enregistree » qu'une ligne vide qui ressemble a une information.
 *
 * Meme traitement que le diagnostic de planification, et volontairement une
 * seconde implementation minuscule plutot qu'un import croise : les deux
 * surfaces ont leurs propres bornes, et les faire dependre l'une de l'autre
 * ferait bouger celles du backlog le jour ou celles-ci changeraient.
 */
export function sanitizeArchitectDiagnosticText(value: string, max: number): string | null {
  const cleaned = value
    // eslint-disable-next-line no-control-regex -- c'est precisement ce qu'on retire.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (cleaned === "") {
    return null;
  }
  return cleaned.length <= max
    ? cleaned
    : `${cleaned.slice(0, max - TRUNCATION_MARKER.length).trim()}${TRUNCATION_MARKER}`;
}

/**
 * Nature d'un echec, derivee de son code.
 *
 * Aucune colonne supplementaire : `errorCode` porte deja cette information, et
 * la dupliquer garantirait qu'un jour les deux se contredisent. La categorie
 * fine — JSON illisible contre contrat refuse — vient de `errorField`, qui
 * porte un marqueur reserve quand l'analyse elle-meme a echoue.
 */
export function architectTurnFailureCategory(
  errorCode: string | null,
  errorField: string | null,
): ArchitectTurnFailureCategory {
  if (errorCode === ARCHITECT_ERROR.ARCHITECT_UPDATE_TOO_LARGE) {
    return ARCHITECT_TURN_FAILURE.UPDATE_TOO_LARGE;
  }
  if (errorCode === ARCHITECT_ERROR.ARCHITECT_RESPONSE_INCOMPLETE) {
    return ARCHITECT_TURN_FAILURE.RESPONSE_INCOMPLETE;
  }
  if (errorCode !== ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID) {
    return ARCHITECT_TURN_FAILURE.PROVIDER_ERROR;
  }
  return errorField === ARCHITECT_DIAGNOSTIC_FIELD.JSON
    ? ARCHITECT_TURN_FAILURE.MALFORMED_JSON
    : ARCHITECT_TURN_FAILURE.CONTRACT_INVALID;
}

/**
 * Champs reserves, poses par NOX quand aucun champ du contrat n'est en cause.
 *
 * Ce ne sont pas des chemins du schema : ce sont des **etapes**. Une reponse
 * qui n'est pas du JSON n'a aucun champ fautif, et laisser `field` a `null`
 * confondrait ce cas avec « cause non enregistree ».
 */
export const ARCHITECT_DIAGNOSTIC_FIELD = {
  /** L'analyse du texte a echoue : rien n'a pu etre lu. */
  JSON: "$response.json",
  /** Le fournisseur a rendu une reponse vide ou coupee. */
  INCOMPLETE: "$response.incomplete",
  /** Le budget structure du projet, mesure sur l'etat resultant. */
  BUDGET: "$projectUpdate.budget",
} as const;

/**
 * Libelles des etapes et des champs du contrat de tour.
 *
 * Un chemin technique se cherche dans une reponse ; un libelle se lit. Les deux
 * sont affiches, comme pour la planification, et pour la meme raison.
 */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  [ARCHITECT_DIAGNOSTIC_FIELD.JSON]: "Réponse du fournisseur",
  [ARCHITECT_DIAGNOSTIC_FIELD.INCOMPLETE]: "Réponse incomplète",
  [ARCHITECT_DIAGNOSTIC_FIELD.BUDGET]: "Budget du brief et du plan",
  turn: "Structure de la réponse",
  schemaVersion: "Version de contrat",
  state: "Issue du tour",
  message: "Message de l'architecte",
  questions: "Questions",
  proposal: "Proposition de tâche",
  projectUpdate: "Mise à jour du projet",
  replan: "Replanification",
};

/**
 * Libelle lisible d'un champ, ou `null` s'il n'en a pas.
 *
 * Un chemin imbrique — `projectUpdate.brief.summary` — est designe par sa
 * **racine** : c'est elle qui dit de quelle partie de la reponse il s'agit, et
 * c'est la seule information qu'un lecteur peut utiliser. Le chemin complet
 * reste affiche a cote.
 */
export function architectDiagnosticFieldLabel(field: string | null): string | null {
  if (field === null) {
    return null;
  }
  const direct = FIELD_LABELS[field];
  if (direct !== undefined) {
    return direct;
  }
  const root = field.split(".")[0];
  return root === undefined ? null : (FIELD_LABELS[root] ?? null);
}

/**
 * Code d'erreur correspondant a une categorie.
 *
 * Utilise a l'ecriture, pour que le code enregistre et la categorie relue ne
 * puissent pas se contredire : `architectTurnFailureCategory` est l'inverse de
 * cette fonction, et un test le verifie dans les deux sens.
 */
export function architectTurnFailureCode(
  category: ArchitectTurnFailureCategory,
): ArchitectErrorCode {
  switch (category) {
    case ARCHITECT_TURN_FAILURE.UPDATE_TOO_LARGE:
      return ARCHITECT_ERROR.ARCHITECT_UPDATE_TOO_LARGE;
    case ARCHITECT_TURN_FAILURE.RESPONSE_INCOMPLETE:
      return ARCHITECT_ERROR.ARCHITECT_RESPONSE_INCOMPLETE;
    case ARCHITECT_TURN_FAILURE.MALFORMED_JSON:
    case ARCHITECT_TURN_FAILURE.CONTRACT_INVALID:
      return ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID;
    case ARCHITECT_TURN_FAILURE.PROVIDER_ERROR:
      return ARCHITECT_ERROR.ARCHITECT_PROVIDER_ERROR;
  }
}
