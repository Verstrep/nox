/**
 * Tests de l'affichage de la livraison Git.
 *
 * ## Ce que ce fichier protege
 *
 * Qu'aucun etat, aucune politique et aucun refus n'atteigne l'ecran sans phrase
 * — un code technique affiche tel quel ne dit a personne quoi faire. Et que les
 * phrases qui **annoncent une consequence** disent la verite : « Approve ne crée
 * aucun commit » etait vrai avant TASK-029 et ne l'est plus dans deux modes sur
 * trois.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DELIVERY_POLICIES,
  DELIVERY_POLICY,
  DELIVERY_REFUSAL,
  DELIVERY_REFUSAL_CODES,
  DELIVERY_STATUS,
  DELIVERY_STATUSES,
  DELIVERY_TRIGGER,
} from "@nox/shared";

import {
  DELIVERY_INDEPENDENT_NOTICE,
  DELIVERY_POLICY_NOTICE,
  DELIVERY_RETRY_PUSH_NOTICE,
  DELIVERY_SAFETY_NOTICE,
  approveDeliveryNotice,
  approvedDeliveryNotice,
  deliveryPolicyExplanation,
  deliveryPolicyLabel,
  deliveryRefusalLabel,
  deliveryRefusalMessage,
  deliveryStateLabel,
  deliveryStatusLabel,
  deliveryTriggerLabel,
  deliveryUrl,
  overrideDeliveryNotice,
  upstreamLabel,
} from "./delivery-display.ts";

describe("libelles", () => {
  it("nomme les trois politiques exactement comme les reglages", () => {
    assert.equal(deliveryPolicyLabel(DELIVERY_POLICY.MANUAL), "Manual");
    assert.equal(deliveryPolicyLabel(DELIVERY_POLICY.AUTO_COMMIT), "Auto commit validated");
    assert.equal(
      deliveryPolicyLabel(DELIVERY_POLICY.AUTO_COMMIT_PUSH),
      "Auto commit + push validated",
    );
  });

  it("explique chaque politique", () => {
    for (const policy of DELIVERY_POLICIES) {
      assert.ok(deliveryPolicyExplanation(policy).length > 40, policy);
    }
  });

  it("nomme chaque etat", () => {
    for (const status of DELIVERY_STATUSES) {
      assert.ok(deliveryStatusLabel(status).length > 0, status);
    }
  });

  it("distingue « push echoue » de « livraison echouee »", () => {
    // Les deux appellent des gestes differents : l'un se reprend par un push
    // seul, l'autre par une livraison entiere. Les confondre ferait recreer un
    // commit.
    assert.equal(
      deliveryStateLabel(DELIVERY_STATUS.COMMITTED, "DELIVERY_PUSH_REJECTED"),
      "Commit created, push failed",
    );
    assert.equal(deliveryStateLabel(DELIVERY_STATUS.COMMITTED, null), "Committed");
    assert.equal(
      deliveryStateLabel(DELIVERY_STATUS.DELIVERED, "DELIVERY_PUSH_FAILED"),
      "Pushed",
    );
  });

  it("dit qui a livre", () => {
    assert.equal(
      deliveryTriggerLabel(DELIVERY_TRIGGER.AUTOMATIC),
      "Delivered by project policy",
    );
    assert.equal(
      deliveryTriggerLabel(DELIVERY_TRIGGER.MANUAL),
      "Delivered on an explicit request",
    );
  });

  it("affiche l'upstream sans jamais son URL", () => {
    // Une URL de remote peut porter des identifiants, et `origin/main` dit tout
    // ce qu'un lecteur a besoin de savoir.
    assert.equal(upstreamLabel("main", "origin", "refs/heads/main"), "main → origin/main");
    assert.equal(upstreamLabel("main", null, null), null);
  });

  it("construit l'URL de la surface de livraison", () => {
    assert.equal(deliveryUrl("p1", "t1"), "/projects/p1/tasks/t1/delivery");
  });
});

describe("refus", () => {
  it("traduit chaque code, sans exception", () => {
    // Un code sans phrase finirait affiche tel quel, et ne dirait a personne
    // quoi faire.
    for (const code of DELIVERY_REFUSAL_CODES) {
      const message = deliveryRefusalMessage(code);
      assert.ok(message.length > 40, code);
      assert.ok(!message.includes("DELIVERY_"), `${code} laisse fuir un code technique`);
    }
  });

  it("reste lisible pour un code inconnu", () => {
    assert.ok(deliveryRefusalMessage("VENU_D_AILLEURS").length > 0);
    assert.equal(deliveryRefusalLabel("VENU_D_AILLEURS"), "Delivery blocked");
    assert.equal(deliveryRefusalLabel(null), null);
  });

  it("dit exactement ce que TASK-029 promet devant un repository modifie", () => {
    const message = deliveryRefusalMessage(DELIVERY_REFUSAL.REPOSITORY_CHANGED);
    assert.ok(message.includes("Repository changed after validation"));
    assert.ok(message.includes("NOX ne commite pas"));
  });

  it("nomme le geste qui reste apres un refus de push", () => {
    const message = deliveryRefusalMessage(DELIVERY_REFUSAL.PUSH_REJECTED);
    assert.ok(message.includes("commit local est conservé"));
    assert.ok(message.includes("ne force jamais"));
  });
});

describe("ce qu'une acceptation annonce", () => {
  it("dit la verite selon la politique", () => {
    assert.ok(approveDeliveryNotice(DELIVERY_POLICY.MANUAL).includes("Aucun commit"));
    assert.ok(
      approveDeliveryNotice(DELIVERY_POLICY.AUTO_COMMIT).includes("peut créer un commit"),
    );
    assert.ok(approveDeliveryNotice(DELIVERY_POLICY.AUTO_COMMIT).includes("Aucun push"));
    assert.ok(approveDeliveryNotice(DELIVERY_POLICY.AUTO_COMMIT_PUSH).includes("pousser"));
  });

  it("annonce la politique avant un passage en force", () => {
    // Un `HUMAN_OVERRIDE` reste une decision humaine explicite : la politique
    // s'applique ensuite normalement, et il faut le dire **avant** le clic.
    assert.equal(overrideDeliveryNotice(DELIVERY_POLICY.MANUAL), null);

    const auto = overrideDeliveryNotice(DELIVERY_POLICY.AUTO_COMMIT);
    assert.ok(auto?.includes("Project Git delivery policy will still apply after this override"));
    assert.ok(auto?.includes("may automatically commit"));
    assert.ok(!auto?.includes("or push"));

    const push = overrideDeliveryNotice(DELIVERY_POLICY.AUTO_COMMIT_PUSH);
    assert.ok(push?.includes("or push"));
  });

  it("ne promet aucun commit apres coup", () => {
    // La livraison est tentee dans la meme action, mais elle a pu etre bloquee :
    // promettre un commit ici serait faux.
    assert.ok(approvedDeliveryNotice(DELIVERY_POLICY.MANUAL).includes("Aucun commit"));
    assert.ok(approvedDeliveryNotice(DELIVERY_POLICY.AUTO_COMMIT).includes("Git delivery"));
  });
});

describe("les deux autorisations restent distinctes", () => {
  it("le texte des reglages annonce la consequence avant le clic", () => {
    assert.ok(DELIVERY_POLICY_NOTICE.includes("ne redemandera pas confirmation"));
    assert.ok(DELIVERY_POLICY_NOTICE.includes("correspond encore exactement"));
  });

  it("le texte des reglages dit ce que la file n'autorise pas", () => {
    assert.ok(DELIVERY_INDEPENDENT_NOTICE.includes("Start queue"));
    assert.ok(DELIVERY_INDEPENDENT_NOTICE.includes("n'autorise rien dans Git"));
  });

  it("la reprise de push annonce qu'elle ne recree aucun commit", () => {
    assert.ok(DELIVERY_RETRY_PUSH_NOTICE.includes("ne recrée aucun commit"));
  });

  it("la surface nomme ce que NOX ne fait jamais", () => {
    for (const forbidden of ["reset", "restore", "checkout", "clean", "pull", "merge", "rebase"]) {
      assert.ok(DELIVERY_SAFETY_NOTICE.includes(forbidden), forbidden);
    }
  });
});
