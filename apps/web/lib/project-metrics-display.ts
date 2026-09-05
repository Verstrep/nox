/**
 * Affichage des compteurs d'activite d'un projet.
 *
 * ## Ce que cette section repond, et ce qu'elle refuse de repondre
 *
 * Elle repond : combien de taches, combien d'executions, combien de decisions
 * humaines, combien d'appels, combien ont coute.
 *
 * Elle refuse de repondre : « quel est le taux d'autonomie de ce projet ». Ce
 * nombre n'existe pas. NOX ne sait pas combien de fois quelqu'un a clique,
 * combien de temps il a passe a relire un diff, ni combien de messages il a
 * reecrits avant de les envoyer. Un « Autonomy 87 % » compose a partir des
 * lignes qu'on possede aurait l'air d'une mesure, se serait fait citer, et
 * aurait ete faux — d'autant plus dangereux qu'il aurait ete precis.
 *
 * Ce module affiche donc des **faits bruts**, et quand un rapport est honnete —
 * deux nombres qui comptent reellement la meme population — il l'ecrit comme
 * une fraction lisible, jamais comme un pourcentage synthetique.
 *
 * ## Ce qu'il ne fait pas
 *
 * Pur : ni base, ni disque, ni runner, ni fournisseur. Il ne divise jamais —
 * une fraction s'ecrit `a / b`, ce qui reste vrai quand `b` vaut zero.
 */

import type { ProjectMetrics } from "@nox/database";

/** Une ligne de compteur, prete a etre rendue. */
export type MetricRow = {
  label: string;
  /** La valeur, deja formatee. Jamais un nombre brut : `null` a un sens ici. */
  value: string;
  /** Precision affichee sous la valeur, ou `null`. */
  detail: string | null;
};

/** Ce que NOX affiche quand rien n'a ete rapporte. */
export const NOT_REPORTED = "Non rapporté";

function row(label: string, value: string, detail: string | null = null): MetricRow {
  return { label, value, detail };
}

/**
 * Une fraction lisible : « 13 / 15 ».
 *
 * Pas un pourcentage, et pas une division : `13 / 15` reste vrai et lisible
 * quand le denominateur vaut zero, la ou `0 / 0` calcule produirait un `NaN`
 * a l'ecran.
 */
export function fraction(part: number, total: number): string {
  return `${String(part)} / ${String(total)}`;
}

/**
 * Le travail du projet.
 *
 * L'amorcage est compte a part : `TASK-000` prepare des fondations, elle ne
 * livre aucune capacite produit, et la melanger aux autres ferait croire a une
 * tache de plus livree.
 */
export function workRows(metrics: ProjectMetrics): MetricRow[] {
  const product = metrics.tasks.total - metrics.tasks.bootstrap;
  return [
    row(
      "Tasks",
      fraction(metrics.tasks.completed, metrics.tasks.total),
      metrics.tasks.bootstrap === 0
        ? "terminées / total"
        : `terminées / total · dont ${String(metrics.tasks.bootstrap)} amorçage`,
    ),
    row("Tâches produit", String(product), "hors amorçage"),
    row(
      "Claude runs",
      String(metrics.runs.total),
      metrics.runs.corrections === 0
        ? "aucune correction"
        : `dont ${String(metrics.runs.corrections)} correction(s)`,
    ),
  ];
}

/**
 * Les decisions humaines, comptees une par une.
 *
 * ## Pourquoi plusieurs compteurs plutot qu'un seul
 *
 * Parce qu'il n'existe pas de definition unique et fiable d'« une intervention
 * humaine ». Accepter une review, confirmer un critere, forcer un passage et
 * livrer a la main sont quatre gestes differents, de poids differents, et les
 * additionner produirait un total que personne ne pourrait interpreter.
 *
 * Chacun de ces nombres, en revanche, correspond exactement a une ligne
 * persistee — `RunReviewDecision.source`, `RunHumanCriterionConfirmation`,
 * `GitDelivery.trigger`. On peut aller les compter a la main et retrouver le
 * meme resultat, ce qui est la seule propriete qui compte pour une metrique.
 */
export function humanDecisionRows(metrics: ProjectMetrics): MetricRow[] {
  return [
    row(
      "Approbations",
      fraction(metrics.approvals.automated, metrics.approvals.automated + metrics.approvals.human),
      "automatiques / total",
    ),
    row("Approbations humaines", String(metrics.approvals.human), "revues acceptées à la main"),
    row(
      "Passages en force",
      String(metrics.approvals.override),
      metrics.approvals.override === 0 ? "aucun" : "humains, motivés, jamais silencieux",
    ),
    row(
      "Critères confirmés",
      String(metrics.approvals.criterionConfirmations),
      "cochés un par un par une personne",
    ),
    row("Livraisons manuelles", String(metrics.delivery.manual), "commit ou push déclenché à la main"),
  ];
}

/**
 * Ce que NOX a prouve lui-meme.
 *
 * `FAILED` et `ERROR` restent separes, ici comme partout : « j'ai regarde et
 * c'est faux » et « je n'ai pas pu regarder » n'appellent pas la meme reaction,
 * et les additionner ferait chercher un bug la ou il n'y a qu'un runner arrete.
 */
export function verificationRows(metrics: ProjectMetrics): MetricRow[] {
  const criteria = metrics.criteria.automated + metrics.criteria.human;
  return [
    row(
      "Critères vérifiables",
      fraction(metrics.criteria.automated, criteria),
      "automatisés / total",
    ),
    row("Critères humains", String(metrics.criteria.human), "vérifiés par une personne"),
    row("Lots de validation", String(metrics.validation.attempts), "tentatives comprises"),
    row("Échecs de preuve", String(metrics.validation.failed), "une commande a rendu un code non nul"),
    row(
      "Pannes de validation",
      String(metrics.validation.errored),
      "NOX n'a pas pu obtenir de preuve",
    ),
  ];
}

/**
 * Ce que ce projet a consomme.
 *
 * Uniquement ce qui a ete **rapporte**. Aucun prix n'est calcule, aucun
 * catalogue n'est consulte, aucune conversion monetaire n'a lieu : NOX affiche
 * ce que les fournisseurs lui ont dit, et dit « non rapporté » quand ils n'ont
 * rien dit. Une estimation aurait l'air d'une facture.
 */
export function costRows(
  metrics: ProjectMetrics,
  formatCost: (value: number | null) => string | null,
): MetricRow[] {
  const cost = formatCost(metrics.runs.reportedCostUsd);
  return [
    row(
      "Appels Architect",
      String(metrics.architect.calls),
      metrics.architect.calls === 0 ? "aucun" : "conversation, backlog, review, refresh",
    ),
    row(
      "Jetons Architect",
      metrics.architect.totalTokens === null
        ? NOT_REPORTED
        : formatTokens(metrics.architect.totalTokens),
      metrics.architect.totalTokens === null
        ? "aucun appel n'a rapporté de consommation"
        : `rapportés sur ${String(metrics.architect.reportedTokenCalls)} appel(s)`,
    ),
    row(
      "Coût Claude rapporté",
      cost ?? NOT_REPORTED,
      cost === null
        ? "Claude Code ne l'a pas fourni"
        : `sur ${String(metrics.runs.reportedCostRuns)} exécution(s)`,
    ),
    row(
      "Livraisons automatiques",
      String(metrics.delivery.automatic),
      metrics.delivery.failed === 0
        ? "écrites par la politique du projet"
        : `dont ${String(metrics.delivery.failed)} en échec`,
    ),
  ];
}

/**
 * Un nombre de jetons, lisible : « 128 400 ».
 *
 * Groupe par milliers, parce que `1284007` ne se lit pas d'un coup d'oeil et
 * qu'un compteur qu'il faut dechiffrer ne sert a rien. Un nombre negatif ou non
 * fini rend « non rapporte » plutot qu'une valeur absurde : il ne devrait pas
 * exister, et s'il existe, l'afficher serait pire que de le taire.
 */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return NOT_REPORTED;
  }
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/gu, THOUSANDS_SEPARATOR);
}

/**
 * Espace fine insecable, ecrite en echappement plutot qu'en litteral.
 *
 * Le caractere lui-meme est indiscernable d'une espace ordinaire dans un
 * editeur : un test qui echouerait sur cette difference afficherait deux
 * valeurs identiques, et personne ne trouverait pourquoi. Insecable parce
 * qu'un nombre ne doit pas se couper en fin de ligne.
 */
const THOUSANDS_SEPARATOR = "\u202f";

/**
 * L'avertissement qui accompagne la section.
 *
 * Il est affiche, et pas seulement ecrit ici : quelqu'un finira par citer un de
 * ces nombres dans une conversation, et il doit savoir ce qu'il ne dit pas.
 */
export const METRICS_NOTICE =
  "Des faits, pas un score. NOX compte ce qu'il a persisté : des décisions, des " +
  "appels et des exécutions. Il ne sait pas combien de fois vous avez cliqué, ni " +
  "combien de temps vous avez passé à relire — et n'en déduit donc aucun taux " +
  "d'autonomie.";
