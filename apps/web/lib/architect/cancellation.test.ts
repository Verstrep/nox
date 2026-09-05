/**
 * HOTFIX-004 — le registre d'abandon, les durees, et ce qui reste cote serveur.
 *
 * Trois choses y sont fixees, et elles n'ont en commun que leur origine : le
 * second pilote reel, qui a attendu deux planifications de backlog sans savoir
 * depuis combien de temps ni comment reprendre la main.
 *
 * 1. Un controleur par generation, retire dans **tous** les cas de sortie.
 * 2. Une duree qui se lit, qui ne juge pas, et qui ne s'invente jamais.
 * 3. Un arret qui ne quitte pas le serveur : ni cle, ni plafond, ni
 *    configuration ne traverse jusqu'au navigateur.
 *
 * Aucun appel reseau, aucun fournisseur, aucune base : tout est en memoire.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  abortArchitectCall,
  activeArchitectCallCount,
  registerArchitectAbort,
} from "./cancellation.ts";
import {
  architectDurationLabel,
  architectElapsedMs,
  formatArchitectDuration,
} from "./duration.ts";

const WEB_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function source(relative: string): string {
  return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

/** Retire les commentaires, pour ne pas confondre une consigne et du code. */
function code(relative: string): string {
  return source(relative)
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^\s*\/\/.*$/gmu, "");
}

describe("HOTFIX-004 — registre d'abandon", () => {
  it("un appel inscrit rend un signal encore ouvert", () => {
    const handle = registerArchitectAbort("g-signal");

    assert.equal(handle.signal.aborted, false);
    handle.release();
  });

  it("l'arret abandonne effectivement le signal", () => {
    // Requirement 3 : `Arrêter` doit fermer la requete, pas seulement changer
    // une ligne en base.
    const handle = registerArchitectAbort("g-abort");

    assert.equal(abortArchitectCall("g-abort"), true);
    assert.equal(handle.signal.aborted, true);
  });

  it("l'arret est idempotent : le second clic ne leve pas et ne rend rien", () => {
    // Requirement 9. Un double clic ne doit produire ni exception, ni message
    // d'echec a l'ecran.
    registerArchitectAbort("g-idempotent");

    assert.equal(abortArchitectCall("g-idempotent"), true);
    assert.equal(abortArchitectCall("g-idempotent"), false);
    assert.equal(abortArchitectCall("g-idempotent"), false);
  });

  it("arreter une generation inconnue est sans effet", () => {
    // Le cas d'un arret arrive apres la conclusion normale, ou apres un
    // redemarrage du serveur : `false` dit « je n'ai rien ferme », et non
    // « une erreur est survenue ».
    assert.equal(abortArchitectCall("g-jamais-inscrite"), false);
  });

  it("le registre est vide apres une reussite", () => {
    // Requirement 10.
    const before = activeArchitectCallCount();
    const handle = registerArchitectAbort("g-reussite");
    assert.equal(activeArchitectCallCount(), before + 1);

    handle.release();

    assert.equal(activeArchitectCallCount(), before);
  });

  it("le registre est vide apres une panne, un plafond atteint ou un arret", () => {
    // Requirements 11, 12 et 13. Les trois sorties passent par la meme
    // liberation : c'est pourquoi elle vit dans un `finally` et non sur chaque
    // chemin.
    const before = activeArchitectCallCount();

    for (const key of ["g-panne", "g-plafond"]) {
      const handle = registerArchitectAbort(key);
      handle.release();
    }

    // Un arret retire l'entree lui-meme ; la liberation qui suit ne doit pas
    // s'en offusquer, ni retirer l'entree d'un autre appel.
    const stopped = registerArchitectAbort("g-arret");
    abortArchitectCall("g-arret");
    stopped.release();

    assert.equal(activeArchitectCallCount(), before);
  });

  it("une liberation repetee reste sans effet", () => {
    const before = activeArchitectCallCount();
    const handle = registerArchitectAbort("g-double-liberation");

    handle.release();
    handle.release();

    assert.equal(activeArchitectCallCount(), before);
  });

  it("deux generations recoivent deux controleurs distincts", () => {
    // Requirement 14 : une generation suivante ne doit jamais reutiliser le
    // controleur de la precedente — sinon un arret tardif viserait le mauvais
    // appel.
    const premiere = registerArchitectAbort("g-1");
    const seconde = registerArchitectAbort("g-2");

    assert.notEqual(premiere.signal, seconde.signal);

    abortArchitectCall("g-1");

    assert.equal(premiere.signal.aborted, true);
    assert.equal(seconde.signal.aborted, false, "la seconde generation n'est pas touchee");

    seconde.release();
  });

  it("liberer un appel deja termine n'efface pas l'inscription suivante", () => {
    // La course la plus subtile : une liberation tardive ne doit pas retirer
    // une entree qui ne lui appartient plus.
    const ancienne = registerArchitectAbort("g-recyclee");
    abortArchitectCall("g-recyclee");
    const nouvelle = registerArchitectAbort("g-recyclee");

    ancienne.release();

    assert.equal(abortArchitectCall("g-recyclee"), true, "la nouvelle entree est toujours la");
    assert.equal(nouvelle.signal.aborted, true);
  });

  it("le registre vit sur globalThis, pas dans une variable de module", () => {
    // Next.js ne garantit pas qu'un Route Handler et une Server Action
    // partagent la meme instance d'un module, et recharge ses modules en
    // developpement. Une `Map` de module vivrait en double, et l'arret ne
    // trouverait jamais le controleur qu'il cherche.
    assert.match(code("lib/architect/cancellation.ts"), /Symbol\.for\(/u);
  });
});

describe("HOTFIX-004 — duree affichee", () => {
  it("rend les secondes seules en dessous d'une minute", () => {
    assert.equal(formatArchitectDuration(42_000), "42 s");
    assert.equal(formatArchitectDuration(59_999), "59 s");
  });

  it("rend minutes et secondes au dela", () => {
    // L'exemple du cahier des charges : « 1 min 42 s ».
    assert.equal(formatArchitectDuration(102_000), "1 min 42 s");
    assert.equal(formatArchitectDuration(60_000), "1 min 0 s");
  });

  it("rend heures et minutes au dela d'une heure", () => {
    assert.equal(formatArchitectDuration(3_660_000), "1 h 1 min");
  });

  it("tronque vers le bas, et ne revient jamais en arriere", () => {
    // Un compteur qui arrondirait afficherait « 1 min » a 55 s, puis
    // repasserait a « 0 min 56 s ».
    assert.equal(formatArchitectDuration(55_000), "55 s");
    assert.equal(formatArchitectDuration(59_900), "59 s");
  });

  it("ramene a zero une duree absurde plutot que d'afficher un nombre negatif", () => {
    for (const value of [0, -1, -100_000, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(formatArchitectDuration(value), "0 s", String(value));
    }
  });

  it("le temps ecoule se derive de l'instant persiste", () => {
    // Requirement 16. L'autorite est la date enregistree a la reservation, et
    // non l'instant du clic : elle seule reste juste apres un rechargement.
    const started = "2026-09-07T10:00:00.000Z";
    const now = Date.parse("2026-09-07T10:01:42.000Z");

    assert.equal(architectElapsedMs(started, now), 102_000);
    assert.equal(formatArchitectDuration(102_000), "1 min 42 s");
  });

  it("une date illisible ne produit aucun compteur, plutot qu'un compteur faux", () => {
    assert.equal(architectElapsedMs("pas une date", Date.now()), null);
  });

  it("une horloge reculee ne produit jamais de duree negative", () => {
    const started = "2026-09-07T10:05:00.000Z";
    const now = Date.parse("2026-09-07T10:00:00.000Z");

    assert.equal(architectElapsedMs(started, now), 0);
  });

  it("une duree jamais enregistree ne s'invente pas", () => {
    // Requirement 17 : les generations anterieures a HOTFIX-004 n'ont pas
    // d'instant de fin. Ne rien afficher est la reponse juste.
    assert.equal(architectDurationLabel(null), null);
    assert.equal(architectDurationLabel(102_000), "1 min 42 s");
  });

  it("aucun seuil, aucune alerte, aucun jugement", () => {
    // Depasser quatre-vingt-dix secondes etait la cause d'un echec hier ; c'est
    // un fait sans consequence aujourd'hui. Le module ne doit porter ni seuil,
    // ni vocabulaire d'alerte.
    const text = code("lib/architect/duration.ts");

    for (const forbidden of ["90_000", "90000", "threshold", "warn", "slow", "danger"]) {
      assert.equal(text.includes(forbidden), false, forbidden);
    }
  });
});

describe("HOTFIX-004 — rien de sensible ne quitte le serveur", () => {
  it("l'ecran d'attente ne nomme ni cle, ni plafond, ni variable d'environnement", () => {
    // Requirement 19. Ce composant est un Client Component : tout ce qu'il
    // nomme part dans le bundle du navigateur.
    const component = source("components/ArchitectProgress.tsx");

    for (const forbidden of [
      "process.env",
      "NOX_OPENAI_API_KEY",
      "NOX_ARCHITECT_MODEL",
      "NOX_ARCHITECT_TIMEOUT_MS",
      "ARCHITECT_HARD_TIMEOUT_MS",
      "apiKey",
    ]) {
      assert.equal(component.includes(forbidden), false, forbidden);
    }
  });

  it("l'ecran d'attente n'importe ni base, ni fournisseur, ni configuration", () => {
    const component = source("components/ArchitectProgress.tsx");

    assert.equal(component.includes("@nox/database"), false);
    assert.equal(component.includes("architect/config"), false);
    assert.equal(component.includes("architect/openai"), false);
  });

  it("les routes d'arret ne rendent que des booleens et un instant", () => {
    // Ni modele, ni empreinte, ni prompt, ni message : le corps de reponse est
    // volontairement pauvre, et cette pauvrete est une garantie.
    for (const route of [
      "app/api/projects/[projectId]/architect/[sessionId]/generation/route.ts",
      "app/api/projects/[projectId]/backlog/generation/route.ts",
    ]) {
      const handler = code(route);

      assert.match(handler, /stopped/u, route);
      assert.match(handler, /aborted/u, route);
      for (const forbidden of ["model", "apiKey", "instructions", "promptVersion", "process.env"]) {
        assert.equal(handler.includes(forbidden), false, `${route} : ${forbidden}`);
      }
    }
  });

  it("l'arret conclut la base avant d'abandonner la requete", () => {
    // L'ordre est la garantie : conclure d'abord ferme la fenetre ou une
    // reponse arrivee entre les deux serait acceptee.
    for (const route of [
      "app/api/projects/[projectId]/architect/[sessionId]/generation/route.ts",
      "app/api/projects/[projectId]/backlog/generation/route.ts",
    ]) {
      const handler = code(route);
      const cancelIndex = handler.search(/cancel(Architect|Backlog)Generation\(/u);
      const abortIndex = handler.indexOf("abortArchitectCall(");

      assert.equal(cancelIndex > -1, true, route);
      assert.equal(abortIndex > -1, true, route);
      assert.equal(cancelIndex < abortIndex, true, `${route} : la base d'abord`);
    }
  });

  it("aucune surface ne fixe son propre delai", () => {
    // Requirement : une seule autorite. Une surface qui se donnerait un nombre
    // en dur finirait par attendre deux fois moins longtemps que sa voisine,
    // sans que rien ne le signale.
    for (const file of [
      "lib/architect/service.ts",
      "lib/architect/review-service.ts",
      "lib/backlog/service.ts",
      "lib/verification-refresh/service.ts",
    ]) {
      const text = code(file);

      assert.match(text, /timeoutMs: resolvedArchitectHardTimeoutMs\(\)/u, file);
      assert.equal(/timeoutMs:\s*\d/u.test(text), false, file);
    }
  });

  it("NOX n'oppose aucun second delai au fournisseur", () => {
    // Le plafond vit dans l'option de requete du SDK, et nulle part ailleurs.
    // Un `setTimeout` cote service ferait une seconde echeance, invisible et
    // impossible a regler.
    for (const file of ["lib/architect/service.ts", "lib/backlog/service.ts"]) {
      const text = code(file);

      assert.equal(text.includes("setTimeout"), false, file);
      assert.equal(text.includes("Promise.race"), false, file);
    }
  });
});

describe("HOTFIX-004 — l'arret n'apparait que la ou il veut dire quelque chose", () => {
  it("il n'est monte que pendant un appel, et le parent en decide", () => {
    // Requirement 15. Un bouton `Arrêter` visible en permanence promettrait
    // d'interrompre quelque chose qui n'existe pas.
    //
    // Le montage conditionnel vaut mieux qu'un drapeau interne : le composant
    // n'existe pas hors d'un appel, donc il ne peut ni interroger, ni proposer
    // d'arreter — et chaque envoi repart d'un etat neuf sans qu'aucune remise a
    // zero n'ait a etre ecrite, donc sans qu'aucune puisse etre oubliee.
    const conversation = source("app/projects/[id]/architect/[sessionId]/SendTurnForm.tsx");
    const backlog = source("app/projects/[id]/backlog/GenerateBacklogButton.tsx");

    assert.match(conversation, /\{sending \? \(\s*<ArchitectProgress/u);
    assert.match(backlog, /\{pending \? \(\s*<ArchitectProgress/u);
  });

  it("le composant ne recoit aucun drapeau d'activite", () => {
    // Deux autorites sur « un appel est-il en vol ? » finiraient par diverger,
    // et l'ecran afficherait un compteur pour une generation terminee. Le
    // montage **est** la reponse ; il n'y a pas de seconde version.
    //
    // (`active` subsiste comme nom de champ dans la reponse de la route, ce qui
    // est une autre chose : c'est ce que le serveur rapporte, pas un etat que le
    // composant tiendrait.)
    const component = code("components/ArchitectProgress.tsx");

    assert.equal(component.includes("active: boolean"), false);
    assert.equal(
      component.includes("ArchitectProgress({ statusUrl, stopUrl, label }: ArchitectProgressProps)"),
      true,
      "la signature ne porte que des donnees d'affichage",
    );
  });

  it("le second clic sur Arrêter est bloque avant meme le rendu suivant", () => {
    // Requirement 9 cote interface : une `ref` plutot qu'un etat, parce que la
    // garde doit valoir immediatement.
    const component = code("components/ArchitectProgress.tsx");

    assert.match(component, /stopSent\.current/u);
    assert.match(component, /disabled=\{stopping \|\| stopped\}/u);
  });

  it("l'ecran distingue « requete fermee » de « je ne sais pas »", () => {
    // NOX ne pretend jamais que le travail paye a cesse quand il ne peut pas
    // l'observer. Apres un redemarrage, le controleur n'existe plus, et la
    // phrase change.
    const component = source("components/ArchitectProgress.tsx");

    assert.match(component, /aborted/u);
    assert.match(component, /ne peut pas confirmer/u);
  });

  it("l'ecran ne suggere jamais qu'une attente longue est anormale", () => {
    // La lecon de HOTFIX-004 : quatre-vingt-dix secondes n'etait pas une
    // limite saine, et une generation de plusieurs minutes est legitime.
    const component = source("components/ArchitectProgress.tsx");

    assert.match(component, /plusieurs minutes/u);
    for (const forbidden of ["anormal", "trop long", "bloqu", "animate-"]) {
      assert.equal(component.includes(forbidden), false, forbidden);
    }
  });

  it("`Cancel` et `Arrêter` restent deux gestes distincts", () => {
    // `Cancel` renonce a un brouillon **qui n'est pas parti** ; `Arrêter`
    // interrompt un appel en vol. Leur donner le meme mot ferait croire qu'un
    // brouillon abandonne a coute un appel.
    const conversation = source("app/projects/[id]/architect/[sessionId]/SendTurnForm.tsx");

    assert.match(conversation, /"Cancel"/u);
    assert.match(source("components/ArchitectProgress.tsx"), /Arrêter/u);
  });

  it("aucun arret n'est expose sur les surfaces sans interface", () => {
    // Le rafraichissement des plans de verification est declenche par la
    // completion d'un amorcage : personne ne le regarde travailler, et un
    // bouton qu'aucun ecran ne montre serait un bouton mort. Il beneficie du
    // meme plafond genereux, et de rien d'autre.
    const refresh = code("lib/verification-refresh/service.ts");
    const review = code("lib/architect/review-service.ts");

    for (const text of [refresh, review]) {
      assert.equal(text.includes("registerArchitectAbort"), false);
      assert.equal(text.includes("signal:"), false);
      assert.match(text, /timeoutMs: resolvedArchitectHardTimeoutMs\(\)/u);
    }
  });
});
