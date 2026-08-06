"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Protection commune aux formulaires qui contiennent du texte non enregistre.
 *
 * Deux formulaires en ont besoin — l'editeur et la creation — et leur besoin est
 * exactement le meme : prevenir avant de perdre une saisie. Le hook s'arrete la.
 * Il ne cherche pas a intercepter toute navigation possible, ce qui demanderait
 * de detourner le routeur de Next.js pour un benefice modeste.
 *
 * `beforeunload` couvre la fermeture d'onglet, le rechargement et le retour
 * navigateur ; il **ne couvre pas** la navigation interne de Next.js, d'ou la
 * confirmation explicite portee par la fonction retournee.
 *
 * Rien n'est demande tant que le formulaire n'a pas change : une confirmation
 * qui apparait sans raison finit par etre cliquee sans etre lue.
 */
const DISCARD_CONFIRMATION =
  "Vos modifications ne sont pas enregistrees. Quitter cette page les perdra definitivement.";

export function useUnsavedChanges(isDirty: boolean): (destination: string) => void {
  const router = useRouter();

  useEffect(() => {
    if (!isDirty) {
      return;
    }

    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };

    window.addEventListener("beforeunload", warn);
    return () => { window.removeEventListener("beforeunload", warn); };
  }, [isDirty]);

  return (destination: string): void => {
    if (isDirty && !window.confirm(DISCARD_CONFIRMATION)) {
      return;
    }
    router.push(destination);
  };
}
