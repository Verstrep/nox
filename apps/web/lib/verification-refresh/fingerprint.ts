/**
 * Empreinte deterministe d'un rafraichissement de verification.
 *
 * ## La question a laquelle elle repond
 *
 * Une seule : ce rafraichissement a-t-il deja eu lieu pour cet etat-la ? C'est
 * elle qui porte l'idempotence de TASK-033, par l'index unique
 * `(projectId, planningFingerprint)` : un meme etat ne peut produire qu'un
 * appel, quelles que soient les concurrences.
 *
 * Ce n'est **pas** une primitive de securite. Comme l'empreinte de
 * planification et celle du contexte de l'Architecte, c'est un SHA-256 nu —
 * contrairement a l'empreinte de dossier de travail, qui est un HMAC parce
 * qu'elle decide si Claude Code peut reprendre une session. Ne jamais confondre
 * les deux familles.
 *
 * ## Ce qu'elle couvre, et pourquoi
 *
 * - L'**empreinte de planification** de TASK-032, importee et non recopiee.
 *   Elle porte deja le contrat de chaque tache modifiable, son verrouillage,
 *   l'ordre du plan, les dependances et les revisions du brief et du plan.
 * - Les **revisions des documents** reellement transmis. C'est ce qui distingue
 *   un projet avant amorcage d'un projet apres : le `README.md` qui documente
 *   les commandes reelles vient d'etre ecrit, et sans lui l'empreinte ne
 *   changerait pas.
 * - Les **entrees reconnues** du repository, dans l'ordre de l'inventaire. Un
 *   `package.json` apparu est le signal le plus direct qu'une pile existe
 *   maintenant.
 *
 * ## Ce qu'elle ne couvre pas
 *
 * Le modele et la version du prompt. Les inclure ferait qu'un changement de
 * configuration rendrait rafraichissable un projet qui n'a pas bouge d'une
 * ligne — et donc paierait un appel pour rien.
 */

import { createHash, type Hash } from "node:crypto";

/** Version de l'algorithme, incluse dans chaque empreinte. */
export const VERIFICATION_REFRESH_FINGERPRINT_VERSION = "verification-refresh/1";

function field(hash: Hash, value: string): void {
  hash.update(String(value.length));
  hash.update(" ");
  hash.update(value, "utf8");
  hash.update(" ");
}

function fieldList(hash: Hash, values: readonly string[]): void {
  hash.update(String(values.length));
  hash.update(" ");
  for (const value of values) {
    field(hash, value);
  }
}

export type VerificationRefreshFingerprintInput = {
  /** Empreinte du plan de travail, produite par TASK-032. */
  planningFingerprint: string;
  /** Documents transmis, avec leur revision. */
  documents: readonly { path: string; revision: string | null }[];
  /** Entrees reconnues du repository, telles que l'inventaire les rend. */
  markers: readonly string[];
};

/**
 * Empreinte de l'etat qui a produit ce rafraichissement.
 *
 * Chaque champ est precede de sa longueur : sans cela, deux etats differents
 * pourraient produire la meme empreinte par simple deplacement d'une frontiere.
 * Les documents sont tries par chemin — l'ordre de lecture du runner ne doit pas
 * changer la reponse.
 */
export function verificationRefreshFingerprint(
  input: VerificationRefreshFingerprintInput,
): string {
  const hash = createHash("sha256");
  field(hash, VERIFICATION_REFRESH_FINGERPRINT_VERSION);
  field(hash, input.planningFingerprint);
  fieldList(
    hash,
    [...input.documents]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((document) => `${document.path}@${document.revision ?? "unknown"}`),
  );
  fieldList(hash, [...input.markers].sort((left, right) => left.localeCompare(right)));
  return hash.digest("hex");
}

export type VerificationRefreshInputHashParts = {
  promptVersion: string;
  model: string;
  instructions: string;
  input: string;
};

/**
 * Empreinte de l'entree logique d'un rafraichissement.
 *
 * Diagnostic, jamais securite : elle repond a « ces deux appels ont-ils vu la
 * meme chose ? », et aucune decision d'autorisation ne s'y appuie. Melangee a
 * l'empreinte de planification, elle aurait rendu rafraichissable un projet dont
 * seul le modele configure a change.
 */
export function verificationRefreshInputHash(
  parts: VerificationRefreshInputHashParts,
): string {
  const hash = createHash("sha256");
  field(hash, parts.promptVersion);
  field(hash, parts.model);
  field(hash, parts.instructions);
  field(hash, parts.input);
  return hash.digest("hex");
}
