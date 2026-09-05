/**
 * Les dependances pendant la revue d'un backlog.
 *
 * ## Le probleme que ce module resout
 *
 * Une dependance de backlog est une **position** : aucune de ces taches n'a
 * encore de code. Or la revue sait deplacer et retirer des cartes, donc changer
 * toutes les positions a la fois. Laisser les indices tels quels ferait pointer
 * une carte vers une voisine qu'elle n'a jamais choisie — silencieusement, et
 * jusqu'a l'application.
 *
 * Les identites, elles, ne bougent pas. Tout ce fichier verifie une seule chose :
 * **ce qui reste a l'ecran est exactement ce qui partira au serveur.**
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { VERIFICATION_MODE } from "@nox/shared";

import { moveBacklogItem, removeBacklogItem } from "./display.ts";
import {
  createBacklogReviewItems,
  remapBacklogDependencies,
  toggleBacklogDependency,
  type BacklogReviewItem,
} from "./review-items.ts";
import type { BacklogReviewItem as BacklogItemValues } from "./service.ts";

function values(title: string, dependsOnPositions: number[] = []): BacklogItemValues {
  return {
    title,
    priority: "MEDIUM",
    objective: `Objectif de ${title}.`,
    context: "",
    outOfScope: "",
    documents: "",
    criteria: [
      {
        key: "c0",
        text: "Un critere verifiable.",
        verificationMode: VERIFICATION_MODE.HUMAN,
        humanInstructions: "Regarder l'ecran.",
        commandKeys: [],
      },
    ],
    commands: [],
    dependsOnTaskIds: [],
    dependsOnPositions,
  };
}

/** Le decoupage du pilote : deux taches, la seconde attend la premiere. */
function tripkit(): BacklogReviewItem[] {
  return createBacklogReviewItems([
    values("Gerer les deplacements et leurs hotels"),
    values("Gerer les notes de frais et leur total", [0]),
  ]);
}

function move(items: readonly BacklogReviewItem[], from: number, to: number): BacklogReviewItem[] {
  return remapBacklogDependencies(items, moveBacklogItem(items, from, to));
}

function remove(items: readonly BacklogReviewItem[], index: number): BacklogReviewItem[] {
  return remapBacklogDependencies(items, removeBacklogItem(items, index));
}

describe("un deplacement reporte les dependances par identite", () => {
  it("suit la cible quand une tache est inseree avant elle", () => {
    const items = createBacklogReviewItems([
      values("A"),
      values("B"),
      values("C", [1]), // C attend B
    ]);

    // A passe en dernier : B devient 0, C devient 1, et C attend toujours B.
    const moved = move(items, 0, 2);
    assert.deepEqual(
      moved.map((item) => item.values.title),
      ["B", "C", "A"],
    );
    assert.deepEqual(moved[1]?.values.dependsOnPositions, [0]);
  });

  it("retire une dependance devenue une reference vers l'avant", () => {
    // TASK-002 attend TASK-001. Les intervertir rend l'attente impossible : le
    // serveur la refuserait, et l'editeur ne la propose plus. La retirer ici est
    // ce qui garde l'ecran et l'envoi d'accord.
    const inverted = move(tripkit(), 0, 1);
    assert.deepEqual(
      inverted.map((item) => item.values.title),
      ["Gerer les notes de frais et leur total", "Gerer les deplacements et leurs hotels"],
    );
    assert.deepEqual(inverted[0]?.values.dependsOnPositions, []);
    assert.deepEqual(inverted[1]?.values.dependsOnPositions, []);
  });

  it("ne recree pas une dependance perdue quand on revient en arriere", () => {
    // Le retrait est definitif : NOX ne se souvient pas d'une intention que
    // l'utilisateur a defaite. Il la reproposera, il ne la restaurera pas.
    const back = move(move(tripkit(), 0, 1), 0, 1);
    assert.deepEqual(back[1]?.values.dependsOnPositions, []);
  });

  it("laisse l'element inchange quand rien ne bouge pour lui", () => {
    const items = tripkit();
    const same = remapBacklogDependencies(items, [...items]);
    assert.equal(same[0], items[0], "aucun objet neuf pour une valeur identique");
    assert.equal(same[1], items[1]);
  });
});

describe("un retrait ne laisse aucune dependance pendante", () => {
  it("retire la dependance vers une carte supprimee", () => {
    const left = remove(tripkit(), 0);
    assert.equal(left.length, 1);
    assert.deepEqual(left[0]?.values.dependsOnPositions, []);
  });

  it("decale les positions restantes", () => {
    const items = createBacklogReviewItems([values("A"), values("B"), values("C", [0])]);
    const left = remove(items, 1);
    assert.deepEqual(
      left.map((item) => item.values.title),
      ["A", "C"],
    );
    assert.deepEqual(left[1]?.values.dependsOnPositions, [0], "C attend toujours A");
  });
});

describe("l'edition d'une dependance", () => {
  it("ajoute puis retire une position anterieure", () => {
    const items = createBacklogReviewItems([values("A"), values("B")]);
    const added = toggleBacklogDependency(items, 1, 0);
    assert.deepEqual(added[1]?.values.dependsOnPositions, [0]);

    const removed = toggleBacklogDependency(added, 1, 0);
    assert.deepEqual(removed[1]?.values.dependsOnPositions, []);
  });

  it("ignore une position qui ne precede pas la carte", () => {
    // L'editeur ne montre que les cartes precedentes ; ce controle redit la
    // meme regle a l'endroit ou elle s'ecrit.
    const items = createBacklogReviewItems([values("A"), values("B")]);
    assert.deepEqual(toggleBacklogDependency(items, 0, 1)[0]?.values.dependsOnPositions, []);
    assert.deepEqual(toggleBacklogDependency(items, 0, 0)[0]?.values.dependsOnPositions, []);
    assert.deepEqual(toggleBacklogDependency(items, 1, 5)[1]?.values.dependsOnPositions, []);
  });

  it("garde les positions triees et sans doublon", () => {
    const items = createBacklogReviewItems([values("A"), values("B"), values("C")]);
    const both = toggleBacklogDependency(toggleBacklogDependency(items, 2, 1), 2, 0);
    assert.deepEqual(both[2]?.values.dependsOnPositions, [0, 1]);
  });

  it("ne touche a aucune autre carte", () => {
    const items = createBacklogReviewItems([values("A"), values("B")]);
    const changed = toggleBacklogDependency(items, 1, 0);
    assert.equal(changed[0], items[0]);
    assert.equal(changed[1]?.uid, items[1]?.uid, "l'identite survit a l'edition");
  });
});
