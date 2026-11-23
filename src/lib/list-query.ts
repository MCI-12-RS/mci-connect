// Mecânica comum das listas paginadas no servidor (E1.08, RN-01 a RN-04):
// parâmetros, resultado, busca por `search_text` e a página além do fim.
// Usada por use-members-list, use-cells-list e use-cell-reports-list.

/** Página (começa em 1), tamanho e busca, como estão na URL. */
export interface ListParams {
  page: number;
  pageSize: number;
  search: string;
}

/** As linhas da página e o total exato de registros do filtro. */
export interface ListResult<T> {
  rows: T[];
  total: number;
}

// O PostgREST responde 416 (PGRST103) quando a página pedida passa do fim,
// por exemplo depois de uma exclusão. A tela então volta para a última página.
export const RANGE_NOT_SATISFIABLE = "PGRST103";

/** Os campos lidos da resposta do supabase-js. */
interface QueryError {
  code: string;
  message: string;
}

interface PageResponse<Row> {
  data: Row[] | null;
  count: number | null;
  error: QueryError | null;
}

interface CountResponse {
  count: number | null;
  error: QueryError | null;
}

interface SearchableQuery<Q> {
  ilike(column: string, pattern: string): Q;
}

/**
 * Aplica um `ilike("search_text", padrão)` por palavra (padrões de
 * `toSearchPatterns`). Um filtro por padrão, e não `ilikeAllOf`, porque este
 * junta os padrões com vírgula e uma vírgula digitada quebraria o filtro.
 */
export function withSearch<Q extends SearchableQuery<Q>>(query: Q, patterns: readonly string[]): Q {
  let filtered = query;
  for (const pattern of patterns) filtered = filtered.ilike("search_text", pattern);
  return filtered;
}

/**
 * Executa a consulta da página (com `count: "exact"`). Se a página passou do
 * fim (416), devolve a página vazia com o total atual, contado por `countAll`
 * com os mesmos filtros, para a tela ir para a última página.
 */
export async function fetchListPage<Row>(
  page: PromiseLike<PageResponse<Row>>,
  countAll: () => PromiseLike<CountResponse>,
): Promise<ListResult<Row>> {
  const { data, count, error } = await page;
  if (error?.code === RANGE_NOT_SATISFIABLE) {
    const { count: total, error: countError } = await countAll();
    if (countError) throw countError;
    return { rows: [], total: total ?? 0 };
  }
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}
