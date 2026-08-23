import Link from "next/link";

import { architectUrl } from "@/lib/architect/display";
import { backlogUrl } from "@/lib/backlog/display";
import { bootstrapUrl } from "@/lib/bootstrap/display";
import { projectSettingsUrl } from "@/lib/project-delete";
import { planUrl } from "@/lib/plan-display";
import { queueUrl } from "@/lib/queue-display";

/**
 * Navigation d'un projet.
 *
 * ## Un ordre, pas un menu
 *
 * Les six premieres entrees suivent le chemin reel du travail : on discute avec
 * l'Architecte, on fixe le plan, on en tire un backlog, on prepare le
 * repository, on ecrit les taches, puis on les met en file. Les trois dernieres
 * sont des surfaces de consultation, separees par un trait : elles restent
 * accessibles sans pretendre etre des etapes.
 *
 * ## Ce que ce composant ne fait pas
 *
 * Aucune route n'est inventee ni modifiee : chaque URL vient du module
 * d'affichage qui la possede deja. Il ne lit rien, ne decide rien, et ne
 * signale aucun etat — les cartes de la page le font, avec les donnees sous les
 * yeux.
 */
const WORKFLOW: readonly { label: string; url: (projectId: string) => string }[] = [
  { label: "Architect", url: architectUrl },
  { label: "Plan", url: planUrl },
  { label: "Backlog", url: backlogUrl },
  { label: "Bootstrap", url: bootstrapUrl },
  { label: "Tasks", url: (projectId) => `/projects/${projectId}/tasks` },
  { label: "Queue", url: queueUrl },
];

const SECONDARY: readonly { label: string; url: (projectId: string) => string }[] = [
  { label: "Documents", url: (projectId) => `/projects/${projectId}/documents` },
  { label: "Memory", url: (projectId) => `/projects/${projectId}/memory` },
  { label: "Settings", url: projectSettingsUrl },
];

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
    >
      {label}
    </Link>
  );
}

export function ProjectNav({ projectId }: { projectId: string }) {
  return (
    <nav aria-label="Navigation du projet" className="flex flex-wrap items-center gap-2">
      {WORKFLOW.map((entry) => (
        <NavLink key={entry.label} href={entry.url(projectId)} label={entry.label} />
      ))}
      <span aria-hidden="true" className="mx-1 h-4 w-px bg-zinc-800" />
      {SECONDARY.map((entry) => (
        <NavLink key={entry.label} href={entry.url(projectId)} label={entry.label} />
      ))}
    </nav>
  );
}
