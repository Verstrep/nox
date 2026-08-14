/**
 * Revelation progressive d'une reponse deja recue.
 *
 * ## Ce n'est pas du streaming
 *
 * NOX recoit la reponse **entiere**, en un seul appel, et l'enregistre avant
 * d'afficher quoi que ce soit. Ce module ne fait que decider comment la devoiler
 * a l'ecran : le reseau, le fournisseur, le Structured Output et la persistance
 * sont identiques a ce qu'ils etaient. Appeler cela « streaming » serait faux, et
 * laisserait croire qu'on pourrait lire avant que le tour soit conclu.
 *
 * ## Par blocs, jamais caractere par caractere
 *
 * Une revelation lettre a lettre est lente sur une reponse courte et penible sur
 * une longue. Les blocs se coupent sur des espaces : un mot qui se construit
 * lettre a lettre attire l'oeil sur la mecanique plutot que sur le texte.
 *
 * ## Une duree plafonnee
 *
 * Le nombre d'etapes est borne, donc la duree aussi. Une reponse de cinq mille
 * caracteres ne prend pas cinquante secondes : ses blocs grossissent. Attendre
 * pour lire un texte deja disponible serait une regression deguisee en animation.
 *
 * Module pur : ni React, ni minuteur, ni DOM.
 */

/** Duree maximale d'une revelation, quelle que soit la longueur du texte. */
export const REVEAL_MAX_MS = 2_000;

/** Intervalle entre deux blocs. Assez court pour paraitre fluide. */
export const REVEAL_STEP_MS = 45;

/** Nombre maximal d'etapes : c'est lui qui plafonne la duree. */
export const REVEAL_MAX_STEPS = Math.floor(REVEAL_MAX_MS / REVEAL_STEP_MS);

/** Taille visee d'un bloc sur un texte court. */
export const REVEAL_MIN_CHUNK = 24;

export type RevealPlan = {
  /** Blocs successifs. Leur concatenation redonne **exactement** le texte. */
  chunks: string[];
  /** Delai entre deux blocs, en millisecondes. */
  stepMs: number;
  /** Duree totale de la revelation, toujours inferieure a `REVEAL_MAX_MS`. */
  totalMs: number;
};

/**
 * Decoupe un texte en blocs de revelation.
 *
 * Le decoupage se fait sur les **points de code**, et non sur les unites UTF-16 :
 * couper une paire de substitution afficherait un caractere de remplacement au
 * milieu de l'animation. Les sauts de ligne comptent comme des separateurs, ce
 * qui fait apparaitre un paragraphe d'un coup plutot qu'a cheval sur deux blocs.
 *
 * Un texte vide donne un plan vide : il n'y a rien a reveler, et une etape de
 * plus afficherait une attente sans contenu.
 */
export function planReveal(text: string): RevealPlan {
  const glyphs = [...text];
  if (glyphs.length === 0) {
    return { chunks: [], stepMs: REVEAL_STEP_MS, totalMs: 0 };
  }

  const steps = Math.min(Math.ceil(glyphs.length / REVEAL_MIN_CHUNK), REVEAL_MAX_STEPS);
  const target = Math.ceil(glyphs.length / steps);
  // Un texte sans le moindre espace — une URL, un identifiant, du japonais —
  // n'offrirait aucune coupe. Au-dela du double de la taille visee, on coupe
  // quand meme : une revelation d'un seul bloc n'en serait plus une.
  const hardLimit = target * 2;

  const chunks: string[] = [];
  let current: string[] = [];

  for (const glyph of glyphs) {
    current.push(glyph);
    // Le bloc se ferme au premier separateur atteint apres la taille visee : la
    // coupe tombe donc entre deux mots, jamais au milieu de l'un d'eux.
    const boundary = current.length >= target && /\s/u.test(glyph);
    if (boundary || current.length >= hardLimit) {
      chunks.push(current.join(""));
      current = [];
    }
  }
  if (current.length > 0) {
    chunks.push(current.join(""));
  }

  // Le reliquat final peut ajouter une etape de trop. On le fond dans le bloc
  // precedent plutot que de laisser la duree depasser son plafond.
  while (chunks.length > REVEAL_MAX_STEPS) {
    const tail = chunks.pop() ?? "";
    chunks[chunks.length - 1] = `${chunks[chunks.length - 1] ?? ""}${tail}`;
  }

  return {
    chunks,
    stepMs: REVEAL_STEP_MS,
    totalMs: chunks.length * REVEAL_STEP_MS,
  };
}
