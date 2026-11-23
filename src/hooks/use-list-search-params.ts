import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { DEFAULT_PAGE_SIZE, lastPage, parsePage, parsePageSize } from "@/lib/pagination";
import type { ListParams } from "@/lib/list-query";

export interface ListSearchState {
  /** Página, tamanho e busca da URL, prontos para o hook da lista. */
  params: ListParams;
  /** Texto do campo de busca; vai para a URL depois de 300 ms sem digitação. */
  searchInput: string;
  setSearchInput: (value: string) => void;
  setPage: (page: number) => void;
  /** Muda o tamanho da página e volta para a página 1. */
  setPageSize: (pageSize: number) => void;
}

/**
 * Estado de uma lista paginada guardado na URL (E1.08, RN-01): `page`, `size`
 * e `q`. Os valores padrão não aparecem na URL. Mudar a busca ou o tamanho
 * volta para a página 1, e o campo de busca acompanha a URL quando ela muda
 * por fora (link do menu, botão voltar).
 */
export function useListSearchParams(): ListSearchState {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = parsePage(searchParams.get("page"));
  const pageSize = parsePageSize(searchParams.get("size"));
  const search = searchParams.get("q") ?? "";
  const [searchInput, setSearchInput] = useState(search);
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 300);

  const updateParams = useCallback(
    (changes: { page?: number; size?: number; q?: string }) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (changes.page !== undefined) {
            if (changes.page > 1) next.set("page", String(changes.page));
            else next.delete("page");
          }
          if (changes.size !== undefined) {
            if (changes.size !== DEFAULT_PAGE_SIZE) next.set("size", String(changes.size));
            else next.delete("size");
          }
          if (changes.q !== undefined) {
            if (changes.q) next.set("q", changes.q);
            else next.delete("q");
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Mudar a busca volta para a página 1. Só reage à digitação: a URL mudando
  // por fora não pode devolver a busca antiga para ela.
  useEffect(() => {
    if (debouncedSearch !== search) updateParams({ q: debouncedSearch, page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  // A URL mudou por fora (link do menu, botão voltar): o campo acompanha.
  useEffect(() => {
    if (search !== debouncedSearch) setSearchInput(search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const setPage = useCallback((next: number) => updateParams({ page: next }), [updateParams]);
  const setPageSize = useCallback((size: number) => updateParams({ size, page: 1 }), [updateParams]);

  return { params: { page, pageSize, search }, searchInput, setSearchInput, setPage, setPageSize };
}

/** Os campos do resultado do `useQuery` da lista que o `useClampPage` usa. */
export interface ListQueryState {
  data?: { total: number };
  isPlaceholderData: boolean;
}

/**
 * Página além do fim (ex.: depois de uma exclusão, ou um link antigo): vai
 * para a última. Só decide com o total da consulta atual. Enquanto carrega, ou
 * enquanto mostra a página anterior (`keepPreviousData`), não mexe: o total
 * antigo pode ser de outra busca (ex.: voltar no navegador de `?q=ana` para
 * `?page=5` levaria para a página 1).
 */
export function useClampPage({ params, setPage }: ListSearchState, { data, isPlaceholderData }: ListQueryState): void {
  const { page, pageSize } = params;
  const total = isPlaceholderData ? undefined : data?.total;
  useEffect(() => {
    if (total === undefined) return;
    const last = lastPage(total, pageSize);
    if (page > last) setPage(last);
  }, [total, page, pageSize, setPage]);
}
