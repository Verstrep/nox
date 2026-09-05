/**
 * Traduction des codes de l'Architecte en phrases francaises.
 *
 * Meme principe que `lib/runner/errors.ts` : le code est stable et sans texte,
 * l'interface porte le message. Chaque phrase dit **quoi faire**, pas seulement
 * ce qui a echoue — « reessayez » est inutile quand la cause est une cle absente.
 *
 * Aucun message ne contient de detail fournisseur : ni URL, ni en-tete, ni
 * trace, ni fragment de cle, ni extrait du prompt envoye.
 */

import { ARCHITECT_ERROR, type ArchitectErrorCode, type ArchitectTextRefusal } from "@nox/shared";

import { ARCHITECT_ENVIRONMENT_VARIABLES } from "./config.ts";

const MESSAGES: Record<ArchitectErrorCode, string> = {
  [ARCHITECT_ERROR.ARCHITECT_NOT_CONFIGURED]:
    `L'architecte n'est pas configure. Renseignez ${ARCHITECT_ENVIRONMENT_VARIABLES.join(" et ")} ` +
    "dans le fichier .env a la racine, puis redemarrez l'application web.",

  [ARCHITECT_ERROR.ARCHITECT_TIMEOUT]:
    "Le fournisseur n'a pas repondu dans le delai imparti. Aucune proposition n'a ete produite ; " +
    "relancez la generation si vous le souhaitez.",

  [ARCHITECT_ERROR.ARCHITECT_RATE_LIMITED]:
    "Le fournisseur a refuse la requete pour cause de limite d'utilisation. Attendez quelques " +
    "minutes avant de relancer : NOX ne reessaie jamais tout seul.",

  [ARCHITECT_ERROR.ARCHITECT_AUTH_FAILED]:
    "Le fournisseur a refuse la cle d'API. Verifiez NOX_OPENAI_API_KEY dans le fichier .env, " +
    "puis redemarrez l'application web.",

  [ARCHITECT_ERROR.ARCHITECT_REFUSED]:
    "L'architecte a refuse de repondre a cette demande. Aucune proposition n'a ete produite. " +
    "Reformulez votre demande, puis relancez.",

  [ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID]:
    "La reponse de l'architecte ne respecte pas le format attendu par NOX. Rien n'a ete " +
    "enregistre ; relancez si vous le souhaitez.",

  [ARCHITECT_ERROR.ARCHITECT_RESPONSE_INCOMPLETE]:
    "Le fournisseur a interrompu sa reponse avant la fin. Rien n'a ete enregistre. Relancez, ou " +
    "reformulez votre demande en plusieurs messages plus courts.",

  [ARCHITECT_ERROR.ARCHITECT_UPDATE_TOO_LARGE]:
    "La mise a jour proposee depasse la taille que NOX accepte pour le brief et le plan reunis. " +
    "Rien n'a ete enregistre, et relancer ne changera rien : demandez a l'architecte une mise a " +
    "jour plus courte, ou raccourcissez le plan existant.",

  [ARCHITECT_ERROR.ARCHITECT_CANCELLED]:
    "Vous avez arrete la generation. NOX a ferme la requete ; rien n'a ete enregistre.",

  [ARCHITECT_ERROR.ARCHITECT_PROVIDER_ERROR]:
    "Le fournisseur a renvoye une erreur. Aucune proposition n'a ete produite ; relancez la " +
    "generation dans un moment.",

  [ARCHITECT_ERROR.ARCHITECT_CONTEXT_TOO_LARGE]:
    "Le contexte prepare a ete refuse par le fournisseur, probablement parce qu'il est trop " +
    "volumineux pour ce modele. Choisissez un modele acceptant une entree plus grande, ou " +
    "allegez les documents du projet.",

  [ARCHITECT_ERROR.ARCHITECT_GENERATION_LIMIT]:
    "Cette session a atteint son nombre maximal de generations. Ouvrez une nouvelle demande, ou " +
    "creez la tache a la main.",

  [ARCHITECT_ERROR.ARCHITECT_GENERATION_ACTIVE]:
    "Une generation est deja en cours pour cette session. Attendez qu'elle se termine avant d'en " +
    "lancer une autre.",

  [ARCHITECT_ERROR.ARCHITECT_ALREADY_APPLIED]:
    "Cette conversation a deja produit une tache. Ouvrez une nouvelle conversation pour en " +
    "preparer une autre.",

  [ARCHITECT_ERROR.ARCHITECT_NO_PENDING_TURN]:
    "Aucun message prepare. Ecrivez votre message, relisez le contexte, puis envoyez.",

  [ARCHITECT_ERROR.ARCHITECT_CONTEXT_CHANGED]:
    "Le contexte du projet a change depuis votre apercu. Relisez le contexte mis a jour avant de " +
    "l'envoyer. Aucun appel n'a ete fait.",

  [ARCHITECT_ERROR.ARCHITECT_CONVERSATION_TOO_LARGE]:
    "Cette conversation a atteint la taille maximale que NOX accepte d'envoyer. Aucun message " +
    "n'est resume ni supprime : ouvrez une nouvelle conversation pour poursuivre.",

  [ARCHITECT_ERROR.ARCHITECT_SESSION_LEGACY]:
    "Cette conversation a ete ouverte avant l'historique conversationnel et reste en lecture " +
    "seule. Ouvrez une nouvelle conversation pour discuter avec l'architecte.",

  [ARCHITECT_ERROR.ARCHITECT_REVIEW_UNAVAILABLE]:
    "Cette execution ne possede pas de snapshot de review suffisamment detaille pour une analyse " +
    "Architecte. NOX ne reconstruit pas un diff depuis le repository actuel : le resultat serait " +
    "celui d'aujourd'hui, pas celui de l'execution.",

  [ARCHITECT_ERROR.ARCHITECT_REVIEW_CHANGED]:
    "Les donnees de cette review ne correspondent plus a l'apercu que vous avez relu. Aucun appel " +
    "n'a ete fait. Rouvrez la preparation pour repartir d'un apercu a jour.",

  [ARCHITECT_ERROR.ARCHITECT_REVIEW_LIMIT]:
    "Cette execution a atteint son nombre maximal d'analyses. Relisez les analyses existantes : " +
    "elles restent toutes consultables.",

  [ARCHITECT_ERROR.ARCHITECT_REVIEW_ACTIVE]:
    "Une analyse est deja en cours pour cette execution. Attendez qu'elle se termine avant d'en " +
    "lancer une autre.",
};

/**
 * Ce que l'utilisateur etait en train de faire.
 *
 * ## Pourquoi ce parametre existe
 *
 * Parce qu'une phrase d'echec doit parler de l'operation qui a echoue. Jusqu'a
 * HOTFIX-003, `ARCHITECT_OUTPUT_INVALID` disait « Aucune tache n'a ete creee »
 * — quelle que soit la surface. Le second pilote reel l'a lu deux fois de suite
 * en demandant un ajustement du Living V1 Plan : aucune tache n'etait attendue,
 * et la phrase envoyait chercher un backlog qui n'existait pas.
 *
 * Le code d'erreur reste unique et stable ; c'est la **phrase** qui s'adapte.
 * Multiplier les codes par surface aurait fait diverger la classification pour
 * un probleme d'affichage.
 */
export const ARCHITECT_OPERATION = {
  /** Un tour de conversation, dont peut sortir une mise a jour du projet. */
  CONVERSATION: "CONVERSATION",
  /** Une planification de backlog, dont sortent des taches. */
  BACKLOG: "BACKLOG",
  /** Une analyse de review, dont sort une recommandation. */
  REVIEW: "REVIEW",
} as const;

export type ArchitectOperation = (typeof ARCHITECT_OPERATION)[keyof typeof ARCHITECT_OPERATION];

/**
 * Phrases specifiques a une operation, la ou la phrase generique mentirait.
 *
 * Volontairement une table minuscule : seuls les codes dont le texte parle de
 * ce qui a ete **produit** y figurent. Un delai depasse ou une cle refusee se
 * decrivent pareil partout, et leur donner trois variantes n'aurait fait que
 * trois occasions de diverger.
 */
const OPERATION_MESSAGES: Partial<
  Record<ArchitectOperation, Partial<Record<ArchitectErrorCode, string>>>
> = {
  [ARCHITECT_OPERATION.BACKLOG]: {
    [ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID]:
      "La reponse de l'architecte ne respecte pas le format attendu par NOX. Aucune tache n'a " +
      "ete creee ; relancez la generation.",
    [ARCHITECT_ERROR.ARCHITECT_RESPONSE_INCOMPLETE]:
      "Le fournisseur a interrompu sa reponse avant la fin. Aucune tache n'a ete creee ; " +
      "relancez la generation.",
    [ARCHITECT_ERROR.ARCHITECT_CANCELLED]:
      "Vous avez arrete la planification. NOX a ferme la requete ; aucun backlog n'a ete " +
      "propose et aucune tache n'a ete creee.",
  },
  [ARCHITECT_OPERATION.CONVERSATION]: {
    [ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID]:
      "La reponse de l'architecte ne respecte pas le format attendu par NOX. Aucune proposition " +
      "ni mise a jour n'a ete appliquee, et votre message est conserve : relancez-le tel quel, " +
      "ou reformulez-le.",
    [ARCHITECT_ERROR.ARCHITECT_RESPONSE_INCOMPLETE]:
      "Le fournisseur a interrompu sa reponse avant la fin. Aucune proposition ni mise a jour " +
      "n'a ete appliquee, et votre message est conserve : relancez-le, ou decoupez-le en " +
      "plusieurs messages plus courts.",
    [ARCHITECT_ERROR.ARCHITECT_TIMEOUT]:
      "Le fournisseur n'a pas repondu dans le delai imparti. Aucune proposition ni mise a jour " +
      "n'a ete appliquee, et votre message est conserve : relancez-le, ou decoupez-le en " +
      "plusieurs messages plus courts.",
    [ARCHITECT_ERROR.ARCHITECT_CANCELLED]:
      "Vous avez arrete le tour. NOX a ferme la requete ; aucune proposition ni mise a jour " +
      "n'a ete appliquee, et votre message est conserve tel quel.",
  },
  [ARCHITECT_OPERATION.REVIEW]: {
    [ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID]:
      "La reponse de l'architecte ne respecte pas le format attendu par NOX. Aucune analyse " +
      "n'a ete enregistree ; relancez si vous le souhaitez.",
  },
};

/**
 * Phrase affichee pour un code de l'Architecte.
 *
 * Sans operation, la phrase generique s'applique : elle ne parle jamais de ce
 * qui a ete produit, et ne peut donc pas se tromper de surface.
 */
export function describeArchitectError(
  code: ArchitectErrorCode,
  operation?: ArchitectOperation,
): string {
  if (operation !== undefined) {
    const specific = OPERATION_MESSAGES[operation]?.[code];
    if (specific !== undefined) {
      return specific;
    }
  }
  return MESSAGES[code];
}

/**
 * Phrase affichee pour un echec d'envoi, quelle qu'en soit la forme.
 *
 * Les trois formes d'echec — code stable, message deja redige, refus de saisie —
 * se rejoignent ici. Les distinguer sur chaque site d'appel finirait par produire
 * trois phrases differentes pour la meme cause.
 */
export function describeArchitectFailure(
  failure: { code: ArchitectErrorCode } | { message: string } | { refusal: ArchitectTextRefusal },
  max: number,
  operation?: ArchitectOperation,
): string {
  if ("code" in failure) {
    return describeArchitectError(failure.code, operation);
  }
  if ("refusal" in failure) {
    return describeArchitectTextRefusal(failure.refusal, max);
  }
  return failure.message;
}

/**
 * Phrase affichee pour un refus de saisie.
 *
 * La meme fonction sert a la demande produit et aux precisions : les deux
 * champs suivent les memes regles, et deux messages differents pour la meme
 * cause finiraient par diverger.
 */
export function describeArchitectTextRefusal(refusal: ArchitectTextRefusal, max: number): string {
  switch (refusal) {
    case "empty":
    case "blank":
      return "Ecrivez ce que vous voulez construire ou modifier.";
    case "too_long":
      return (
        `Ce texte depasse ${max.toLocaleString("fr-FR")} caracteres. Resumez votre demande : ` +
        "l'architecte a besoin d'une intention, pas d'une specification complete."
      );
    case "control_character":
      return (
        "Ce texte contient un caractere de controle. Recopiez-le depuis un editeur de texte simple."
      );
  }
}
