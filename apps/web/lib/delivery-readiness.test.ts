/**
 * Ce que « le repository est-il pret ? » veut dire, selon la politique du projet.
 *
 * ## Deux questions, jamais une seule
 *
 * « Ce repository peut-il recevoir une autre tache ? » et « la livraison Git du
 * travail precedent est-elle satisfaite ? » sont deux questions differentes. Les
 * confondre a un cout precis, et TASK-031 l'a paye : sous `AUTO_COMMIT`, NOX
 * commite le travail valide et ne le pousse pas, donc la branche locale reste
 * **en avance** sur son upstream. Traiter cette avance comme un defaut de
 * synchronisation arretait la file apres la premiere tache, alors que le
 * repository etait parfaitement relisible.
 *
 * ## Pourquoi ce fichier lit des sources
 *
 * La garantie qui compte ici est une provenance : la politique doit venir de la
 * **base**, jamais d'un formulaire. Une provenance ne se voit pas en lisant un
 * resultat — elle se perd le jour ou quelqu'un ajoute un champ au corps d'une
 * Server Action « pour eviter une requete ».
 *
 * Le comportement, lui, est verifie ailleurs : `claude/preflight.test.ts` sur de
 * vrais repositories, `claude/runs.test.ts` juste avant le spawn, et les tests
 * fonctionnels de bout en bout.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DELIVERY_POLICIES,
  DELIVERY_POLICY,
  DELIVERY_STATUS,
  deliverySatisfied,
  policyAllowsLocalAhead,
} from "@nox/shared";

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function source(file: string): Promise<string> {
  return readFile(path.join(HERE, file), "utf8");
}

/** Le code seul : les entetes nomment ce qu'ils refusent, et c'est voulu. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/\/\/.*$/gmu, " ");
}

describe("la readiness d'un repository depend de la politique du projet", () => {
  it("seule AUTO_COMMIT tolere une branche locale en avance", () => {
    assert.equal(policyAllowsLocalAhead(DELIVERY_POLICY.AUTO_COMMIT), true);
    assert.equal(policyAllowsLocalAhead(DELIVERY_POLICY.MANUAL), false);
    assert.equal(policyAllowsLocalAhead(DELIVERY_POLICY.AUTO_COMMIT_PUSH), false);
  });

  it("ne confond pas readiness et satisfaction de la livraison", () => {
    // `AUTO_COMMIT` + `COMMITTED` : la politique est satisfaite **et** la branche
    // est en avance. Si la premiere question empruntait sa reponse a la seconde,
    // ou l'inverse, l'un des deux cas ci-dessous basculerait.
    assert.equal(deliverySatisfied(DELIVERY_POLICY.AUTO_COMMIT, DELIVERY_STATUS.COMMITTED), true);
    assert.equal(
      deliverySatisfied(DELIVERY_POLICY.AUTO_COMMIT_PUSH, DELIVERY_STATUS.COMMITTED),
      false,
    );
    assert.equal(policyAllowsLocalAhead(DELIVERY_POLICY.AUTO_COMMIT), true);
    assert.equal(policyAllowsLocalAhead(DELIVERY_POLICY.AUTO_COMMIT_PUSH), false);
  });

  it("n'a que trois politiques, et aucun troisieme etat intermediaire", () => {
    assert.equal(DELIVERY_POLICIES.length, 3);
    assert.equal(DELIVERY_POLICIES.filter(policyAllowsLocalAhead).length, 1);
  });
});

describe("la politique vient de la base, jamais du navigateur", () => {
  it("chaque sonde de repository relit la politique du projet", async () => {
    // Une sonde qui l'oublierait annoncerait un blocage la ou la file avance —
    // ou, pire, l'inverse.
    for (const file of [
      "queue.ts",
      "projects.ts",
      "runs.ts",
      "guided-workflow.ts",
      "run-launch.ts",
      "correction-launch.ts",
    ]) {
      const text = code(await source(file));
      assert.ok(
        text.includes("readProjectDeliveryPolicy("),
        `${file} doit relire la politique en base`,
      );
    }
  });

  it("aucune Server Action ne recoit une politique de readiness", async () => {
    // Le navigateur transmet des identifiants. Une politique recue serait un
    // droit d'ecriture Git offert a un formulaire — et le seul endroit ou elle
    // se choisit reste l'ecran des reglages, qui appelle `setProjectDeliveryPolicy`.
    for (const file of ["run-launch.ts", "correction-launch.ts", "queue.ts"]) {
      const text = code(await source(file));
      for (const forbidden of [
        "input.deliveryPolicy",
        "formData.get(\"deliveryPolicy\")",
        "requireUpstreamSync",
        "allowAhead",
        "skipSyncCheck",
        "ignoreAhead",
      ]) {
        assert.ok(!text.includes(forbidden), `${forbidden} ne doit pas exister dans ${file}`);
      }
    }
  });

  it("le preflight du runner n'a aucune option de forcage", async () => {
    const text = code(
      await readFile(
        path.join(HERE, "..", "..", "runner", "src", "claude", "preflight.ts"),
        "utf8",
      ),
    );

    // La politique assouplit **une** chose, nommee. Elle n'ouvre pas une porte
    // generique par laquelle un appelant pourrait desactiver les autres controles.
    for (const forbidden of ["force", "override", "skipGit", "ignoreDirty", "allowDirty"]) {
      assert.ok(!text.includes(forbidden), `${forbidden} ne doit pas exister dans preflight.ts`);
    }

    // Et le dossier de travail sale reste refuse sans condition : la garde n'est
    // pas rendue dependante de la politique.
    assert.ok(text.includes("REPOSITORY_DIRTY"), "le refus d'un depot sale existe toujours");
    assert.ok(
      !/deliveryPolicy[\s\S]{0,200}REPOSITORY_DIRTY/u.test(text),
      "la proprete du dossier de travail ne depend d'aucune politique",
    );
  });
});
