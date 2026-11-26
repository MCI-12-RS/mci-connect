// Leitura da resposta da Edge Function `sign-in` (E1.04, "Contratos"; AQ-1).
// Qualquer resposta fora do contrato vira `server_error`: a tela mostra a
// mensagem de conexão, e nada do que o servidor mandou é exibido como veio.

/** A sessão devolvida pela função (RN-13): só estes campos. */
export interface SignInSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number;
  token_type: string;
}

export type SignInFailure =
  | { result: "invalid_credentials" }
  | { result: "locked"; minutes: number }
  | { result: "empty_fields" }
  | { result: "server_error" };

/**
 * O sucesso traz a sessão e a marca de troca obrigatória (E2.03, RN-08 b e
 * AQ-3). Sem o campo (uma `sign-in` anterior ao E2.03), a marca é `false`: o
 * portão do banco ainda leva à troca pelo código.
 */
export type SignInResult = { result: "ok"; session: SignInSession; mustChangePassword: boolean } | SignInFailure;

/** O que o `AuthContext.signIn` devolve à tela: a sessão fica no cliente do Supabase. */
export type SignInOutcome = { result: "ok"; mustChangePassword: boolean } | SignInFailure;

export const SERVER_ERROR: SignInFailure = { result: "server_error" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isSignInSession(value: unknown): value is SignInSession {
  return (
    isRecord(value) &&
    isNonEmptyString(value.access_token) &&
    isNonEmptyString(value.refresh_token) &&
    isFiniteNumber(value.expires_in) &&
    isFiniteNumber(value.expires_at) &&
    isNonEmptyString(value.token_type)
  );
}

export function isSignInOk(result: SignInResult): result is Extract<SignInResult, { result: "ok" }> {
  return result.result === "ok";
}

export function isSignInLocked(result: SignInResult | SignInOutcome): result is { result: "locked"; minutes: number } {
  return result.result === "locked";
}

/**
 * A resposta tipada a partir do status HTTP e do corpo (já lido como JSON, ou
 * `null` se não for JSON). O status e o `result` precisam bater:
 * 200 `ok` com a sessão (e `must_change_password`, booleano ou ausente); 400 `empty_fields`; 401 `invalid_credentials`;
 * 429 `locked` com `retry_after_minutes` (inteiro, no mínimo 1). O resto,
 * inclusive 5xx, 405 e 413, é `server_error`.
 */
export function parseSignInResponse(status: number, body: unknown): SignInResult {
  if (!isRecord(body)) return SERVER_ERROR;

  switch (status) {
    case 200:
      return body.result === "ok" &&
        isSignInSession(body.session) &&
        (body.must_change_password === undefined || typeof body.must_change_password === "boolean")
        ? {
            result: "ok",
            session: {
              access_token: body.session.access_token,
              refresh_token: body.session.refresh_token,
              expires_in: body.session.expires_in,
              expires_at: body.session.expires_at,
              token_type: body.session.token_type,
            },
            mustChangePassword: body.must_change_password === true,
          }
        : SERVER_ERROR;
    case 400:
      return body.result === "empty_fields" ? { result: "empty_fields" } : SERVER_ERROR;
    case 401:
      return body.result === "invalid_credentials" ? { result: "invalid_credentials" } : SERVER_ERROR;
    case 429: {
      const minutes = body.retry_after_minutes;
      return body.result === "locked" && Number.isInteger(minutes) && isFiniteNumber(minutes) && minutes >= 1
        ? { result: "locked", minutes }
        : SERVER_ERROR;
    }
    default:
      return SERVER_ERROR;
  }
}
