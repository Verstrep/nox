import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-start justify-center gap-4 px-5 py-10 sm:px-8">
      <p className="font-mono text-xs text-zinc-600">404</p>
      <h1 className="text-xl font-semibold text-zinc-100">Page introuvable</h1>
      <p className="max-w-prose text-sm text-zinc-500">
        Cette page n&apos;existe pas. Le projet demande a peut-etre ete supprime, ou son
        identifiant est incorrect.
      </p>
      <Link
        href="/"
        className="mt-2 rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100"
      >
        Retour au tableau de bord
      </Link>
    </div>
  );
}
