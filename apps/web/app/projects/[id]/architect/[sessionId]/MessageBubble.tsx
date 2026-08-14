import type { ReactNode } from "react";

/**
 * Bulles du chat.
 *
 * Ces composants n'ont aucun etat et ne lisent rien : ils habillent du texte.
 * C'est ce qui leur permet d'etre utilises a la fois par le fil rendu cote
 * serveur et par la bulle temporaire affichee pendant un envoi — un seul style,
 * donc aucun risque qu'un message change d'apparence en devenant reel.
 *
 * La distinction est **uniquement visuelle**. Rien de ce qui est stocke ne
 * change, et le fournisseur ne voit ni couleur, ni alignement.
 */

/** Message de l'utilisateur : a droite, en bleu. */
export function UserBubble({
  children,
  dimmed = false,
}: {
  children: ReactNode;
  /** Vrai pendant qu'un envoi est en vol : le message n'est pas encore acquis. */
  dimmed?: boolean;
}) {
  return (
    <div className="flex justify-end">
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2.5 text-sm leading-relaxed text-white sm:max-w-[75%] ${
          dimmed ? "opacity-70" : ""
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Reponse de l'architecte : a gauche, sobre.
 *
 * Volontairement sans bulle coloree. Une reponse d'architecte est souvent
 * longue, structuree, et se lit comme un texte ; l'enfermer dans un cartouche
 * la rendrait plus difficile a parcourir que le message d'une ligne auquel elle
 * repond.
 */
export function ArchitectBubble({ children }: { children: ReactNode }) {
  return (
    <div className="whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-sm leading-relaxed text-zinc-200">
      {children}
    </div>
  );
}
