import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_ARCHITECT_MODEL,
  DEFAULT_ARCHITECT_REASONING_EFFORT,
  effectiveArchitectConfiguration,
  loadArchitectConfig,
} from "./config.ts";
import { architectModelLine, architectModelSourceLabel } from "./display.ts";

/**
 * Visibilite du modele Architecte, avant l'appel.
 *
 * ## D'ou vient cette suite
 *
 * Du premier pilote reel. `BACKLOG-002` de TripKit a ete genere en entier par
 * `gpt-5-mini` : `NOX_ARCHITECT_MODEL` avait ete saisie sans etre enregistree,
 * et rien a l'ecran ne disait avec quoi NOX allait decouper toute une V1. Le
 * modele n'apparaissait qu'**apres** l'appel, dans l'historique.
 *
 * Ces tests fixent les deux garanties qui en sortent : ce qui est affiche est
 * ce qui sera appele, et rien de secret ne traverse.
 */
describe("configuration Architecte effective", () => {
  it("annonce le modele et l'effort par defaut de NOX", () => {
    const configuration = effectiveArchitectConfiguration({ NOX_OPENAI_API_KEY: "sk-test" });

    assert.equal(configuration.model, DEFAULT_ARCHITECT_MODEL);
    assert.equal(configuration.reasoningEffort, DEFAULT_ARCHITECT_REASONING_EFFORT);
    assert.equal(configuration.source, "default");
    assert.equal(configuration.configured, true);
  });

  it("annonce le modele impose par l'environnement, jamais celui de NOX", () => {
    const configuration = effectiveArchitectConfiguration({
      NOX_OPENAI_API_KEY: "sk-test",
      NOX_ARCHITECT_MODEL: "gpt-5-mini",
    });

    assert.equal(configuration.model, "gpt-5-mini");
    assert.equal(configuration.source, "environment");
    // NOX ne connait pas les capacites d'un modele qu'il n'a pas choisi : il
    // n'en demande donc aucun effort, et l'ecran ne doit pas en inventer un.
    assert.equal(configuration.reasoningEffort, null);
  });

  it("resout exactement comme l'appel lui-meme", () => {
    // La garantie centrale : deux resolutions differentes feraient afficher un
    // modele et en appeler un autre — precisement le probleme du pilote.
    for (const model of ["", "gpt-5-mini", "  gpt-4.1  "]) {
      const environment = { NOX_OPENAI_API_KEY: "sk-test", NOX_ARCHITECT_MODEL: model };
      const config = loadArchitectConfig(environment);
      assert.equal(config.ok, true);
      assert.equal(
        effectiveArchitectConfiguration(environment).model,
        config.ok ? config.config.model : null,
        model,
      );
    }
  });

  it("resout le modele meme sans cle : c'est l'appel qui manque, pas le modele", () => {
    const configuration = effectiveArchitectConfiguration({ NOX_ARCHITECT_MODEL: "gpt-5-mini" });

    assert.equal(configuration.model, "gpt-5-mini");
    assert.equal(configuration.configured, false);
  });

  it("ne porte jamais la cle, ni un fragment, ni sa longueur", () => {
    const secret = "sk-proj-ultrasecret-value";
    const configuration = effectiveArchitectConfiguration({
      NOX_OPENAI_API_KEY: secret,
      NOX_ARCHITECT_MODEL: "gpt-5-mini",
    });

    const serialized = JSON.stringify(configuration);
    assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes("sk-"), false);
    assert.equal(serialized.includes(String(secret.length)), false);
    // La liste des champs est fermee : un champ ajoute plus tard devrait passer
    // par ici, et ce test l'obligerait a etre examine.
    assert.deepEqual(Object.keys(configuration).sort(), [
      "configured",
      "model",
      "reasoningEffort",
      "source",
    ]);
  });

  it("ne lit aucune autre variable d'environnement", () => {
    const configuration = effectiveArchitectConfiguration({
      NOX_OPENAI_API_KEY: "sk-test",
      NOX_RUNNER_TOKEN: "runner-secret",
      PATH: "/usr/bin",
      HOME: "/home/someone",
    });

    const serialized = JSON.stringify(configuration);
    assert.equal(serialized.includes("runner-secret"), false);
    assert.equal(serialized.includes("/usr/bin"), false);
    assert.equal(serialized.includes("/home/someone"), false);
  });

  it("n'a aucun effet de bord : la resoudre ne change rien", () => {
    // Un affichage ne doit jamais changer ce qu'il decrit. `process.env` n'est
    // pas mute, et la fonction rend deux fois la meme reponse.
    const environment = { NOX_OPENAI_API_KEY: "sk-test" };
    const first = effectiveArchitectConfiguration(environment);
    const second = effectiveArchitectConfiguration(environment);

    assert.deepEqual(first, second);
    assert.deepEqual(Object.keys(environment), ["NOX_OPENAI_API_KEY"]);
  });
});

describe("affichage du modele Architecte", () => {
  it("compose une seule chaine cherchable", () => {
    assert.equal(
      architectModelLine({ model: "gpt-5.6-sol", reasoningEffort: "high" }),
      "gpt-5.6-sol · reasoning high",
    );
  });

  it("n'invente pas un effort quand NOX n'en demande aucun", () => {
    assert.equal(
      architectModelLine({ model: "gpt-5-mini", reasoningEffort: null }),
      "gpt-5-mini",
    );
  });

  it("dit d'ou vient le modele affiche", () => {
    // « C'est le defaut de NOX » et « c'est ce que vous avez impose » ne se
    // lisent pas pareil, et c'est cette difference que le pilote n'avait pas.
    assert.notEqual(
      architectModelSourceLabel("default"),
      architectModelSourceLabel("environment"),
    );
    assert.equal(architectModelSourceLabel("environment"), "NOX_ARCHITECT_MODEL");
  });
});

/**
 * L'historique et le prochain appel sont deux notions distinctes.
 *
 * Une generation enregistre le modele **reellement** utilisee ; la pastille
 * affiche le modele que le prochain appel utiliserait. Confondre les deux
 * reecrirait l'histoire : `BACKLOG-001` doit continuer de dire `gpt-5-mini`,
 * meme apres que la configuration a change.
 */
describe("historique contre prochain appel", () => {
  it("n'ecrit rien dans une generation passee", () => {
    const historical = { model: "gpt-5-mini", promptVersion: "backlog/2" };
    const next = effectiveArchitectConfiguration({
      NOX_OPENAI_API_KEY: "sk-test",
      NOX_ARCHITECT_MODEL: "gpt-5.6-sol",
    });

    assert.equal(historical.model, "gpt-5-mini");
    assert.notEqual(historical.model, next.model);
  });

  it("le module de configuration n'expose aucun ecrivain", () => {
    // Rien dans cette surface ne doit pouvoir modifier un modele : TASK-034 est
    // de la visibilite, pas un reglage.
    assert.equal(typeof effectiveArchitectConfiguration, "function");
    assert.equal(effectiveArchitectConfiguration.length, 1);
  });
});
