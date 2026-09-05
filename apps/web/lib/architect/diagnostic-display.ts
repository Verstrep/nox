/**
 * Affichage d'un tour d'Architecte qui a echoue.
 *
 * ## Ce que cet ecran doit permettre
 *
 * Comprendre **pourquoi** un tour a echoue sans relancer d'appel. C'est la
 * lecon du second pilote reel : deux tours consecutifs ont echoue sur la meme
 * phrase generique, et la seule facon d'en apprendre davantage aurait ete d'en
 * payer un troisieme.
 *
 * ## Ce qu'il n'affiche jamais
 *
 * Le texte recu du fournisseur, le prompt, les en-tetes, la cle, une trace. Ce
 * n'est pas un filtre applique ici : `ArchitectTurnDiagnostic` n'a aucun champ
 * ou les mettre, et rien de ce module ne va les chercher ailleurs.
 *
 * Pur : ni base, ni React, ni reseau.
 */

import {
  ARCHITECT_ERROR,
  ARCHITECT_TURN_FAILURE,
  architectDiagnosticFieldLabel,
  type ArchitectTurnDiagnostic,
  type ArchitectTurnFailureCategory,
} from "@nox/shared";

/**
 * Ce que la categorie dit, en une phrase courte.
 *
 * Elle repond a « de quelle nature est ce probleme », la ou `message` repond a
 * « lequel exactement ». Les deux sont affiches : la premiere oriente, la
 * seconde localise.
 */
export function architectFailureCategoryLabel(category: ArchitectTurnFailureCategory): string {
  switch (category) {
    case ARCHITECT_TURN_FAILURE.MALFORMED_JSON:
      return "Réponse illisible";
    case ARCHITECT_TURN_FAILURE.CONTRACT_INVALID:
      return "Contrat non respecté";
    case ARCHITECT_TURN_FAILURE.RESPONSE_INCOMPLETE:
      return "Réponse interrompue";
    case ARCHITECT_TURN_FAILURE.UPDATE_TOO_LARGE:
      return "Mise à jour trop volumineuse";
    case ARCHITECT_TURN_FAILURE.PROVIDER_ERROR:
      return "Panne du fournisseur";
  }
}

/**
 * Ce qu'il faut faire, par nature de probleme.
 *
 * Trois causes, trois gestes differents — et c'est toute la raison pour
 * laquelle elles ont ete separees. « Relancez » etait la seule consigne
 * affichee jusqu'ici, et elle etait fausse dans le cas qui a coute deux tours
 * au pilote : un depassement de budget est deterministe, relancer le reproduit
 * a l'identique.
 */
export function architectFailureGuidance(category: ArchitectTurnFailureCategory): string {
  switch (category) {
    case ARCHITECT_TURN_FAILURE.MALFORMED_JSON:
    case ARCHITECT_TURN_FAILURE.CONTRACT_INVALID:
      return "Relancer le même message peut suffire : le modèle ne répond pas deux fois pareil.";
    case ARCHITECT_TURN_FAILURE.RESPONSE_INCOMPLETE:
      return (
        "Relancer peut suffire. Si l'échec se répète, découpez la demande en plusieurs " +
        "messages plus courts."
      );
    case ARCHITECT_TURN_FAILURE.UPDATE_TOO_LARGE:
      return (
        "Relancer ne changera rien : ce refus est déterministe. Raccourcissez le plan " +
        "existant, ou demandez une mise à jour plus courte."
      );
    case ARCHITECT_TURN_FAILURE.PROVIDER_ERROR:
      return "Rien n'a été reçu de lisible. Relancez dans un moment.";
  }
}

/**
 * Le libelle **precis** d'un echec, quand le code en dit plus que sa categorie.
 *
 * ## Pourquoi cette table existe
 *
 * `PROVIDER_ERROR` regroupe cinq codes : delai depasse, quota, cle refusee,
 * contexte trop grand, panne generique. Le groupe sert a choisir une consigne —
 * elle est la meme pour les cinq — mais il ne doit pas remplacer le **fait**.
 *
 * Le second pilote l'a montre immediatement : ses tours 5 et 6, persistes avec
 * `ARCHITECT_TIMEOUT`, se sont mis a s'afficher « Panne du fournisseur / Rien
 * n'a ete recu de lisible » apres le premier correctif. C'etait une regression
 * d'affichage — la ligne en base disait bien « delai depasse », et l'ecran
 * cessait de le dire.
 *
 * Rien n'est reconstruit ici : le code affiche est celui qui a ete enregistre.
 */
const CODE_LABELS: Readonly<Record<string, string>> = {
  [ARCHITECT_ERROR.ARCHITECT_TIMEOUT]: "Délai dépassé",
  [ARCHITECT_ERROR.ARCHITECT_RATE_LIMITED]: "Limite d'utilisation atteinte",
  [ARCHITECT_ERROR.ARCHITECT_AUTH_FAILED]: "Clé refusée",
  [ARCHITECT_ERROR.ARCHITECT_CONTEXT_TOO_LARGE]: "Contexte trop volumineux",
  [ARCHITECT_ERROR.ARCHITECT_REFUSED]: "Refus du modèle",
};

/**
 * Consigne propre a un code, quand celle de la categorie serait fausse.
 *
 * « Rien n'a ete recu de lisible. Relancez dans un moment. » convient a une
 * panne generique, et pas a une cle refusee ni a un contexte trop grand : ces
 * deux-la ne se corrigent pas en attendant.
 */
const CODE_GUIDANCE: Readonly<Record<string, string>> = {
  [ARCHITECT_ERROR.ARCHITECT_TIMEOUT]:
    "Le fournisseur n'a pas répondu dans le délai imparti. Relancez, ou découpez la demande.",
  [ARCHITECT_ERROR.ARCHITECT_RATE_LIMITED]:
    "Attendez quelques minutes : NOX ne réessaie jamais tout seul.",
  [ARCHITECT_ERROR.ARCHITECT_AUTH_FAILED]:
    "Relancer ne changera rien tant que la clé n'est pas corrigée.",
  [ARCHITECT_ERROR.ARCHITECT_CONTEXT_TOO_LARGE]:
    "Relancer ne changera rien : allégez les documents du projet, ou changez de modèle.",
};

/** Une ligne de diagnostic, prete a etre rendue. */
export type ArchitectDiagnosticView = {
  category: string;
  /** Libelle lisible du champ, ou `null` s'il n'en a pas. */
  fieldLabel: string | null;
  /** Chemin technique, qui se cherche dans une reponse. */
  fieldPath: string | null;
  message: string | null;
  guidance: string;
};

/**
 * Compose l'affichage d'un diagnostic.
 *
 * `null` quand rien n'a ete enregistre — une generation anterieure a
 * HOTFIX-003. Ne rien afficher est alors la bonne reponse : reconstruire une
 * cause apres coup inventerait une information que personne n'a persistee.
 */
export function architectDiagnosticView(
  diagnostic: ArchitectTurnDiagnostic | null,
  /**
   * Le code reellement enregistre sur la generation.
   *
   * Il prime sur la categorie pour le libelle et la consigne : la categorie
   * regroupe, le code constate. Absent, la categorie suffit.
   */
  errorCode: string | null = null,
): ArchitectDiagnosticView | null {
  if (diagnostic === null) {
    return null;
  }
  const precise = errorCode === null ? undefined : CODE_LABELS[errorCode];
  const preciseGuidance = errorCode === null ? undefined : CODE_GUIDANCE[errorCode];
  return {
    category: precise ?? architectFailureCategoryLabel(diagnostic.category),
    fieldLabel: architectDiagnosticFieldLabel(diagnostic.field),
    fieldPath: diagnostic.field,
    message: diagnostic.message,
    guidance: preciseGuidance ?? architectFailureGuidance(diagnostic.category),
  };
}

/**
 * Ce que l'empreinte de contexte designe, dit a l'ecran.
 *
 * ## Pourquoi cette phrase existe
 *
 * Le second pilote a remarque que six tours consecutifs affichaient la meme
 * empreinte alors que chaque message etait different, et s'est demande si NOX
 * envoyait un contexte perime. Il n'en etait rien : cette empreinte couvre le
 * **contexte projet** — brief, plan, documents, memoire, taches recentes — et
 * pas la conversation. Elle ne doit changer que lorsque le projet change, et sa
 * stabilite entre deux messages est exactement ce qu'on attend d'elle.
 *
 * L'empreinte qui couvre le message en attente existe, s'appelle autrement, et
 * n'est pas affichee : elle sert a refuser un envoi parti d'un onglet perime.
 */
export const CONTEXT_FINGERPRINT_NOTICE =
  "L'empreinte de contexte couvre le brief, le plan, la mémoire, les documents et les tâches " +
  "récentes — jamais vos messages. Elle reste donc identique d'un tour à l'autre tant que le " +
  "projet ne change pas, et c'est le comportement attendu.";

/** Le message soumis survit a un tour echoue, et l'ecran doit le dire. */
export const FAILED_TURN_DRAFT_NOTICE =
  "Votre message est conservé : un échec du fournisseur ne fait pas perdre ce que vous avez " +
  "écrit. Il repart tel quel au prochain envoi.";
