/**
 * Attente d'une reponse : trois points qui s'animent.
 *
 * ## Ce n'est pas un message
 *
 * Rien de ce composant n'est ecrit en base, n'entre dans le transcript, ne
 * rejoint le prompt ni ne consomme quoi que ce soit. C'est un etat d'interface,
 * qui disparait des que le tour aboutit — ou echoue.
 *
 * ## Pourquoi trois points plutot qu'un texte
 *
 * « Appel au fournisseur en cours… » decrit une plomberie ; trois points
 * decrivent quelqu'un qui reflechit. La conversation doit ressembler a une
 * conversation. Et un indicateur discret vaut mieux qu'un grand disque tournant :
 * l'attente est courte, la signaler bruyamment la ferait paraitre longue.
 *
 * L'animation est definie dans la feuille globale, ou elle sait aussi se taire
 * quand le systeme demande moins de mouvement.
 */
export function PendingArchitectMessage() {
  return (
    <li className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-zinc-100">NOX</h3>
      <div className="w-fit rounded-md border border-zinc-800 bg-zinc-900/40 px-4 py-3">
        <span className="sr-only">L&apos;architecte prepare sa reponse.</span>
        <span aria-hidden="true" className="flex items-center gap-1.5">
          <span className="nox-dot size-1.5 rounded-full bg-zinc-400" />
          <span className="nox-dot nox-dot-2 size-1.5 rounded-full bg-zinc-400" />
          <span className="nox-dot nox-dot-3 size-1.5 rounded-full bg-zinc-400" />
        </span>
      </div>
    </li>
  );
}
