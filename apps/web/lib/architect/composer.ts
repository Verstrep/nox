/**
 * Cycle de vie du composer d'une conversation Architecte.
 *
 * ## Pourquoi ce module existe
 *
 * Deux endroits decident du premier message d'une conversation : le rendu, qui
 * choisit d'afficher un champ editable ou un texte fige, et la Server Action,
 * qui choisit de lire le formulaire ou la base. Tant que ces deux decisions
 * vivaient chacune dans son fichier — l'une en JSX, l'autre au milieu d'une
 * action — rien ne garantissait qu'elles disent la meme chose, et rien ne
 * permettait de les tester sans navigateur.
 *
 * Elles n'en font plus qu'une, ici, sans React ni base de donnees.
 *
 * ## Le role decide, jamais le comptage
 *
 * Une session de **conception de tache** possede un message d'ouverture ecrit
 * sur la page precedente : il est fige, et le serveur le relit en base plutot
 * que de faire confiance au formulaire. C'est ce qui garantit que le texte
 * affiche dans la liste des conversations et le premier message du transcript
 * ne peuvent pas diverger.
 *
 * Une **conversation projet** n'a pas d'ouverture. Elle commence par un message
 * ordinaire, editable, comme tous ceux qui suivront — c'est le sens meme d'une
 * conversation qui ne se ferme pas.
 *
 * La distinction se lit donc sur `kind`, qui est declare. La deduire du nombre
 * de messages confondait les deux modeles, et laissait une conversation projet
 * neuve sans aucun moyen d'ecrire.
 */

import { ARCHITECT_SESSION_KIND, type ArchitectSessionKind } from "@nox/shared";

/**
 * Ce qu'il faut savoir d'une session pour decider du composer.
 *
 * Volontairement structurel : les tests decrivent un cas en trois champs, sans
 * fabriquer une session complete ni ouvrir une base.
 */
export type ComposerSession = {
  kind: ArchitectSessionKind;
  /** Nombre de messages deja echanges, utilisateur et architecte confondus. */
  messageCount: number;
  /** Texte d'ouverture d'une session de conception de tache. */
  requestText: string;
};

/**
 * Message d'ouverture fige de ce tour, ou `null` si le message vient du formulaire.
 *
 * `null` est le cas courant : tout tour d'une conversation projet, et tout tour
 * au-dela du premier dans une session de conception de tache.
 *
 * L'appelant qui prepare un tour ecrit donc `architectOpeningMessage(session) ??
 * submitted` : le texte fige gagne quand il existe, le formulaire sinon.
 */
export function architectOpeningMessage(session: ComposerSession): string | null {
  if (session.kind !== ARCHITECT_SESSION_KIND.TASK_DESIGN_LEGACY) {
    return null;
  }
  return session.messageCount === 0 ? session.requestText : null;
}

/**
 * Titre de la carte du composer.
 *
 * « Premier tour » nomme un envoi qui a deja son texte et qu'il ne reste qu'a
 * relire ; « Premier message » nomme un texte a ecrire. Les deux situations sont
 * differentes, et les nommer pareil laissait croire qu'un champ manquait.
 */
export function architectComposerTitle(session: ComposerSession): string {
  if (session.messageCount > 0) {
    return "Votre message";
  }
  return architectOpeningMessage(session) === null ? "Premier message" : "Premier tour";
}
