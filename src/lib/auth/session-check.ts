// Sinal de "confira a sessão" (E2.01, RN-14, AQ-8 e DT-20). Quem percebe uma
// recusa (o `QueryCache`/`MutationCache` do TanStack, os formulários) avisa
// por aqui, sem conhecer o `AuthContext`; o `AuthProvider` registra a
// verificação. Sem React e sem Supabase, para ser testado sozinho.

import { isPermissionDenied } from "@/lib/errors";

type SessionCheck = () => void;

let handler: SessionCheck | null = null;

/**
 * Registra a verificação da sessão. Devolve a função que a desfaz (só se
 * ainda for a registrada, para um provider não apagar o de outro).
 */
export function setSessionCheckHandler(check: SessionCheck): () => void {
  handler = check;
  return () => {
    if (handler === check) handler = null;
  };
}

/** Pede a releitura do próprio cadastro. Sem verificação registrada, não faz nada. */
export function requestSessionCheck(): void {
  handler?.();
}

/** Pede a releitura se o erro for uma recusa de permissão (42501). Os demais erros são ignorados. */
export function requestSessionCheckOnDenied(error: unknown): void {
  if (isPermissionDenied(error)) requestSessionCheck();
}

/**
 * Uma execução por vez: enquanto uma está em voo, as chamadas seguintes
 * recebem a mesma promessa (várias recusas ao mesmo tempo geram uma releitura
 * só). Terminada, a próxima chamada executa de novo.
 */
export function singleFlight<T>(run: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () => {
    if (!inFlight) {
      inFlight = run().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  };
}

/** Intervalo mínimo entre duas verificações pela volta do foco da aba. */
export const FOCUS_CHECK_INTERVAL_MS = 10_000;

/**
 * A volta do foco pede outra verificação? Só se a última foi há pelo menos
 * `intervalMs` (o `focus` e o `visibilitychange` chegam juntos, e trocar de
 * aba várias vezes seguidas não deve gerar uma releitura a cada troca).
 */
export function isFocusCheckDue(lastCheckAt: number | null, now: number, intervalMs = FOCUS_CHECK_INTERVAL_MS): boolean {
  return lastCheckAt === null || now - lastCheckAt >= intervalMs;
}
