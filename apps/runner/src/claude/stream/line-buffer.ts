/**
 * Decoupage d'un flux en lignes.
 *
 * `stdout` d'un processus n'est pas une suite de lignes : c'est une suite
 * d'octets qui arrivent quand le systeme le decide. Une ligne JSON de 40 Kio
 * peut arriver en douze morceaux, et trois lignes courtes dans un seul. Traiter
 * chaque `chunk` comme une ligne produirait des JSON coupes au milieu et des
 * evenements perdus.
 *
 * Ce module ne fait que ce decoupage, et rien d'autre : il ne sait pas ce qu'est
 * un evenement, ne lit pas de JSON, et n'a aucune opinion sur le contenu.
 *
 * ## Trois choses qu'il garantit
 *
 * 1. **Un reste incomplet est conserve** jusqu'au morceau suivant, indefiniment
 *    s'il le faut.
 * 2. **`\r\n` et `\n` sont equivalents.** Claude Code tourne sous Windows ici, et
 *    un `\r` traine en fin de ligne ferait echouer `JSON.parse` sur une chaine
 *    par ailleurs valide.
 * 3. **Une ligne demesuree est jetee, pas bufferisee.** Sans cette borne, un
 *    processus qui n'ecrirait jamais de retour a la ligne ferait grandir la
 *    memoire du runner sans limite. La ligne est abandonnee jusqu'au prochain
 *    retour a la ligne, et l'abandon est **signale** — jamais silencieux.
 */

/** Resultat de l'absorption d'un morceau. */
export type LineBufferResult = {
  /** Lignes completes, dans l'ordre, sans leur terminateur. */
  lines: string[];
  /** Nombre de lignes abandonnees parce qu'elles depassaient la borne. */
  dropped: number;
};

const EMPTY: LineBufferResult = { lines: [], dropped: 0 };

export class LineBuffer {
  #pending = "";
  /** Vrai lorsqu'on jette les octets jusqu'au prochain retour a la ligne. */
  #discarding = false;
  #dropped = 0;
  readonly #maxLineLength: number;

  constructor(maxLineLength: number) {
    this.#maxLineLength = maxLineLength;
  }

  /** Nombre total de lignes abandonnees depuis la creation. */
  get droppedLines(): number {
    return this.#dropped;
  }

  /**
   * Absorbe un morceau et retourne les lignes devenues completes.
   *
   * Un morceau vide ne produit rien : c'est un cas normal, pas une anomalie.
   */
  push(chunk: string): LineBufferResult {
    if (chunk === "") {
      return EMPTY;
    }

    const lines: string[] = [];
    let dropped = 0;
    let rest = chunk;

    for (;;) {
      const index = rest.indexOf("\n");

      if (index === -1) {
        if (this.#discarding) {
          // Toujours dans une ligne abandonnee : rien a garder.
          return { lines, dropped };
        }

        this.#pending += rest;
        if (this.#pending.length > this.#maxLineLength) {
          // La ligne est deja trop longue et n'est pas finie : on cesse de la
          // retenir tout de suite plutot que d'attendre son terminateur.
          this.#pending = "";
          this.#discarding = true;
          this.#dropped += 1;
          dropped += 1;
        }
        return { lines, dropped };
      }

      const line = rest.slice(0, index);
      rest = rest.slice(index + 1);

      if (this.#discarding) {
        // Fin de la ligne abandonnee : on reprend normalement a la suivante.
        this.#discarding = false;
        continue;
      }

      const complete = this.#pending + line;
      this.#pending = "";

      if (complete.length > this.#maxLineLength) {
        this.#dropped += 1;
        dropped += 1;
        continue;
      }

      const trimmed = stripCarriageReturn(complete);
      if (trimmed !== "") {
        lines.push(trimmed);
      }
    }
  }

  /**
   * Rend la derniere ligne, si le flux s'est termine sans retour a la ligne.
   *
   * Ce cas est frequent : beaucoup de programmes n'ecrivent pas de terminateur
   * apres leur derniere ligne. Sans `flush`, c'est exactement le resultat final
   * qui serait perdu — la ligne la plus importante du flux.
   */
  flush(): LineBufferResult {
    if (this.#discarding) {
      this.#discarding = false;
      this.#pending = "";
      return EMPTY;
    }

    const remaining = stripCarriageReturn(this.#pending);
    this.#pending = "";

    if (remaining === "") {
      return EMPTY;
    }
    if (remaining.length > this.#maxLineLength) {
      this.#dropped += 1;
      return { lines: [], dropped: 1 };
    }

    return { lines: [remaining], dropped: 0 };
  }
}

/** Retire le `\r` d'un `\r\n`, et les espaces qui entourent la ligne. */
function stripCarriageReturn(line: string): string {
  return line.replace(/\r+$/u, "").trim();
}
