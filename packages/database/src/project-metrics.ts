/**
 * Comptages d'activite d'un projet.
 *
 * ## La question a laquelle ce module repond
 *
 * Pas « Claude a-t-il reussi ? » — la review y repond deja, tache par tache —
 * mais « **combien de fois a-t-il fallu intervenir** entre une idee et une V1 ».
 * C'est la seule mesure qui dit si NOX tient sa promesse, et le premier pilote
 * reel l'a rendue impossible a lire : l'information existait entierement, en
 * base, eparpillee dans neuf tables.
 *
 * ## Ce que ce module ne fait pas
 *
 * **Il n'invente rien.** Chaque nombre ci-dessous est un `count` ou une somme
 * sur des lignes reellement ecrites. Une metrique qui demanderait une donnee que
 * NOX ne persiste pas n'apparait pas ici : elle est omise, et son absence est
 * documentee. C'est ce qui separe un compteur d'un score.
 *
 * **Il ne cree aucune table.** Aucune colonne n'a ete ajoutee pour l'affichage :
 * ce serait fabriquer une seconde verite a cote de celle qui existe deja, et la
 * premiere divergence serait invisible.
 *
 * **Il ne met rien en cache.** Tout se recalcule a la lecture. Un compteur
 * stocke deviendrait faux a la premiere tache rouverte, au premier projet
 * supprime, a la premiere correction — et rien ne le signalerait.
 *
 * ## Le cout des requetes
 *
 * Un lot d'agregats, emis ensemble, jamais une requete par tache ou par
 * execution. Les jetons et les couts sont sommes par la base, pas en memoire :
 * charger toutes les generations d'un projet pour en additionner un champ
 * marcherait aujourd'hui et pas dans six mois.
 */

import type { DatabaseClient } from "./client.ts";

/** Ce que NOX sait compter, sans rien deduire. */
export type ProjectMetrics = {
  tasks: {
    total: number;
    completed: number;
    /** Taches d'amorcage : elles ne sont pas du travail produit. */
    bootstrap: number;
  };
  runs: {
    /** Toutes executions confondues, corrections comprises. */
    total: number;
    /** Executions nees d'une correction : elles reprennent un travail refuse. */
    corrections: number;
    /**
     * Somme des couts rapportes par Claude Code, en dollars.
     *
     * `null` quand aucune execution n'en a rapporte. NOX n'estime jamais un
     * cout : ni depuis une duree, ni depuis un nombre de tours, ni depuis un
     * catalogue de prix.
     */
    reportedCostUsd: number | null;
    /** Executions ayant rapporte un cout — le denominateur de la somme. */
    reportedCostRuns: number;
  };
  criteria: {
    automated: number;
    human: number;
  };
  approvals: {
    /** Decisions de review acceptees par une personne. */
    human: number;
    /** Decisions conclues par la regle deterministe de TASK-027. */
    automated: number;
    /** Passages en force : humains, motives, et jamais silencieux. */
    override: number;
    /** Criteres humains confirmes un par un, tels qu'ils sont persistes. */
    criterionConfirmations: number;
  };
  validation: {
    /** Lots de validation autonome, tentatives de reprise comprises. */
    attempts: number;
    /** Lots conclus par un echec de preuve. */
    failed: number;
    /** Lots ou NOX n'a pas pu obtenir de preuve. Jamais confondu avec le precedent. */
    errored: number;
  };
  architect: {
    /**
     * Appels enregistres, toutes surfaces confondues.
     *
     * Conversation projet, planification de backlog, analyse de review et
     * rafraichissement de verification. Les quatre partagent une facture ; les
     * separer sur cet ecran donnerait quatre petits nombres au lieu d'une
     * reponse.
     *
     * Compte les **lignes**, c'est-a-dire les appels engages — un appel en
     * echec en est un, et il a pu etre facture. C'est deliberement plus large
     * que `reportedTokenCalls`, qui ne compte que ceux dont le fournisseur a
     * rendu une consommation.
     */
    calls: number;
    /** Jetons totaux rapportes. `null` quand aucun appel n'en a rapporte. */
    totalTokens: number | null;
    /** Appels ayant rapporte des jetons — le denominateur de la somme. */
    reportedTokenCalls: number;
  };
  delivery: {
    /** Livraisons ecrites par la politique du projet. */
    automatic: number;
    /** Livraisons declenchees par un clic explicite. */
    manual: number;
    /** Livraisons dont la derniere tentative a echoue. */
    failed: number;
  };
};

/**
 * Somme d'un champ nullable, avec son denominateur.
 *
 * Le denominateur compte, et c'est pourquoi il est retourne : « 0 $ » et
 * « aucun cout rapporte » sont deux affirmations differentes, et afficher la
 * premiere quand la seconde est vraie inventerait une gratuite.
 */
type NullableSum = { sum: number | null; reported: number };

function nullableSum(sum: number | null | undefined, reported: number): NullableSum {
  return reported === 0 ? { sum: null, reported: 0 } : { sum: sum ?? null, reported };
}

/**
 * Rassemble les compteurs d'activite d'un projet.
 *
 * Lecture seule : aucune ecriture, aucun appel au runner, aucun appel au
 * fournisseur. Un projet vide rend des zeros et des `null`, jamais un `NaN` ni
 * une division par zero — il n'y a aucune division ici, et c'est deliberé : un
 * ratio se compose a l'affichage, a partir de deux nombres qu'on peut lire
 * separement.
 */
export async function collectProjectMetrics(
  db: DatabaseClient,
  projectId: string,
): Promise<ProjectMetrics> {
  const taskFilter = { projectId };
  const runFilter = { task: { projectId } };

  const [
    taskTotal,
    taskCompleted,
    taskBootstrap,
    runTotal,
    runCorrections,
    runCost,
    criterionAutomated,
    criterionHuman,
    approvalsHuman,
    approvalsAutomated,
    approvalsOverride,
    criterionConfirmations,
    batchTotal,
    batchFailed,
    batchErrored,
    conversationCalls,
    backlogCalls,
    reviewCalls,
    refreshCalls,
    conversationTokens,
    backlogTokens,
    reviewTokens,
    refreshTokens,
    deliveryAutomatic,
    deliveryManual,
    deliveryFailed,
  ] = await Promise.all([
    db.task.count({ where: taskFilter }),
    db.task.count({ where: { ...taskFilter, status: "COMPLETED" } }),
    db.task.count({ where: { ...taskFilter, kind: "BOOTSTRAP" } }),

    db.run.count({ where: runFilter }),
    // La nature d'une execution est declaree : `CORRECTION` est une valeur de
    // `RunKind`, jamais une deduction sur `parentRunId`.
    db.run.count({ where: { ...runFilter, kind: "CORRECTION" } }),
    db.run.aggregate({
      where: { ...runFilter, reportedCostUsd: { not: null } },
      _sum: { reportedCostUsd: true },
      _count: { reportedCostUsd: true },
    }),

    db.taskAcceptanceCriterion.count({ where: { task: taskFilter, verificationMode: "AUTOMATED" } }),
    db.taskAcceptanceCriterion.count({ where: { task: taskFilter, verificationMode: "HUMAN" } }),

    db.runReviewDecision.count({ where: { run: runFilter, source: "HUMAN" } }),
    db.runReviewDecision.count({ where: { run: runFilter, source: "AUTOMATED" } }),
    db.runReviewDecision.count({ where: { run: runFilter, source: "HUMAN_OVERRIDE" } }),
    db.runHumanCriterionConfirmation.count({ where: { decision: { run: runFilter } } }),

    db.autonomousValidationBatch.count({ where: { run: runFilter } }),
    db.autonomousValidationBatch.count({ where: { run: runFilter, status: "FAILED" } }),
    db.autonomousValidationBatch.count({ where: { run: runFilter, status: "ERROR" } }),

    // Les quatre surfaces d'appel, chacune dans sa table. Une ligne est un
    // appel engage ; les jetons se somment separement, parce qu'un appel en
    // echec n'en rapporte aucun sans cesser d'avoir eu lieu.
    db.architectGeneration.count({ where: { session: { projectId } } }),
    db.architectBacklogGeneration.count({ where: { projectId } }),
    db.architectRunReview.count({ where: { run: runFilter } }),
    db.verificationRefresh.count({ where: { projectId } }),

    // Aucune consommation n'est estimee : seules les lignes qui portent un
    // total de jetons entrent dans la somme, et leur nombre est conserve.
    db.architectGeneration.aggregate({
      where: { session: { projectId }, totalTokens: { not: null } },
      _sum: { totalTokens: true },
      _count: { totalTokens: true },
    }),
    db.architectBacklogGeneration.aggregate({
      where: { projectId, totalTokens: { not: null } },
      _sum: { totalTokens: true },
      _count: { totalTokens: true },
    }),
    db.architectRunReview.aggregate({
      where: { run: runFilter, totalTokens: { not: null } },
      _sum: { totalTokens: true },
      _count: { totalTokens: true },
    }),
    db.verificationRefresh.aggregate({
      where: { projectId, totalTokens: { not: null } },
      _sum: { totalTokens: true },
      _count: { totalTokens: true },
    }),

    // Valeurs de `DeliveryTrigger` : `AUTOMATIC` et `MANUAL`. Le declencheur
    // est recopie a la reservation, donc changer la politique du projet ne
    // reclasse jamais une livraison passee.
    db.gitDelivery.count({ where: { projectId, trigger: "AUTOMATIC" } }),
    db.gitDelivery.count({ where: { projectId, trigger: "MANUAL" } }),
    db.gitDelivery.count({ where: { projectId, status: "FAILED" } }),
  ]);

  const cost = nullableSum(runCost._sum.reportedCostUsd, runCost._count.reportedCostUsd);

  const architectCalls = conversationCalls + backlogCalls + reviewCalls + refreshCalls;
  const tokenCalls =
    conversationTokens._count.totalTokens +
    backlogTokens._count.totalTokens +
    reviewTokens._count.totalTokens +
    refreshTokens._count.totalTokens;
  const tokenSum =
    (conversationTokens._sum.totalTokens ?? 0) +
    (backlogTokens._sum.totalTokens ?? 0) +
    (reviewTokens._sum.totalTokens ?? 0) +
    (refreshTokens._sum.totalTokens ?? 0);
  const tokens = nullableSum(tokenSum, tokenCalls);

  return {
    tasks: { total: taskTotal, completed: taskCompleted, bootstrap: taskBootstrap },
    runs: {
      total: runTotal,
      corrections: runCorrections,
      reportedCostUsd: cost.sum,
      reportedCostRuns: cost.reported,
    },
    criteria: { automated: criterionAutomated, human: criterionHuman },
    approvals: {
      human: approvalsHuman,
      automated: approvalsAutomated,
      override: approvalsOverride,
      criterionConfirmations,
    },
    validation: { attempts: batchTotal, failed: batchFailed, errored: batchErrored },
    architect: {
      calls: architectCalls,
      totalTokens: tokens.sum,
      reportedTokenCalls: tokens.reported,
    },
    delivery: {
      automatic: deliveryAutomatic,
      manual: deliveryManual,
      failed: deliveryFailed,
    },
  };
}
