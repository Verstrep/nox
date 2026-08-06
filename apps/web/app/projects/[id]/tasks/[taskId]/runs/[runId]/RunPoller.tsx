"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Intervalle entre deux interrogations, en millisecondes. */
const POLL_INTERVAL_MS = 2_000;

type RunPollerProps = {
  /** Route Handler de Next.js ; jamais l'URL du runner. */
  endpoint: string;
  /** Faux des le premier rendu si l'execution est deja terminee. */
  active: boolean;
};

type StatusResponse = {
  ok?: boolean;
  run?: { final?: boolean };
};

/**
 * Interrogation periodique de l'etat d'une execution.
 *
 * Pas de streaming pendant TASK-008 : une interrogation toutes les deux
 * secondes suffit a savoir *si* le travail est fini, et coute infiniment moins
 * cher en complexite qu'un flux d'evenements. Le detail du resultat, lui,
 * n'arrive pas par ce canal — il est rendu cote serveur, au rafraichissement.
 *
 * L'interrogation s'arrete des que l'execution est terminee : rien ne tourne en
 * arriere-plan sur une page de resultat.
 */
export function RunPoller({ endpoint, active }: RunPollerProps) {
  const router = useRouter();
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    if (!active) {
      return;
    }

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async (): Promise<void> => {
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        if (stopped) {
          return;
        }

        if (!response.ok) {
          setUnreachable(true);
        } else {
          const payload = (await response.json()) as StatusResponse;
          setUnreachable(false);

          if (payload.run?.final === true) {
            // Le serveur a deja persiste le resultat : un rafraichissement
            // suffit a afficher le detail complet.
            router.refresh();
            return;
          }
        }
      } catch {
        if (!stopped) {
          setUnreachable(true);
        }
      }

      if (!stopped) {
        timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
      }
    };

    timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);

    return () => {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, [endpoint, active, router]);

  if (!active) {
    return null;
  }

  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-lg border border-teal-400/30 bg-teal-400/10 px-4 py-3 text-sm text-teal-200"
    >
      <p className="flex items-center gap-2">
        <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-teal-300" />
        Execution en cours. Cette page se met a jour toute seule.
      </p>
      <p className="text-xs text-teal-200/70">
        Vous pouvez fermer cet onglet : Claude Code continue dans le runner.
      </p>
      {unreachable ? (
        <p className="text-xs text-amber-200/90">
          L&apos;etat n&apos;a pas pu etre recupere au dernier essai. NOX reessaie ; rien n&apos;est
          conclu tant que le runner n&apos;a pas repondu.
        </p>
      ) : null}
    </div>
  );
}
