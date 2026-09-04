/**
 * Traduction des echecs du runner en messages destines a l'utilisateur.
 *
 * Le runner ne renvoie que des codes ; toute la formulation vit ici. Aucun
 * message ne contient l'URL du runner, le jeton, ni un detail technique.
 */

import { RUNNER_ERROR, type RunnerErrorCode } from "@nox/shared";

export type RunnerFailure =
  /** Ni `NOX_RUNNER_TOKEN` ni configuration exploitable cote web. */
  | { kind: "not_configured" }
  /** Aucune connexion possible : runner arrete, port different, pare-feu. */
  | { kind: "unreachable" }
  /** Le runner n'a pas repondu dans le delai imparti. */
  | { kind: "timeout" }
  /** Le runner a refuse le jeton : les deux processus n'ont pas la meme valeur. */
  | { kind: "unauthorized" }
  /** Reponse illisible ou ne respectant pas le contrat partage. */
  | { kind: "invalid_response" }
  /**
   * Echec metier remonte par le runner, avec son code stable.
   *
   * `detail` est facultatif et purement descriptif : il nomme ce que le code
   * laisse ambigu — un programme introuvable et un lancement refuse par le
   * systeme partagent `VALIDATION_SPAWN_FAILED`. Il n'entre dans aucune
   * decision, et aucune traduction ne depend de sa presence.
   */
  | { kind: "runner_error"; code: RunnerErrorCode; detail?: string };

export type RunnerResult<TValue> =
  | { ok: true; value: TValue }
  | { ok: false; failure: RunnerFailure };

const RUNNER_UNAVAILABLE_MESSAGE =
  "Le runner local ne repond pas. Demarrez-le dans un autre terminal avec « npm run dev:runner », puis reessayez.";

const GENERIC_RUNNER_ERROR_MESSAGE =
  "Le runner a refuse la demande. Consultez les logs du runner pour le detail.";

/**
 * Message du conflit de revision.
 *
 * Il doit dire trois choses : ce qui s'est passe, que rien n'a ete perdu, et
 * quoi faire ensuite. NOX ne propose deliberement pas d'ecraser la version du
 * disque : personne ne peut choisir sans avoir vu ce qui a change.
 */
const DOCUMENT_CONFLICT_MESSAGE =
  "Ce document a ete modifie depuis son ouverture. Votre texte est conserve ci-dessous : " +
  "rechargez la version actuelle du fichier, puis reportez-y vos modifications.";

const REVISION_MISSING_MESSAGE =
  "Cette page d'edition n'est plus a jour. Rechargez le document avant de l'enregistrer.";

/**
 * Message du conflit de suppression.
 *
 * Volontairement different de celui de l'edition, malgre une cause identique.
 * Apres un refus d'ecriture, l'utilisateur a un texte a reporter ; apres un
 * refus de suppression, il n'a rien a sauver — seulement une version qu'il n'a
 * pas vue et qu'il doit relire avant de decider. Le geste attendu n'est pas le
 * meme, la phrase non plus.
 */
const DOCUMENT_DELETE_CONFLICT_MESSAGE =
  "Ce document a ete modifie depuis son affichage. Rechargez sa version actuelle avant de le " +
  "supprimer : le fichier present sur le disque n'est pas celui que vous avez sous les yeux.";

const CODE_MESSAGES: Record<RunnerErrorCode, string> = {
  [RUNNER_ERROR.PATH_REQUIRED]: "Indiquez le chemin du repository Git local.",
  [RUNNER_ERROR.PATH_NOT_ABSOLUTE]:
    "Le chemin doit etre absolu (par exemple D:\\Projets\\mon-projet).",
  [RUNNER_ERROR.PATH_NOT_FOUND]: "Ce chemin n'existe pas sur cette machine.",
  [RUNNER_ERROR.PATH_NOT_DIRECTORY]: "Ce chemin pointe vers un fichier : indiquez un dossier.",
  [RUNNER_ERROR.NOT_A_GIT_REPOSITORY]: "Ce dossier n'appartient a aucun repository Git.",
  [RUNNER_ERROR.GIT_NOT_AVAILABLE]:
    "Git est introuvable sur cette machine. Installez Git et verifiez qu'il est dans le PATH.",
  [RUNNER_ERROR.GIT_TIMEOUT]: "Git n'a pas repondu dans le delai imparti.",

  // --- Documents ------------------------------------------------------------
  [RUNNER_ERROR.REPOSITORY_NOT_FOUND]:
    "Le repository de ce projet est introuvable. Il a peut-etre ete deplace ou supprime depuis son enregistrement.",
  [RUNNER_ERROR.REPOSITORY_NOT_DIRECTORY]:
    "Le chemin enregistre pour ce projet ne designe plus un dossier.",
  [RUNNER_ERROR.DOCUMENT_NOT_FOUND]:
    "Ce document n'existe plus dans le repository. Il a peut-etre ete supprime ou renomme.",
  [RUNNER_ERROR.DOCUMENT_NOT_FILE]: "Cet emplacement designe un dossier, pas un document.",
  [RUNNER_ERROR.DOCUMENT_NOT_MARKDOWN]: "Seuls les fichiers Markdown (.md) peuvent etre ouverts.",
  [RUNNER_ERROR.DOCUMENT_NOT_ALLOWED]:
    "Ce document se trouve hors des emplacements inspectes par NOX (racine, docs/, decisions/, plans/, tasks/).",
  [RUNNER_ERROR.DOCUMENT_TOO_LARGE]:
    "Ce document depasse la taille maximale lisible (1 Mio). Ouvrez-le dans votre editeur.",
  [RUNNER_ERROR.DOCUMENT_NOT_UTF8]:
    "Ce fichier n'est pas du texte UTF-8 valide. NOX ne tente pas de deviner son encodage.",
  [RUNNER_ERROR.DOCUMENT_READ_FAILED]:
    "La lecture de ce document a echoue. Verifiez qu'il n'est pas verrouille par un autre programme.",
  [RUNNER_ERROR.TOO_MANY_DOCUMENTS]:
    "Ce repository contient trop de documents Markdown pour etre inventorie (limite : 500).",

  // --- Ecriture -------------------------------------------------------------
  [RUNNER_ERROR.DOCUMENT_CONFLICT]: DOCUMENT_CONFLICT_MESSAGE,
  [RUNNER_ERROR.DOCUMENT_SYMLINK_NOT_WRITABLE]:
    "Ce document est un lien symbolique. NOX ne modifie que des fichiers reels, pour que le fichier ecrit ne soit jamais une surprise.",
  [RUNNER_ERROR.DOCUMENT_CONTENT_INVALID]:
    "Le texte saisi contient un caractere que NOX ne peut pas enregistrer en UTF-8. Retirez-le et reessayez.",
  [RUNNER_ERROR.DOCUMENT_TEMPORARY_FILE_FAILED]:
    "NOX n'a pas pu preparer l'ecriture dans le dossier du document. Le fichier n'a pas ete modifie ; verifiez l'espace disque et les droits du dossier.",
  [RUNNER_ERROR.DOCUMENT_WRITE_FAILED]:
    "L'enregistrement a echoue et le document n'a pas ete modifie. Il est peut-etre verrouille par un autre programme.",
  // Ces deux codes signalent un formulaire altere ou une page restee ouverte
  // trop longtemps : l'utilisateur ne peut rien y faire d'autre que recharger.
  [RUNNER_ERROR.DOCUMENT_REVISION_REQUIRED]: REVISION_MISSING_MESSAGE,
  [RUNNER_ERROR.DOCUMENT_REVISION_INVALID]: REVISION_MISSING_MESSAGE,

  // --- Creation -------------------------------------------------------------
  [RUNNER_ERROR.DOCUMENT_ALREADY_EXISTS]:
    "Un document existe deja a cet emplacement. NOX ne le remplace jamais : choisissez un autre nom, ou ouvrez le document existant pour le modifier.",
  [RUNNER_ERROR.DOCUMENT_PARENT_NOT_FOUND]:
    "Le dossier indique n'existe pas dans le repository. NOX ne cree aucun dossier : creez-le d'abord, puis reessayez.",
  [RUNNER_ERROR.DOCUMENT_PARENT_NOT_DIRECTORY]:
    "Un element du chemin est un fichier, pas un dossier. Choisissez un autre emplacement.",
  [RUNNER_ERROR.DOCUMENT_PARENT_SYMLINK_NOT_ALLOWED]:
    "Ce dossier ne peut pas etre utilise pour creer un document : c'est un lien. NOX n'ecrit qu'a travers des dossiers reels.",
  [RUNNER_ERROR.DOCUMENT_NAME_NOT_PORTABLE]:
    "Ce nom de fichier ne serait pas utilisable sur tous les systemes. Evitez les caracteres < > : \" | ? *, les noms reserves de Windows (CON, PRN, AUX, NUL, COM1 a COM9, LPT1 a LPT9), ainsi qu'un espace ou un point en fin de nom.",
  [RUNNER_ERROR.DOCUMENT_CREATION_FAILED]:
    "La creation du document a echoue. Verifiez l'espace disque et les droits du dossier ; aucun fichier existant n'a ete modifie.",

  // --- Suppression ----------------------------------------------------------
  [RUNNER_ERROR.DOCUMENT_DELETE_CONFLICT]: DOCUMENT_DELETE_CONFLICT_MESSAGE,
  [RUNNER_ERROR.DOCUMENT_PROTECTED]:
    "Ce document appartient a une tache NOX. Le supprimer ici laisserait la tache sans son fichier : passez par « Delete task » sur la page de la tache, qui supprime les deux ensemble.",
  [RUNNER_ERROR.DOCUMENT_DELETE_FAILED]:
    "La suppression a echoue et le document est toujours present. Il est peut-etre ouvert dans un autre programme ; fermez-le, puis reessayez.",

  // --- Document d'une tache -------------------------------------------------
  [RUNNER_ERROR.TASKS_DIRECTORY_NOT_DIRECTORY]:
    "Un fichier nomme « tasks » occupe la racine du repository. NOX ne le remplace pas : renommez-le, puis reessayez.",
  [RUNNER_ERROR.TASKS_DIRECTORY_SYMLINK_NOT_ALLOWED]:
    "Le dossier « tasks » est un lien. NOX n'ecrit qu'a travers des dossiers reels, pour que l'emplacement du fichier ne soit jamais une surprise.",
  [RUNNER_ERROR.TASKS_DIRECTORY_CREATION_FAILED]:
    "NOX n'a pas pu creer le dossier « tasks » a la racine du repository. Verifiez l'espace disque et les droits du dossier.",
  [RUNNER_ERROR.TASK_DOCUMENT_REVISION_UNKNOWN]:
    "Un fichier occupe le chemin du document de cette tache, mais NOX ne l'a jamais synchronise : il ne peut donc pas affirmer qu'il lui appartient. Ouvrez ce fichier pour l'examiner, ou relancez la creation du document, avant de supprimer la tache.",
  // Le code d'une tache est calcule par NOX : ce refus signale une requete
  // falsifiee ou une base incoherente, jamais une faute de saisie.
  [RUNNER_ERROR.TASK_CODE_INVALID]: GENERIC_RUNNER_ERROR_MESSAGE,

  // --- Preflight avant execution --------------------------------------------
  // Chacun de ces refus se corrige en quelques secondes ; le message dit donc
  // quoi faire, pas seulement ce qui ne va pas.
  [RUNNER_ERROR.CLAUDE_NOT_AVAILABLE]:
    "Claude Code est introuvable sur cette machine. Installez-le, ou indiquez son chemin dans NOX_CLAUDE_EXECUTABLE, puis redemarrez le runner.",
  [RUNNER_ERROR.REPOSITORY_DIRTY]:
    "Le repository contient des modifications non commitees. Commitez ou remisez votre travail avant de lancer : sans un etat de depart propre, il serait impossible de distinguer vos changements de ceux de Claude.",
  [RUNNER_ERROR.GIT_DETACHED_HEAD]:
    "Le repository n'est sur aucune branche (HEAD detache). Revenez sur une branche avant de lancer une execution.",
  [RUNNER_ERROR.GIT_UPSTREAM_MISSING]:
    "La branche courante n'a pas de branche distante associee. Poussez-la une premiere fois (git push -u), puis reessayez.",
  [RUNNER_ERROR.GIT_NOT_SYNCHRONIZED]:
    "La branche courante est en avance ou en retard sur sa reference distante connue. Poussez ou recuperez vos commits avant de lancer.",
  [RUNNER_ERROR.GIT_PREFLIGHT_FAILED]:
    "La verification Git prealable a echoue. Consultez les logs du runner pour le detail.",

  // --- Execution -------------------------------------------------------------
  // Code historique : il ne peut plus etre emis, mais des executions anterieures
  // le portent encore, et leur page doit rester lisible.
  [RUNNER_ERROR.CLAUDE_RUN_ALREADY_ACTIVE]:
    "Une execution Claude Code etait deja en cours au moment du lancement.",
  [RUNNER_ERROR.REPOSITORY_CLAUDE_RUN_ALREADY_ACTIVE]:
    "Une execution Claude Code travaille deja sur ce repository. NOX n'en autorise qu'une a la fois par repository : attendez sa fin avant d'en lancer une autre. Les autres projets ne sont pas concernes.",
  [RUNNER_ERROR.CLAUDE_RUN_NOT_FOUND]:
    "Le runner ne suit plus cette execution. Elle a probablement ete interrompue par un redemarrage du runner : NOX ne peut pas dire ce que le processus a fait, verifiez l'etat du repository vous-meme.",
  [RUNNER_ERROR.CLAUDE_TIMEOUT]:
    "L'execution a depasse le delai maximal et a ete arretee. L'etat du repository a ete capture tel quel ; NOX n'a rien restaure.",
  [RUNNER_ERROR.CLAUDE_LIMIT_REACHED]:
    "Une limite d'utilisation Claude a ete detectee. L'execution est bloquee : relancez-la plus tard, quand votre quota sera de nouveau disponible. NOX n'affiche pas d'heure de reinitialisation, faute de la connaitre.",
  [RUNNER_ERROR.CLAUDE_COMMAND_NOT_ALLOWED]:
    "Une commande de validation enregistree avec cette tache ne peut pas etre autorisee sans risque. Corrigez-la dans la tache : NOX ne l'elargit pas pour la faire passer.",
  [RUNNER_ERROR.GIT_HEAD_CHANGED]:
    "Le repository a change depuis la verification prealable. Rechargez la page pour repartir de l'etat actuel.",
  [RUNNER_ERROR.GIT_POLICY_VIOLATION]:
    "L'execution a modifie l'historique Git alors que c'etait interdit — un commit ou un changement de branche. NOX n'a rien restaure : verifiez l'etat du repository avant toute autre chose.",
  [RUNNER_ERROR.CLAUDE_START_FAILED]:
    "Le processus Claude Code n'a pas pu etre lance. Verifiez son installation et les logs du runner.",

  // --- Annulation -----------------------------------------------------------
  [RUNNER_ERROR.CLAUDE_RUN_ALREADY_FINISHED]:
    "Cette execution est deja terminee : il n'y a plus rien a interrompre. Rafraichissez la page pour voir son resultat.",
  [RUNNER_ERROR.CLAUDE_RUN_CANCELLING]:
    "L'arret est deja engage. Laissez le processus se terminer : NOX affichera le resultat des qu'il aura ferme.",
  [RUNNER_ERROR.CLAUDE_CANCEL_FAILED]:
    "NOX a demande l'arret mais n'a pas pu constater la fin du processus. Celui-ci peut encore modifier le repository : verifiez-le vous-meme, et au besoin terminez-le depuis le gestionnaire de taches.",
  // La review est un confort de relecture, pas un resultat : ces deux messages
  // disent ce qui manque sans laisser croire que l'execution est compromise.
  [RUNNER_ERROR.CLAUDE_REVIEW_NOT_READY]:
    "Cette execution n'est pas encore terminee : sa review sera capturee au moment ou elle le sera.",
  [RUNNER_ERROR.CLAUDE_REVIEW_FAILED]:
    "NOX n'a pas pu capturer le detail des changements de cette execution. Son compte rendu et son etat Git restent valides ; pour le diff, utilisez « git status » et « git diff ».",
  [RUNNER_ERROR.CLAUDE_PROCESS_FAILED]:
    "L'execution s'est terminee sur une erreur. Consultez le compte rendu et la sortie d'erreur ci-dessous.",

  // --- Correction ciblee ------------------------------------------------------
  [RUNNER_ERROR.GIT_BRANCH_CHANGED]:
    "La branche courante n'est plus celle de cette review. Revenez sur la branche d'origine avant de reprendre la session.",
  [RUNNER_ERROR.REVIEW_FEEDBACK_INVALID]:
    "Ce feedback ne peut pas etre enregistre : il est vide, trop long, ou contient des caracteres que NOX ne sait pas transmettre.",
  [RUNNER_ERROR.REVIEW_FEEDBACK_ALREADY_USED]:
    "Ce feedback a deja servi a lancer une correction. Relisez la nouvelle review, puis ecrivez-en un autre si besoin.",
  [RUNNER_ERROR.REVIEW_NOT_RESUMABLE]:
    "Cette execution ne peut pas etre reprise. Consultez la review pour en connaitre la raison exacte.",
  // Le message ne liste pas ce qui a change : le detail viendrait du disque, et
  // pourrait nommer un fichier dont le contenu ne doit pas etre expose.
  [RUNNER_ERROR.REVIEW_WORKTREE_CHANGED]:
    "Le repository a change depuis cette review. NOX ne peut pas attribuer surement ces modifications au run precedent. Retablissez exactement l'etat relu, ou lancez une nouvelle execution apres avoir remis Git dans un etat propre.",
  [RUNNER_ERROR.WORKSPACE_FINGERPRINT_UNAVAILABLE]:
    "NOX n'a pas pu verifier l'etat du dossier de travail. La reprise ciblee est indisponible pour cette execution : le contexte securise ne peut plus etre confirme.",
  [RUNNER_ERROR.CLAUDE_OUTPUT_INVALID]:
    "La sortie de Claude Code n'a pas pu etre analysee. La version installee ne produit peut-etre pas le format attendu.",
  // Ces deux codes signalent une demande que l'interface n'aurait pas du emettre.
  [RUNNER_ERROR.CLAUDE_RUN_ID_INVALID]: GENERIC_RUNNER_ERROR_MESSAGE,
  [RUNNER_ERROR.CLAUDE_PROMPT_INVALID]: GENERIC_RUNNER_ERROR_MESSAGE,

  // Ces codes traduisent un desaccord de contrat entre le web et le runner :
  // l'utilisateur ne peut rien y faire, seul le message generique a du sens.
  [RUNNER_ERROR.UNAUTHORIZED]:
    "Le runner a refuse l'authentification. Verifiez que NOX_RUNNER_TOKEN est identique pour le runner et pour l'application web.",
  [RUNNER_ERROR.INVALID_JSON]: GENERIC_RUNNER_ERROR_MESSAGE,
  [RUNNER_ERROR.INVALID_REQUEST]: GENERIC_RUNNER_ERROR_MESSAGE,
  [RUNNER_ERROR.PAYLOAD_TOO_LARGE]: "Le chemin transmis est trop long.",
  [RUNNER_ERROR.UNSUPPORTED_MEDIA_TYPE]: GENERIC_RUNNER_ERROR_MESSAGE,
  [RUNNER_ERROR.ROUTE_NOT_FOUND]: GENERIC_RUNNER_ERROR_MESSAGE,
  [RUNNER_ERROR.METHOD_NOT_ALLOWED]: GENERIC_RUNNER_ERROR_MESSAGE,
  // Ces trois codes signalent une demande que l'interface n'aurait pas du
  // emettre : l'utilisateur ne peut rien y faire.
  [RUNNER_ERROR.REPOSITORY_PATH_REQUIRED]: GENERIC_RUNNER_ERROR_MESSAGE,
  [RUNNER_ERROR.DOCUMENT_PATH_REQUIRED]: "Aucun document selectionne.",
  [RUNNER_ERROR.DOCUMENT_PATH_INVALID]: "Ce chemin de document n'est pas valide.",
  [RUNNER_ERROR.DOCUMENT_OUTSIDE_REPOSITORY]:
    "Ce document se trouve hors du repository du projet : NOX refuse de le lire.",
  [RUNNER_ERROR.VALIDATION_COMMAND_REFUSED]:
    "Le runner a refuse d'executer cette commande de validation. Elle a change, ou la politique " +
    "des commandes autonomes ne l'autorise pas : verifiez le plan de verification de la tache.",
  [RUNNER_ERROR.VALIDATION_SPAWN_FAILED]:
    "La commande de validation n'a pas pu demarrer : programme introuvable, ou droits " +
    "insuffisants. Aucune preuve n'a ete obtenue.",

  // Livraison Git. Ces messages sont volontairement proches de ceux de
  // `delivery-display.ts` sans les dupliquer : ceux-la decrivent l'etat d'une
  // livraison, ceux-ci decrivent le refus d'un appel au runner. Ils peuvent
  // apparaitre pour une livraison comme pour une inspection.
  [RUNNER_ERROR.DELIVERY_REPOSITORY_CHANGED]:
    "Le repository ne correspond plus a l'etat qui a ete valide. Aucune ecriture Git " +
    "n'a eu lieu.",
  [RUNNER_ERROR.DELIVERY_INDEX_NOT_EMPTY]:
    "L'index Git porte deja des changements prepares. NOX ne les melange pas avec le " +
    "travail qu'il a valide.",
  [RUNNER_ERROR.DELIVERY_IDENTITY_MISSING]:
    "Git n'a ni user.name ni user.email configure pour ce repository. NOX n'en invente " +
    "aucun et ne modifie aucune configuration.",
  [RUNNER_ERROR.DELIVERY_STAGING_FAILED]:
    "Les chemins du travail valide n'ont pas pu etre prepares. Aucun commit n'a ete cree.",
  [RUNNER_ERROR.DELIVERY_STAGED_MISMATCH]:
    "Ce qui a ete prepare ne correspond pas au travail valide. Aucun commit n'a ete cree.",
  [RUNNER_ERROR.DELIVERY_COMMIT_FAILED]:
    "Git n'a pas pu creer le commit. Rien n'a ete defait.",
  [RUNNER_ERROR.DELIVERY_TREE_MISMATCH]:
    "Le commit a ete cree, mais l'etat obtenu n'est pas celui attendu. NOX ne defait rien.",
  [RUNNER_ERROR.DELIVERY_PUSH_REJECTED]:
    "Le serveur distant a refuse le push : l'historique a diverge. Le commit local est " +
    "conserve, et NOX ne force jamais.",
  [RUNNER_ERROR.DELIVERY_PUSH_FAILED]:
    "Le push a echoue : reseau, authentification ou delai depasse. Le commit local est " +
    "conserve.",

  [RUNNER_ERROR.INTERNAL_ERROR]:
    "Le runner a rencontre une erreur interne. Consultez ses logs pour le detail.",
};

/** Message affichable pour un echec, sans aucune information sensible. */
export function describeRunnerFailure(failure: RunnerFailure): string {
  switch (failure.kind) {
    case "not_configured":
      return (
        "Le runner n'est pas configure : definissez NOX_RUNNER_TOKEN dans le fichier .env " +
        "a la racine du projet, avec la meme valeur pour le runner et pour l'application web."
      );
    case "unreachable":
      return RUNNER_UNAVAILABLE_MESSAGE;
    case "timeout":
      return "Le runner n'a pas repondu dans le delai imparti. Verifiez qu'il fonctionne toujours.";
    case "unauthorized":
      return CODE_MESSAGES[RUNNER_ERROR.UNAUTHORIZED];
    case "invalid_response":
      return "Le runner a renvoye une reponse inattendue. Verifiez que le runner et l'application web sont a la meme version.";
    case "runner_error":
      return CODE_MESSAGES[failure.code];
  }
}

/**
 * Ce que NOX conserve d'un echec d'infrastructure.
 *
 * `code` est stable et sert a l'historique ; `message` est la phrase affichee.
 * Le detail du runner, quand il existe, s'y ajoute : il nomme ce que le code
 * laisse ambigu — « le programme est introuvable » et « le systeme a refuse de
 * le demarrer » partagent `VALIDATION_SPAWN_FAILED`, et le premier se corrige en
 * installant un outil, le second pas.
 *
 * Aucun detail n'est invente : un echec sans detail rend la phrase du code, qui
 * reste exacte.
 */
export function describeInfrastructureFailure(failure: RunnerFailure): {
  code: string;
  message: string;
} {
  const code = failure.kind === "runner_error" ? failure.code : failure.kind.toUpperCase();
  const base = describeRunnerFailure(failure);
  const detail = failure.kind === "runner_error" ? (failure.detail ?? null) : null;

  return { code, message: detail === null ? base : `${base} ${detail}` };
}

/**
 * Distingue le conflit de revision de tous les autres echecs.
 *
 * Ce cas n'est pas une panne : le fichier est accessible, la demande est
 * correcte, mais le disque a bouge. L'interface doit reagir differemment —
 * conserver le texte saisi et proposer de recharger la version actuelle — d'ou
 * cette question posee separement.
 */
export function isDocumentConflict(failure: RunnerFailure): boolean {
  return failure.kind === "runner_error" && failure.code === RUNNER_ERROR.DOCUMENT_CONFLICT;
}

/**
 * Distingue le refus d'ecraser un document existant.
 *
 * C'est le pendant du conflit de revision pour la creation : la demande est
 * correcte, mais le disque contient deja quelque chose. L'interface doit alors
 * proposer d'ouvrir le document existant plutot que d'inviter a reessayer.
 */
export function isDocumentAlreadyExists(failure: RunnerFailure): boolean {
  return failure.kind === "runner_error" && failure.code === RUNNER_ERROR.DOCUMENT_ALREADY_EXISTS;
}

/**
 * Distingue un document absent d'une panne.
 *
 * Une resynchronisation qui ne trouve plus son fichier n'a pas echoue : elle a
 * simplement quelque chose a creer. Confondre les deux ferait afficher une
 * erreur la ou NOX sait quoi faire.
 */
export function isDocumentMissing(failure: RunnerFailure): boolean {
  return failure.kind === "runner_error" && failure.code === RUNNER_ERROR.DOCUMENT_NOT_FOUND;
}

/**
 * Distingue le refus de supprimer une version non affichee.
 *
 * Comme le conflit d'ecriture, ce n'est pas une panne : le fichier est
 * accessible et la demande correcte, mais le disque a bouge. L'interface doit
 * alors proposer de recharger, jamais de forcer.
 */
export function isDocumentDeleteConflict(failure: RunnerFailure): boolean {
  return (
    failure.kind === "runner_error" && failure.code === RUNNER_ERROR.DOCUMENT_DELETE_CONFLICT
  );
}

/**
 * Indique si l'echec traduit une indisponibilite du runner plutot qu'un
 * probleme de saisie. Sert a choisir ou afficher le message dans le formulaire.
 */
export function isRunnerUnavailable(failure: RunnerFailure): boolean {
  return (
    failure.kind === "not_configured" ||
    failure.kind === "unreachable" ||
    failure.kind === "timeout" ||
    failure.kind === "unauthorized" ||
    failure.kind === "invalid_response"
  );
}
