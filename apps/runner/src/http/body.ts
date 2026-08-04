/**
 * Lecture du corps JSON d'une requete.
 *
 * Trois protections, toutes necessaires pour un serveur qui accepte des corps
 * arbitraires : une taille maximale, un delai maximal (un client qui annonce un
 * corps sans jamais l'envoyer ne doit pas immobiliser une connexion), et un
 * `Content-Type` verifie.
 */

import type { IncomingMessage } from "node:http";

import { RUNNER_ERROR, type RunnerErrorCode } from "@nox/shared";

/** Taille maximale acceptee pour un corps de requete : 32 Kio. */
export const MAX_BODY_BYTES = 32 * 1024;

/** Delai maximal pour recevoir un corps complet. */
export const BODY_TIMEOUT_MS = 5_000;

export type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; code: RunnerErrorCode };

function hasJsonContentType(request: IncomingMessage): boolean {
  const contentType = request.headers["content-type"];
  if (typeof contentType !== "string") {
    return false;
  }
  // `application/json; charset=utf-8` doit etre accepte.
  return contentType.split(";")[0]?.trim().toLowerCase() === "application/json";
}

function declaredLengthExceedsLimit(request: IncomingMessage, maxBytes: number): boolean {
  const declared = Number(request.headers["content-length"]);
  return Number.isFinite(declared) && declared > maxBytes;
}

/**
 * Lit et decode le corps JSON d'une requete.
 *
 * La lecture est interrompue des que la limite de taille est atteinte : le corps
 * n'est jamais accumule au-dela.
 */
export function readJsonBody(
  request: IncomingMessage,
  options: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<JsonBodyResult> {
  const maxBytes = options.maxBytes ?? MAX_BODY_BYTES;
  const timeoutMs = options.timeoutMs ?? BODY_TIMEOUT_MS;

  if (!hasJsonContentType(request)) {
    return Promise.resolve({ ok: false, code: RUNNER_ERROR.UNSUPPORTED_MEDIA_TYPE });
  }

  if (declaredLengthExceedsLimit(request, maxBytes)) {
    return Promise.resolve({ ok: false, code: RUNNER_ERROR.PAYLOAD_TOO_LARGE });
  }

  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;

    const finish = (result: JsonBodyResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      resolve(result);
    };

    const timer = setTimeout(() => {
      // Corps incomplet : la requete est abandonnee plutot qu'attendue.
      request.destroy();
      finish({ ok: false, code: RUNNER_ERROR.INVALID_REQUEST });
    }, timeoutMs);

    const onData = (chunk: Buffer): void => {
      received += chunk.length;
      if (received > maxBytes) {
        request.destroy();
        finish({ ok: false, code: RUNNER_ERROR.PAYLOAD_TOO_LARGE });
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = (): void => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.trim() === "") {
        finish({ ok: false, code: RUNNER_ERROR.INVALID_JSON });
        return;
      }

      try {
        finish({ ok: true, value: JSON.parse(raw) });
      } catch {
        finish({ ok: false, code: RUNNER_ERROR.INVALID_JSON });
      }
    };

    const onError = (): void => {
      finish({ ok: false, code: RUNNER_ERROR.INVALID_REQUEST });
    };

    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
  });
}
