/** O rótulo de cada filtro do painel: a mesma altura e o mesmo espaço até o campo, para as colunas alinharem (P50). */
export const FILTER_LABEL_CLASS = "mb-1 block text-sm font-medium leading-5";

/** Uma opção de filtro de escolha (P51, P52): o valor que vai para a URL, o rótulo e, se houver, a dica. */
export interface FilterOption<T extends string> {
  value: T;
  label: string;
  /** Dica embaixo da opção (P51), ligada à caixa por `aria-describedby`. */
  hint?: string;
}
