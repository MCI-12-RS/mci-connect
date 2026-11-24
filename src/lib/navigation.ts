// Navegação entre as telas (E2.01, "Navegação e rotas").

/**
 * O item do menu lateral está ativo nesta rota? A raiz (`/`) só na própria
 * raiz; os demais itens também nas sub-rotas (`/cell-reports/deleted` acende
 * "Relatórios", e não "Células").
 */
export function isNavItemActive(pathname: string, itemPath: string): boolean {
  if (itemPath === "/") return pathname === "/";
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}

/**
 * Estado da navegação de uma lista para a lista de excluídos dela: o
 * endereço da lista (com a busca e a página), para o "← {Lista}" voltar a ele
 * (UX-19). Vai no estado do histórico, e não na URL da lista de excluídos.
 */
export interface ReturnToState {
  returnTo: string;
}

export function toReturnToState(pathname: string, search: string): ReturnToState {
  return { returnTo: `${pathname}${search}` };
}

/**
 * Para onde o "← {Lista}" leva: o endereço guardado, se for o da própria
 * lista (com ou sem parâmetros); senão (link direto, ou estado de outra
 * tela), a lista sem parâmetros.
 */
export function returnPathFrom(state: unknown, listPath: string): string {
  if (typeof state !== "object" || state === null || !("returnTo" in state)) return listPath;
  const { returnTo } = state;
  if (typeof returnTo !== "string") return listPath;
  return returnTo === listPath || returnTo.startsWith(`${listPath}?`) ? returnTo : listPath;
}

/** Um endereço com a busca `q` (os links das recusas da restauração, T6). */
export function withSearchParam(path: string, search: string): string {
  const query = new URLSearchParams({ q: search }).toString();
  return `${path}?${query}`;
}

/**
 * Os parâmetros da URL com `name` trocado por `value`, ou retirado com
 * `null` ou vazio. Os demais (`q`, `page`, `size`…) ficam como estavam.
 */
export function withQueryParam(params: URLSearchParams, name: string, value: string | null): URLSearchParams {
  const next = new URLSearchParams(params);
  if (value) next.set(name, value);
  else next.delete(name);
  return next;
}
