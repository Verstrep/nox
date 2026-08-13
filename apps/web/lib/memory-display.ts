/**
 * Presentation de la memoire projet, sans React.
 *
 * Fonctions pures : URL, filtres, tailles lisibles, messages de refus. Aucune ne
 * lit la base, le disque ni le fournisseur — et ce sont les memes qui decident
 * de l'affichage d'un bouton et du message qui le remplace. Deux
 * implementations divergeraient, et c'est l'interface qui aurait raison a tort.
 *
 * Les libelles de categorie et de statut, eux, vivent dans `lib/labels.ts`.
 */

import {
  PROJECT_MEMORY_LIMITS,
  PROJECT_MEMORY_STATUS,
  type ProjectMemoryEntry,
  type ProjectMemoryRefusal,
  type ProjectMemoryStatus,
} from "@nox/shared";

/** Page de la memoire d'un projet. */
export function memoryUrl(projectId: string, filter?: MemoryFilter): string {
  const base = `/projects/${projectId}/memory`;
  return filter === undefined || filter === "ALL" ? base : `${base}?filter=${filter}`;
}

/** Formulaire de creation d'une entree. */
export function newMemoryUrl(projectId: string): string {
  return `/projects/${projectId}/memory/new`;
}

/** Formulaire d'edition d'une entree. */
export function memoryEntryUrl(projectId: string, memoryId: string): string {
  return `/projects/${projectId}/memory/${memoryId}`;
}

/**
 * Filtres de la liste.
 *
 * Trois valeurs, et pas de moteur de recherche : une memoire bornee a cent
 * entrees se parcourt a l'oeil, et un champ de recherche donnerait l'illusion
 * qu'il en existe des milliers.
 */
export type MemoryFilter = "ACTIVE" | "ARCHIVED" | "ALL";

const FILTERS: readonly MemoryFilter[] = ["ACTIVE", "ARCHIVED", "ALL"];

/**
 * Lit le filtre depuis l'URL.
 *
 * Une valeur inconnue — ou repetee — ne leve pas : elle retombe sur `ACTIVE`,
 * qui est ce que l'utilisateur vient voir en premier. Un lien errone ne doit pas
 * produire une page d'erreur.
 */
export function readMemoryFilter(value: string | string[] | undefined): MemoryFilter {
  if (typeof value !== "string") {
    return "ACTIVE";
  }
  return (FILTERS as readonly string[]).includes(value) ? (value as MemoryFilter) : "ACTIVE";
}

/** Applique un filtre a la liste, sans jamais la reordonner. */
export function filterMemories(
  entries: readonly ProjectMemoryEntry[],
  filter: MemoryFilter,
): ProjectMemoryEntry[] {
  if (filter === "ALL") {
    return [...entries];
  }
  return entries.filter((entry) => entry.status === filter);
}

/**
 * Taille lisible, en Kio.
 *
 * Des caracteres, jamais des jetons : NOX ne compte pas ce qu'un fournisseur
 * facturera, et afficher une estimation de jetons donnerait une precision que
 * personne ne peut garantir.
 */
export function formatMemorySize(chars: number): string {
  if (chars < 1024) {
    return `${String(chars)} car.`;
  }
  return `${(chars / 1024).toFixed(1)} Kio`;
}

/** Part du budget consommee, entre 0 et 1. Bornee : une jauge ne deborde pas. */
export function memoryBudgetRatio(used: number, limit: number): number {
  if (limit <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, used / limit));
}

/** Vrai lorsque le budget actif est proche de sa borne. */
export function isMemoryBudgetTight(used: number, limit: number): boolean {
  return memoryBudgetRatio(used, limit) >= 0.9;
}

/**
 * Message d'un champ refuse.
 *
 * Chaque phrase dit ce qui ne va pas **et** ce qu'il faut faire. « Champ
 * invalide » n'apprend rien a personne.
 */
export function memoryRefusalMessage(refusal: ProjectMemoryRefusal): string {
  const limits: Record<string, number> = {
    title: PROJECT_MEMORY_LIMITS.title,
    content: PROJECT_MEMORY_LIMITS.content,
    rationale: PROJECT_MEMORY_LIMITS.rationale,
  };

  switch (refusal.reason) {
    case "required":
      return refusal.field === "title"
        ? "Donnez un titre a cette entree : c'est lui qui l'identifie dans la liste et dans le contexte."
        : "Ecrivez le contenu a retenir : une memoire sans texte n'apprend rien a personne.";
    case "too_long":
      return `Ce champ depasse la limite de ${String(limits[refusal.field] ?? 0)} caracteres. Raccourcissez-le, ou coupez-le en deux entrees.`;
    case "multiline":
      return "Le titre tient sur une seule ligne : il sert d'identite courte, le detail va dans le contenu.";
    case "control_character":
      return "Ce texte contient des caracteres de controle que NOX n'enregistre pas. Recollez-le depuis un editeur de texte simple.";
    case "unknown":
      return "Cette valeur n'existe pas. Rechargez la page pour retrouver les choix possibles.";
  }
}

/**
 * Message d'un refus d'ecriture.
 *
 * Le budget et le nombre d'entrees sont deux refus distincts : le premier se
 * leve en raccourcissant ou en archivant, le second en supprimant. Les
 * confondre donnerait un message qui ne dit pas quoi faire.
 */
export function memoryWriteRefusalMessage(
  reason: "not_found" | "budget" | "entries",
  detail?: { activeChars: number; requiredChars: number },
): string {
  switch (reason) {
    case "not_found":
      return "Cette entree n'existe plus. Revenez a la memoire du projet et rechargez la page.";
    case "entries":
      return `Ce projet atteint la limite de ${String(PROJECT_MEMORY_LIMITS.entries)} entrees de memoire. Supprimez-en une avant d'en ajouter une nouvelle.`;
    case "budget": {
      const used = detail === undefined ? null : formatMemorySize(detail.activeChars);
      const required = detail === undefined ? null : formatMemorySize(detail.requiredChars);
      const sizes =
        used === null || required === null
          ? ""
          : ` La memoire active occupe deja ${used}, et cette entree en demande ${required}.`;
      return (
        `Memory budget exceeded : la memoire active de ce projet est limitee a ${formatMemorySize(PROJECT_MEMORY_LIMITS.activeChars)}.${sizes}` +
        " NOX n'envoie jamais une partie seulement de la memoire active : raccourcissez cette entree," +
        " archivez-en une autre, ou enregistrez celle-ci directement en Archived."
      );
    }
  }
}

/** Actions proposees pour une entree, selon son statut. */
export function memoryStatusToggle(status: ProjectMemoryStatus): {
  next: ProjectMemoryStatus;
  label: string;
} {
  return status === PROJECT_MEMORY_STATUS.ACTIVE
    ? { next: PROJECT_MEMORY_STATUS.ARCHIVED, label: "Archive" }
    : { next: PROJECT_MEMORY_STATUS.ACTIVE, label: "Restore" };
}

/**
 * Phrase de confidentialite de la page Memory.
 *
 * Elle dit deux choses, et les deux comptent : ce qui part, et **quand**.
 * « Envoyees a OpenAI » sans la seconde moitie laisserait croire a un envoi
 * permanent, ce qui est faux — NOX n'appelle jamais le fournisseur tout seul.
 */
export const MEMORY_PRIVACY_NOTICE =
  "Les entrees actives sont incluses dans le contexte envoye a l'Architecte OpenAI lorsque vous " +
  "declenchez explicitement un appel Architecte. Aucune n'est transmise autrement : ni au " +
  "chargement d'une page, ni en arriere-plan. Les entrees archivees ne quittent jamais cette " +
  "machine.";

/** Ce qu'un archivage change, dit avant le clic. */
export const MEMORY_ARCHIVE_NOTICE =
  "Une entree archivee reste consultable et modifiable ici, mais elle ne sera plus incluse dans " +
  "les prochains contextes envoyes a l'Architecte.";
