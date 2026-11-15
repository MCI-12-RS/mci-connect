// Paginação das listas no servidor (E1.08, RN-01).

export const PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

/** Tamanho de página vindo da URL; qualquer valor fora da lista vira o padrão. */
export function parsePageSize(value: string | null | undefined): number {
  const n = Number(value);
  return PAGE_SIZES.some((size) => size === n) ? n : DEFAULT_PAGE_SIZE;
}

/** Página vinda da URL (começa em 1); valor inválido vira 1. */
export function parsePage(value: string | null | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** Intervalo inclusivo de linhas para o `.range()` do PostgREST. */
export function toRange(page: number, pageSize: number): [number, number] {
  const from = (Math.max(1, page) - 1) * pageSize;
  return [from, from + pageSize - 1];
}

/** Última página válida; uma lista vazia tem uma página. */
export function lastPage(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
