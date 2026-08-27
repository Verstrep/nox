"use client";

import type { DeliveryPolicy } from "@nox/shared";
import Link from "next/link";
import { useActionState, useId } from "react";

import { decideReviewAction } from "./actions";
import {
  approveDeliveryNotice,
  approvedDeliveryNotice,
  deliveryUrl,
  overrideDeliveryNotice,
} from "@/lib/delivery-display";

import { INITIAL_REVIEW_DECISION_STATE } from "./form-state";

/** Un critere que seul un humain peut confirmer. */
export type HumanCheck = { id: string; text: string; instructions: string };

type ReviewDecisionFormProps = {
  projectId: string;
  taskId: string;
  runId: string;
  /**
   * Criteres humains a confirmer avant toute acceptation.
   *
   * La liste vient du serveur, qui la revalide de toute facon a la soumission :
   * cocher ici est une commodite, pas une autorisation.
   */
  humanChecks: readonly HumanCheck[];
  /** La validation automatisee a echoue : seul un passage en force reste. */
  overrideRequired: boolean;
  /**
   * Politique de livraison Git du projet, relue en base.
   *
   * Elle ne change rien a ce que ce formulaire fait : elle change ce qu'il
   * **annonce**. « Approve ne cree aucun commit » etait vrai avant TASK-029 et
   * ne l'est plus dans deux modes sur trois — et une phrase rassurante devenue
   * fausse est pire qu'une phrase absente.
   */
  deliveryPolicy: DeliveryPolicy;
  /** Un lot de validation tourne encore : aucune decision n'est possible. */
  validationRunning: boolean;
  /**
   * Lien vers la demande de corrections, ou `null` si elle est indisponible.
   *
   * `null` n'est pas un detail d'affichage : il signifie qu'une precondition
   * manque — pas de session, review absente, empreinte absente. La raison est
   * expliquee a cote plutot que d'etre devinee depuis un bouton disparu.
   */
  requestChangesHref: string | null;
  /** Pourquoi la reprise est indisponible, lorsqu'elle l'est. */
  requestChangesReason: string | null;
};

/**
 * Acceptation ou renvoi en file du travail d'une execution.
 *
 * Deux boutons, une seule difference : le champ cache `decision`. Le navigateur
 * ne choisit pas un statut — il choisit entre deux intentions, que la Server
 * Action traduit. Un formulaire altere ne peut donc pas poser un statut
 * arbitraire sur la tache.
 *
 * Aucun des deux boutons ne touche a Git. C'est dit sous les boutons, pas
 * seulement dans la documentation : c'est exactement le moment ou l'utilisateur
 * se demande si NOX vient de commiter a sa place.
 */
export function ReviewDecisionForm({
  projectId,
  taskId,
  runId,
  humanChecks,
  overrideRequired,
  deliveryPolicy,
  validationRunning,
  requestChangesHref,
  requestChangesReason,
}: ReviewDecisionFormProps) {
  const [state, formAction, pending] = useActionState(
    decideReviewAction,
    INITIAL_REVIEW_DECISION_STATE,
  );
  const noticeId = useId();

  if (state.decided === "approve") {
    return (
      <div role="status" className="flex flex-col gap-2 text-sm leading-relaxed text-teal-200/90">
        <p>{approvedDeliveryNotice(deliveryPolicy)}</p>
        <Link href={deliveryUrl(projectId, taskId)} className="text-xs underline underline-offset-4">
          Open delivery
        </Link>
      </div>
    );
  }

  if (state.decided === "reopen") {
    return (
      <p role="status" className="text-sm leading-relaxed text-amber-200/90">
        Tache remise en <span className="font-mono">Ready</span>. Avant un nouveau lancement, le
        repository devra redevenir propre et synchronise : les changements de cette execution sont
        encore la, et la verification prealable les refusera.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="runId" value={runId} />

      {validationRunning ? (
        <p
          role="status"
          className="rounded-md border border-zinc-700 bg-zinc-900/60 px-4 py-3 text-sm leading-relaxed text-zinc-300"
        >
          La validation automatique de NOX est encore en cours. Aucune decision n&apos;est possible
          avant son resultat.
        </p>
      ) : null}

      {humanChecks.length === 0 ? null : (
        <fieldset className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
          <legend className="px-1 text-sm font-medium text-zinc-200">
            Human validation required
          </legend>
          {/* Chaque case dit **quoi** tester. Demander a l'utilisateur de relire
              tout le diff quand seuls deux points le concernent est la façon la
              plus sure de n'obtenir ni l'un ni l'autre. */}
          <p className="text-xs leading-relaxed text-zinc-500">
            NOX ne peut pas verifier ces criteres. Confirmez-les un par un : l&apos;acceptation
            est refusee tant qu&apos;il en reste un.
          </p>
          {humanChecks.map((check) => (
            <label key={check.id} className="flex items-start gap-3 text-sm text-zinc-300">
              <input
                type="checkbox"
                name="humanCriterion"
                value={check.id}
                className="mt-1 h-4 w-4 shrink-0 accent-teal-400"
              />
              <span className="flex flex-col gap-1">
                <span>{check.text}</span>
                <span className="text-xs leading-relaxed text-zinc-500">{check.instructions}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {overrideRequired || state.overrideRequired === true ? (
        <fieldset className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <legend className="px-1 text-sm font-medium text-amber-200">
            Approve with validation override
          </legend>
          {/* Le passage en force ne reecrit rien : le resultat automatise reste
              affiche tel quel, juste au-dessus. Ce champ enregistre seulement
              qu'un humain a accepte malgre lui, et pourquoi. */}
          <p className="text-xs leading-relaxed text-amber-200/80">
            Une validation automatisee n&apos;est pas passee. Vous restez l&apos;autorite finale,
            mais la raison sera conservee avec la decision — et le resultat automatise ne sera pas
            reecrit.
          </p>
          {overrideDeliveryNotice(deliveryPolicy) === null ? null : (
            <p className="rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs leading-relaxed text-amber-100">
              {overrideDeliveryNotice(deliveryPolicy)}
            </p>
          )}
          <input type="hidden" name="override" value="1" />
          <textarea
            name="overrideReason"
            rows={3}
            maxLength={1000}
            required
            placeholder="Pourquoi acceptez-vous malgre ce resultat ?"
            className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
          />
        </fieldset>
      ) : null}

      {state.error === null ? null : (
        <p
          role="alert"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-200"
        >
          {state.error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          name="decision"
          value="approve"
          disabled={pending}
          aria-describedby={noticeId}
          className="rounded-md border border-teal-400/40 bg-teal-400/10 px-4 py-2 text-sm font-medium text-teal-100 transition-colors hover:border-teal-300/60 hover:bg-teal-400/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {overrideRequired || state.overrideRequired === true
            ? "Approve with validation override"
            : "Approve"}
        </button>

        {requestChangesHref === null ? null : (
          <Link
            href={requestChangesHref}
            className="rounded-md border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
          >
            Request changes
          </Link>
        )}

        <button
          type="submit"
          name="decision"
          value="reopen"
          disabled={pending}
          aria-describedby={noticeId}
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reopen
        </button>
      </div>

      <div id={noticeId} className="flex flex-col gap-2 text-xs leading-relaxed text-zinc-600">
        <p>
          <span className="font-mono">Approve</span> passe la tache a{" "}
          <span className="font-mono">Done</span>. {approveDeliveryNotice(deliveryPolicy)}
        </p>
        {/* La difference entre les deux boutons de rejet est la question la plus
            frequente de cette page : elle est repondue ici, pas dans un
            document que personne n'ouvrira au moment du clic. */}
        <p>
          <span className="font-mono">Request changes</span> demande a{" "}
          <strong className="text-zinc-500">la meme session Claude</strong> de corriger ce travail,
          a partir de votre feedback et sans repartir de zero.{" "}
          <span className="font-mono">Reopen</span> remet simplement la tache a{" "}
          <span className="font-mono">Ready</span> : c&apos;est vous qui reprendrez la main sur le
          repository avant un futur lancement.
        </p>
        {requestChangesReason === null ? null : (
          <p className="text-amber-200/80">
            <span className="font-mono">Request changes</span> est indisponible :{" "}
            {requestChangesReason}
          </p>
        )}
      </div>
    </form>
  );
}
