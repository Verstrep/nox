/**
 * Tests du fil affiche.
 *
 * Ce qui est verifie ici tient en une phrase : un evenement de tache se lit a
 * cote de la discussion qui l'a produit, et ne se confond jamais avec un
 * message. La seconde moitie de cette phrase est la plus importante — le
 * transcript transmis au fournisseur se construit ailleurs, et rien de ce fichier
 * ne doit pouvoir l'atteindre.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ARCHITECT_MESSAGE_ROLE } from "@nox/shared";

import {
  buildArchitectTimeline,
  type TimelineMessage,
  type TimelineProjectUpdate,
  type TimelineTask,
} from "./timeline.ts";

function user(id: string, generationId: string | null): TimelineMessage {
  return {
    id,
    role: ARCHITECT_MESSAGE_ROLE.USER,
    content: `Message ${id}`,
    createdAt: "2026-08-14T10:00:00.000Z",
    generationId,
  };
}

function architect(id: string, generationId: string | null): TimelineMessage {
  return {
    id,
    role: ARCHITECT_MESSAGE_ROLE.ARCHITECT,
    content: `Reponse ${id}`,
    createdAt: "2026-08-14T10:00:01.000Z",
    generationId,
  };
}

function task(generationId: string, taskId: string, code: string): TimelineTask {
  return { generationId, taskId, code, title: `Titre de ${code}` };
}

function update(
  generationId: string,
  updateId: string,
  status: TimelineProjectUpdate["status"] = "PENDING",
): TimelineProjectUpdate {
  return { generationId, updateId, status, briefChanges: 2, planChanges: 0 };
}

/** Resume lisible du fil : « u a T:TASK-001 ». */
function shape(entries: ReturnType<typeof buildArchitectTimeline>): string {
  return entries
    .map((entry) => {
      if (entry.kind === "task") {
        return `T:${entry.code}`;
      }
      if (entry.kind === "update") {
        return `U:${entry.status}`;
      }
      return entry.role === ARCHITECT_MESSAGE_ROLE.USER ? "u" : "a";
    })
    .join(" ");
}

describe("buildArchitectTimeline", () => {
  it("rend les messages seuls quand aucune tache n'a ete creee", () => {
    const entries = buildArchitectTimeline([user("1", "g1"), architect("2", "g1")], []);

    assert.equal(shape(entries), "u a");
    assert.equal(
      entries.every((entry) => entry.kind === "message"),
      true,
    );
  });

  it("place la tache apres le dernier message de sa generation", () => {
    const entries = buildArchitectTimeline(
      [user("1", "g1"), architect("2", "g1"), user("3", "g2"), architect("4", "g2")],
      [task("g1", "t1", "TASK-001")],
    );

    // La tache suit la reponse qui portait la proposition, pas la question.
    assert.equal(shape(entries), "u a T:TASK-001 u a");
  });

  it("ne place jamais un evenement entre une question et sa reponse", () => {
    const entries = buildArchitectTimeline(
      [user("1", "g1"), architect("2", "g1")],
      [task("g1", "t1", "TASK-001")],
    );

    assert.equal(shape(entries), "u a T:TASK-001");
  });

  it("rattache chaque tache a sa propre generation", () => {
    const entries = buildArchitectTimeline(
      [
        user("1", "g1"),
        architect("2", "g1"),
        user("3", "g2"),
        architect("4", "g2"),
        user("5", "g3"),
        architect("6", "g3"),
      ],
      [task("g1", "t1", "TASK-001"), task("g3", "t2", "TASK-002")],
    );

    assert.equal(shape(entries), "u a T:TASK-001 u a u a T:TASK-002");
  });

  it("accepte deux taches sur une meme generation sans en perdre", () => {
    const entries = buildArchitectTimeline(
      [user("1", "g1"), architect("2", "g1")],
      [task("g1", "t1", "TASK-001"), task("g1", "t2", "TASK-002")],
    );

    assert.equal(shape(entries), "u a T:TASK-001 T:TASK-002");
  });

  it("n'oublie pas une tache dont la generation n'a laisse aucun message", () => {
    const entries = buildArchitectTimeline(
      [user("1", "g1"), architect("2", "g1")],
      [task("orpheline", "t9", "TASK-009")],
    );

    // Mal placee reste visible ; supprimee disparaitrait sans que rien ne le dise.
    assert.equal(shape(entries), "u a T:TASK-009");
  });

  it("porte un identifiant distinct de celui des messages", () => {
    const entries = buildArchitectTimeline(
      [user("t1", "g1"), architect("2", "g1")],
      [task("g1", "t1", "TASK-001")],
    );

    const identifiers = entries.map((entry) => entry.id);
    assert.equal(new Set(identifiers).size, identifiers.length);
  });

  it("expose le code, le titre et l'identifiant de la tache", () => {
    const entries = buildArchitectTimeline(
      [user("1", "g1"), architect("2", "g1")],
      [task("g1", "t1", "TASK-001")],
    );

    const event = entries.find((entry) => entry.kind === "task");
    assert.ok(event !== undefined && event.kind === "task");
    assert.equal(event.code, "TASK-001");
    assert.equal(event.title, "Titre de TASK-001");
    assert.equal(event.taskId, "t1");
  });

  it("laisse le fil vide quand la conversation n'a rien echange", () => {
    assert.deepEqual(buildArchitectTimeline([], []), []);
  });

  it("ne modifie pas les entrees qu'on lui donne", () => {
    const messages = [user("1", "g1"), architect("2", "g1")];
    const tasks = [task("g1", "t1", "TASK-001")];
    const before = JSON.stringify({ messages, tasks });

    buildArchitectTimeline(messages, tasks);

    assert.equal(JSON.stringify({ messages, tasks }), before);
  });
});

describe("frontiere avec le fournisseur", () => {
  it("ne construit aucun transcript", async () => {
    // Le fil est de l'affichage. S'il importait le transcript ou la preparation
    // d'un tour, un evenement local pourrait un jour se retrouver dans le prompt.
    //
    // Le commentaire du module parle de ces notions ; son **code** ne doit pas
    // les toucher. Ils sont donc retires avant l'examen.
    const file = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("./timeline.ts", import.meta.url), "utf8"),
    );
    const code = file.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");

    for (const forbidden of ["transcript", "prepare", "provider", "fetch", "await"]) {
      assert.equal(code.includes(forbidden), false, `le code ne mentionne pas ${forbidden}`);
    }
  });
});

describe("propositions de mise a jour du projet", () => {
  it("place la carte apres la reponse du tour qui l'a produite", () => {
    const entries = buildArchitectTimeline(
      [user("1", "g1"), architect("2", "g1")],
      [],
      [update("g1", "u1")],
    );

    assert.equal(shape(entries), "u a U:PENDING");
  });

  it("rend la proposition avant la tache creee au meme tour", () => {
    // La proposition est ce que l'architecte a suggere ; la tache est ce que
    // l'utilisateur en a fait. Lire la consequence avant sa cause deroute.
    const entries = buildArchitectTimeline(
      [user("1", "g1"), architect("2", "g1")],
      [task("g1", "t1", "TASK-001")],
      [update("g1", "u1")],
    );

    assert.equal(shape(entries), "u a U:PENDING T:TASK-001");
  });

  it("rattache chaque proposition a son propre tour", () => {
    const entries = buildArchitectTimeline(
      [user("1", "g1"), architect("2", "g1"), user("3", "g2"), architect("4", "g2")],
      [],
      [update("g1", "u1"), update("g2", "u2")],
    );

    assert.equal(shape(entries), "u a U:PENDING u a U:PENDING");
  });

  it("rend le statut enregistre, sans le deduire", () => {
    // Le statut vient de la base : un rafraichissement rend la meme carte, et
    // aucun etat de navigateur n'en decide.
    const entries = buildArchitectTimeline(
      [user("1", "g1"), architect("2", "g1")],
      [],
      [update("g1", "u1", "APPLIED")],
    );

    assert.equal(shape(entries), "u a U:APPLIED");
  });

  it("n'oublie pas une proposition dont le tour n'a laisse aucun message", () => {
    const entries = buildArchitectTimeline([user("1", null)], [], [update("g9", "u9")]);
    assert.equal(shape(entries), "u U:PENDING");
  });

  it("ne rend aucune carte quand aucune proposition n'existe", () => {
    const entries = buildArchitectTimeline([user("1", "g1"), architect("2", "g1")], []);
    assert.equal(shape(entries), "u a");
  });

  it("ne cree aucun message pour une proposition", () => {
    // Une carte n'est pas un message : elle n'a ni role, ni contenu, et ne peut
    // donc pas entrer dans le transcript transmis.
    const entries = buildArchitectTimeline(
      [user("1", "g1"), architect("2", "g1")],
      [],
      [update("g1", "u1")],
    );

    assert.equal(entries.filter((entry) => entry.kind === "message").length, 2);
    const card = entries.find((entry) => entry.kind === "update");
    assert.ok(card !== undefined);
    assert.equal("content" in card, false);
    assert.equal("role" in card, false);
  });
});
