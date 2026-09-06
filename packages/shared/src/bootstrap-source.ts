/**
 * Source canonique d'un amorcage : le rendu **sans perte** de l'etat produit.
 *
 * ## Pourquoi ce module existe separement
 *
 * Parce que `bootstrap.ts` melangeait deux natures de texte sous une seule
 * fonction `truncate`. Le premier pilote reel l'a paye : la direction technique
 * du plan de V1, longue de 653 caracteres, est arrivee dans `TASK-000` coupee a
 * 600 — « ... et applique u… » —, quatre entrees de memoire sur six ont perdu
 * leur fin, et le contexte entier a ete tranche a douze mille caracteres,
 * emportant cinq sections de consignes. Claude a recopie ce qu'il avait recu,
 * puis a refuse d'inventer la suite : il avait raison, et le critere
 * d'acceptation « restituer fidelement le brief et le plan valides » est devenu
 * impossible a approuver honnetement.
 *
 * ## Deux natures de texte, deux modules
 *
 * **Contractuel** — brief, plan de V1, memoire active. C'est ce que `TASK-000`
 * a la charge de materialiser dans le repository. Il n'est jamais raccourci,
 * jamais suivi de points de suspension, et sa fidelite est **prouvee** avant la
 * creation plutot que supposee.
 *
 * **Presentation** — nom du projet, inventaire des taches a venir, etat du
 * repository. Il situe, il n'engage pas. Il peut etre resume, et il l'est.
 *
 * Ce module ne connait que le premier. Il ne contient **aucun** raccourcisseur
 * — pas meme pour l'affichage —, et un test lit sa source pour le verifier : la
 * meme discipline que celle qui empeche `review-service.ts` d'importer une
 * action de tache. Le raccourcisseur de presentation vit dans `bootstrap.ts`,
 * ou il rend un type nominal que ces fonctions-ci ne pourraient pas accepter.
 *
 * ## Les bornes sont derivees, jamais choisies
 *
 * Elever un seuil arbitraire aurait deplace le probleme d'un pilote au suivant.
 * Les entites concernees possedent deja des bornes metier, appliquees a
 * l'ecriture : seize Kio pour le brief et le plan reunis, quarante-huit pour la
 * memoire active. Une donnee valide au sens de ces bornes doit survivre a
 * l'amorcage — c'est la garantie, et la borne d'ici s'en deduit.
 *
 * Ce qui depasse ces bornes ne peut pas exister en base. Si cela arrivait
 * malgre tout, la creation **echoue en le nommant** : un contrat d'amorcage
 * sciemment incomplet est pire qu'une absence de contrat, parce qu'il a l'air
 * complet.
 */

import { PROJECT_MEMORY_LIMITS, type ArchitectPromptMemory } from "./project-memory.js";
import {
  PROJECT_PLAN_LIMITS,
  type ArchitectPromptBrief,
  type ArchitectPromptV1Plan,
} from "./project-plan.js";

/**
 * Version du rendu de la source canonique.
 *
 * Distincte de `BOOTSTRAP_SPEC_VERSION` : elle nomme la facon dont l'etat
 * produit est materialise, et c'est elle qui separe le rendu integral d'ici du
 * rendu tronque d'avant HOTFIX-007.
 */
export const BOOTSTRAP_SOURCE_VERSION = "bootstrap-source/2";

/** Titres des trois sections contractuelles. Stables : la reprise s'y ancre. */
export const BOOTSTRAP_SOURCE_HEADINGS = {
  brief: "Brief produit",
  plan: "Plan de V1",
  memory: "Memoire du projet",
} as const;

/**
 * Majorant du nombre de lignes de balisage que le rendu contractuel ajoute.
 *
 * Il se calcule plutot qu'il ne se choisit : le brief compte au plus quatre
 * champs etiquetes et deux listes de `items` elements, le plan deux champs et
 * trois listes, la memoire au plus `entries` entrees de quelques lignes.
 */
const SOURCE_LINE_BUDGET =
  // Brief : titre, quatre champs, deux listes et leurs elements.
  10 +
  4 * 3 +
  2 * (3 + PROJECT_PLAN_LIMITS.items) +
  // Plan : titre, deux champs, trois listes et leurs elements.
  10 +
  2 * 3 +
  3 * (3 + PROJECT_PLAN_LIMITS.items) +
  // Memoire : titre, preambule, et quelques lignes par entree.
  10 +
  6 * PROJECT_MEMORY_LIMITS.entries;

/** Ce qu'une ligne de balisage peut couter : titre, puce, etiquette, code. */
const SOURCE_MARKUP_PER_LINE = 64;

export const BOOTSTRAP_SOURCE_LIMITS = {
  /** Texte canonique du brief et du plan reunis, borne a l'ecriture. */
  structured: PROJECT_PLAN_LIMITS.structuredChars,
  /** Texte canonique de la memoire active, borne a l'ecriture. */
  memory: PROJECT_MEMORY_LIMITS.activeChars,
  /** Majorant du balisage ajoute par le rendu. */
  markup: SOURCE_LINE_BUDGET * SOURCE_MARKUP_PER_LINE,
  /** Total qu'un etat produit valide ne peut pas depasser. */
  total:
    PROJECT_PLAN_LIMITS.structuredChars +
    PROJECT_MEMORY_LIMITS.activeChars +
    SOURCE_LINE_BUDGET * SOURCE_MARKUP_PER_LINE,
} as const;

/**
 * Refus de materialisation, nomme.
 *
 * Deux formes : un etat canonique hors de ses propres bornes, ou une valeur
 * perdue au rendu. La seconde ne devrait jamais arriver ; c'est precisement
 * pour cela qu'elle est verifiee.
 */
export type BootstrapSourceRefusalCode = "SOURCE_TOO_LARGE" | "SOURCE_VALUE_LOST";

export type BootstrapSourceRefusal = {
  code: BootstrapSourceRefusalCode;
  /** Le champ canonique en cause : `plan.technicalDirection`, `MEM-003.content`. */
  field: string;
  /** Phrase actionnable. Ne porte jamais le texte fautif. */
  message: string;
};

/** Ce que le rendu contractuel recoit. Des objets canoniques, jamais des chaines. */
export type BootstrapSourceInput = {
  brief: ArchitectPromptBrief | null;
  v1Plan: ArchitectPromptV1Plan | null;
  /** Memoire **active** seulement : les archivees n'arrivent jamais ici. */
  memories: readonly ArchitectPromptMemory[];
};

function heading(level: number, text: string): string {
  return `${"#".repeat(level)} ${text}`;
}

function labelled(label: string, value: string): string[] {
  return [`**${label}**`, "", value];
}

function bullets(values: readonly string[]): string[] {
  return values.length === 0 ? ["- (aucun)"] : values.map((value) => `- ${value}`);
}

/**
 * Le brief produit, en entier.
 *
 * Chaque valeur canonique occupe son propre paragraphe plutot que la fin d'une
 * ligne etiquetee. Deux Kio derriere « Resume : » resteraient du Markdown
 * valide, et rendraient illisible le diff du jour ou la fidelite echouera.
 */
export function renderBootstrapBriefSection(brief: ArchitectPromptBrief | null): string {
  if (brief === null) {
    return [heading(3, BOOTSTRAP_SOURCE_HEADINGS.brief), "", "Non defini."].join("\n");
  }

  return [
    heading(3, BOOTSTRAP_SOURCE_HEADINGS.brief),
    "",
    ...labelled("Resume", brief.summary),
    "",
    ...labelled("Probleme", brief.problem),
    "",
    ...labelled("Utilisateurs vises", brief.targetUsers),
    "",
    ...labelled("Resultat attendu", brief.desiredOutcome),
    "",
    "**Objectifs**",
    "",
    ...bullets(brief.goals),
    "",
    "**Hors objectifs**",
    "",
    ...bullets(brief.nonGoals),
  ].join("\n");
}

/** Le plan de V1, en entier — direction technique comprise. */
export function renderBootstrapPlanSection(plan: ArchitectPromptV1Plan | null): string {
  if (plan === null) {
    return [heading(3, BOOTSTRAP_SOURCE_HEADINGS.plan), "", "Non defini."].join("\n");
  }

  return [
    heading(3, BOOTSTRAP_SOURCE_HEADINGS.plan),
    "",
    ...labelled("Objectif de V1", plan.goal),
    "",
    ...labelled("Direction technique", plan.technicalDirection),
    "",
    "**Dans le perimetre**",
    "",
    ...bullets(plan.inScope),
    "",
    "**Hors perimetre**",
    "",
    ...bullets(plan.outOfScope),
    "",
    "**Etapes**",
    "",
    ...bullets(plan.milestones),
  ].join("\n");
}

/**
 * La memoire active, entree par entree.
 *
 * Chaque entree devient un sous-titre suivi de son contenu et, lorsqu'elle en
 * porte une, de sa justification. Cette justification fait partie de la
 * decision durable enregistree : elle dit **pourquoi** la regle s'applique, et
 * une regle dont on ignore la raison se contourne au premier obstacle.
 *
 * Le contenu n'est jamais indente. Ce serait plus joli sous une puce, et cela
 * ajouterait deux espaces a chaque ligne d'un texte qui doit rester exactement
 * celui qui est stocke.
 */
export function renderBootstrapMemorySection(
  memories: readonly ArchitectPromptMemory[],
): string {
  if (memories.length === 0) {
    return [
      heading(3, BOOTSTRAP_SOURCE_HEADINGS.memory),
      "",
      "Aucune entree active.",
    ].join("\n");
  }

  const lines: string[] = [
    heading(3, BOOTSTRAP_SOURCE_HEADINGS.memory),
    "",
    "Decisions, contraintes et conventions enregistrees explicitement. Elles",
    "s'appliquent des l'amorcage, et leur texte est integral.",
  ];

  for (const memory of memories) {
    lines.push("", heading(4, `${memory.code} · ${memory.category} · ${memory.title}`), "");
    lines.push(memory.content);
    if (memory.rationale !== null) {
      lines.push("", "**Raison**", "", memory.rationale);
    }
  }

  return lines.join("\n");
}

/** Les trois sections contractuelles, dans l'ordre fixe du contexte d'amorcage. */
export function renderBootstrapSource(input: BootstrapSourceInput): string {
  return [
    renderBootstrapBriefSection(input.brief),
    renderBootstrapPlanSection(input.v1Plan),
    renderBootstrapMemorySection(input.memories),
  ].join("\n\n");
}

/**
 * Toutes les valeurs canoniques, nommees, dans un ordre deterministe.
 *
 * C'est la liste que la verification de fidelite parcourt. La produire ici
 * plutot que dans le verificateur garantit qu'un champ ajoute au brief ou au
 * plan entre dans les deux d'un seul geste.
 */
export function canonicalBootstrapValues(
  input: BootstrapSourceInput,
): { field: string; value: string }[] {
  const values: { field: string; value: string }[] = [];

  if (input.brief !== null) {
    values.push(
      { field: "brief.summary", value: input.brief.summary },
      { field: "brief.problem", value: input.brief.problem },
      { field: "brief.targetUsers", value: input.brief.targetUsers },
      { field: "brief.desiredOutcome", value: input.brief.desiredOutcome },
    );
    input.brief.goals.forEach((value, index) => {
      values.push({ field: `brief.goals[${String(index)}]`, value });
    });
    input.brief.nonGoals.forEach((value, index) => {
      values.push({ field: `brief.nonGoals[${String(index)}]`, value });
    });
  }

  if (input.v1Plan !== null) {
    values.push(
      { field: "plan.goal", value: input.v1Plan.goal },
      { field: "plan.technicalDirection", value: input.v1Plan.technicalDirection },
    );
    input.v1Plan.inScope.forEach((value, index) => {
      values.push({ field: `plan.inScope[${String(index)}]`, value });
    });
    input.v1Plan.outOfScope.forEach((value, index) => {
      values.push({ field: `plan.outOfScope[${String(index)}]`, value });
    });
    input.v1Plan.milestones.forEach((value, index) => {
      values.push({ field: `plan.milestones[${String(index)}]`, value });
    });
  }

  for (const memory of input.memories) {
    values.push(
      { field: `${memory.code}.title`, value: memory.title },
      { field: `${memory.code}.content`, value: memory.content },
    );
    if (memory.rationale !== null) {
      values.push({ field: `${memory.code}.rationale`, value: memory.rationale });
    }
  }

  return values;
}

/**
 * Poids des valeurs canoniques, compte **comme les bornes metier le comptent**.
 *
 * Deux totaux, et non un seul, parce qu'il y a deux budgets : seize Kio pour le
 * brief et le plan reunis, quarante-huit pour la memoire active. Les additionner
 * laisserait passer une memoire hors borne compensee par un brief minuscule —
 * c'est-a-dire exactement l'etat que l'ecriture refuse deja.
 */
export function bootstrapSourceChars(input: BootstrapSourceInput): {
  structured: number;
  memory: number;
} {
  let structured = 0;
  for (const value of [
    input.brief?.summary,
    input.brief?.problem,
    input.brief?.targetUsers,
    input.brief?.desiredOutcome,
    ...(input.brief?.goals ?? []),
    ...(input.brief?.nonGoals ?? []),
    input.v1Plan?.goal,
    input.v1Plan?.technicalDirection,
    ...(input.v1Plan?.inScope ?? []),
    ...(input.v1Plan?.outOfScope ?? []),
    ...(input.v1Plan?.milestones ?? []),
  ]) {
    structured += value?.length ?? 0;
  }

  let memory = 0;
  for (const entry of input.memories) {
    memory += entry.title.length + entry.content.length + (entry.rationale?.length ?? 0);
  }

  return { structured, memory };
}

/**
 * Prouve qu'aucune valeur canonique n'a disparu du texte rendu.
 *
 * Une comparaison octet a octet du Markdown serait fausse : le rendu ajoute
 * legitimement des titres et des puces. Ce qui se verifie est donc la seule
 * chose qui compte — chaque valeur canonique figure **entiere** dans le rendu.
 *
 * La verification porte sur le contexte reellement assemble, pas sur un rendu
 * refait pour l'occasion. C'est ce qui lui permet d'attraper une troncature
 * survenue **apres** les sections, comme celle de douze mille caracteres qui a
 * emporte la moitie de `TASK-000` chez le premier pilote.
 */
export function checkBootstrapSourceFidelity(
  input: BootstrapSourceInput,
  rendered: string,
): BootstrapSourceRefusal | null {
  const weight = bootstrapSourceChars(input);

  const overflow =
    weight.structured > BOOTSTRAP_SOURCE_LIMITS.structured
      ? {
          field: "brief+plan",
          used: weight.structured,
          limit: BOOTSTRAP_SOURCE_LIMITS.structured,
          what: "le brief produit et le plan de V1",
        }
      : weight.memory > BOOTSTRAP_SOURCE_LIMITS.memory
        ? {
            field: "memory",
            used: weight.memory,
            limit: BOOTSTRAP_SOURCE_LIMITS.memory,
            what: "la memoire active du projet",
          }
        : null;

  if (overflow !== null) {
    return {
      code: "SOURCE_TOO_LARGE",
      field: overflow.field,
      message:
        `${overflow.what} depasse la borne qui garantit sa materialisation integrale ` +
        `(${String(overflow.used)} caracteres pour un maximum de ${String(overflow.limit)}). ` +
        "Reduisez-la avant de creer la tache d'amorcage : NOX ne cree pas un contrat qu'il " +
        "sait incomplet.",
    };
  }

  for (const entry of canonicalBootstrapValues(input)) {
    if (entry.value === "") {
      continue;
    }
    if (!rendered.includes(entry.value)) {
      return {
        code: "SOURCE_VALUE_LOST",
        field: entry.field,
        message:
          `Le champ « ${entry.field} » n'a pas ete transporte integralement dans le contrat ` +
          "d'amorcage. NOX refuse de creer une tache dont la source est incomplete : ce refus " +
          "designe un defaut de NOX, pas de votre projet.",
      };
    }
  }

  return null;
}

/** Titre du supplement, stable : la review et les tests s'y ancrent. */
export const BOOTSTRAP_SUPPLEMENT_HEADING = "Authoritative bootstrap source supplement";

/**
 * Le supplement de source, pour une tache d'amorcage creee avec un rendu lossy.
 *
 * ## Ce qu'il est
 *
 * La source canonique que la tache **aurait du** transporter, restituee
 * integralement. Rien d'autre : ni critere, ni objectif, ni perimetre, ni
 * commande. Il repare un transport, il ne renegocie pas un contrat — et le
 * texte le dit a l'agent, parce qu'un bloc de texte inattendu dans un prompt de
 * correction se lit volontiers comme une nouvelle consigne.
 *
 * ## Pourquoi il rappelle que le texte historique est tronque
 *
 * Sans cela, l'agent verrait deux versions du meme plan — l'une coupee dans la
 * tache, l'autre entiere ici — et n'aurait aucune raison de preferer la seconde.
 * Il pourrait meme conclure a une contradiction et s'arreter, ce qui est
 * exactement ce que le pilote reel a fait, a juste titre, quand il a refuse
 * d'inventer la fin d'une phrase.
 */
export function renderBootstrapSourceSupplement(input: BootstrapSourceInput): string {
  return [
    `## ${BOOTSTRAP_SUPPLEMENT_HEADING}`,
    "",
    "Le contrat de cette tache a ete genere par une version de NOX qui tronquait la",
    "source canonique du projet. Le texte du brief, du plan de V1 et de la memoire",
    "que tu as lu dans la tache et dans les executions precedentes est donc",
    "**incomplet** : des phrases s'y arretent en cours, et des elements de liste en",
    "ont ete retires entierement.",
    "",
    "Ce qui suit est cette meme source, restituee integralement depuis l'etat",
    "valide du projet. Elle ne remplace pas le contrat : elle restitue le texte",
    "qu'il aurait du transporter.",
    "",
    "Utilise-la **uniquement** pour corriger les artefacts dont la fidelite",
    "dependait du texte manquant — typiquement `docs/PROJECT_BRIEF.md` et",
    "`docs/V1_SCOPE.md`, qui doivent restituer fidelement le brief et le plan.",
    "",
    "Ce supplement ne change rien d'autre :",
    "",
    "- l'objectif, les criteres d'acceptation et le perimetre de la tache sont",
    "  inchanges, et restent ceux du contrat gele ;",
    "- il n'ajoute aucune demande, aucune fonctionnalite et aucun document ;",
    "- il ne t'autorise a modifier aucune implementation sans rapport avec la",
    "  fidelite de ces documents ;",
    "- il ne demande de commencer aucune tache produit : `TASK-001` et les",
    "  suivantes restent hors perimetre.",
    "",
    renderBootstrapSource(input),
  ].join("\n");
}
