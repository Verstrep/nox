import type { ReactNode } from "react";

/**
 * Tons disponibles.
 *
 * `warn` et `danger` sont arrives avec la validation autonome : un echec de
 * preuve et une panne d'infrastructure ne doivent pas se lire comme un statut
 * ordinaire, et les rendre en gris aurait fait passer inapercu exactement ce
 * qu'il fallait remarquer.
 */
export type BadgeTone = "accent" | "neutral" | "muted" | "warn" | "danger";

const TONE_CLASSES: Record<BadgeTone, string> = {
  accent: "border-teal-400/30 bg-teal-400/10 text-teal-200",
  neutral: "border-zinc-700 bg-zinc-800/60 text-zinc-200",
  muted: "border-zinc-800 bg-zinc-900/60 text-zinc-500",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  danger: "border-red-500/40 bg-red-500/10 text-red-300",
};

const DOT_CLASSES: Record<BadgeTone, string> = {
  accent: "bg-teal-300",
  neutral: "bg-zinc-300",
  muted: "bg-zinc-600",
  warn: "bg-amber-300",
  danger: "bg-red-400",
};

type StatusBadgeProps = {
  children: ReactNode;
  tone?: BadgeTone;
  withDot?: boolean;
};

export function StatusBadge({ children, tone = "neutral", withDot = false }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium tracking-wide ${TONE_CLASSES[tone]}`}
    >
      {withDot ? (
        <span aria-hidden="true" className={`size-1.5 rounded-full ${DOT_CLASSES[tone]}`} />
      ) : null}
      {children}
    </span>
  );
}
