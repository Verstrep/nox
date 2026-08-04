import type { Metadata } from "next";
import Link from "next/link";

import { RunnerStatusBadge } from "@/components/RunnerStatusBadge";

import { CreateProjectForm } from "./CreateProjectForm";

export const metadata: Metadata = {
  title: "Nouveau projet - NOX",
};

export default function NewProjectPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-4 border-b border-zinc-800 pb-6">
        <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300">
          &larr; Retour au tableau de bord
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-zinc-50">Nouveau projet</h1>
            <p className="mt-2 max-w-prose text-sm leading-relaxed text-zinc-400">
              Associez un repository Git deja present sur cette machine. Le runner local verifie le
              chemin et renvoie la racine du repository.
            </p>
          </div>
          {/* Le formulaire reste accessible meme sans runner : l'echec est
              explique a la soumission plutot que par un blocage prealable. */}
          <RunnerStatusBadge />
        </div>
      </header>

      <main>
        <CreateProjectForm />
      </main>

      <footer className="mt-auto border-t border-zinc-800 pt-6 text-xs text-zinc-600">
        NOX ne clone aucun repository et ne modifie jamais son contenu. Seul le chemin est
        enregistre.
      </footer>
    </div>
  );
}
