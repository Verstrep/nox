"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { planReveal } from "@/lib/architect/reveal";

import { ArchitectBubble } from "./MessageBubble";

/**
 * La derniere reponse vient-elle d'arriver dans cette session d'affichage ?
 *
 * `false` au chargement d'une page : tout ce qui est deja en base s'affiche
 * **en entier, immediatement**. Rejouer l'animation a chaque rafraichissement
 * transformerait la relecture d'une conversation en spectacle.
 *
 * `true` seulement apres qu'un tour a abouti sous les yeux de l'utilisateur.
 */
const JustArrived = createContext(false);

export const JustArrivedProvider = JustArrived.Provider;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * Le systeme demande-t-il moins de mouvement ?
 *
 * C'est un abonnement a un etat exterieur a React, pas un effet : le lire ainsi
 * evite le rendu en cascade d'un `setState` au montage, et la valeur suit
 * l'utilisateur s'il change sa preference sans recharger la page.
 *
 * Cote serveur, la reponse est « non » : le rendu initial est alors identique
 * pour tout le monde, et le navigateur tranche des qu'il prend la main.
 */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(REDUCED_MOTION);
      query.addEventListener("change", onChange);
      return () => {
        query.removeEventListener("change", onChange);
      };
    },
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

/**
 * Reponse de l'architecte, revelee par blocs.
 *
 * ## Ce n'est pas du streaming
 *
 * Le texte est **deja recu et deja enregistre** quand ce composant le rend :
 * l'appel au fournisseur est termine, le tour est conclu, rien n'attend le
 * reseau. Ce qui est progressif est l'affichage, et lui seul. Aucun protocole,
 * aucune route, aucune option du fournisseur n'a change.
 *
 * ## Ce qui declenche l'animation
 *
 * Uniquement une reponse arrivee pendant que la page etait ouverte. Un
 * rafraichissement, un retour en arriere ou une reouverture du projet affichent
 * tout d'un coup — c'est de l'historique, pas une nouveaute.
 *
 * ## La carte de proposition
 *
 * Elle attend la fin de la revelation. La voir apparaitre pendant que le texte
 * qui la justifie s'ecrit encore au-dessus donnerait une impression de desordre.
 */
export function ProgressiveArchitectMessage({
  text,
  children,
}: {
  text: string;
  /** Carte de proposition, revelee une fois le texte complet. */
  children?: ReactNode;
}) {
  const justArrived = useContext(JustArrived);
  const reduced = usePrefersReducedMotion();

  // L'etat initial decide tout : une reponse historique nait complete, et aucun
  // minuteur n'est jamais arme pour elle.
  const [shown, setShown] = useState(() => (justArrived ? 0 : Number.POSITIVE_INFINITY));

  const plan = planReveal(text);
  const complete = reduced || shown >= plan.chunks.length;

  useEffect(() => {
    if (complete) {
      return;
    }
    const timer = setInterval(() => {
      setShown((previous) => previous + 1);
    }, plan.stepMs);
    return () => {
      clearInterval(timer);
    };
  }, [complete, plan.stepMs]);

  const visible = complete ? text : plan.chunks.slice(0, shown).join("");

  return (
    <>
      <ArchitectBubble>
        {visible}
        {complete ? null : <span className="sr-only">Reponse en cours d&apos;affichage.</span>}
      </ArchitectBubble>
      {complete ? children : null}
    </>
  );
}
