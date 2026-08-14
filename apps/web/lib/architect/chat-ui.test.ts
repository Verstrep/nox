/**
 * Frontieres de l'habillage du chat.
 *
 * L'apparence d'un message et l'attente d'une reponse sont des faits d'ecran.
 * Ce fichier verifie qu'ils le restent : aucune classe CSS, aucun libelle
 * d'interface, aucun point d'attente ne doit pouvoir atteindre le transcript, le
 * prompt ou la base.
 *
 * Faute d'un moteur de rendu React dans cette suite — en ajouter un serait une
 * dependance lourde pour quelques assertions —, la presentation est verifiee sur
 * la **source** des composants, et le rendu reel l'est par `functional-020`, qui
 * lit le HTML servi. Les deux se complètent : l'un dit ce que le code prevoit,
 * l'autre ce que le navigateur recoit.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { prepareArchitectGeneration } from "./prepare.ts";
import type { TranscriptEntry } from "./window.ts";

const CHAT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "app",
  "projects",
  "[id]",
  "architect",
  "[sessionId]",
);

function source(file: string): Promise<string> {
  return readFile(path.join(CHAT_DIR, file), "utf8");
}

/** Retire commentaires et documentation : seul le code compte. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");
}

describe("presentation des messages", () => {
  it("aligne le message utilisateur a droite, en bleu", async () => {
    const bubbles = await source("MessageBubble.tsx");
    const user = bubbles.slice(bubbles.indexOf("export function UserBubble"), bubbles.indexOf("export function ArchitectBubble"));

    assert.ok(user.includes("justify-end"), "aligne a droite");
    assert.ok(user.includes("bg-blue-600"), "fond bleu");
    assert.ok(user.includes("rounded-2xl"), "coins de bulle");
    assert.ok(/max-w-\[\d+%\]/u.test(user), "largeur bornee");
    assert.ok(user.includes("whitespace-pre-wrap"), "le texte reste du texte");
  });

  it("laisse la reponse de l'architecte a gauche et sobre", async () => {
    const bubbles = await source("MessageBubble.tsx");
    const architect = bubbles.slice(bubbles.indexOf("export function ArchitectBubble"));

    assert.equal(architect.includes("justify-end"), false, "pas d'alignement a droite");
    assert.equal(architect.includes("bg-blue"), false, "pas de bulle bleue");
    assert.ok(architect.includes("whitespace-pre-wrap"), "le texte reste du texte");
  });

  it("ne reserve les bulles qu'a la conversation projet", async () => {
    // Une session historique garde exactement l'apparence qu'elle avait : la
    // presentation depend d'un drapeau explicite, jamais du contenu.
    const timeline = code(await source("ConversationTimeline.tsx"));

    assert.ok(timeline.includes("chat = false"), "le mode chat est explicite et desactive par defaut");
    assert.ok(timeline.includes("chat ? ("), "la bulle utilisateur depend de ce drapeau");
  });

  it("n'anime jamais un evenement de tache", async () => {
    const timeline = code(await source("ConversationTimeline.tsx"));
    const event = timeline.slice(timeline.indexOf('entry.kind === "task"'), timeline.indexOf("const message ="));

    assert.equal(event.includes("Progressive"), false);
  });
});

describe("l'attente n'est pas un message", () => {
  it("ne touche ni a la base, ni au fournisseur", async () => {
    for (const file of ["PendingArchitectMessage.tsx", "MessageBubble.tsx", "ProgressiveMessage.tsx"]) {
      const body = code(await source(file));
      for (const forbidden of ["@nox/database", "prisma", "fetch(", "openai", "sendArchitect"]) {
        assert.equal(body.includes(forbidden), false, `${file} ne mentionne pas ${forbidden}`);
      }
    }
  });

  it("n'ecrit aucun message : le panneau n'a qu'un chemin d'envoi", async () => {
    const panel = code(await source("ChatPanel.tsx"));

    // Un seul appel d'action : celui du formulaire. Aucun second pipeline de
    // persistance n'accompagne la bulle temporaire.
    assert.equal(panel.split("formAction(").length - 1, 1);
    assert.equal(panel.includes("@nox/database"), false);
    assert.equal(panel.includes("createArchitectMessage"), false);
  });

  it("disparait des que l'envoi rend la main", async () => {
    const panel = code(await source("ChatPanel.tsx"));

    // La bulle et les points sont derives de `pending` : rien a vider, donc rien
    // qui puisse rester bloque apres un succes comme apres un echec.
    assert.ok(panel.includes("const sending = pending ? written : null;"));
    assert.ok(panel.includes("{pending ? <PendingArchitectMessage /> : null}"));
  });

  it("ne laisse aucun de ses libelles atteindre le prompt", async () => {
    const transcript: TranscriptEntry[] = [
      { role: "USER", content: "Ajoute un mode sombre.", proposal: null, turnId: "g1" },
      { role: "ARCHITECT", content: "Voici comment je m'y prendrais.", proposal: null, turnId: "g1" },
    ];
    const prepared = prepareArchitectGeneration({
      projectName: "NOX",
      repositoryPath: "D:/Projets/Dev/nox",
      documents: [],
      inventory: [],
      tasks: [],
      memories: [],
      transcript,
      newMessage: "Et ensuite ?",
      model: "modele-de-test",
      environment: {},
    });

    const sent = `${prepared.prompt.instructions}\n${prepared.prompt.input}`;
    for (const artefact of [
      "nox-dot",
      "bg-blue-600",
      "justify-end",
      "rounded-2xl",
      "prepare sa reponse",
      "Reponse en cours",
      "Envoi…",
    ]) {
      assert.equal(sent.includes(artefact), false, `le prompt ne porte pas « ${artefact} »`);
    }
  });

  it("n'entre dans aucun module qui parle au fournisseur", async () => {
    // Le sens de la dependance dit tout : l'affichage connait le contexte, le
    // contexte ignore l'affichage.
    const modules = ["prepare.ts", "context.ts", "transcript.ts", "window.ts", "service.ts"];
    for (const file of modules) {
      const body = await readFile(
        path.join(path.dirname(fileURLToPath(import.meta.url)), file),
        "utf8",
      );
      for (const component of ["MessageBubble", "PendingArchitectMessage", "ProgressiveMessage", "ChatPanel"]) {
        assert.equal(body.includes(component), false, `${file} n'importe pas ${component}`);
      }
    }
  });
});

describe("revelation d'une reponse", () => {
  it("affiche l'historique en entier, sans animation", async () => {
    const progressive = code(await source("ProgressiveMessage.tsx"));

    // Au chargement d'une page, le contexte vaut `false` : l'etat initial place
    // deja la revelation a son terme, et aucun minuteur n'est arme.
    assert.ok(progressive.includes("createContext(false)"));
    assert.ok(progressive.includes("justArrived ? 0 : Number.POSITIVE_INFINITY"));
  });

  it("n'anime que la reponse arrivee dans la session d'affichage", async () => {
    const panel = code(await source("ChatPanel.tsx"));
    assert.ok(panel.includes("messageCount > openedAt"));
  });

  it("respecte la preference de mouvement reduit", async () => {
    const progressive = code(await source("ProgressiveMessage.tsx"));
    const styles = await readFile(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "app", "globals.css"),
      "utf8",
    );

    assert.ok(progressive.includes("prefers-reduced-motion"), "la revelation la consulte");
    assert.ok(progressive.includes("reduced || shown"), "et affiche tout d'un coup");
    assert.ok(styles.includes("@media (prefers-reduced-motion: reduce)"), "les points se figent");
  });

  it("revele la carte de proposition apres le texte", async () => {
    const progressive = code(await source("ProgressiveMessage.tsx"));
    assert.ok(progressive.includes("{complete ? children : null}"));
  });

  it("ne pretend jamais faire du streaming", async () => {
    // Ce n'est pas du streaming reseau, et le vocabulaire ne doit pas le
    // laisser croire : la reponse est entiere avant le premier bloc affiche.
    for (const file of ["ProgressiveMessage.tsx", "ChatPanel.tsx", "PendingArchitectMessage.tsx"]) {
      const body = (await source(file)).toLowerCase();
      assert.equal(body.includes("streaming openai"), false, file);
      assert.equal(body.includes("token par token"), false, file);
    }
  });
});
