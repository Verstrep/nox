/**
 * Tests du contrat web <-> runner pour la livraison Git.
 *
 * Ce que ces tests protegent tient en une phrase : **aucun argument Git ne peut
 * traverser ce contrat**. Un corps qui porterait un chemin absolu, une remontee
 * `..`, un message sans trailer ou une liste vide doit etre refuse ici — avant
 * d'atteindre le module qui invoque reellement Git.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DELIVERY_LIMITS,
  isDeliveryCommitSuccess,
  isDeliveryInspectSuccess,
  isDeliveryPushSuccess,
  parseDeliveryCommitRequest,
  parseDeliveryInspectRequest,
  parseDeliveryPushRequest,
} from "../dist/index.js";

const HEAD = "a".repeat(40);
const FINGERPRINT = "b".repeat(64);

function commitBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    repositoryPath: "/depot",
    expectedBranch: "main",
    expectedHead: HEAD,
    expectedFingerprint: FINGERPRINT,
    paths: ["src/app.ts"],
    message: "TASK-001: titre\n\nNOX-Delivery: abc\n",
    trailer: "NOX-Delivery: abc",
    ...overrides,
  };
}

describe("inspection", () => {
  it("accepte un corps minimal", () => {
    assert.deepEqual(parseDeliveryInspectRequest({ repositoryPath: "/depot" }), {
      repositoryPath: "/depot",
    });
  });

  it("accepte un trailer facultatif", () => {
    assert.deepEqual(
      parseDeliveryInspectRequest({ repositoryPath: "/depot", trailer: "NOX-Delivery: x" }),
      { repositoryPath: "/depot", trailer: "NOX-Delivery: x" },
    );
  });

  it("refuse un corps sans repository", () => {
    assert.equal(parseDeliveryInspectRequest({}), null);
    assert.equal(parseDeliveryInspectRequest({ repositoryPath: "   " }), null);
    assert.equal(parseDeliveryInspectRequest(null), null);
  });

  it("reconnait une reponse d'inspection", () => {
    assert.equal(
      isDeliveryInspectSuccess({
        ok: true,
        inspection: {
          branch: "main",
          head: HEAD,
          headParents: [],
          headTrailerMatches: false,
          upstreamRemote: null,
          upstreamRef: null,
          upstreamCommit: null,
          indexDirty: false,
          entries: [{ code: " M", path: "src/app.ts" }],
          omittedEntries: 0,
          fingerprint: FINGERPRINT,
          identityComplete: true,
          signingConfigured: false,
          hooks: [],
        },
      }),
      true,
    );
  });

  it("refuse une inspection dont une entree porte un chemin absolu", () => {
    // Aucun chemin absolu de la machine ne doit jamais atteindre le serveur web,
    // donc encore moins le navigateur.
    assert.equal(
      isDeliveryInspectSuccess({
        ok: true,
        inspection: {
          branch: "main",
          head: HEAD,
          headParents: [],
          headTrailerMatches: false,
          upstreamRemote: null,
          upstreamRef: null,
          upstreamCommit: null,
          indexDirty: false,
          entries: [{ code: " M", path: "C:/depot/src/app.ts" }],
          omittedEntries: 0,
          fingerprint: FINGERPRINT,
          identityComplete: true,
          signingConfigured: false,
          hooks: [],
        },
      }),
      false,
    );
  });
});

describe("commit", () => {
  it("accepte un corps complet", () => {
    const parsed = parseDeliveryCommitRequest(commitBody());
    assert.notEqual(parsed, null);
    assert.deepEqual(parsed?.paths, ["src/app.ts"]);
  });

  it("refuse un chemin absolu ou une remontee", () => {
    for (const bad of ["/etc/passwd", "C:/secrets.txt", "../voisin/app.ts", "a/../../b"]) {
      assert.equal(parseDeliveryCommitRequest(commitBody({ paths: [bad] })), null, bad);
    }
  });

  it("refuse une liste de chemins vide ou trop longue", () => {
    assert.equal(parseDeliveryCommitRequest(commitBody({ paths: [] })), null);
    const tooMany = Array.from({ length: DELIVERY_LIMITS.maxEntries + 1 }, (_, index) =>
      `src/f${String(index)}.ts`,
    );
    assert.equal(parseDeliveryCommitRequest(commitBody({ paths: tooMany })), null);
  });

  it("refuse un message qui ne porte pas le trailer", () => {
    // Sans cette verification, une reprise apres panne ne saurait plus
    // reconnaitre son propre commit, et en creerait un second.
    assert.equal(
      parseDeliveryCommitRequest(commitBody({ message: "TASK-001: titre\n" })),
      null,
    );
  });

  it("refuse une empreinte ou un HEAD mal formes", () => {
    assert.equal(parseDeliveryCommitRequest(commitBody({ expectedHead: "abc" })), null);
    assert.equal(parseDeliveryCommitRequest(commitBody({ expectedFingerprint: "zz" })), null);
  });

  it("ignore tout champ etranger au contrat", () => {
    // Un `--force`, un `--no-verify` ou un `env` glisses dans la requete n'ont
    // aucune facon d'atteindre la suite : ils ne sont pas lus.
    const parsed = parseDeliveryCommitRequest(
      commitBody({ force: true, noVerify: true, env: { PATH: "/evil" }, shell: true }),
    );
    assert.notEqual(parsed, null);
    assert.deepEqual(Object.keys(parsed ?? {}).sort(), [
      "expectedBranch",
      "expectedFingerprint",
      "expectedHead",
      "message",
      "paths",
      "repositoryPath",
      "trailer",
    ]);
  });

  it("reconnait une reponse de commit, echec compris", () => {
    assert.equal(
      isDeliveryCommitSuccess({
        ok: true,
        commitSha: HEAD,
        alreadyCommitted: false,
        worktreeClean: true,
        failureCode: null,
        failureDetail: null,
      }),
      true,
    );
    assert.equal(
      isDeliveryCommitSuccess({
        ok: true,
        commitSha: null,
        alreadyCommitted: false,
        worktreeClean: false,
        failureCode: "DELIVERY_COMMIT_FAILED",
        failureDetail: "hook refuse",
      }),
      true,
    );
  });
});

describe("push", () => {
  it("accepte un corps minimal", () => {
    assert.deepEqual(
      parseDeliveryPushRequest({
        repositoryPath: "/depot",
        expectedBranch: "main",
        expectedHead: HEAD,
      }),
      { repositoryPath: "/depot", expectedBranch: "main", expectedHead: HEAD },
    );
  });

  it("ne porte ni remote, ni URL, ni refspec", () => {
    // La destination est lue par le runner dans la configuration de la branche :
    // aucun appelant ne peut faire pousser NOX ailleurs.
    const parsed = parseDeliveryPushRequest({
      repositoryPath: "/depot",
      expectedBranch: "main",
      expectedHead: HEAD,
      remote: "attaquant",
      url: "https://exemple.invalid/depot.git",
      refspec: "+HEAD:refs/heads/main",
      force: true,
    });
    assert.deepEqual(Object.keys(parsed ?? {}).sort(), [
      "expectedBranch",
      "expectedHead",
      "repositoryPath",
    ]);
  });

  it("refuse un HEAD mal forme", () => {
    assert.equal(
      parseDeliveryPushRequest({
        repositoryPath: "/depot",
        expectedBranch: "main",
        expectedHead: "HEAD",
      }),
      null,
    );
  });

  it("reconnait une reponse de push, refus distant compris", () => {
    assert.equal(
      isDeliveryPushSuccess({
        ok: true,
        pushed: false,
        alreadyPushed: false,
        remote: "origin",
        remoteRef: "refs/heads/main",
        failureCode: "DELIVERY_PUSH_REJECTED",
        failureDetail: "non-fast-forward",
      }),
      true,
    );
  });
});
