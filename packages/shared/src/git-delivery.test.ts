/**
 * Tests du vocabulaire et de la decision de livraison Git.
 *
 * Ce module est pur : aucun de ces tests n'ouvre un repository, ne lance Git, ni
 * n'ecrit quoi que ce soit. Ce qui est verifie ici est ce qui **decide** — et
 * une decision qui laisserait passer un repository divergent ne se rattraperait
 * nulle part ailleurs.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  DELIVERY_LIMITS,
  DELIVERY_POLICIES,
  DELIVERY_POLICY,
  DELIVERY_REFUSAL,
  DELIVERY_STATUS,
  DELIVERY_STATUSES,
  DELIVERY_TRAILER_KEY,
  DELIVERY_TRIGGER,
  buildDeliveryCommitMessage,
  candidatePaths,
  checkDeliveryEligibility,
  checkDeliveryPush,
  checkDeliveryWrite,
  deliveryHasCommit,
  deliverySatisfied,
  deliverySubject,
  deliveryTrailer,
  isDeliveryPolicy,
  isUntrackedEntry,
  policyAllowsAutomatic,
  policyAllowsLocalAhead,
  policyRequiresPush,
  readDeliveryPolicy,
  readDeliveryStatus,
  readDeliveryTrigger,
  reconcilesExistingCommit,
  reconcilesExistingPush,
  sensitiveNewPaths,
  type DeliveryWriteFacts,
} from "../dist/index.js";

const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));

describe("politique de livraison", () => {
  it("expose exactement trois modes", () => {
    assert.deepEqual([...DELIVERY_POLICIES], ["MANUAL", "AUTO_COMMIT", "AUTO_COMMIT_PUSH"]);
  });

  it("retombe sur MANUAL pour toute valeur illisible", () => {
    // Le defaut sur n'accorde rien : une politique qu'on ne sait pas lire ne
    // doit jamais ouvrir un droit d'ecriture dans Git.
    for (const value of [null, undefined, "", "AUTO", "auto_commit", "FORCE"]) {
      assert.equal(readDeliveryPolicy(value), DELIVERY_POLICY.MANUAL);
    }
  });

  it("reconnait les trois modes", () => {
    for (const policy of DELIVERY_POLICIES) {
      assert.ok(isDeliveryPolicy(policy));
      assert.equal(readDeliveryPolicy(policy), policy);
    }
  });

  it("distingue ce qui autorise un automatisme de ce qui exige un push", () => {
    assert.equal(policyAllowsAutomatic(DELIVERY_POLICY.MANUAL), false);
    assert.equal(policyAllowsAutomatic(DELIVERY_POLICY.AUTO_COMMIT), true);
    assert.equal(policyAllowsAutomatic(DELIVERY_POLICY.AUTO_COMMIT_PUSH), true);

    assert.equal(policyRequiresPush(DELIVERY_POLICY.AUTO_COMMIT), false);
    assert.equal(policyRequiresPush(DELIVERY_POLICY.AUTO_COMMIT_PUSH), true);
  });

  it("ne tolere une branche locale en avance que sous AUTO_COMMIT", () => {
    // `AUTO_COMMIT` commite et ne pousse pas : une branche en avance y est
    // l'etat normal apres chaque tache validee. `MANUAL` n'ecrit rien, et
    // `AUTO_COMMIT_PUSH` n'est satisfaite qu'une fois le commit pousse : chez
    // elles, une branche en avance reste le refus historique.
    assert.equal(policyAllowsLocalAhead(DELIVERY_POLICY.MANUAL), false);
    assert.equal(policyAllowsLocalAhead(DELIVERY_POLICY.AUTO_COMMIT), true);
    assert.equal(policyAllowsLocalAhead(DELIVERY_POLICY.AUTO_COMMIT_PUSH), false);
  });

  it("distingue la lisibilite du repository de la satisfaction de la livraison", () => {
    // Deux questions differentes, et le bug de TASK-031 venait de les avoir
    // fondues : `AUTO_COMMIT` + `COMMITTED` satisfait la politique **et** laisse
    // une branche en avance. Si la seconde question repondait « non », la file
    // s'arreterait apres chaque tache alors que tout est en ordre.
    assert.equal(deliverySatisfied(DELIVERY_POLICY.AUTO_COMMIT, DELIVERY_STATUS.COMMITTED), true);
    assert.equal(policyAllowsLocalAhead(DELIVERY_POLICY.AUTO_COMMIT), true);
  });
});

describe("satisfaction d'une politique", () => {
  it("ne confond jamais commit et push", () => {
    // Le coeur de la distinction : `AUTO_COMMIT` est satisfait des `COMMITTED`,
    // `AUTO_COMMIT_PUSH` seulement apres `DELIVERED`. Les fondre ferait avancer
    // la file d'un projet dont le travail n'est jamais parti.
    assert.equal(deliverySatisfied(DELIVERY_POLICY.AUTO_COMMIT, DELIVERY_STATUS.COMMITTED), true);
    assert.equal(
      deliverySatisfied(DELIVERY_POLICY.AUTO_COMMIT_PUSH, DELIVERY_STATUS.COMMITTED),
      false,
    );
    assert.equal(
      deliverySatisfied(DELIVERY_POLICY.AUTO_COMMIT_PUSH, DELIVERY_STATUS.DELIVERED),
      true,
    );
  });

  it("n'est jamais satisfaite en mode manuel", () => {
    // `MANUAL` confie la question au preflight Git existant : c'est ce qui
    // permet a un utilisateur qui prefere son terminal de continuer a
    // travailler sans que NOX ait rien ecrit.
    for (const status of DELIVERY_STATUSES) {
      assert.equal(deliverySatisfied(DELIVERY_POLICY.MANUAL, status), false);
    }
  });

  it("retombe sur BLOCKED pour un statut illisible", () => {
    assert.equal(readDeliveryStatus("EN_COURS"), DELIVERY_STATUS.BLOCKED);
    assert.equal(readDeliveryStatus(null), DELIVERY_STATUS.BLOCKED);
    // Et un statut illisible ne fait avancer aucune file.
    assert.equal(deliverySatisfied(DELIVERY_POLICY.AUTO_COMMIT, readDeliveryStatus("?")), false);
  });

  it("reconnait les etats qui portent un commit local", () => {
    assert.equal(deliveryHasCommit(DELIVERY_STATUS.PENDING), false);
    assert.equal(deliveryHasCommit(DELIVERY_STATUS.COMMITTING), false);
    assert.equal(deliveryHasCommit(DELIVERY_STATUS.COMMITTED), true);
    assert.equal(deliveryHasCommit(DELIVERY_STATUS.PUSHING), true);
    assert.equal(deliveryHasCommit(DELIVERY_STATUS.DELIVERED), true);
  });

  it("retombe sur MANUAL pour un declencheur illisible", () => {
    assert.equal(readDeliveryTrigger("ROBOT"), DELIVERY_TRIGGER.MANUAL);
  });
});

describe("candidat", () => {
  const candidate = [
    { code: "??", path: "src/new.ts" },
    { code: " M", path: "src/app.ts" },
    { code: " D", path: "src/old.ts" },
    { code: " M", path: "src/app.ts" },
  ];

  it("rend des chemins tries et sans doublon", () => {
    assert.deepEqual(candidatePaths(candidate), ["src/app.ts", "src/new.ts", "src/old.ts"]);
  });

  it("distingue un fichier nouveau d'un fichier suivi", () => {
    assert.equal(isUntrackedEntry({ code: "??", path: "a" }), true);
    assert.equal(isUntrackedEntry({ code: " M", path: "a" }), false);
  });

  it("ne signale que les fichiers sensibles reellement nouveaux", () => {
    // Un `.env` deja suivi releve du contrat Git reel du repository : il est
    // deja dans l'historique, et le retirer du commit ne l'en retirerait pas.
    const paths = sensitiveNewPaths([
      { code: "??", path: ".env" },
      { code: "??", path: "config/service.pem" },
      { code: " M", path: ".env.production" },
      { code: "??", path: ".env.example" },
      { code: "??", path: "src/app.ts" },
    ]);
    assert.deepEqual(paths, [".env", "config/service.pem"]);
  });
});

describe("message de commit", () => {
  it("porte le code de la tache et un trailer deterministe", () => {
    const message = buildDeliveryCommitMessage({
      taskCode: "TASK-003",
      title: "Generate shopping list",
      deliveryId: "abc123",
    });
    assert.equal(message.split("\n")[0], "TASK-003: Generate shopping list");
    assert.ok(message.includes(`${DELIVERY_TRAILER_KEY}: abc123`));
    assert.equal(deliveryTrailer("abc123"), "NOX-Delivery: abc123");
  });

  it("est identique pour la meme livraison", () => {
    // Une reprise apres panne doit commiter exactement le meme texte, sinon le
    // trailer ne prouverait plus quel commit appartient a quelle livraison.
    const input = { taskCode: "TASK-003", title: "Titre", deliveryId: "abc" };
    assert.equal(buildDeliveryCommitMessage(input), buildDeliveryCommitMessage(input));
  });

  it("ramene un titre a une seule ligne", () => {
    const subject = deliverySubject("TASK-001", "Ligne\nsuivante\ttabulee");
    assert.equal(subject.includes("\n"), false);
    assert.equal(subject, "TASK-001: Ligne suivante tabulee");
  });

  it("borne le sujet sans le couper au milieu d'un mot", () => {
    const subject = deliverySubject("TASK-001", "mot ".repeat(80).trim());
    assert.ok(subject.length <= DELIVERY_LIMITS.subject);
    assert.ok(subject.endsWith("…"));
  });

  it("reste lisible pour un titre vide", () => {
    assert.equal(deliverySubject("TASK-007", "   "), "TASK-007: livraison du travail valide");
  });
});

describe("eligibilite", () => {
  it("refuse une tache non terminee", () => {
    const decision = checkDeliveryEligibility({
      taskCompleted: false,
      hasCompletionDecision: true,
      runCompleted: true,
    });
    assert.deepEqual(decision, {
      eligible: false,
      code: DELIVERY_REFUSAL.TASK_NOT_COMPLETED,
    });
  });

  it("refuse une tache terminee sans execution validee", () => {
    // Un `Mark done` a la main n'a ni run, ni review : il n'existe alors aucun
    // travail valide, et commiter ce qui traine serait une invention.
    const decision = checkDeliveryEligibility({
      taskCompleted: true,
      hasCompletionDecision: false,
      runCompleted: false,
    });
    assert.deepEqual(decision, {
      eligible: false,
      code: DELIVERY_REFUSAL.NO_COMPLETION_RUN,
    });
  });

  it("accepte une tache terminee avec une decision sur une execution reussie", () => {
    assert.deepEqual(
      checkDeliveryEligibility({
        taskCompleted: true,
        hasCompletionDecision: true,
        runCompleted: true,
      }),
      { eligible: true },
    );
  });
});

/** Un etat valide, que chaque test degrade sur un seul point. */
function writeFacts(overrides: Partial<DeliveryWriteFacts> = {}): DeliveryWriteFacts {
  return {
    policy: DELIVERY_POLICY.AUTO_COMMIT,
    trigger: DELIVERY_TRIGGER.AUTOMATIC,
    status: DELIVERY_STATUS.PENDING,
    requiresPush: false,
    detached: false,
    branch: "main",
    expectedBranch: "main",
    head: "a".repeat(40),
    expectedHead: "a".repeat(40),
    fingerprintMatches: true,
    indexDirty: false,
    entryCount: 3,
    sensitiveAdditions: [],
    identityComplete: true,
    signingConfigured: false,
    hooksConfigured: false,
    upstream: { remote: "origin", ref: "refs/heads/main" },
    expectedUpstream: { remote: "origin", ref: "refs/heads/main" },
    ...overrides,
  };
}

describe("decision d'ecriture", () => {
  it("autorise un etat exact", () => {
    assert.deepEqual(checkDeliveryWrite(writeFacts()), { ok: true });
  });

  it("refuse une politique manuelle a un declencheur automatique", () => {
    const decision = checkDeliveryWrite(
      writeFacts({ policy: DELIVERY_POLICY.MANUAL, trigger: DELIVERY_TRIGGER.AUTOMATIC }),
    );
    assert.deepEqual(decision, { ok: false, code: DELIVERY_REFUSAL.POLICY_MANUAL });
  });

  it("laisse un humain livrer un projet manuel", () => {
    // Manuel ne veut pas dire « interdit » : il veut dire « c'est vous qui
    // declenchez ». Toutes les autres gardes restent en place.
    assert.deepEqual(
      checkDeliveryWrite(
        writeFacts({ policy: DELIVERY_POLICY.MANUAL, trigger: DELIVERY_TRIGGER.MANUAL }),
      ),
      { ok: true },
    );
  });

  it("refuse un repository qui a divergé", () => {
    assert.deepEqual(checkDeliveryWrite(writeFacts({ fingerprintMatches: false })), {
      ok: false,
      code: DELIVERY_REFUSAL.REPOSITORY_CHANGED,
    });
  });

  it("refuse un index deja garni", () => {
    assert.deepEqual(checkDeliveryWrite(writeFacts({ indexDirty: true })), {
      ok: false,
      code: DELIVERY_REFUSAL.INDEX_NOT_EMPTY,
    });
  });

  it("refuse un HEAD detache, et ne change jamais de branche", () => {
    assert.deepEqual(checkDeliveryWrite(writeFacts({ detached: true, branch: "" })), {
      ok: false,
      code: DELIVERY_REFUSAL.DETACHED_HEAD,
    });
  });

  it("refuse une branche differente", () => {
    assert.deepEqual(checkDeliveryWrite(writeFacts({ branch: "feature" })), {
      ok: false,
      code: DELIVERY_REFUSAL.BRANCH_CHANGED,
    });
  });

  it("refuse un HEAD qui a avance", () => {
    assert.deepEqual(checkDeliveryWrite(writeFacts({ head: "b".repeat(40) })), {
      ok: false,
      code: DELIVERY_REFUSAL.HEAD_CHANGED,
    });
  });

  it("refuse un dossier de travail propre", () => {
    assert.deepEqual(checkDeliveryWrite(writeFacts({ entryCount: 0 })), {
      ok: false,
      code: DELIVERY_REFUSAL.NOTHING_TO_COMMIT,
    });
  });

  it("refuse un candidat plus large que la borne", () => {
    assert.deepEqual(
      checkDeliveryWrite(writeFacts({ entryCount: DELIVERY_LIMITS.maxEntries + 1 })),
      { ok: false, code: DELIVERY_REFUSAL.TOO_MANY_ENTRIES },
    );
  });

  it("refuse un fichier sensible nouveau, meme pour un humain", () => {
    // La garde ne depend ni de la politique, ni du declencheur : « manuel » ne
    // veut jamais dire « les gardes de securite sont desactivees ».
    assert.deepEqual(
      checkDeliveryWrite(writeFacts({ sensitiveAdditions: [".env"] })),
      { ok: false, code: DELIVERY_REFUSAL.SENSITIVE_PATH },
    );
    assert.deepEqual(
      checkDeliveryWrite(
        writeFacts({
          trigger: DELIVERY_TRIGGER.MANUAL,
          policy: DELIVERY_POLICY.MANUAL,
          sensitiveAdditions: [".env"],
        }),
      ),
      { ok: false, code: DELIVERY_REFUSAL.SENSITIVE_PATH },
    );
  });

  it("refuse une identite Git absente", () => {
    assert.deepEqual(checkDeliveryWrite(writeFacts({ identityComplete: false })), {
      ok: false,
      code: DELIVERY_REFUSAL.GIT_IDENTITY_MISSING,
    });
  });

  it("fait renoncer l'automatique devant une signature ou un hook", () => {
    // NOX ne desactive jamais ces protections. Quand personne ne regarde, il
    // renonce ; un geste humain, lui, reste possible et le hook s'executera.
    assert.deepEqual(checkDeliveryWrite(writeFacts({ signingConfigured: true })), {
      ok: false,
      code: DELIVERY_REFUSAL.SIGNING_CONFIGURED,
    });
    assert.deepEqual(checkDeliveryWrite(writeFacts({ hooksConfigured: true })), {
      ok: false,
      code: DELIVERY_REFUSAL.HOOKS_CONFIGURED,
    });
    assert.deepEqual(
      checkDeliveryWrite(
        writeFacts({
          trigger: DELIVERY_TRIGGER.MANUAL,
          signingConfigured: true,
          hooksConfigured: true,
        }),
      ),
      { ok: true },
    );
  });

  it("verifie l'upstream avant de creer le commit", () => {
    // Sans cette verification, une politique `AUTO_COMMIT_PUSH` creerait un
    // commit local qu'elle savait ne pas pouvoir pousser — donc un preflight en
    // echec, donc une file arretee.
    assert.deepEqual(checkDeliveryWrite(writeFacts({ requiresPush: true, upstream: null })), {
      ok: false,
      code: DELIVERY_REFUSAL.UPSTREAM_MISSING,
    });
    // Sans push exige, l'absence d'upstream n'empeche rien.
    assert.deepEqual(checkDeliveryWrite(writeFacts({ requiresPush: false, upstream: null })), {
      ok: true,
    });
  });

  it("refuse un upstream qui a change", () => {
    assert.deepEqual(
      checkDeliveryWrite(
        writeFacts({
          requiresPush: true,
          upstream: { remote: "fork", ref: "refs/heads/main" },
        }),
      ),
      { ok: false, code: DELIVERY_REFUSAL.UPSTREAM_CHANGED },
    );
  });

  it("ne cree jamais un second commit", () => {
    for (const status of [
      DELIVERY_STATUS.COMMITTED,
      DELIVERY_STATUS.PUSHING,
      DELIVERY_STATUS.DELIVERED,
    ]) {
      assert.deepEqual(checkDeliveryWrite(writeFacts({ status })), {
        ok: false,
        code: DELIVERY_REFUSAL.ALREADY_DELIVERED,
      });
    }
  });
});

describe("decision de push", () => {
  const base = {
    status: DELIVERY_STATUS.COMMITTED,
    detached: false,
    branch: "main",
    expectedBranch: "main",
    head: "c".repeat(40),
    commitSha: "c".repeat(40),
    upstream: { remote: "origin", ref: "refs/heads/main" },
    expectedUpstream: { remote: "origin", ref: "refs/heads/main" },
  };

  it("autorise un commit local intact", () => {
    assert.deepEqual(checkDeliveryPush(base), { ok: true });
  });

  it("refuse quand aucun commit n'a ete cree", () => {
    assert.deepEqual(
      checkDeliveryPush({ ...base, status: DELIVERY_STATUS.PENDING, commitSha: null }),
      { ok: false, code: DELIVERY_REFUSAL.NOTHING_TO_PUSH },
    );
  });

  it("refuse quand HEAD n'est plus le commit de la livraison", () => {
    assert.deepEqual(checkDeliveryPush({ ...base, head: "d".repeat(40) }), {
      ok: false,
      code: DELIVERY_REFUSAL.HEAD_CHANGED,
    });
  });

  it("ne repousse pas une livraison deja delivree", () => {
    assert.deepEqual(checkDeliveryPush({ ...base, status: DELIVERY_STATUS.DELIVERED }), {
      ok: false,
      code: DELIVERY_REFUSAL.ALREADY_DELIVERED,
    });
  });

  it("refuse un upstream absent", () => {
    assert.deepEqual(checkDeliveryPush({ ...base, upstream: null }), {
      ok: false,
      code: DELIVERY_REFUSAL.UPSTREAM_MISSING,
    });
  });
});

describe("reconciliation", () => {
  it("reconnait un commit deja cree par cette livraison", () => {
    assert.equal(
      reconcilesExistingCommit({
        headTrailerMatches: true,
        headParents: ["a".repeat(40)],
        expectedHead: "a".repeat(40),
      }),
      true,
    );
  });

  it("exige le trailer **et** le parent attendu", () => {
    // Le trailer seul pourrait venir d'un `cherry-pick` : la place compte autant
    // que l'intention.
    assert.equal(
      reconcilesExistingCommit({
        headTrailerMatches: true,
        headParents: ["z".repeat(40)],
        expectedHead: "a".repeat(40),
      }),
      false,
    );
    assert.equal(
      reconcilesExistingCommit({
        headTrailerMatches: false,
        headParents: ["a".repeat(40)],
        expectedHead: "a".repeat(40),
      }),
      false,
    );
  });

  it("refuse un commit de fusion", () => {
    assert.equal(
      reconcilesExistingCommit({
        headTrailerMatches: true,
        headParents: ["a".repeat(40), "b".repeat(40)],
        expectedHead: "a".repeat(40),
      }),
      false,
    );
  });

  it("reconnait un push deja abouti", () => {
    assert.equal(
      reconcilesExistingPush({ trackingRef: "c".repeat(40), commitSha: "c".repeat(40) }),
      true,
    );
    assert.equal(reconcilesExistingPush({ trackingRef: null, commitSha: "c".repeat(40) }), false);
  });
});

describe("aucune porte derobee", () => {
  it("ne declare aucun parametre de forcage", async () => {
    // La garantie est structurelle : un `force`, un `ignoreFingerprint` ou un
    // `commitAnyway` glisses ici videraient TASK-029 de son contenu. Le test lit
    // la **source**, parce que c'est la que la porte serait ouverte.
    const source = await readFile(path.join(SOURCE_DIR, "git-delivery.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");

    for (const forbidden of [
      "force",
      "ignoreFingerprint",
      "skipValidation",
      "commitAnyway",
      "pushForce",
      "override",
    ]) {
      assert.equal(
        new RegExp(`\\b${forbidden}\\b`, "iu").test(code),
        false,
        `« ${forbidden} » ne doit pas exister dans la decision de livraison`,
      );
    }
  });

  it("ne nomme aucune commande Git destructrice", async () => {
    const source = await readFile(path.join(SOURCE_DIR, "git-delivery.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");

    for (const forbidden of ["reset", "restore", "checkout", "clean", "rebase", "stash"]) {
      assert.equal(
        new RegExp(`\\b${forbidden}\\b`, "iu").test(code),
        false,
        `« ${forbidden} » n'a rien a faire dans le vocabulaire de livraison`,
      );
    }
  });
});
