/**
 * Tests de la chaine complete, des octets aux evenements publics.
 *
 * Les tests des modules precedents verifient chacun leur etape. Ceux-ci
 * verifient qu'elles sont bien branchees dans le bon ordre — c'est-a-dire que le
 * nettoyage s'applique **apres** la normalisation, et qu'aucune etape ne peut
 * etre contournee.
 */

import { CLAUDE_RUN_EVENT_KIND, type ClaudeRunEventDraft } from "@nox/shared";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ClaudeStreamCollector } from "./collector.ts";

const ROOT = "D:\\Projets\\Dev\\nox";

function collect(chunks: readonly string[], environment: Record<string, string> = {}) {
  const events: ClaudeRunEventDraft[] = [];
  const collector = new ClaudeStreamCollector({
    repositoryRoot: ROOT,
    allowedCommands: ["npm run test"],
    environment,
    caseInsensitivePaths: true,
    onEvents: (batch) => events.push(...batch),
  });

  for (const chunk of chunks) {
    collector.push(chunk);
  }
  collector.end();

  return { events, collector };
}

const INIT = JSON.stringify({ type: "system", subtype: "init" });
const RESULT = JSON.stringify({ type: "result", subtype: "success", is_error: false });

function text(value: string): string {
  return JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text: value }] },
  });
}

function read(id: string, path: string): string {
  return JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id, name: "Read", input: { file_path: path } }],
    },
  });
}

describe("ClaudeStreamCollector", () => {
  it("traite un flux complet", () => {
    const { events } = collect([`${INIT}\n${read("t1", "README.md")}\n${RESULT}\n`]);

    assert.deepEqual(
      events.map((event) => event.label),
      ["Claude Code ready", "Reading README.md", "Completed"],
    );
  });

  it("recolle une ligne coupee entre plusieurs morceaux", () => {
    const line = text("Message reconstitue.");
    const third = Math.ceil(line.length / 3);

    const { events } = collect([
      line.slice(0, third),
      line.slice(third, third * 2),
      `${line.slice(third * 2)}\n`,
    ]);

    assert.equal(events[0]?.detail, "Message reconstitue.");
  });

  it("accepte plusieurs lignes dans un seul morceau", () => {
    const { events } = collect([`${text("Un")}\n${text("Deux")}\n${text("Trois")}\n`]);
    assert.equal(events.length, 3);
  });

  it("accepte CRLF", () => {
    const { events } = collect([`${INIT}\r\n${RESULT}\r\n`]);
    assert.equal(events.length, 2);
  });

  it("traite une derniere ligne sans retour a la ligne", () => {
    const { events, collector } = collect([`${INIT}\n${RESULT}`]);

    assert.equal(events.at(-1)?.kind, CLAUDE_RUN_EVENT_KIND.RESULT);
    assert.notEqual(collector.finalResultLine, null);
  });

  it("conserve la ligne du resultat final pour le parser de TASK-008", () => {
    const { collector } = collect([`${INIT}\n${RESULT}\n`]);
    assert.equal(collector.finalResultLine, RESULT);
  });

  it("laisse la ligne finale a null quand il n'y en a pas", () => {
    const { collector } = collect([`${INIT}\n${text("Sans conclusion.")}\n`]);
    assert.equal(collector.finalResultLine, null);
  });

  it("produit un unique avertissement pour des lignes illisibles", () => {
    const { events } = collect([
      `${INIT}\npas du json\n[1,2]\n42\n${RESULT}\n`,
    ]);

    const warnings = events.filter((event) => event.kind === CLAUDE_RUN_EVENT_KIND.WARNING);
    assert.equal(warnings.length, 1);
  });

  it("n'expose jamais la ligne illisible", () => {
    const { events, collector } = collect([
      `{"contenu":"MOT_DE_PASSE_EN_CLAIR"\n${RESULT}\n`,
    ]);

    assert.equal(JSON.stringify(events).includes("MOT_DE_PASSE_EN_CLAIR"), false);
    // La trace technique retient la taille et la nature, jamais le texte.
    assert.deepEqual(collector.failures[0]?.reason, "invalid_json");
  });

  it("continue apres une ligne illisible", () => {
    const { events } = collect([`pas du json\n${read("t1", "README.md")}\n`]);
    assert.equal(
      events.some((event) => event.label === "Reading README.md"),
      true,
    );
  });

  it("rend les chemins relatifs au repository", () => {
    const { events } = collect([`${read("t1", `${ROOT}\\apps\\web\\lib\\runs.ts`)}\n`]);
    assert.equal(events[0]?.label, "Reading apps/web/lib/runs.ts");
  });

  it("masque un chemin exterieur au repository", () => {
    const { events } = collect([`${read("t1", "C:\\Windows\\System32\\config\\SAM")}\n`]);
    assert.equal(events[0]?.label.includes("System32"), false);
  });

  it("retire un secret NOX du texte d'un message", () => {
    const token = "jeton-de-test-tres-long-0123456789";
    const { events } = collect([`${text(`Le jeton est ${token}`)}\n`], {
      NOX_RUNNER_TOKEN: token,
    });

    assert.equal(JSON.stringify(events).includes(token), false);
  });

  it("borne un detail demesure", () => {
    const { events } = collect([`${text("x".repeat(20_000))}\n`]);
    assert.equal((events[0]?.detail?.length ?? 0) <= 4_096, true);
  });

  it("fusionne deux evenements consecutifs identiques", () => {
    const { events } = collect([`${read("t1", "README.md")}\n${read("t2", "README.md")}\n`]);
    assert.equal(events.length, 1);
  });

  it("ne fusionne pas deux fichiers differents", () => {
    const { events } = collect([`${read("t1", "a.md")}\n${read("t2", "b.md")}\n`]);
    assert.deepEqual(
      events.map((event) => event.label),
      ["Reading a.md", "Reading b.md"],
    );
  });

  it("ne fusionne pas deux messages, meme identiques", () => {
    // Les messages portent un detail : ils ne sont jamais coalesces, sans quoi
    // une repetition volontaire disparaitrait.
    const { events } = collect([`${text("Meme texte.")}\n${text("Meme texte.")}\n`]);
    assert.equal(events.length, 2);
  });

  it("ne laisse passer aucun bloc de raisonnement", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "SECRET_INTERNE", signature: "sig" },
          { type: "text", text: "Public." },
        ],
      },
    });

    const { events } = collect([`${line}\n`]);
    assert.equal(JSON.stringify(events).includes("SECRET_INTERNE"), false);
    assert.equal(events.length, 1);
  });

  it("ne leve pas sur un flux entierement absurde", () => {
    assert.doesNotThrow(() => collect(["\u0000\u0001\n[]\n{}\n\n\r\n"]));
  });
});
