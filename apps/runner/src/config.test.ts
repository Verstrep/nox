import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_RUNNER_HOST, DEFAULT_RUNNER_PORT, isLoopbackHost, loadRunnerConfig } from "./config.ts";

const TOKEN = "jeton-de-test-suffisamment-long";

function environment(overrides: Record<string, string | undefined> = {}) {
  return { NOX_RUNNER_TOKEN: TOKEN, ...overrides };
}

describe("isLoopbackHost", () => {
  it("accepte les adresses de boucle locale", () => {
    for (const host of ["127.0.0.1", "127.1.2.3", "localhost", "LOCALHOST", "::1", "[::1]"]) {
      assert.equal(isLoopbackHost(host), true, host);
    }
  });

  it("refuse toute autre adresse", () => {
    for (const host of ["0.0.0.0", "192.168.1.13", "10.0.0.1", "example.com", "::"]) {
      assert.equal(isLoopbackHost(host), false, host);
    }
  });
});

describe("loadRunnerConfig", () => {
  it("applique les valeurs par defaut", () => {
    const result = loadRunnerConfig(environment());

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.config.host, DEFAULT_RUNNER_HOST);
    assert.equal(result.ok && result.config.port, DEFAULT_RUNNER_PORT);
    assert.equal(result.ok && result.config.token, TOKEN);
  });

  it("accepte un port valide", () => {
    const result = loadRunnerConfig(environment({ NOX_RUNNER_PORT: "4400" }));
    assert.equal(result.ok && result.config.port, 4400);
  });

  it("refuse un port invalide", () => {
    for (const port of ["0", "70000", "abc", "-1", "4310.5"]) {
      const result = loadRunnerConfig(environment({ NOX_RUNNER_PORT: port }));
      assert.equal(result.ok, false, port);
      assert.match(result.ok === false ? result.message : "", /NOX_RUNNER_PORT/);
    }
  });

  it("accepte un host de boucle locale", () => {
    const result = loadRunnerConfig(environment({ NOX_RUNNER_HOST: "localhost" }));
    assert.equal(result.ok && result.config.host, "localhost");
  });

  it("refuse un host non-loopback", () => {
    const result = loadRunnerConfig(environment({ NOX_RUNNER_HOST: "0.0.0.0" }));

    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.message : "", /boucle locale/);
  });

  it("refuse une configuration sans jeton", () => {
    for (const token of [undefined, "", "   "]) {
      const result = loadRunnerConfig({ NOX_RUNNER_TOKEN: token });
      assert.equal(result.ok, false, String(token));
      assert.match(result.ok === false ? result.message : "", /NOX_RUNNER_TOKEN/);
    }
  });

  it("ne recopie jamais le jeton dans un message d'erreur", () => {
    const result = loadRunnerConfig(environment({ NOX_RUNNER_HOST: "0.0.0.0" }));
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.message.includes(TOKEN), false);
  });
});
