/**
 * Validation des champs libres du formulaire de creation de projet.
 *
 * Fonctions pures, sans acces au systeme de fichiers ni a la base : elles sont
 * appelees cote serveur et testables isolement.
 */

export const PROJECT_NAME_MAX_LENGTH = 80;
export const PROJECT_DESCRIPTION_MAX_LENGTH = 500;

export const PROJECT_NAME_ERROR = {
  EMPTY: "EMPTY",
  TOO_LONG: "TOO_LONG",
} as const;

export type ProjectNameErrorCode = (typeof PROJECT_NAME_ERROR)[keyof typeof PROJECT_NAME_ERROR];

export type ProjectNameResult =
  | { ok: true; name: string }
  | { ok: false; code: ProjectNameErrorCode; message: string };

const NAME_MESSAGES: Record<ProjectNameErrorCode, string> = {
  EMPTY: "Le nom du projet est obligatoire.",
  TOO_LONG: `Le nom du projet ne doit pas depasser ${String(PROJECT_NAME_MAX_LENGTH)} caracteres.`,
};

/** Valide et normalise le nom d'un projet. */
export function validateProjectName(rawName: string): ProjectNameResult {
  const name = rawName.trim();

  if (name === "") {
    return { ok: false, code: PROJECT_NAME_ERROR.EMPTY, message: NAME_MESSAGES.EMPTY };
  }

  if (name.length > PROJECT_NAME_MAX_LENGTH) {
    return { ok: false, code: PROJECT_NAME_ERROR.TOO_LONG, message: NAME_MESSAGES.TOO_LONG };
  }

  return { ok: true, name };
}

export type ProjectDescriptionResult =
  | { ok: true; description: string | null }
  | { ok: false; message: string };

/**
 * Normalise la description : une valeur vide devient `null` plutot qu'une
 * chaine vide, pour que l'absence de description soit representee une seule
 * facon en base.
 */
export function validateProjectDescription(rawDescription: string): ProjectDescriptionResult {
  const description = rawDescription.trim();

  if (description.length > PROJECT_DESCRIPTION_MAX_LENGTH) {
    return {
      ok: false,
      message: `La description ne doit pas depasser ${String(PROJECT_DESCRIPTION_MAX_LENGTH)} caracteres.`,
    };
  }

  return { ok: true, description: description === "" ? null : description };
}

export type RepositoryPathInputResult =
  | { ok: true; repositoryPath: string }
  | { ok: false; message: string };

/**
 * Verifie qu'un chemin a bien ete saisi, avant tout appel au runner.
 *
 * La validation reelle du chemin (existence, dossier, repository Git) appartient
 * au runner : lui seul voit le systeme de fichiers. Ce controle-ci evite
 * seulement d'annoncer « runner indisponible » a un utilisateur qui a simplement
 * laisse le champ vide.
 */
export function validateRepositoryPathInput(rawPath: string): RepositoryPathInputResult {
  const repositoryPath = rawPath.trim();

  if (repositoryPath === "") {
    return { ok: false, message: "Indiquez le chemin du repository Git local." };
  }

  return { ok: true, repositoryPath };
}
