/**
 * Ce que le moteur de livraison Git ne fait pas.
 *
 * ## Pourquoi ce fichier lit une source
 *
 * Parce que les garanties de TASK-029 sont pour l'essentiel des **absences** :
 * aucun `reset`, aucun `restore`, aucun `checkout`, aucun `clean`, aucun push
 * force, aucun interpreteur de commandes, aucun parametre de forcage, aucun
 * appel a un fournisseur. Une absence ne s'observe pas en lancant le code une
 * fois — une commande ajoutee par megarde ne se verrait qu'a la prochaine perte
 * de travail.
 *
 * Le parcours complet — une tache validee, un commit, un push, une file qui
 * repart — est verifie par le test fonctionnel, sur des repositories Git
 * temporaires avec remotes bare. Ici, on protege ce qui ne doit jamais
 * apparaitre.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(HERE, "..", "..", "runner", "src", "repositories");

/** Separateur de lignes, quel que soit le style du fichier lu. */
const LINE_BREAK = /\r?\n/u;

async function source(file: string): Promise<string> {
  return readFile(path.join(HERE, file), "utf8");
}

/** Le code seul : l'entete nomme ce qu'il refuse, et c'est une bonne chose. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/\/\/.*$/gmu, " ");
}

describe("aucune commande Git destructrice", () => {
  it("le moteur du web n'en nomme aucune", async () => {
    const text = code(await source("git-delivery.ts"));
    for (const forbidden of [
      "reset",
      "restore",
      "checkout",
      "clean",
      "rebase",
      "merge",
      "pull",
      "stash",
      "cherry-pick",
      "revert",
    ]) {
      assert.ok(!text.includes(forbidden), `« ${forbidden} » ne doit pas apparaitre`);
    }
  });

  it("le module du runner n'invoque que add, commit et push", async () => {
    const text = code(await readFile(path.join(RUNNER, "git-delivery.ts"), "utf8"));

    // Les seules ecritures : preparer des chemins exacts, creer un commit,
    // pousser vers l'upstream deja configure.
    assert.ok(text.includes('"add"'));
    assert.ok(text.includes('"commit"'));
    assert.ok(text.includes('"push"'));

    for (const forbidden of [
      '"reset"',
      '"restore"',
      '"checkout"',
      '"clean"',
      '"rebase"',
      '"merge"',
      '"pull"',
      '"stash"',
      '"cherry-pick"',
      '"revert"',
      '"switch"',
      '"tag"',
      '"remote"',
      "--force",
      "--force-with-lease",
      "--no-verify",
      "--no-gpg-sign",
      '"-u"',
      "--set-upstream",
    ]) {
      assert.ok(!text.includes(forbidden), `« ${forbidden} » ne doit pas apparaitre`);
    }
  });

  it("le module du runner n'ecrit jamais une configuration Git", async () => {
    // `git config --get` lit ; `git config <cle> <valeur>` ecrirait. NOX ne
    // configure ni identite, ni upstream, ni remote : il utilise ce que la
    // machine a deja.
    const text = code(await readFile(path.join(RUNNER, "git-delivery.ts"), "utf8"));
    const configCalls = [...text.matchAll(/\["config"[^\]]*\]/gu)].map((match) => match[0]);
    assert.ok(configCalls.length > 0, "le module lit bien la configuration");
    for (const call of configCalls) {
      assert.ok(call.includes('"--get"'), `configuration ecrite : ${call}`);
    }
  });
});

describe("aucun interpreteur de commandes", () => {
  it("le module du runner n'en invoque aucun", async () => {
    const text = code(await readFile(path.join(RUNNER, "git-delivery.ts"), "utf8"));
    for (const forbidden of [
      "shell: true",
      "cmd /c",
      "cmd.exe",
      "powershell",
      "bash -c",
      "sh -c",
      "execSync",
      "exec(",
    ]) {
      assert.ok(!text.includes(forbidden), `« ${forbidden} » ne doit pas apparaitre`);
    }
    // `execFile` prend un vecteur d'arguments : il n'y a aucune ligne de
    // commande a interpreter, donc rien a echapper.
    assert.ok(text.includes("execFile("));
  });

  it("les chemins deviennent des pathspecs litteraux", async () => {
    // Sans `:(literal)`, un fichier nomme `notes[1].md` serait lu comme un motif
    // de recherche, et Git ne trouverait rien.
    const text = code(await readFile(path.join(RUNNER, "git-delivery.ts"), "utf8"));
    assert.ok(text.includes(":(literal)"));
  });

  it("le staging est toujours ferme sur une liste de chemins", async () => {
    const text = code(await readFile(path.join(RUNNER, "git-delivery.ts"), "utf8"));
    // Jamais `git add .`, jamais `git add -A` sans pathspec : la liste vient du
    // candidat valide, et rien d'autre n'entre dans le commit.
    assert.ok(!/\["add",\s*"\."\]/u.test(text));
    assert.ok(!/\["add",\s*"-A"\]/u.test(text));
    assert.ok(text.includes('["add", "-A", "--", ...'));
  });
});

describe("aucune porte derobee", () => {
  it("le moteur ne declare aucun parametre de forcage", async () => {
    const text = code(await source("git-delivery.ts"));
    for (const forbidden of [
      "force",
      "ignoreFingerprint",
      "skipValidation",
      "commitAnyway",
      "pushForce",
      "acceptCurrentState",
    ]) {
      assert.ok(
        !new RegExp(`\\b${forbidden}\\b`, "iu").test(text),
        `« ${forbidden} » ne doit pas exister`,
      );
    }
  });

  it("le modele de lecture n'ecrit ni ne livre", async () => {
    // Ouvrir la surface de livraison ne doit jamais rien ecrire : ni dans Git,
    // ni en base. Le seul appel au runner est l'inspection, en lecture seule.
    const text = code(await source("delivery-view.ts"));
    for (const forbidden of [
      "commitDelivery",
      "pushDelivery",
      "reserveGitDelivery",
      "claimDelivery",
      "recordDeliveryCommit",
      "recordDeliveryPush",
      "runDelivery",
      "prepareDelivery",
    ]) {
      assert.ok(!text.includes(forbidden), `« ${forbidden} » ne doit pas apparaitre`);
    }
    assert.ok(text.includes("inspectDelivery"));
  });

  it("l'affichage ne decide de rien", async () => {
    const text = code(await source("delivery-display.ts"));
    for (const forbidden of [
      "@nox/database",
      "runner/client",
      "child_process",
      "fetch(",
      "await ",
    ]) {
      assert.ok(!text.includes(forbidden), `« ${forbidden} » ne doit pas apparaitre`);
    }
  });
});

describe("aucune IA dans la livraison", () => {
  it("le moteur n'appelle aucun fournisseur", async () => {
    const text = code(await source("git-delivery.ts"));
    for (const forbidden of [
      "OpenAI",
      "openai",
      "generateTurn",
      "generateBacklog",
      "NOX_OPENAI_API_KEY",
      "architect",
      "startClaudeRun",
      "launchCorrection",
    ]) {
      assert.ok(!text.includes(forbidden), `« ${forbidden} » ne doit pas apparaitre`);
    }
  });

  it("aucune decision de livraison n'est demandee a un modele", async () => {
    // Les imports vers `../claude/` sont ecartes : le module y prend le filtre
    // d'environnement et le nettoyeur de sorties, deux primitives partagees qui
    // n'appellent aucun modele.
    const runnerText = code(await readFile(path.join(RUNNER, "git-delivery.ts"), "utf8"))
      .split(LINE_BREAK)
      .filter((line) => !line.trimStart().startsWith("import "))
      .join(" ")
      .toLowerCase();
    for (const forbidden of ["openai", "anthropic", "claude", "startclauderun"]) {
      assert.ok(!runnerText.includes(forbidden), forbidden);
    }
  });
});

describe("aucun secret transmis a Git", () => {
  it("l'environnement est privé de toute variable NOX_*", async () => {
    const text = code(await readFile(path.join(RUNNER, "git-delivery.ts"), "utf8"));
    assert.ok(text.includes("sanitizeEnvironment("));
  });

  it("les sorties passent par la sanitation centralisee", async () => {
    // Chemins du repository rendus relatifs, chemins exterieurs masques,
    // variables `NOX_*` retirees, taille bornee — et, propre a Git, les
    // identifiants inscrits dans une URL de remote.
    const text = code(await readFile(path.join(RUNNER, "git-delivery.ts"), "utf8"));
    assert.ok(text.includes("createEventSanitizer("));
    assert.ok(text.includes("REMOTE_CREDENTIALS_PLACEHOLDER"));
  });

  it("Git ne peut jamais devenir interactif", async () => {
    const text = code(await readFile(path.join(RUNNER, "git-delivery.ts"), "utf8"));
    assert.ok(text.includes("GIT_TERMINAL_PROMPT"));
    assert.ok(text.includes("GIT_ASKPASS"));
    assert.ok(text.includes("SSH_ASKPASS"));
  });

  it("aucune table de credentials n'est declaree", async () => {
    const schema = await readFile(
      path.join(HERE, "..", "..", "..", "packages", "database", "prisma", "schema.prisma"),
      "utf8",
    );
    for (const forbidden of ["model GitCredential", "model GitToken", "model SSHKey"]) {
      assert.ok(!schema.includes(forbidden), forbidden);
    }
  });
});

describe("le declenchement", () => {
  it("vient de la transition d'une tache, jamais d'un rendu", async () => {
    // `maybeDeliver` est appele par `applyTaskTransition`, sur `COMPLETED`. Une
    // page qui l'appellerait rendrait un rafraichissement capable d'ecrire dans
    // Git.
    const lifecycle = code(await source("task-lifecycle.ts"));
    assert.ok(lifecycle.includes("maybeDeliver"));
    assert.ok(lifecycle.includes("TASK_STATUS.COMPLETED"));
  });

  it("la file lit la livraison, elle ne la declenche pas", async () => {
    const queue = code(await source("queue.ts"));
    assert.ok(queue.includes("getBlockingDelivery"));
    for (const forbidden of ["maybeDeliver", "runDelivery", "prepareDelivery", "commitDelivery"]) {
      assert.ok(!queue.includes(forbidden), `« ${forbidden} » ne doit pas apparaitre`);
    }
  });
});
