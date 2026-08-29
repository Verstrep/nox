import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { repositoryLockKey, sameRepository } from "../dist/index.js";

/**
 * Ce que ces tests protegent : le domaine du verrou d'execution.
 *
 * Une cle trop large bloquerait deux repositories qui n'ont rien a partager.
 * Une cle trop etroite laisserait deux Claude Code ecrire dans le meme dossier.
 * Les deux erreurs sont graves, et aucune ne se voit a la lecture du code
 * appelant — d'ou ces cas ecrits a la main.
 */

const BACKSLASH = String.fromCharCode(92);
const WIN = (...segments: readonly string[]): string => segments.join(BACKSLASH);

describe("repositoryLockKey - chemins Windows", () => {
  it("ignore un separateur final", () => {
    assert.equal(
      repositoryLockKey(WIN("D:", "depots", "alpha")),
      repositoryLockKey(WIN("D:", "depots", "alpha", "")),
    );
  });

  it("ignore le sens des separateurs", () => {
    assert.equal(
      repositoryLockKey(WIN("D:", "depots", "alpha")),
      repositoryLockKey("D:/depots/alpha"),
    );
  });

  it("ignore la casse", () => {
    // Sous Windows, `d:\depots\alpha` et `D:\Depots\Alpha` sont le meme dossier.
    // Deux cles differentes y autoriseraient deux executions simultanees.
    assert.equal(
      repositoryLockKey(WIN("d:", "depots", "alpha")),
      repositoryLockKey(WIN("D:", "Depots", "Alpha")),
    );
  });

  it("reduit les segments relatifs residuels", () => {
    assert.equal(
      repositoryLockKey(WIN("D:", "depots", "beta", "..", "alpha")),
      repositoryLockKey(WIN("D:", "depots", "alpha")),
    );
    assert.equal(
      repositoryLockKey(WIN("D:", "depots", ".", "alpha")),
      repositoryLockKey(WIN("D:", "depots", "alpha")),
    );
  });

  it("ne remonte jamais au-dessus de la racine", () => {
    // Une cle qui deborderait vers le haut ferait de deux lecteurs differents la
    // meme cle.
    assert.notEqual(
      repositoryLockKey(WIN("D:", "..", "..", "..", "alpha")),
      repositoryLockKey(WIN("C:", "..", "..", "..", "alpha")),
    );
  });

  it("distingue deux repositories voisins", () => {
    assert.notEqual(
      repositoryLockKey(WIN("D:", "depots", "alpha")),
      repositoryLockKey(WIN("D:", "depots", "alpha-bis")),
    );
    assert.notEqual(
      repositoryLockKey(WIN("D:", "depots", "alpha")),
      repositoryLockKey(WIN("D:", "depots", "alpha", "sous-dossier")),
    );
  });

  it("distingue deux lecteurs", () => {
    assert.notEqual(
      repositoryLockKey(WIN("C:", "depots", "alpha")),
      repositoryLockKey(WIN("D:", "depots", "alpha")),
    );
  });

  it("conserve le prefixe UNC", () => {
    const unc = repositoryLockKey(WIN("", "", "serveur", "partage", "depot"));
    assert.ok(unc.startsWith(BACKSLASH + BACKSLASH), unc);
    // Reduire le prefixe ferait d'un partage reseau un chemin local.
    assert.notEqual(unc, repositoryLockKey(WIN("", "serveur", "partage", "depot")));
  });
});

describe("repositoryLockKey - chemins POSIX", () => {
  it("ignore une barre finale", () => {
    assert.equal(repositoryLockKey("/srv/depots/alpha/"), repositoryLockKey("/srv/depots/alpha"));
  });

  it("reduit les segments relatifs residuels", () => {
    assert.equal(
      repositoryLockKey("/srv/depots/beta/../alpha"),
      repositoryLockKey("/srv/depots/alpha"),
    );
  });

  it("conserve la casse", () => {
    // Sur un systeme sensible a la casse, ce sont deux dossiers distincts : les
    // confondre bloquerait a tort le second.
    assert.notEqual(repositoryLockKey("/srv/Depots"), repositoryLockKey("/srv/depots"));
  });
});

describe("repositoryLockKey - valeurs vides", () => {
  it("rend une cle vide pour une chaine vide", () => {
    assert.equal(repositoryLockKey(""), "");
    assert.equal(repositoryLockKey("   "), "");
  });

  it("ne fait jamais de deux absences un meme repository", () => {
    // Une cle vide ne designe rien : en faire un verrou bloquerait tout le monde.
    assert.equal(sameRepository("", ""), false);
    assert.equal(sameRepository("   ", ""), false);
  });
});

describe("sameRepository", () => {
  it("reconnait deux ecritures du meme repository", () => {
    assert.equal(sameRepository(WIN("D:", "depots", "alpha"), "D:/depots/alpha/"), true);
  });

  it("refuse deux repositories differents", () => {
    assert.equal(
      sameRepository(WIN("D:", "depots", "alpha"), WIN("D:", "depots", "beta")),
      false,
    );
  });
});
