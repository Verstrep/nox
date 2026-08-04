/**
 * Verifie que le runner local est joignable a l'adresse configuree.
 *
 * Utilise `NOX_RUNNER_URL` si elle est definie, sinon l'adresse par defaut.
 * Aucun jeton n'est envoye : `/health` est une route publique en local, et cette
 * commande ne doit jamais afficher de secret.
 *
 * Lance par `npm run runner:health`.
 */

const DEFAULT_URL = "http://127.0.0.1:4310";
const TIMEOUT_MS = 5_000;

const baseUrl = (process.env.NOX_RUNNER_URL ?? DEFAULT_URL).replace(/\/+$/, "");
const healthUrl = `${baseUrl}/health`;

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

try {
  const response = await fetch(healthUrl, { signal: controller.signal });
  const body = await response.json();

  if (response.status === 200 && body?.service === "nox-runner" && body?.status === "ok") {
    console.log(`Runner disponible sur ${baseUrl} (version ${body.version}).`);
  } else {
    console.error(`Reponse inattendue de ${healthUrl} (statut ${response.status}) :`);
    console.error(JSON.stringify(body));
    process.exitCode = 1;
  }
} catch (error) {
  const reason = controller.signal.aborted ? "delai depasse" : "connexion impossible";
  console.error(`Runner injoignable sur ${healthUrl} (${reason}).`);
  console.error("  Demarrez-le avec : npm run dev:runner");
  if (!controller.signal.aborted && error instanceof Error) {
    console.error(`  Detail : ${error.message}`);
  }
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
}
