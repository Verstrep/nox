/**
 * Ce qu'un rafraichissement de verification affiche.
 *
 * Pur : ni base, ni reseau, ni React. Les libelles vivent ici et nulle part
 * ailleurs, comme tous les libelles de NOX.
 *
 * ## Une indication, pas un ecran
 *
 * Un rafraichissement n'a ni page, ni bouton, ni revue : son contrat est si
 * borne qu'une reponse valide s'applique directement. Ce module rend donc une
 * phrase et un detail — de quoi savoir ce qui s'est passe et pourquoi, sans
 * pretendre en faire un objet a manipuler.
 */

import { VERIFICATION_REFRESH_STATUS, type VerificationRefreshStatus } from "@nox/shared";

/** Ce que le statut d'un rafraichissement veut dire, en une phrase. */
export function verificationRefreshLabel(status: VerificationRefreshStatus): string {
  switch (status) {
    case VERIFICATION_REFRESH_STATUS.RUNNING:
      return "Rafraichissement en cours";
    case VERIFICATION_REFRESH_STATUS.APPLIED:
      return "Plans de verification mis a jour";
    case VERIFICATION_REFRESH_STATUS.NO_CHANGE:
      return "Aucun plan de verification a changer";
    case VERIFICATION_REFRESH_STATUS.REFUSED:
      return "Reponse refusee : rien n'a ete modifie";
    case VERIFICATION_REFRESH_STATUS.STALE:
      return "Le plan de travail a change entre-temps : rien n'a ete modifie";
    case VERIFICATION_REFRESH_STATUS.FAILED:
      return "L'appel n'a pas abouti : rien n'a ete modifie";
  }
}

/**
 * Le decompte, tel que TASK-033 le demande.
 *
 * « 6 criteres automatises, 2 restent humains » plutot qu'un pourcentage : ce
 * sont deux faits, et le second est celui qui dit ce qu'il reste a faire.
 */
export function verificationRefreshCounts(refresh: {
  changedTaskCount: number;
  automatedCount: number;
  humanCount: number;
}): string {
  const tasks =
    refresh.changedTaskCount === 1
      ? "1 tache mise a jour"
      : `${String(refresh.changedTaskCount)} taches mises a jour`;
  const automated =
    refresh.automatedCount === 1
      ? "1 critere automatise"
      : `${String(refresh.automatedCount)} criteres automatises`;
  const human =
    refresh.humanCount === 1 ? "1 reste humain" : `${String(refresh.humanCount)} restent humains`;

  return `${tasks} · ${automated} · ${human}`;
}

/** Un rafraichissement a-t-il reellement ecrit quelque chose ? */
export function verificationRefreshChangedSomething(refresh: {
  status: VerificationRefreshStatus;
  changedTaskCount: number;
}): boolean {
  return (
    refresh.status === VERIFICATION_REFRESH_STATUS.APPLIED && refresh.changedTaskCount > 0
  );
}

/**
 * La phrase qui accompagne un rafraichissement sans effet.
 *
 * Elle dit ce que NOX **sait**, et rien de plus : un echec n'est jamais presente
 * comme une decision, et un refus n'est jamais presente comme une panne.
 */
export function verificationRefreshDetail(refresh: {
  status: VerificationRefreshStatus;
  errorDetail: string | null;
}): string | null {
  if (refresh.errorDetail !== null) {
    return refresh.errorDetail;
  }
  switch (refresh.status) {
    case VERIFICATION_REFRESH_STATUS.FAILED:
      return "Les plans de verification restent ceux d'avant l'amorcage. Vous pouvez les ajuster a la main sur chaque tache, ou demander une replanification a l'Architecte.";
    case VERIFICATION_REFRESH_STATUS.STALE:
      return "Le plan de travail a change pendant l'appel. Rien n'a ete ecrit, et c'est voulu : NOX ne fusionne jamais deux etats.";
    case VERIFICATION_REFRESH_STATUS.NO_CHANGE:
      return "L'Architecte n'a trouve aucun critere a reclasser avec les commandes desormais disponibles.";
    default:
      return null;
  }
}
