// O estado de uma seção do Dashboard (E2.14, T7, P112, RN-17, DA-3), a partir
// do estado da consulta que a alimenta. Sem React e sem TanStack: a página
// passa os campos.

export interface SectionInput {
  /** Há números na tela (a consulta já respondeu alguma vez). */
  hasData: boolean;
  /** A última busca falhou. */
  isError: boolean;
  /** Uma busca está em andamento (a primeira, a atualização ou "Tentar de novo"). */
  isFetching: boolean;
  /** A consulta foi invalidada por uma gravação desta aba e ainda não buscou com sucesso (DT-07). */
  invalidatedByWrite: boolean;
  /** "Tentar de novo" foi tocado e falhou depois disso. */
  retried: boolean;
}

export type SectionView =
  | { kind: "loading" }
  /** `retrying`: o botão fica ocupado; `announce`: o `Alert` vira `role="alert"` (só quando "Tentar de novo" falhou). */
  | { kind: "error"; retrying: boolean; announce: boolean }
  /** `updating`: os números de antes, com `opacity-60` e `aria-busy` (P44). */
  | { kind: "ready"; updating: boolean };

/**
 * - Sem dados e sem erro: carregando.
 * - Sem dados e com erro: erro.
 * - Com dados, erro e uma gravação no meio: erro, porque o Dashboard nunca
 *   mostra o número de antes de uma gravação (RN-17). Sem gravação (voltar
 *   para a aba, reconectar), a falha mantém os números.
 * - Senão, os números, em atualização enquanto busca de novo.
 */
export function sectionView({ hasData, isError, isFetching, invalidatedByWrite, retried }: SectionInput): SectionView {
  if (isError && (!hasData || invalidatedByWrite)) return { kind: "error", retrying: isFetching, announce: retried };
  if (!hasData) return { kind: "loading" };
  return { kind: "ready", updating: isFetching };
}
