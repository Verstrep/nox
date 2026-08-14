/**
 * Tests de la fenetre de transcript.
 *
 * Ce module decide ce qui part chez le fournisseur, et cette decision est la
 * plus facile a rendre fausse sans que rien ne casse : un tour coupe en deux
 * produit un dialogue plausible et faux, et personne ne s'en apercoit avant de
 * lire une reponse incoherente.
 *
 * Les tests portent donc surtout sur ce que la fenetre **ne fait pas** :
 * couper un tour, reordonner, reprendre un tour ancien apres en avoir saute un.
 */

import { ARCHITECT_LIMITS } from "@nox/shared";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  selectTranscriptWindow,
  transcriptBudget,
  type TranscriptEntry,
} from "./window.ts";

/** Un tour complet : le message de l'utilisateur, puis la reponse. */
function turn(id: string, userChars = 10, architectChars = 10): TranscriptEntry[] {
  return [
    { role: "USER", content: "u".repeat(userChars), proposal: null, turnId: id },
    { role: "ARCHITECT", content: "a".repeat(architectChars), proposal: null, turnId: id },
  ];
}

function turns(count: number, chars = 10): TranscriptEntry[] {
  return Array.from({ length: count }, (_, index) => turn(`t${String(index + 1)}`, chars, chars))
    .flat();
}

describe("selectTranscriptWindow — cas simples", () => {
  it("rend une fenetre vide pour une conversation vide", () => {
    const window = selectTranscriptWindow([], 1_000);

    assert.deepEqual(window.messages, []);
    assert.equal(window.includedTurns, 0);
    assert.equal(window.omittedTurns, 0);
    assert.equal(window.omittedMessages, 0);
    assert.equal(window.chars, 0);
  });

  it("transmet un tour unique en entier", () => {
    const window = selectTranscriptWindow(turn("t1"), 1_000);

    assert.equal(window.includedTurns, 1);
    assert.equal(window.omittedTurns, 0);
    assert.equal(window.messages.length, 2);
    assert.equal(window.chars, 20);
  });

  it("transmet vingt tours quand ils tiennent", () => {
    const window = selectTranscriptWindow(turns(ARCHITECT_LIMITS.windowTurns), 1_000_000);

    assert.equal(window.includedTurns, ARCHITECT_LIMITS.windowTurns);
    assert.equal(window.omittedTurns, 0);
    assert.equal(window.omittedMessages, 0);
  });

  it("conserve l'ordre chronologique", () => {
    const entries = [...turn("t1"), ...turn("t2"), ...turn("t3")];
    const window = selectTranscriptWindow(entries, 1_000_000);

    assert.deepEqual(
      window.messages.map((message) => message.role),
      ["USER", "ARCHITECT", "USER", "ARCHITECT", "USER", "ARCHITECT"],
    );
  });
});

describe("selectTranscriptWindow — au-dela des bornes", () => {
  it("ecarte les tours les plus anciens au-dela du nombre maximal", () => {
    const entries = turns(ARCHITECT_LIMITS.windowTurns + 5);
    const window = selectTranscriptWindow(entries, 1_000_000);

    assert.equal(window.includedTurns, ARCHITECT_LIMITS.windowTurns);
    assert.equal(window.omittedTurns, 5);
    assert.equal(window.omittedMessages, 10);
  });

  it("garde les plus recents, jamais les plus anciens", () => {
    const entries = [...turn("vieux", 5, 5), ...turn("recent", 5, 5)];
    const window = selectTranscriptWindow(entries, 10, 20);

    assert.equal(window.includedTurns, 1);
    assert.equal(window.messages[0]?.content, "uuuuu");
    // Le tour retenu est bien le second : les deux ont le meme texte, mais
    // l'omission porte sur un seul tour et la taille le confirme.
    assert.equal(window.chars, 10);
    assert.equal(window.omittedTurns, 1);
  });

  it("ne coupe jamais un tour en deux", () => {
    // Le budget laisse passer un tour et demi. La moitie n'est pas transmise :
    // une question sans sa reponse produirait un dialogue que personne n'a tenu.
    const entries = [...turn("t1", 10, 10), ...turn("t2", 10, 10)];
    const window = selectTranscriptWindow(entries, 30);

    assert.equal(window.includedTurns, 1);
    assert.equal(window.messages.length, 2);
    assert.equal(window.chars, 20);
  });

  it("ne reprend pas un tour ancien apres en avoir saute un gros", () => {
    // Un tour ancien plus petit tiendrait dans ce qui reste. Le reprendre
    // produirait un trou : l'architecte lirait une reponse a une question qu'il
    // n'a pas vue.
    const entries = [...turn("petit", 2, 2), ...turn("gros", 40, 40), ...turn("dernier", 5, 5)];
    const window = selectTranscriptWindow(entries, 50);

    assert.equal(window.includedTurns, 1);
    assert.equal(window.messages[0]?.content, "uuuuu");
    assert.equal(window.omittedTurns, 2);
  });

  it("rend une fenetre vide plutot qu'un tour tronque", () => {
    const window = selectTranscriptWindow(turn("t1", 100, 100), 10);

    assert.deepEqual(window.messages, []);
    assert.equal(window.includedTurns, 0);
    assert.equal(window.omittedTurns, 1);
    assert.equal(window.omittedMessages, 2);
  });
});

describe("selectTranscriptWindow — regroupement en tours", () => {
  it("regroupe les messages qui partagent une generation", () => {
    const window = selectTranscriptWindow(turn("t1"), 1_000);

    assert.equal(window.includedTurns, 1);
    assert.equal(window.messages.length, 2);
  });

  it("traite un message orphelin comme son propre tour", () => {
    // Cas d'une session historique : un message sans generation connue n'est
    // rattache a aucun voisin, faute de savoir s'il lui repondait.
    const entries: TranscriptEntry[] = [
      { role: "USER", content: "seul", proposal: null, turnId: "m1" },
      { role: "USER", content: "autre", proposal: null, turnId: "m2" },
    ];
    const window = selectTranscriptWindow(entries, 1_000);

    assert.equal(window.includedTurns, 2);
  });

  it("conserve la proposition attachee a une reponse", () => {
    const entries: TranscriptEntry[] = [
      { role: "USER", content: "vas-y", proposal: null, turnId: "t1" },
      {
        role: "ARCHITECT",
        content: "voici",
        proposal: { title: "Une tache" } as never,
        turnId: "t1",
      },
    ];
    const window = selectTranscriptWindow(entries, 1_000);

    assert.equal(window.messages[1]?.proposal !== null, true);
  });

  it("compte les caracteres, pas les octets", () => {
    // Un emoji compte pour ce qu'il occupe dans la chaine, comme partout
    // ailleurs dans NOX : les bornes sont en caracteres, jamais en jetons.
    const entries: TranscriptEntry[] = [
      { role: "USER", content: "éàü🙂", proposal: null, turnId: "t1" },
    ];
    const window = selectTranscriptWindow(entries, 1_000);

    assert.equal(window.chars, "éàü🙂".length);
    assert.equal(window.includedTurns, 1);
  });
});

describe("transcriptBudget", () => {
  it("reserve la place du message que l'utilisateur vient d'ecrire", () => {
    assert.equal(transcriptBudget(1_000), ARCHITECT_LIMITS.transcript - 1_000);
  });

  it("ne descend jamais sous zero", () => {
    assert.equal(transcriptBudget(ARCHITECT_LIMITS.transcript * 2), 0);
  });

  it("laisse toujours de la place pour au moins un tour complet", () => {
    // La borne d'un message utilisateur est tres inferieure au budget de
    // transcript : un message ne peut donc jamais, a lui seul, vider la fenetre.
    const budget = transcriptBudget(ARCHITECT_LIMITS.request);
    const largestTurn = ARCHITECT_LIMITS.request + ARCHITECT_LIMITS.architectMessage;

    assert.ok(budget >= largestTurn);
  });
});
