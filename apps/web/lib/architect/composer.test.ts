/**
 * Tests du cycle de vie du composer.
 *
 * Ces cas existent parce qu'ils ont manque. Une conversation projet neuve
 * affichait le formulaire d'ouverture d'une session de conception de tache :
 * un champ fige, vide, sans aucun moyen d'ecrire. Le defaut ne vivait ni dans le
 * service, ni dans la base — les deux etaient corrects — mais dans une decision
 * prise deux fois, en JSX et dans une Server Action, qu'aucun test ne pouvait
 * atteindre.
 *
 * Elle n'est plus prise qu'une fois, ici, et ce fichier la couvre.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ARCHITECT_SESSION_KIND } from "@nox/shared";

import {
  architectComposerTitle,
  architectOpeningMessage,
  type ComposerSession,
} from "./composer.ts";

/** Conversation principale d'un projet : `requestText` y est toujours vide. */
function projectSession(messageCount: number): ComposerSession {
  return { kind: ARCHITECT_SESSION_KIND.PROJECT, messageCount, requestText: "" };
}

function legacySession(messageCount: number): ComposerSession {
  return {
    kind: ARCHITECT_SESSION_KIND.TASK_DESIGN_LEGACY,
    messageCount,
    requestText: "Je veux pouvoir filtrer les livres.",
  };
}

describe("conversation projet", () => {
  it("n'a pas de message d'ouverture, meme neuve", () => {
    // Le coeur du defaut : `requestText` vaut "", qui n'est pas `null`. Rendre
    // ce texte au lieu de `null` figeait le champ sur une chaine vide.
    assert.equal(architectOpeningMessage(projectSession(0)), null);
  });

  it("n'en a pas davantage apres un tour", () => {
    assert.equal(architectOpeningMessage(projectSession(2)), null);
  });

  it("n'en a pas apres plusieurs tours et une tache creee", () => {
    assert.equal(architectOpeningMessage(projectSession(8)), null);
  });

  it("nomme son premier tour un message, pas un envoi a relire", () => {
    assert.equal(architectComposerTitle(projectSession(0)), "Premier message");
  });

  it("nomme les suivants « Votre message »", () => {
    assert.equal(architectComposerTitle(projectSession(2)), "Votre message");
  });

  it("ne rend jamais le requestText, meme s'il portait un texte", () => {
    // Defense en profondeur : c'est le role qui decide, pas le contenu du champ.
    const odd: ComposerSession = {
      kind: ARCHITECT_SESSION_KIND.PROJECT,
      messageCount: 0,
      requestText: "Un texte qui ne devrait pas etre la.",
    };
    assert.equal(architectOpeningMessage(odd), null);
  });
});

describe("session de conception de tache", () => {
  it("garde son message d'ouverture fige au premier tour", () => {
    assert.equal(
      architectOpeningMessage(legacySession(0)),
      "Je veux pouvoir filtrer les livres.",
    );
  });

  it("passe au champ editable des le premier tour echange", () => {
    assert.equal(architectOpeningMessage(legacySession(2)), null);
  });

  it("nomme son premier tour un tour", () => {
    assert.equal(architectComposerTitle(legacySession(0)), "Premier tour");
  });

  it("nomme les suivants « Votre message »", () => {
    assert.equal(architectComposerTitle(legacySession(2)), "Votre message");
  });
});

describe("une seule decision", () => {
  it("le titre se deduit du message d'ouverture, jamais du role directement", () => {
    // Si les deux fonctions divergeaient, une carte pourrait annoncer un champ
    // editable au-dessus d'un texte fige. Elles partagent donc leur source.
    for (const session of [projectSession(0), legacySession(0), projectSession(4), legacySession(4)]) {
      const editable = architectOpeningMessage(session) === null;
      const title = architectComposerTitle(session);
      assert.equal(title === "Premier tour", !editable && session.messageCount === 0);
    }
  });
});
