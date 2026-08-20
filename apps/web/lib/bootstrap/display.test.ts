/**
 * Affichage de l'amorcage.
 *
 * ## Ce que ce fichier prouve
 *
 * Que chaque refus dit **quoi faire** : definir le brief, definir le plan,
 * appliquer un backlog, demarrer le runner. Un message unique pour quatre
 * causes differentes laisserait l'utilisateur sans geste a poser.
 *
 * Et qu'aucune sortie ne suggere de contourner une garantie : ni fusion, ni
 * forcage, ni « creer quand meme ».
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TASK_STATUS } from "@nox/shared";

import {
  BOOTSTRAP_ALREADY_EXISTS_MESSAGE,
  BOOTSTRAP_FREE_NOTICE,
  BOOTSTRAP_INTRODUCTION,
  BOOTSTRAP_STALE_MESSAGE,
  BOOTSTRAP_UNKNOWN_MESSAGE,
  bootstrapBlockerMessage,
  bootstrapContextUrl,
  bootstrapStateLabel,
  bootstrapTaskDone,
  bootstrapUrl,
  type BootstrapBlocker,
} from "./display.ts";

describe("URL", () => {
  it("rend l'adresse de la page d'amorcage", () => {
    assert.equal(bootstrapUrl("p1"), "/projects/p1/bootstrap");
  });

  it("rend l'adresse de l'inspection", () => {
    assert.equal(bootstrapContextUrl("p1"), "/projects/p1/bootstrap/context");
  });
});

describe("libelles d'etat", () => {
  it("distingue les trois etats", () => {
    assert.equal(bootstrapStateLabel("blocked"), "Not prepared");
    assert.equal(bootstrapStateLabel("available"), "Ready to prepare");
    assert.equal(bootstrapStateLabel("prepared"), "Prepared");
  });

  it("n'en confond aucun avec un autre", () => {
    const labels = ["blocked", "available", "prepared"].map((state) =>
      bootstrapStateLabel(state as "blocked" | "available" | "prepared"),
    );
    assert.equal(new Set(labels).size, 3);
  });
});

describe("messages de refus", () => {
  const blockers: BootstrapBlocker[] = [
    "brief_missing",
    "plan_missing",
    "backlog_missing",
    "repository_unreachable",
  ];

  it("donne un message distinct par cause", () => {
    const messages = blockers.map(bootstrapBlockerMessage);
    assert.equal(new Set(messages).size, blockers.length);
  });

  it("dit quel geste poser, pour chacune", () => {
    assert.ok(bootstrapBlockerMessage("brief_missing").includes("definissez le brief produit"));
    assert.ok(bootstrapBlockerMessage("plan_missing").includes("definissez le plan de V1"));
    assert.ok(bootstrapBlockerMessage("backlog_missing").includes("generez puis appliquez"));
    assert.ok(bootstrapBlockerMessage("repository_unreachable").includes("Demarrez le runner"));
  });

  it("explique pourquoi le backlog est exige", () => {
    assert.ok(
      bootstrapBlockerMessage("backlog_missing").includes(
        "l'amorcage prepare le repository pour ces taches-la",
      ),
    );
  });

  it("ne suggere aucun contournement", () => {
    const all = [
      ...blockers.map(bootstrapBlockerMessage),
      BOOTSTRAP_STALE_MESSAGE,
      BOOTSTRAP_ALREADY_EXISTS_MESSAGE,
      BOOTSTRAP_UNKNOWN_MESSAGE,
    ].join("\n");

    for (const forbidden of ["quand meme", "Forcer", "forcer", "Ignorer", "Merge", "Auto"]) {
      assert.equal(all.includes(forbidden), false, forbidden);
    }
  });
});

describe("peremption", () => {
  it("dit ce qui a change et quoi faire", () => {
    assert.ok(BOOTSTRAP_STALE_MESSAGE.includes("a change depuis cet apercu"));
    assert.ok(BOOTSTRAP_STALE_MESSAGE.includes("rechargez la page"));
  });

  it("explique le refus plutot que de l'imposer", () => {
    assert.ok(
      BOOTSTRAP_STALE_MESSAGE.includes("NOX ne cree pas une tache fondee sur un etat qui n'existe plus"),
    );
  });
});

describe("annonces", () => {
  it("dit que l'action n'appelle aucune IA", () => {
    assert.ok(BOOTSTRAP_FREE_NOTICE.includes("calls no AI"));
    assert.ok(BOOTSTRAP_FREE_NOTICE.includes("deterministically"));
  });

  it("explique le role de TASK-000", () => {
    assert.ok(BOOTSTRAP_INTRODUCTION.includes("TASK-000"));
    assert.ok(BOOTSTRAP_INTRODUCTION.includes("prepares the repository"));
    assert.ok(BOOTSTRAP_INTRODUCTION.includes("foundational project documentation"));
    assert.ok(BOOTSTRAP_INTRODUCTION.includes("before product implementation tasks"));
  });

  it("dit qu'une seule tache d'amorcage existe par projet", () => {
    assert.ok(BOOTSTRAP_ALREADY_EXISTS_MESSAGE.includes("Un projet n'en a qu'une"));
  });
});

describe("achevement", () => {
  it("n'est atteint que par la tache terminee", () => {
    assert.equal(bootstrapTaskDone(TASK_STATUS.COMPLETED), true);
    for (const status of [
      TASK_STATUS.DRAFT,
      TASK_STATUS.READY,
      TASK_STATUS.RUNNING,
      TASK_STATUS.REVIEW,
      TASK_STATUS.FAILED,
      TASK_STATUS.BLOCKED,
    ]) {
      assert.equal(bootstrapTaskDone(status), false, status);
    }
  });
});
