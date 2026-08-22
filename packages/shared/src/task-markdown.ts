/**
 * Generateur du document Markdown d'une tache.
 *
 * Fonction pure et deterministe : memes donnees, meme fichier, octet pour
 * octet. Aucune date, aucun aleatoire, aucune lecture de l'environnement — sans
 * quoi la reprise idempotente de la synchronisation serait impossible, puisqu'
 * elle compare le contenu attendu au contenu deja present sur le disque.
 *
 * Ce module n'importe ni Node, ni Prisma, ni React, et ne touche jamais au
 * systeme de fichiers : il rend une chaine, c'est le runner qui l'ecrit.
 *
 * ## Ce que le document ne contient pas
 *
 * Ni statut, ni priorite, ni date, ni identifiant technique. Ces valeurs
 * changent sans que la specification change : les inscrire obligerait a
 * reecrire le fichier a chaque clic, et remplirait l'historique Git de
 * modifications qui n'apprennent rien. Elles restent dans SQLite.
 *
 * Les libelles des sections sont accentues : ce texte n'est pas une chaine
 * d'interface, c'est un document destine a etre lu dans le repository et
 * versionne avec lui.
 */

import type { TaskSpecification } from "./tasks.js";

/** Ramene toutes les conventions de fin de ligne a LF. */
function toLineFeed(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

/** Normalise un bloc de texte libre : fins de ligne LF, sans marges. */
function normalizeBlock(value: string): string {
  return toLineFeed(value)
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

/**
 * Reduit une valeur a une seule ligne.
 *
 * Un titre ou un critere qui contiendrait un saut de ligne casserait la
 * structure du document : le reste de la phrase deviendrait un paragraphe
 * detache de sa puce. La saisie interdit deja les sauts de ligne ; cette
 * normalisation garantit que le generateur reste correct meme appele
 * directement.
 */
function toSingleLine(value: string): string {
  return toLineFeed(value).replace(/\s+/g, " ").trim();
}

/**
 * Encadre une valeur en code inline, quelle que soit sa ponctuation.
 *
 * Un chemin contenant un accent grave romprait un encadrement naif. La cloture
 * est donc toujours plus longue que la plus longue suite d'accents graves de la
 * valeur, comme le prevoit CommonMark, et une espace de garde est ajoutee quand
 * la valeur commence ou finit par un accent grave.
 */
function inlineCode(value: string): string {
  const longestRun = [...value.matchAll(/`+/g)].reduce(
    (longest, match) => Math.max(longest, match[0].length),
    0,
  );
  const fence = "`".repeat(longestRun + 1);
  const guard = value.startsWith("`") || value.endsWith("`") ? " " : "";
  return `${fence}${guard}${value}${guard}${fence}`;
}

/**
 * Encadre un bloc de commandes dans une cloture de code.
 *
 * Meme principe qu'en inline : une commande contenant ``` fermerait le bloc au
 * milieu du document. La cloture s'allonge donc autant qu'il le faut.
 */
function fencedBlock(language: string, content: string): string {
  const longestRun = [...content.matchAll(/`{3,}/g)].reduce(
    (longest, match) => Math.max(longest, match[0].length),
    2,
  );
  const fence = "`".repeat(longestRun + 1);
  return `${fence}${language}\n${content}\n${fence}`;
}

/** Retire les entrees vides d'une liste, en conservant l'ordre de saisie. */
function usableEntries(entries: readonly string[]): string[] {
  return entries.map(toSingleLine).filter((entry) => entry !== "");
}

type Section = { heading: string; body: string };

/**
 * Une dependance, telle que le document la nomme.
 *
 * Le code et le titre suffisent : le document decrit un contrat, pas un etat.
 */
export type TaskMarkdownDependency = { code: string; title: string };

/**
 * Rappel adresse a l'agent qui lira ce fichier.
 *
 * Il est constant et fait partie du format : un document de tache sans regles
 * d'execution invite a elargir le perimetre, ce que tout le decoupage de NOX
 * cherche justement a eviter.
 */
const EXECUTION_RULES = [
  "- Implémenter uniquement cette tâche.",
  "- Ne commencer aucune autre tâche.",
  "- Ne créer aucun commit ni push sans demande explicite.",
].join("\n");

/**
 * Rend le document Markdown d'une tache.
 *
 * Les sections facultatives absentes ne laissent pas de titre vide : un document
 * qui annonce « Contexte » puis ne dit rien fait perdre du temps a chaque
 * lecture.
 */
export function renderTaskMarkdown(
  task: TaskSpecification,
  dependencies: readonly TaskMarkdownDependency[] = [],
): string {
  const sections: Section[] = [];

  const objective = normalizeBlock(task.objective);
  if (objective !== "") {
    sections.push({ heading: "Objectif", body: objective });
  }

  const context = task.context === null ? "" : normalizeBlock(task.context);
  if (context !== "") {
    sections.push({ heading: "Contexte", body: context });
  }

  const references = usableEntries(task.documentReferences);
  if (references.length > 0) {
    sections.push({
      heading: "Documents obligatoires",
      body: references.map((reference) => `- ${inlineCode(reference)}`).join("\n"),
    });
  }

  const criteria = usableEntries(task.acceptanceCriteria);
  if (criteria.length > 0) {
    sections.push({
      heading: "Critères d'acceptation",
      // Cases non cochees : ce document decrit ce qui doit etre vrai a la fin,
      // pas ce qui l'est deja. NOX ne suit aucun avancement par critere.
      body: criteria.map((criterion) => `- [ ] ${criterion}`).join("\n"),
    });
  }

  const commands = usableEntries(task.validationCommands);
  if (commands.length > 0) {
    sections.push({
      heading: "Commandes de validation",
      body: fencedBlock("bash", commands.join("\n")),
    });
  }

  const outOfScope = task.outOfScope === null ? "" : normalizeBlock(task.outOfScope);
  if (outOfScope !== "") {
    sections.push({ heading: "Hors périmètre", body: outOfScope });
  }

  // Meme convention que partout ailleurs dans ce document : une section vide
  // n'est pas ecrite. Un « ## Dépendances / Aucune » sur la quasi-totalite des
  // taches ajouterait deux lignes de bruit a chaque fichier pour ne rien dire.
  //
  // Le **statut** des dependances n'y figure pas, pour la meme raison que le
  // statut de la tache elle-meme : il change sans que la specification change,
  // et l'inscrire obligerait a reecrire le fichier a chaque transition.
  if (dependencies.length > 0) {
    sections.push({
      heading: "Dépendances",
      body: dependencies
        .map((entry) => {
          const title = toSingleLine(entry.title);
          return title === "" ? `- ${entry.code}` : `- ${entry.code} — ${title}`;
        })
        .join("\n"),
    });
  }

  sections.push({ heading: "Règles d'exécution", body: EXECUTION_RULES });

  const title = toSingleLine(task.title);
  const heading = title === "" ? `# ${task.code}` : `# ${task.code} — ${title}`;

  const blocks = [heading, ...sections.map((section) => `## ${section.heading}\n\n${section.body}`)];

  // Une seule ligne vide entre les blocs, et exactement un saut de ligne final :
  // un fichier qui n'en aurait pas produirait un diff Git parasite des la
  // premiere modification manuelle.
  return `${blocks.join("\n\n")}\n`;
}
