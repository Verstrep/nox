/**
 * Exclusion d'execution, par repository.
 *
 * ## Ce que ce module garantit
 *
 * Qu'un repository ne porte jamais deux executions Claude Code actives, et que
 * deux repositories differents n'ont aucune raison de s'attendre.
 *
 * Avant TASK-031, la question posee etait « ce **projet** a-t-il une execution
 * active ? ». C'etait presque juste : un repository appartient normalement a un
 * seul projet, et TASK-025 le garantit. Mais « normalement » n'est pas une
 * garantie d'execution. Une base modifiee a la main, un etat ancien, une course
 * de creation : il suffit de deux projets visant le meme dossier pour que deux
 * Claude Code se marchent dessus. La securite d'execution ne doit pas dependre
 * d'un invariant applicatif — elle doit tenir toute seule.
 *
 * ## Pourquoi la comparaison se fait en memoire
 *
 * Parce que la cle canonique d'un repository n'est pas une colonne : elle se
 * derive d'un chemin, et SQLite ne sait pas la calculer. Lire la table des
 * projets pour la calculer ici coute une requete sur une table qui compte des
 * dizaines de lignes dans l'outil local qu'est NOX — et rend la comparaison
 * identique a celle du runner, qui utilise exactement la meme fonction.
 *
 * ## Ce que ce module ne fait pas
 *
 * Il ne verrouille rien par lui-meme. La serialisation reelle vient de l'ordre
 * d'ecriture de l'appelant : reserver, ecrire, **puis** compter. C'est
 * l'ecriture qui prend le verrou de SQLite ; le perdant relit alors une base qui
 * contient deja l'execution du gagnant. Verifier avant d'ecrire laisserait les
 * deux passer.
 */

import { ACTIVE_RUN_STATUSES, repositoryLockKey } from "@nox/shared";

import type { DatabaseClient } from "./client.js";

/** Client minimal suffisant, pour etre utilisable dans une transaction en cours. */
export type RepositoryLockClient = Pick<DatabaseClient, "project" | "run">;

/**
 * Projets partageant le repository d'un projet donne, lui compris.
 *
 * Rend une liste vide si le projet est introuvable : sans repository connu, il
 * n'y a pas de domaine d'exclusion, et inventer le sien reviendrait a se
 * verrouiller contre rien.
 */
export async function listProjectIdsSharingRepository(
  db: RepositoryLockClient,
  projectId: string,
): Promise<string[]> {
  const projects = await db.project.findMany({ select: { id: true, repositoryPath: true } });

  const own = projects.find((project) => project.id === projectId);
  if (own === undefined) {
    return [];
  }

  const key = repositoryLockKey(own.repositoryPath);
  if (key === "") {
    // Un chemin illisible ne designe aucun repository. L'exclusion retombe alors
    // sur le projet lui-meme : elle ne peut pas etre plus large, mais elle ne
    // doit surtout pas etre vide.
    return [own.id];
  }

  return projects
    .filter((project) => repositoryLockKey(project.repositoryPath) === key)
    .map((project) => project.id);
}

/**
 * Nombre d'executions actives sur le repository d'un projet.
 *
 * `excludeRunId` sert a l'appelant qui vient de creer la sienne : il compte les
 * **autres**, et un resultat non nul signifie qu'il a perdu la course.
 *
 * Les statuts comptes sont exactement `ACTIVE_RUN_STATUSES` — `QUEUED`,
 * `RUNNING`, `CANCELLING` —, c'est-a-dire ceux qui peuvent encore posseder un
 * processus. Une definition differente ici et ailleurs finirait par laisser
 * passer precisement l'etat qu'on croyait couvert.
 */
export async function countActiveRepositoryRuns(
  db: RepositoryLockClient,
  projectId: string,
  excludeRunId: string | null = null,
): Promise<number> {
  const projectIds = await listProjectIdsSharingRepository(db, projectId);
  if (projectIds.length === 0) {
    return 0;
  }

  return db.run.count({
    where: {
      task: { projectId: { in: projectIds } },
      status: { in: [...ACTIVE_RUN_STATUSES] },
      ...(excludeRunId === null ? {} : { id: { not: excludeRunId } }),
    },
  });
}
