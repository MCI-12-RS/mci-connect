// Chamada à Edge Function `sign-in` (E1.04, "Front"; AQ-1 e AQ-2).
// Usa `fetch` direto, e não `supabase.functions.invoke`, para ler o status e o
// corpo sem depender do `FunctionsHttpError`. Só com a chave pública: antes do
// login não há sessão.

import { SERVER_ERROR, parseSignInResponse, type SignInResult } from "@/lib/auth/sign-in-result";

/** Tempo-limite da tentativa (AQ-2). A tentativa que chegou ao servidor conta mesmo se a tela desistir. */
export const SIGN_IN_TIMEOUT_MS = 20_000;

export interface RequestSignInOptions {
  timeoutMs?: number;
}

/**
 * Envia a identificação e a senha como foram digitadas (RN-09): o servidor
 * normaliza a identificação, e a senha não é transformada. Rede, tempo-limite,
 * 5xx e qualquer resposta fora do contrato viram `server_error`.
 */
export async function requestSignIn(
  identifier: string,
  password: string,
  { timeoutMs = SIGN_IN_TIMEOUT_MS }: RequestSignInOptions = {},
): Promise<SignInResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sign-in`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ identifier, password }),
      signal: controller.signal,
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return parseSignInResponse(response.status, body);
  } catch {
    return SERVER_ERROR;
  } finally {
    clearTimeout(timer);
  }
}
