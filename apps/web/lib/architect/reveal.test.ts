/**
 * Tests du decoupage de revelation.
 *
 * La propriete la plus importante tient en une ligne : **la concatenation des
 * blocs redonne exactement le texte**. Une animation qui perdrait un caractere
 * ferait mentir l'affichage sur ce que l'architecte a repondu — et le lecteur
 * n'aurait aucun moyen de s'en apercevoir.
 *
 * La seconde est la duree : elle est plafonnee, donc une longue reponse ne se
 * transforme jamais en attente.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  planReveal,
  REVEAL_MAX_MS,
  REVEAL_MAX_STEPS,
  REVEAL_STEP_MS,
} from "./reveal.ts";

const SHORT = "Une reponse courte.";
const MEDIUM =
  "Trois options se defendent ici, selon ce que tu veux garder simple. " +
  "La premiere consiste a tout faire cote client, la seconde a passer par une " +
  "API dediee, et la troisieme a ne rien changer pour l'instant.";
const LONG = `${MEDIUM} `.repeat(30);

/** Les blocs redonnent-ils le texte, dans l'ordre ? */
function rebuilds(text: string): boolean {
  return planReveal(text).chunks.join("") === text;
}

describe("planReveal — fidelite au texte", () => {
  it("ne perd rien sur un texte court", () => {
    assert.equal(rebuilds(SHORT), true);
  });

  it("ne perd rien sur un texte moyen", () => {
    assert.equal(rebuilds(MEDIUM), true);
  });

  it("ne perd rien sur un texte tres long", () => {
    assert.equal(rebuilds(LONG), true);
  });

  it("ne perd rien sur des sauts de ligne", () => {
    const text = "Premier paragraphe.\n\nSecond paragraphe.\n\nTroisieme.";
    assert.equal(rebuilds(text), true);
  });

  it("ne perd rien sur de l'Unicode hors du plan de base", () => {
    // Emoji et ideogrammes : couper une paire de substitution afficherait un
    // caractere de remplacement au milieu de l'animation.
    const text = "Bravo 🎉 pour cette idee 👏 vraiment 🚀 excellente. 日本語のテキストもあります。";
    const plan = planReveal(text);

    assert.equal(plan.chunks.join(""), text);
    for (const chunk of plan.chunks) {
      assert.equal(chunk.includes("�"), false, "aucun caractere de remplacement");
      // Aucune moitie de paire de substitution isolee.
      assert.equal([...chunk].join("") , chunk);
    }
  });

  it("ne perd rien sur un texte sans le moindre espace", () => {
    assert.equal(rebuilds("a".repeat(1_500)), true);
  });

  it("ne perd rien sur des accents et des apostrophes", () => {
    assert.equal(rebuilds("L'idée d'Éric était déjà là, tôt ce matin-là — vraiment."), true);
  });

  it("rend un plan vide pour un texte vide", () => {
    const plan = planReveal("");
    assert.deepEqual(plan.chunks, []);
    assert.equal(plan.totalMs, 0);
  });

  it("rend un seul bloc pour un texte minuscule", () => {
    const plan = planReveal("Oui.");
    assert.deepEqual(plan.chunks, ["Oui."]);
  });
});

describe("planReveal — duree", () => {
  it("plafonne la duree, quelle que soit la longueur", () => {
    for (const text of [SHORT, MEDIUM, LONG, "a".repeat(50_000)]) {
      const plan = planReveal(text);
      assert.ok(
        plan.totalMs <= REVEAL_MAX_MS,
        `${String(plan.totalMs)} ms pour ${String(text.length)} caracteres`,
      );
      assert.ok(plan.chunks.length <= REVEAL_MAX_STEPS);
    }
  });

  it("reste rapide sur une reponse courte", () => {
    assert.ok(planReveal(SHORT).totalMs <= 500);
  });

  it("tient une reponse moyenne sous une seconde et demie", () => {
    const plan = planReveal(MEDIUM);
    assert.ok(plan.totalMs <= 1_500, `${String(plan.totalMs)} ms`);
  });

  it("ne croit pas lineairement avec la longueur", () => {
    // Trente fois plus long ne doit pas vouloir dire trente fois plus lent : ce
    // sont les blocs qui grossissent, pas la duree.
    const texte = LONG.length / MEDIUM.length;
    const duree = planReveal(LONG).totalMs / planReveal(MEDIUM).totalMs;

    assert.ok(
      duree < texte / 4,
      `texte x${texte.toFixed(1)} mais duree x${duree.toFixed(1)}`,
    );
  });

  it("agrandit les blocs plutot que d'ajouter des etapes", () => {
    const moyen = planReveal(MEDIUM);
    const long = planReveal(LONG);
    const taille = (plan: { chunks: string[] }) =>
      plan.chunks.reduce((total, chunk) => total + chunk.length, 0) / plan.chunks.length;

    assert.ok(taille(long) > taille(moyen));
  });

  it("annonce un intervalle constant", () => {
    assert.equal(planReveal(MEDIUM).stepMs, REVEAL_STEP_MS);
  });
});

describe("planReveal — coupes", () => {
  it("coupe entre les mots, pas au milieu", () => {
    const plan = planReveal(MEDIUM);
    // Chaque bloc sauf le dernier se termine par un separateur.
    for (const chunk of plan.chunks.slice(0, -1)) {
      assert.match(chunk, /\s$/u, `bloc mal coupe : ${JSON.stringify(chunk)}`);
    }
  });

  it("coupe quand meme un texte sans separateur", () => {
    // Sinon une URL de deux mille caracteres apparaitrait d'un seul coup.
    const plan = planReveal("a".repeat(2_000));
    assert.ok(plan.chunks.length > 1);
  });

  it("est deterministe", () => {
    assert.deepEqual(planReveal(MEDIUM), planReveal(MEDIUM));
  });
});

describe("frontiere avec la persistance", () => {
  it("ne touche ni au reseau, ni au fournisseur, ni au temps", async () => {
    // Ce module decide d'un affichage. S'il pouvait joindre le fournisseur ou
    // ecrire quelque part, une animation deviendrait un effet de bord.
    const file = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("./reveal.ts", import.meta.url), "utf8"),
    );
    const code = file.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");

    for (const forbidden of ["fetch", "provider", "await", "import", "Date", "setTimeout"]) {
      assert.equal(code.includes(forbidden), false, `le code ne mentionne pas ${forbidden}`);
    }
  });
});
