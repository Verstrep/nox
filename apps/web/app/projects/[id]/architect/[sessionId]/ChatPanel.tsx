"use client";

import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { sendMessageAction } from "./actions";
import { INITIAL_COMPOSER_STATE } from "./form-state";
import { JustArrivedProvider } from "./ProgressiveMessage";
import { PendingArchitectMessage } from "./PendingArchitectMessage";
import { UserBubble } from "./MessageBubble";

type ChatPanelProps = {
  /** Le fil, rendu cote serveur et passe a travers la frontiere client. */
  children: ReactNode;
  projectId: string;
  sessionId: string;
  maxLength: number;
  /**
   * Nombre de messages que le serveur vient de rendre.
   *
   * Deux usages, tous deux locaux : il repart tel quel a l'envoi pour que le
   * serveur reconnaisse un onglet reste sur un etat depasse, et sa progression
   * signale qu'un tour vient d'aboutir sous les yeux de l'utilisateur.
   *
   * **Indice, jamais autorite** : il ne porte aucun fragment de contexte et ne
   * peut elargir aucune permission.
   */
  messageCount: number;
  configured: boolean;
};

/**
 * Le panneau de conversation : le fil, l'attente, et le composer.
 *
 * ## Pourquoi le formulaire vit ici
 *
 * Parce que l'attente s'affiche **en haut**, a la fin du fil, alors que le
 * bouton qui la declenche est **en bas**. Un composer isole ne pourrait pas dire
 * a la liste qu'un envoi est en vol. Un seul composant client tient les deux,
 * et le fil reste rendu par le serveur : il traverse cette frontiere en
 * `children`, sans passer par le navigateur.
 *
 * ## Ce qui n'existe qu'a l'ecran
 *
 * La bulle affichee pendant l'envoi et les trois points d'attente sont de l'etat
 * React, rien d'autre. Aucun message n'est ecrit avant que le serveur ne conclue
 * le tour : il n'existe **aucun second chemin de persistance**, et le message
 * reel prend la place de la bulle temporaire des que la page se revalide.
 */
export function ChatPanel({
  children,
  projectId,
  sessionId,
  maxLength,
  messageCount,
  configured,
}: ChatPanelProps) {
  const [state, formAction, pending] = useActionState(sendMessageAction, INITIAL_COMPOSER_STATE);
  const [written, setWritten] = useState<string | null>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const fieldId = useId();
  const helpId = useId();
  const errorId = useId();

  // Nombre de messages au moment ou cette page a ete rendue. Fige : c'est lui
  // qui distingue « deja la » de « vient d'arriver ».
  const [openedAt] = useState(messageCount);

  // Un tour a-t-il abouti depuis l'ouverture de cette page ? C'est ce qui
  // autorise la revelation progressive — et seulement pour la reponse arrivee.
  const justArrived = messageCount > openedAt;

  // La bulle temporaire se **derive** de l'envoi en cours, elle ne se range pas
  // dans un etat qu'il faudrait penser a vider : des que l'action rend la main,
  // elle disparait d'elle-meme. Sur un succes le vrai message a pris sa place ;
  // sur un echec elle n'a plus rien a montrer.
  const sending = pending ? written : null;

  // On revient au bas du fil a l'envoi et a l'arrivee de la reponse, jamais
  // pendant la revelation : repositionner l'ascenseur toutes les quarante
  // millisecondes empecherait de remonter lire un ancien message.
  useEffect(() => {
    anchor.current?.scrollIntoView({ block: "end", behavior: "instant" });
  }, [messageCount, pending]);

  const submit = (formData: FormData) => {
    const text = String(formData.get("message") ?? "").trim();
    setWritten(text === "" ? null : text);
    formAction(formData);
  };

  return (
    <section className="flex h-[calc(100vh-16rem)] min-h-96 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
      <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <JustArrivedProvider value={justArrived}>{children}</JustArrivedProvider>

        {sending === null && !pending ? null : (
          <ol className="mt-5 flex flex-col gap-5">
            {sending === null ? null : (
              <li>
                <UserBubble dimmed>{sending}</UserBubble>
              </li>
            )}
            {pending ? <PendingArchitectMessage /> : null}
          </ol>
        )}

        <div ref={anchor} aria-hidden="true" />
      </div>

      <div className="border-t border-zinc-800 bg-zinc-950/80 px-4 py-4 sm:px-6">
        <form action={submit} className="flex flex-col gap-3">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="messageCount" value={String(messageCount)} />

          {state.error === null ? null : (
            <p
              id={errorId}
              role="alert"
              className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
            >
              {state.error}
            </p>
          )}

          <label htmlFor={fieldId} className="sr-only">
            Message a l&apos;architecte
          </label>
          {/*
            La cle change quand un tour aboutit : le champ repart vide. Apres un
            refus elle ne bouge pas, et le texte survit — perdre ce que
            l'utilisateur vient d'ecrire serait la pire facon de refuser.
          */}
          <textarea
            key={messageCount}
            id={fieldId}
            name="message"
            rows={3}
            required
            maxLength={maxLength}
            defaultValue={state.message}
            aria-describedby={state.error === null ? helpId : `${errorId} ${helpId}`}
            placeholder="Ecrivez votre message…"
            className="field-sizing-content max-h-56 min-h-20 w-full resize-none overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm leading-relaxed text-zinc-200 placeholder:text-zinc-700 focus-visible:border-zinc-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400 disabled:cursor-not-allowed disabled:opacity-50"
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p id={helpId} className="text-xs text-zinc-600">
              Un clic, un appel. Entree ne declenche rien.
            </p>
            <button
              type="submit"
              disabled={pending || !configured}
              className="rounded-md border border-zinc-600 bg-zinc-800 px-5 py-2 text-sm font-medium text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Envoi…" : "Send"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
