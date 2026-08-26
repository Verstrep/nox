/**
 * Identite des elements pendant la revue d'un backlog.
 *
 * ## Ce que ce fichier prouve
 *
 * Qu'une frappe ne change pas l'identite d'une carte. C'est la cause du bug
 * observe en revue reelle : la cle React etait derivee du titre, donc taper une
 * lettre remontait la carte et le champ perdait le focus. Le test ne simule pas
 * un focus — il verifie la propriete qui, seule, le rendait impossible a tenir.
 *
 * Et qu'un deplacement ne melange pas les formulaires : l'identite suit son
 * element, les valeurs restent attachees a la bonne tache.
 *
 * ## Une garantie structurelle en plus
 *
 * Le dernier bloc lit la **source** du composant. Une propriete pure ne protege
 * de rien si le composant cesse de s'en servir : le jour ou quelqu'un
 * reintroduirait une cle derivee d'une valeur editable, ce test le dirait.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { VERIFICATION_MODE } from "@nox/shared";

import type { TaskEditFormValues } from "../verification-fields.ts";

import { moveBacklogItem, removeBacklogItem } from "./display.ts";
import {
  backlogReviewValues,
  createBacklogReviewItems,
  setBacklogItemField,
} from "./review-items.ts";

function values(title: string): TaskEditFormValues {
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
  };
}

const THREE = [values("Domaine"), values("Planning"), values("Courses")];

describe("attribution des identites", () => {
  it("donne une identite distincte a chaque element", () => {
    const items = createBacklogReviewItems(THREE);
    assert.equal(items.length, 3);
    assert.equal(new Set(items.map((item) => item.uid)).size, 3);
  });

  it("ne derive l'identite d'aucune valeur editable", () => {
    const items = createBacklogReviewItems(THREE);
    const renamed = createBacklogReviewItems(THREE.map((item) => values(`${item.title} bis`)));
    assert.deepEqual(
      items.map((item) => item.uid),
      renamed.map((item) => item.uid),
      "deux backlogs de meme taille portent les memes identites",
    );
  });

  it("conserve les valeurs telles quelles", () => {
    assert.deepEqual(backlogReviewValues(createBacklogReviewItems(THREE)), THREE);
  });

  it("accepte une liste vide", () => {
    assert.deepEqual(createBacklogReviewItems([]), []);
  });
});

describe("edition d'un champ", () => {
  it("laisse l'identite intacte apres six frappes consecutives", () => {
    let items = createBacklogReviewItems(THREE);
    const before = items.map((item) => item.uid);

    // Une frappe, une lettre : exactement ce que fait le champ Titre.
    let typed = "";
    for (const letter of ["a", "b", "c", "d", "e", "f"]) {
      typed += letter;
      items = setBacklogItemField(items, 1, "title", typed);
      assert.deepEqual(
        items.map((item) => item.uid),
        before,
        `identite modifiee apres « ${typed} »`,
      );
    }

    assert.equal(items[1]?.values.title, "abcdef");
  });

  it("ne modifie que l'element vise", () => {
    const items = setBacklogItemField(createBacklogReviewItems(THREE), 0, "title", "Autre");
    assert.equal(items[0]?.values.title, "Autre");
    assert.equal(items[1]?.values.title, "Planning");
    assert.equal(items[2]?.values.title, "Courses");
  });

  it("ne modifie que le champ vise", () => {
    const items = setBacklogItemField(createBacklogReviewItems(THREE), 0, "title", "Autre");
    assert.equal(items[0]?.values.objective, "Objectif de Domaine.");
    assert.equal(items[0]?.values.criteria[0]?.text, "Un critere verifiable.");
    assert.equal(items[0]?.values.priority, "MEDIUM");
  });

  it("accepte une valeur vide, qui est une saisie comme une autre", () => {
    const items = setBacklogItemField(createBacklogReviewItems(THREE), 2, "title", "");
    assert.equal(items[2]?.values.title, "");
    assert.equal(items[2]?.uid, createBacklogReviewItems(THREE)[2]?.uid);
  });

  it("rend une nouvelle liste sans modifier l'ancienne", () => {
    const items = createBacklogReviewItems(THREE);
    const edited = setBacklogItemField(items, 0, "objective", "Change");
    assert.notEqual(edited, items);
    assert.equal(items[0]?.values.objective, "Objectif de Domaine.");
  });

  it("ignore un index hors bornes plutot que d'inventer un element", () => {
    const items = createBacklogReviewItems(THREE);
    assert.deepEqual(
      backlogReviewValues(setBacklogItemField(items, 9, "title", "Nulle part")),
      THREE,
    );
  });
});

describe("deplacement et retrait", () => {
  it("fait suivre l'identite a l'element deplace", () => {
    const items = createBacklogReviewItems(THREE);
    const moved = moveBacklogItem(items, 2, 0);

    assert.equal(moved[0]?.uid, items[2]?.uid);
    assert.equal(moved[0]?.values.title, "Courses");
    assert.equal(moved[1]?.uid, items[0]?.uid);
    assert.equal(moved[2]?.uid, items[1]?.uid);
  });

  it("garde les valeurs attachees a leur tache apres un deplacement puis une edition", () => {
    // Le scenario qui casserait si l'identite venait de la position : deplacer,
    // puis editer, puis relire ce qui partirait au serveur.
    const moved = moveBacklogItem(createBacklogReviewItems(THREE), 0, 2);
    const edited = setBacklogItemField(moved, 0, "title", "Planning revu");

    assert.deepEqual(
      backlogReviewValues(edited).map((item) => item.title),
      ["Planning revu", "Courses", "Domaine"],
    );
    assert.deepEqual(
      backlogReviewValues(edited).map((item) => item.objective),
      ["Objectif de Planning.", "Objectif de Courses.", "Objectif de Domaine."],
      "chaque objectif est reste avec son titre",
    );
  });

  it("retire l'element vise, et lui seul", () => {
    const items = createBacklogReviewItems(THREE);
    const left = removeBacklogItem(items, 1);

    assert.deepEqual(
      left.map((item) => item.uid),
      [items[0]?.uid, items[2]?.uid],
    );
    assert.deepEqual(
      backlogReviewValues(left).map((item) => item.title),
      ["Domaine", "Courses"],
    );
  });

  it("laisse les identites uniques apres un retrait suivi d'un deplacement", () => {
    const left = moveBacklogItem(removeBacklogItem(createBacklogReviewItems(THREE), 0), 0, 1);
    assert.equal(new Set(left.map((item) => item.uid)).size, left.length);
  });
});

describe("le composant s'en sert reellement", () => {
  async function reviewSource(): Promise<string> {
    return readFile(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "..",
        "app",
        "projects",
        "[id]",
        "backlog",
        "[proposalId]",
        "BacklogReview.tsx",
      ),
      "utf8",
    );
  }

  it("ne derive aucune cle React d'une valeur editable", async () => {
    const source = await reviewSource();
    // Le bug d'origine, sous les formes qu'il pourrait reprendre. Une cle
    // derivee du titre remonte la carte a chaque frappe ; une cle derivee de la
    // position melange les formulaires au premier deplacement.
    for (const forbidden of [
      "key={item.title}",
      "key={item.values.title}",
      "key={`${String(index)}-${item.title}`}",
      "key={index}",
      "key={String(index)}",
    ]) {
      assert.ok(!source.includes(forbidden), forbidden);
    }
  });

  it("utilise l'identite locale comme cle", async () => {
    const source = await reviewSource();
    assert.ok(source.includes("key={uid}"));
    assert.ok(source.includes("createBacklogReviewItems"));
    assert.ok(source.includes("setBacklogItemField"));
  });

  it("nomme toujours les champs d'apres leur position courante", async () => {
    const source = await reviewSource();
    // L'identite sert au rendu ; elle ne doit pas fuir dans le formulaire, sous
    // peine de faire dependre l'ordre applique d'autre chose que l'ecran.
    assert.ok(source.includes("`items.${String(index)}.`"));
    assert.ok(source.includes("`${prefix}${field}`"));
    assert.ok(!source.includes('name={uid}'));
  });
});
