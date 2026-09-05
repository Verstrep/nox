import { architectModelLine, architectModelSourceLabel } from "@/lib/architect/display";

/**
 * Le modele que le **prochain** appel Architecte utilisera.
 *
 * ## D'ou vient ce composant
 *
 * Du premier pilote reel. `BACKLOG-002` a ete genere en entier par `gpt-5-mini`
 * parce que `NOX_ARCHITECT_MODEL` avait ete saisie sans etre enregistree.
 * L'historique affichait bien le modele employe — apres coup. Avant de cliquer
 * `Generate`, rien a l'ecran ne disait avec quoi NOX allait decouper toute une
 * V1.
 *
 * ## Ce qu'il n'est pas
 *
 * Ni un selecteur, ni un reglage : il n'ecrit rien, ne propose aucun choix, et
 * ouvrir la page qui le contient ne coute aucun appel. Changer de modele reste
 * une variable d'environnement — c'est deliberement une decision qu'on prend
 * hors de l'interface.
 *
 * ## Ce qu'il ne montre jamais
 *
 * `EffectiveArchitectConfiguration` ne porte pas la cle : elle n'entre pas dans
 * ce composant, donc elle ne peut pas en sortir. `configured` dit seulement
 * qu'une cle est presente, jamais laquelle ni de quelle longueur.
 */
export function ArchitectModelBadge({
  configuration,
}: {
  configuration: {
    model: string;
    reasoningEffort: string | null;
    source: "default" | "environment";
    configured: boolean;
  };
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-zinc-500">
      <span className="uppercase tracking-wider text-zinc-600">Architect</span>
      <span className="font-mono text-zinc-300">{architectModelLine(configuration)}</span>
      <span className="text-zinc-600">{architectModelSourceLabel(configuration.source)}</span>
      {configuration.configured ? null : (
        <span className="text-amber-200/80">
          {/* La cle absente ne change pas le modele resolu : elle empeche
              simplement tout appel. Le dire ici evite de laisser croire que le
              modele affiche serait en cause. */}
          Clé absente : aucun appel ne partira.
        </span>
      )}
    </div>
  );
}
