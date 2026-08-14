/**
 * Message d'accueil de la conversation projet.
 *
 * ## Pourquoi il n'est pas un message
 *
 * Il n'est ni stocke, ni transmis, ni compte comme un tour. C'est du texte
 * d'interface, affiche tant que la conversation est vide.
 *
 * Le stocker comme message d'architecte aurait deux couts. Il partirait dans le
 * transcript, donc le modele lirait une phrase qu'il n'a jamais ecrite et la
 * prendrait pour la sienne. Et il faudrait l'ecrire a la creation de la
 * conversation, ce qui donnerait a une ouverture de page le pouvoir d'ecrire un
 * message — precisement ce que NOX evite partout ailleurs.
 *
 * ## Et surtout : il ne coute rien
 *
 * Ouvrir la conversation d'un projet ne declenche aucun appel au fournisseur.
 * Demander a un modele de dire bonjour serait un appel facture pour une phrase
 * connue d'avance.
 */
export const PROJECT_ARCHITECT_GREETING = [
  "Bonjour, je suis NOX, ton assistant de developpement.",
  "",
  "Decris-moi le projet que tu veux construire, une amelioration que tu envisages,",
  "ou pose-moi une question sur ce projet. On peut aussi simplement discuter d'une",
  "decision technique avant de decider quoi que ce soit.",
].join("\n");
