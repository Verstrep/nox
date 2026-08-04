import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isAuthorized } from "./auth.ts";

const TOKEN = "0123456789abcdef0123456789abcdef";

describe("isAuthorized", () => {
  it("accepte le bon jeton", () => {
    assert.equal(isAuthorized(`Bearer ${TOKEN}`, TOKEN), true);
  });

  it("accepte un schema ecrit dans n'importe quelle casse", () => {
    assert.equal(isAuthorized(`bearer ${TOKEN}`, TOKEN), true);
    assert.equal(isAuthorized(`BEARER ${TOKEN}`, TOKEN), true);
  });

  it("refuse un en-tete absent", () => {
    assert.equal(isAuthorized(undefined, TOKEN), false);
  });

  it("refuse un en-tete duplique (tableau)", () => {
    assert.equal(isAuthorized([`Bearer ${TOKEN}`], TOKEN), false);
  });

  it("refuse un schema incorrect", () => {
    assert.equal(isAuthorized(TOKEN, TOKEN), false);
    assert.equal(isAuthorized(`Basic ${TOKEN}`, TOKEN), false);
    assert.equal(isAuthorized(`Token ${TOKEN}`, TOKEN), false);
  });

  it("refuse un jeton vide", () => {
    assert.equal(isAuthorized("Bearer ", TOKEN), false);
    assert.equal(isAuthorized("Bearer", TOKEN), false);
  });

  it("refuse un mauvais jeton", () => {
    assert.equal(isAuthorized("Bearer mauvais-jeton", TOKEN), false);
  });

  it("refuse un jeton de meme longueur mais different", () => {
    const wrong = "f".repeat(TOKEN.length);
    assert.equal(wrong.length, TOKEN.length);
    assert.equal(isAuthorized(`Bearer ${wrong}`, TOKEN), false);
  });

  it("refuse un prefixe correct du jeton attendu", () => {
    assert.equal(isAuthorized(`Bearer ${TOKEN.slice(0, -1)}`, TOKEN), false);
  });
});
