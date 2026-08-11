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
    "La reponse de l'architecte ne respecte pas le format attendu par NOX. Aucune tache n'a ete " +
    "creee ; relancez la generation.",

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
};

/** Phrase affichee pour un code de l'Architecte. */
export function describeArchitectError(code: ArchitectErrorCode): string {
  return MESSAGES[code];
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
