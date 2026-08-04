import { connection } from "next/server";

import { checkRunnerHealth } from "@/lib/runner/client";

import { StatusBadge } from "./StatusBadge";

/**
 * Indicateur de disponibilite du runner, calcule cote serveur au rendu de la
 * page.
 *
 * Volontairement sans rafraichissement automatique : un sondage depuis le
 * navigateur ajouterait du trafic permanent pour une information que
 * l'utilisateur consulte au chargement. L'etat est reevalue a chaque navigation.
 *
 * Aucun detail technique n'est affiche : ni URL, ni jeton, ni cause exacte.
 */
export async function RunnerStatusBadge() {
  // Sans `connection()`, Next.js prerendrait cet indicateur pendant le build :
  // l'etat du runner au moment de la compilation resterait fige pour toujours.
  await connection();
  const health = await checkRunnerHealth();

  if (health.ok) {
    return (
      <StatusBadge tone="accent" withDot>
        Runner disponible
      </StatusBadge>
    );
  }

  return (
    <span title="Demarrez le runner avec « npm run dev:runner »">
      <StatusBadge tone="muted" withDot>
        Runner indisponible
      </StatusBadge>
    </span>
  );
}
