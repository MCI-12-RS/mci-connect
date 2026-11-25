// Sinal de "confira a sessão" (E2.01, RN-14, AQ-8 e DT-20). Quem percebe uma
// recusa (o `QueryCache`/`MutationCache` do TanStack, os formulários) avisa
// por aqui, sem conhecer o `AuthContext`; o `AuthProvider` registra a
// verificação. Sem React e sem Supabase, para ser testado sozinho.

import { gateCode, isPermissionDenied, type GateCode } from "@/lib/errors";

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

type GateHandler = (code: GateCode) => void;

let gateHandler: GateHandler | null = null;

/**
 * Registra o tratamento do portão da senha (E2.03, AQ-3): o `AuthProvider`
 * liga a marca ou encerra a sessão. Devolve a função que o desfaz.
 */
export function setGateHandler(handle: GateHandler): () => void {
  gateHandler = handle;
  return () => {
    if (gateHandler === handle) gateHandler = null;
  };
}

/** Avisa o código do portão. Sem tratamento registrado, não faz nada. */
export function requestGate(code: GateCode): void {
  gateHandler?.(code);
}

/**
 * O erro é do portão da senha? Então avisa o portão e devolve `true`: quem
 * chamou não trata como recusa comum (a releitura do cadastro e do acesso
 * cairia no portão de novo).
 */
export function handleGateError(error: unknown): boolean {
  const code = gateCode(error);
  if (!code) return false;
  requestGate(code);
  return true;
}

/**
 * Pede a releitura se o erro for uma recusa de permissão (42501). O código do
 * portão (E2.03) vai antes, para o portão. Os demais erros são ignorados.
 */
export function requestSessionCheckOnDenied(error: unknown): void {
  if (handleGateError(error)) return;
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
