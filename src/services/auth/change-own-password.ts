// Chamada à Edge Function `change-own-password` (E2.03, "Contratos"; AQ-4 e
// AQ-5). Usa `fetch` direto, como o `requestSignIn` do E1.04, para ler o status
// e o corpo sem depender do `FunctionsHttpError`.

import { CHANGE_SERVER_ERROR, parseChangePasswordResponse, type ChangePasswordResult } from "@/lib/auth/password-results";

/** Tempo-limite da troca, o mesmo do login. */
export const CHANGE_PASSWORD_TIMEOUT_MS = 20_000;

export interface PasswordChangeRequest {
  mode: "forced" | "voluntary";
  /** Só na troca voluntária. */
  currentPassword?: string;
  newPassword: string;
  confirmation: string;
  /** Gerado ao abrir a tela ou o diálogo e repetido nos reenvios (AQ-5, DA-13). */
  requestId: string;
}

export interface RequestPasswordChangeOptions {
  accessToken: string;
  timeoutMs?: number;
}

/**
 * Envia as senhas como foram digitadas, sem `trim`. Rede, tempo-limite, 5xx e
 * qualquer resposta fora do contrato viram `server_error`.
 */
export async function requestPasswordChange(
  input: PasswordChangeRequest,
  { accessToken, timeoutMs = CHANGE_PASSWORD_TIMEOUT_MS }: RequestPasswordChangeOptions,
): Promise<ChangePasswordResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const body: Record<string, string> = {
    mode: input.mode,
    new_password: input.newPassword,
    confirmation: input.confirmation,
    request_id: input.requestId,
  };
  if (input.mode === "voluntary") body.current_password = input.currentPassword ?? "";
  try {
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/change-own-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    return parseChangePasswordResponse(response.status, parsed);
  } catch {
    return CHANGE_SERVER_ERROR;
  } finally {
    clearTimeout(timer);
  }
}
