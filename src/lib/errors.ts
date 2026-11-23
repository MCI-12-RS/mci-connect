// Erros do banco que a tela trata de um jeito específico.

/**
 * SQLSTATE de permissão negada (`insufficient_privilege`). É o código que as
 * funções do banco usam para recusar quem não tem a permissão exigida (por
 * exemplo, as RPCs do dashboard, RN-09 do E1.08).
 */
export const PERMISSION_DENIED = "42501";

/** O erro tem o código de permissão negada? Aceita qualquer valor lançado. */
export function isPermissionDenied(error: unknown): error is { code: typeof PERMISSION_DENIED } {
  return typeof error === "object" && error !== null && "code" in error && error.code === PERMISSION_DENIED;
}

/** Novas tentativas do padrão do TanStack Query. */
const DEFAULT_QUERY_RETRIES = 3;

/**
 * `retry` do TanStack Query: tenta de novo como o padrão, menos quando a
 * permissão foi negada. Repetir não muda a resposta e só atrasaria a mensagem
 * de acesso negado.
 */
export function retryUnlessPermissionDenied(failureCount: number, error: unknown): boolean {
  return !isPermissionDenied(error) && failureCount < DEFAULT_QUERY_RETRIES;
}
