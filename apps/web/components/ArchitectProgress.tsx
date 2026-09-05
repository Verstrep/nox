"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { architectElapsedMs, formatArchitectDuration } from "@/lib/architect/duration";

/**
 * Ce qui s'affiche pendant qu'un appel a l'Architecte est en vol.
 *
 * ## Ce qu'il remplace
 *
 * Un bouton grise et rien d'autre. Le second pilote reel a attendu deux fois
 * une planification de backlog sans savoir depuis combien de temps, sans savoir
 * si quelque chose se passait, et sans autre issue que de recharger la page —
 * ce qui laissait la requete travailler et facturer dans le vide.
 *
 * Trois choses, donc : le temps ecoule, une phrase qui dit qu'une attente longue
 * est normale, et un bouton qui arrete reellement la requete.
 *
 * ## Le temps ecoule ne juge pas
 *
 * Aucune couleur d'alerte, aucun seuil, aucune animation. Depasser quatre-vingt-
 * dix secondes etait un echec hier ; c'est un fait sans consequence
 * aujourd'hui, et l'ecran ne doit pas suggerer le contraire.
 *
 * ## Ce qui est interroge, et a quelle cadence
 *
 * Une lecture toutes les trois secondes, qui rapporte un booleen et un instant.
 * Elle sert a obtenir l'instant **enregistre** au depart de la generation — le
 * seul qui reste juste apres un rechargement de page. Le compteur, lui, avance
 * dans le navigateur : la base n'est pas interrogee chaque seconde.
 *
 * ## Il n'est monte que pendant un appel
 *
 * C'est le parent qui decide, et non un drapeau interne. Ce composant n'existe
 * donc **que** tant qu'un appel est en vol : il ne peut ni interroger, ni
 * proposer d'arreter quand il n'y a rien a arreter, et chaque nouvel envoi
 * repart d'un etat neuf sans qu'aucune remise a zero n'ait a etre ecrite — donc
 * sans qu'aucune puisse etre oubliee.
 */

/** Cadence de lecture de l'instant de depart, en millisecondes. */
const POLL_INTERVAL_MS = 3000;

/** Cadence du compteur affiche. Local, sans aucune requete. */
const TICK_INTERVAL_MS = 1000;

type ArchitectProgressProps = {
  /** Route de lecture de la generation en vol. */
  statusUrl: string;
  /** Route d'arret. */
  stopUrl: string;
  /** Ce qui travaille, dit a l'utilisateur : « Génération du backlog… ». */
  label: string;
};

type ActiveResponse = { ok?: unknown; active?: { startedAt?: unknown } | null };

export function ArchitectProgress({ statusUrl, stopUrl, label }: ArchitectProgressProps) {
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [stopping, setStopping] = useState(false);
  const [stopped, setStopped] = useState(false);
  /**
   * Vrai quand l'arret a bien ferme une requete dans ce processus.
   *
   * `false` apres un arret ne veut pas dire que le travail continue : il veut
   * dire que NOX n'a plus le controleur — un redemarrage du serveur — et donc
   * qu'il ne peut rien affirmer. Ces deux etats ne se disent pas pareil.
   */
  const [aborted, setAborted] = useState(false);

  // Un arret deja demande ne doit pas repartir sur un second clic, ni sur un
  // re-rendu. Une ref plutot qu'un etat : la garde doit valoir immediatement,
  // sans attendre le rendu suivant.
  const stopSent = useRef(false);

  useEffect(() => {
    const controller = new AbortController();

    const read = () => {
      fetch(statusUrl, { cache: "no-store", signal: controller.signal })
        .then((response) => (response.ok ? (response.json() as Promise<ActiveResponse>) : null))
        .then((body) => {
          const value = body?.active?.startedAt;
          setStartedAt(typeof value === "string" ? value : null);
        })
        .catch(() => {
          // Une lecture d'etat qui echoue ne doit rien casser : le compteur
          // s'efface, l'arret reste disponible, et l'envoi continue.
        });
    };

    read();
    const poll = window.setInterval(read, POLL_INTERVAL_MS);
    const tick = window.setInterval(() => {
      setNow(Date.now());
    }, TICK_INTERVAL_MS);

    return () => {
      controller.abort();
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [statusUrl]);

  const stop = useCallback(() => {
    if (stopSent.current) {
      return;
    }
    stopSent.current = true;
    setStopping(true);

    fetch(stopUrl, { method: "POST", cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<Record<string, unknown>>) : null))
      .then((body) => {
        setStopped(true);
        setAborted(body?.["aborted"] === true);
      })
      .catch(() => {
        // L'arret est idempotent cote serveur : reessayer n'apporterait rien de
        // plus qu'un second appel sans effet. L'ecran dit ce qu'il sait.
        setStopped(true);
      })
      .finally(() => {
        setStopping(false);
      });
  }, [stopUrl]);

  const elapsed = startedAt === null ? null : architectElapsedMs(startedAt, now);

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col gap-3 rounded-md border border-zinc-800 bg-zinc-900/60 px-4 py-3"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm text-zinc-200">{label}</span>
        {elapsed === null ? null : (
          <span className="font-mono text-sm tabular-nums text-zinc-400">
            {formatArchitectDuration(elapsed)}
          </span>
        )}
      </div>

      <p className="text-xs leading-relaxed text-zinc-500">
        {stopped
          ? aborted
            ? "Arrêt demandé. NOX a fermé la requête ; rien n'a été enregistré."
            : "Arrêt enregistré. NOX ne peut pas confirmer que la requête a été fermée ; rien n'a été enregistré."
          : "Le modèle travaille toujours. Une génération peut légitimement prendre plusieurs minutes."}
      </p>

      <div>
        <button
          type="button"
          onClick={stop}
          disabled={stopping || stopped}
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {stopped ? "Arrêté" : stopping ? "Arrêt…" : "Arrêter"}
        </button>
      </div>
    </div>
  );
}
