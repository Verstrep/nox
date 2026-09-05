import { ARCHITECT_ERROR, ARCHITECT_ERROR_CODES, ARCHITECT_TURN_FAILURE } from "@nox/shared";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ARCHITECT_HARD_TIMEOUT_BOUNDS,
  ARCHITECT_HARD_TIMEOUT_MS,
  ARCHITECT_TIMEOUT_VARIABLE,
  architectHardTimeoutMs,
} from "./config.ts";
import {
  CONTEXT_FINGERPRINT_NOTICE,
  FAILED_TURN_DRAFT_NOTICE,
  architectDiagnosticView,
  architectFailureCategoryLabel,
  architectFailureGuidance,
} from "./diagnostic-display.ts";
import {
  ARCHITECT_OPERATION,
  describeArchitectError,
  describeArchitectFailure,
} from "./errors.ts";

/**
 * La phrase d'echec doit parler de l'operation qui a echoue.
 *
 * ## D'ou vient cette suite
 *
 * Du second pilote reel. Les tours 8 et 9 de TicketPulse demandaient un
 * ajustement du Living V1 Plan — aucune tache n'etait en jeu — et NOX a
 * repondu deux fois :
 *
 * ```text
 * La reponse de l'architecte ne respecte pas le format attendu par NOX.
 * Aucune tache n'a ete creee ; relancez la generation.
 * ```
 *
 * La premiere phrase etait vraie, la seconde parlait d'autre chose, et la
 * troisieme conseillait un geste inutile.
 */
describe("copie d'echec, par operation", () => {
  it("ne parle jamais de taches pour un tour de conversation", () => {
    const message = describeArchitectError(
      ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID,
      ARCHITECT_OPERATION.CONVERSATION,
    );

    assert.equal(/tâche|tache/iu.test(message), false, message);
    assert.equal(/backlog/iu.test(message), false, message);
    assert.match(message, /proposition|mise a jour/iu);
  });

  it("garde le vocabulaire des taches pour une planification", () => {
    // La formulation d'origine reste **exacte** la ou elle decrit ce qui s'est
    // reellement passe : une generation de backlog qui echoue ne cree aucune
    // tache, et le dire est utile.
    const message = describeArchitectError(
      ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID,
      ARCHITECT_OPERATION.BACKLOG,
    );

    assert.match(message, /Aucune tache n'a ete creee/u);
  });

  it("parle d'analyse pour une review", () => {
    const message = describeArchitectError(
      ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID,
      ARCHITECT_OPERATION.REVIEW,
    );

    assert.match(message, /analyse/iu);
    assert.equal(/tâche|tache/iu.test(message), false, message);
  });

  it("ne parle de taches dans aucune phrase generique", () => {
    // Sans operation, la phrase ne doit rien affirmer de ce qui a ete produit :
    // elle sert les surfaces qui n'en declarent pas, et une phrase generique
    // qui parle de taches se trompe partout sauf a un endroit.
    const message = describeArchitectError(ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID);

    assert.equal(/tâche|tache/iu.test(message), false, message);
  });

  it("dit qu'un depassement de budget ne se corrige pas en relancant", () => {
    // C'est le cas deterministe : deux tours identiques echouent identiquement.
    // Conseiller « relancez » etait la pire consigne possible.
    const message = describeArchitectError(ARCHITECT_ERROR.ARCHITECT_UPDATE_TOO_LARGE);

    assert.match(message, /relancer ne changera rien/iu);
    assert.match(message, /plus court|raccourciss/iu);
  });

  it("annonce a l'utilisateur que son message est conserve", () => {
    // Requirement C rendu observable : NOX preservait deja le brouillon, sans
    // jamais le dire. Le pilote ne pouvait donc pas le savoir.
    for (const code of [
      ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID,
      ARCHITECT_ERROR.ARCHITECT_RESPONSE_INCOMPLETE,
      ARCHITECT_ERROR.ARCHITECT_TIMEOUT,
    ]) {
      const message = describeArchitectError(code, ARCHITECT_OPERATION.CONVERSATION);
      assert.match(message, /message est conserve/iu, code);
    }
  });

  it("couvre chaque code, avec ou sans operation", () => {
    for (const code of ARCHITECT_ERROR_CODES) {
      assert.notEqual(describeArchitectError(code).trim(), "", code);
      for (const operation of Object.values(ARCHITECT_OPERATION)) {
        assert.notEqual(describeArchitectError(code, operation).trim(), "", `${code}/${operation}`);
      }
    }
  });

  it("transmet l'operation depuis describeArchitectFailure", () => {
    const conversation = describeArchitectFailure(
      { code: ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID },
      2000,
      ARCHITECT_OPERATION.CONVERSATION,
    );
    const backlog = describeArchitectFailure(
      { code: ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID },
      2000,
      ARCHITECT_OPERATION.BACKLOG,
    );

    assert.notEqual(conversation, backlog);
  });
});

/**
 * Les deux seules phrases autorisees a nommer la variable de cle.
 *
 * Le **nom** oriente vers le fichier a corriger ; la valeur n'apparait jamais.
 * Cet ensemble est ferme volontairement : une troisieme phrase qui la nommerait
 * ferait echouer ce test, et c'est le but.
 */
const NAMES_THE_KEY_VARIABLE = new Set<string>([
  ARCHITECT_ERROR.ARCHITECT_NOT_CONFIGURED,
  ARCHITECT_ERROR.ARCHITECT_AUTH_FAILED,
]);

describe("aucune phrase ne fuit de detail technique", () => {
  it("ne cite ni cle, ni en-tete, ni URL, ni trace, ni chemin", () => {
    const forbidden = [
      "NOX_OPENAI_API_KEY",
      "sk-",
      "Authorization",
      "Bearer",
      "api.openai.com",
      "https://",
      "at Object.",
      "node_modules",
      "C:\\",
      "/home/",
    ];

    const operations = [undefined, ...Object.values(ARCHITECT_OPERATION)];
    for (const code of ARCHITECT_ERROR_CODES) {
      for (const operation of operations) {
        const message = describeArchitectError(code, operation);
        for (const needle of forbidden) {
          // Deux phrases nomment `NOX_OPENAI_API_KEY` : celle qui dit qu'elle
          // manque, et celle qui dit qu'elle a ete refusee. Y renvoyer est
          // precisement leur but, et le **nom** d'une variable n'est pas sa
          // valeur. Toute autre phrase doit s'en abstenir.
          if (needle === "NOX_OPENAI_API_KEY" && NAMES_THE_KEY_VARIABLE.has(code)) {
            continue;
          }
          assert.equal(message.includes(needle), false, `${code} → ${needle}`);
        }
      }
    }
  });
});

describe("affichage d'un diagnostic", () => {
  it("compose categorie, champ et consigne", () => {
    const view = architectDiagnosticView({
      category: ARCHITECT_TURN_FAILURE.CONTRACT_INVALID,
      field: "projectUpdate.plan",
      message: "L'action proposee pour « plan » est inconnue.",
    });

    assert.notEqual(view, null);
    assert.equal(view?.fieldPath, "projectUpdate.plan");
    assert.equal(view?.fieldLabel, "Mise à jour du projet");
    assert.notEqual(view?.guidance.trim(), "");
  });

  it("n'invente aucune cause quand rien n'a ete enregistre", () => {
    // Les tours anterieurs a HOTFIX-003 — dont ceux du pilote — n'en portent
    // aucune. Reconstruire une cause apres coup inventerait une information.
    assert.equal(architectDiagnosticView(null), null);
  });

  it("donne une consigne differente selon la nature du probleme", () => {
    const guidance = new Set(
      Object.values(ARCHITECT_TURN_FAILURE).map((category) =>
        architectFailureGuidance(category),
      ),
    );

    // Trois gestes distincts au minimum : relancer, raccourcir, attendre.
    assert.equal(guidance.size >= 3, true);
    assert.match(
      architectFailureGuidance(ARCHITECT_TURN_FAILURE.UPDATE_TOO_LARGE),
      /ne changera rien/iu,
    );
  });

  it("nomme chaque categorie de facon distincte", () => {
    const labels = Object.values(ARCHITECT_TURN_FAILURE).map(architectFailureCategoryLabel);

    assert.equal(new Set(labels).size, labels.length);
    for (const label of labels) {
      assert.notEqual(label.trim(), "");
    }
  });
});

/**
 * L'empreinte de contexte, et pourquoi sa repetition est normale.
 *
 * Le pilote a vu six tours consecutifs porter `194b2de3c931` avec des messages
 * differents, et s'est demande si NOX envoyait un contexte perime.
 */
describe("empreinte de contexte", () => {
  it("dit ce qu'elle couvre, et ce qu'elle ne couvre pas", () => {
    assert.match(CONTEXT_FINGERPRINT_NOTICE, /brief/iu);
    assert.match(CONTEXT_FINGERPRINT_NOTICE, /jamais vos messages/iu);
    assert.match(CONTEXT_FINGERPRINT_NOTICE, /comportement attendu/iu);
  });

  it("le brouillon conserve est annonce", () => {
    assert.match(FAILED_TURN_DRAFT_NOTICE, /conserv/iu);
  });
});

/**
 * Le plafond de securite du fournisseur.
 *
 * ## Ce que ces tests fixaient, et ce qui a change
 *
 * Ils fixaient la portee — un seul delai, par requete, partage par les quatre
 * surfaces, sans reessai — et disaient explicitement ne pas fixer que 90 s soit
 * la bonne valeur : « l'enquete n'a pas produit de preuve suffisante pour en
 * changer ».
 *
 * HOTFIX-004 a produit cette preuve. Le second pilote reel a vu quatre
 * depassements sur **deux** charges de travail differentes — une conversation
 * volumineuse, puis deux planifications de backlog — et une seule reussite,
 * obtenue en amputant la demande. Quatre-vingt-dix secondes n'etait donc pas un
 * garde-fou mais une echeance, et elle etait trop courte.
 *
 * Ce que ces tests fixent desormais : la portee, inchangee, et le fait que la
 * valeur est un **plafond de securite** — genereux, borne, et jamais presente a
 * l'utilisateur comme une duree attendue.
 */
describe("configuration du plafond de securite", () => {
  const WEB_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

  function source(relative: string): string {
    return readFileSync(path.join(WEB_ROOT, relative), "utf8");
  }

  it("est une constante unique, exprimee en millisecondes", () => {
    assert.equal(Number.isInteger(ARCHITECT_HARD_TIMEOUT_MS), true);
    assert.equal(ARCHITECT_HARD_TIMEOUT_MS, 10 * 60 * 1000);
  });

  it("laisse largement passer une generation qui depasse l'ancienne echeance", () => {
    // Le coeur du correctif : un travail de plusieurs minutes est legitime.
    assert.equal(ARCHITECT_HARD_TIMEOUT_MS > 90_000, true);
  });

  it("un environnement vide donne le defaut", () => {
    assert.equal(architectHardTimeoutMs({}), ARCHITECT_HARD_TIMEOUT_MS);
    assert.equal(
      architectHardTimeoutMs({ [ARCHITECT_TIMEOUT_VARIABLE]: "   " }),
      ARCHITECT_HARD_TIMEOUT_MS,
    );
  });

  it("une valeur entiere dans les bornes est retenue", () => {
    assert.equal(
      architectHardTimeoutMs({ [ARCHITECT_TIMEOUT_VARIABLE]: "300000" }),
      300_000,
    );
    assert.equal(
      architectHardTimeoutMs({
        [ARCHITECT_TIMEOUT_VARIABLE]: String(ARCHITECT_HARD_TIMEOUT_BOUNDS.min),
      }),
      ARCHITECT_HARD_TIMEOUT_BOUNDS.min,
    );
    assert.equal(
      architectHardTimeoutMs({
        [ARCHITECT_TIMEOUT_VARIABLE]: String(ARCHITECT_HARD_TIMEOUT_BOUNDS.max),
      }),
      ARCHITECT_HARD_TIMEOUT_BOUNDS.max,
    );
  });

  it("toute valeur illisible ou hors bornes retombe sur le defaut", () => {
    // Une variable mal ecrite ne doit pas produire un plafond que personne n'a
    // voulu — ni une seconde, ni une journee.
    for (const value of [
      "abc",
      "",
      "12.5",
      "-1",
      "0",
      " 300000abc",
      String(ARCHITECT_HARD_TIMEOUT_BOUNDS.min - 1),
      String(ARCHITECT_HARD_TIMEOUT_BOUNDS.max + 1),
    ]) {
      assert.equal(
        architectHardTimeoutMs({ [ARCHITECT_TIMEOUT_VARIABLE]: value }),
        ARCHITECT_HARD_TIMEOUT_MS,
        value,
      );
    }
  });

  it("une notation scientifique entiere reste une valeur entiere", () => {
    // `Number("1e6")` vaut un million, et c'est un entier dans les bornes.
    // Le refuser demanderait une regle de plus pour interdire une ecriture
    // parfaitement claire ; ce test consigne le comportement plutot que de
    // laisser croire qu'il a ete decide ailleurs.
    assert.equal(architectHardTimeoutMs({ [ARCHITECT_TIMEOUT_VARIABLE]: "1e6" }), 1_000_000);
  });

  it("la variable porte le prefixe qui la met hors de portee de Claude Code", () => {
    // Le runner retire toutes les variables `NOX_` de l'environnement de
    // l'agent. Le prefixe n'est pas cosmetique.
    assert.match(ARCHITECT_TIMEOUT_VARIABLE, /^NOX_/u);
  });

  it("s'applique par requete, et n'autorise aucun reessai automatique", () => {
    // `maxRetries: 0` est la garantie qui empeche une facturation en double et
    // des propositions dupliquees. Elle vit a un seul endroit.
    const provider = source("lib/architect/openai.ts");

    assert.match(provider, /timeout: input\.timeoutMs/u);
    assert.match(provider, /maxRetries: 0/u);
  });

  it("est la meme pour les quatre surfaces d'appel", () => {
    // Une surface qui se donnerait son propre delai finirait par diverger sans
    // que rien ne le signale.
    for (const file of [
      "lib/architect/service.ts",
      "lib/architect/review-service.ts",
      "lib/backlog/service.ts",
      "lib/verification-refresh/service.ts",
    ]) {
      assert.match(source(file), /timeoutMs: resolvedArchitectHardTimeoutMs\(\)/u, file);
    }
  });

  it("aucun chemin de code ne relance un appel apres un echec", () => {
    // Requirement D : ni reessai aveugle, ni repli de modele. Un echec remonte
    // a l'utilisateur, qui recliquera s'il le souhaite.
    const service = source("lib/architect/service.ts").replace(/\/\*[\s\S]*?\*\//gu, "");

    assert.equal(service.includes("retry"), false);
    assert.equal(service.includes("fallbackModel"), false);
  });
});


/**
 * Un code enregistre reste lisible tel qu'il a ete enregistre.
 *
 * ## La regression que le second pilote a vue immediatement
 *
 * Ses tours 5 et 6, persistes avec `ARCHITECT_TIMEOUT`, se sont mis a afficher
 * « Panne du fournisseur / Rien n'a ete recu de lisible » apres le premier
 * correctif. La categorie `PROVIDER_ERROR` regroupe cinq codes ; s'en servir
 * comme libelle effacait le fait que la base portait toujours.
 *
 * Aucune ligne ancienne n'a ete modifiee, et aucune cause n'est reconstruite :
 * ce qui s'affiche est le code qui avait ete ecrit.
 */
describe("HOTFIX-003 — un delai depasse continue de se lire comme un delai", () => {
  const PROVIDER_FAILURE = {
    category: ARCHITECT_TURN_FAILURE.PROVIDER_ERROR,
    field: null,
    message: null,
  } as const;

  it("affiche « delai depasse » pour une generation persistee en timeout", () => {
    const view = architectDiagnosticView(PROVIDER_FAILURE, ARCHITECT_ERROR.ARCHITECT_TIMEOUT);

    assert.match(view?.category ?? "", /[Dd]élai dépassé/u);
    assert.match(view?.guidance ?? "", /délai imparti/u);
    assert.equal((view?.category ?? "").includes("Panne du fournisseur"), false);
  });

  it("distingue les cinq codes que la categorie regroupe", () => {
    const labels = [
      ARCHITECT_ERROR.ARCHITECT_TIMEOUT,
      ARCHITECT_ERROR.ARCHITECT_RATE_LIMITED,
      ARCHITECT_ERROR.ARCHITECT_AUTH_FAILED,
      ARCHITECT_ERROR.ARCHITECT_CONTEXT_TOO_LARGE,
      ARCHITECT_ERROR.ARCHITECT_PROVIDER_ERROR,
    ].map((code) => architectDiagnosticView(PROVIDER_FAILURE, code)?.category);

    assert.equal(new Set(labels).size, 5, "aucun code n'en efface un autre");
  });

  it("ne conseille pas d'attendre quand attendre ne sert a rien", () => {
    // Une cle refusee et un contexte trop grand ne se corrigent pas en
    // patientant : la consigne de la categorie serait fausse pour eux.
    for (const code of [
      ARCHITECT_ERROR.ARCHITECT_AUTH_FAILED,
      ARCHITECT_ERROR.ARCHITECT_CONTEXT_TOO_LARGE,
    ]) {
      const view = architectDiagnosticView(PROVIDER_FAILURE, code);
      assert.match(view?.guidance ?? "", /ne changera rien/u, code);
    }
  });

  it("retombe sur la categorie quand aucun code n'est fourni", () => {
    const view = architectDiagnosticView(PROVIDER_FAILURE);

    assert.equal(view?.category, "Panne du fournisseur");
  });

  it("ne reconstruit aucune cause pour une ligne sans diagnostic", () => {
    // Les tours 8 et 9 du pilote portent `errorCode` sans champ ni phrase. Le
    // code se lit ; la cause, elle, n'a jamais ete enregistree.
    assert.equal(architectDiagnosticView(null, ARCHITECT_ERROR.ARCHITECT_TIMEOUT), null);
  });

  it("ne touche pas au libelle des echecs de contrat", () => {
    const view = architectDiagnosticView(
      { category: ARCHITECT_TURN_FAILURE.CONTRACT_INVALID, field: "projectUpdate.plan.inScope", message: null },
      ARCHITECT_ERROR.ARCHITECT_OUTPUT_INVALID,
    );

    assert.equal(view?.category, "Contrat non respecté");
  });
});
