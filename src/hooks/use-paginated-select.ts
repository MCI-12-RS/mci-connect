import { useCallback, useMemo, useState } from "react";
import type { InfiniteData, UseInfiniteQueryResult } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { flattenOptionPages, type OptionsPage, type SelectOption } from "@/lib/selectors";

// Estado dos seletores paginados (E1.08, RN-07), compartilhado entre o
// AsyncMemberSelect e os seletores do formulário de relatório.

/** Atraso entre a digitação e a consulta. */
export const SELECT_SEARCH_DEBOUNCE_MS = 300;

/** O texto digitado no seletor e se o menu está aberto. */
export interface SelectSearch {
  /** O texto no campo, a cada tecla. */
  inputValue: string;
  setInputValue: (value: string) => void;
  /** O texto que vai para a consulta, depois de 300 ms sem digitar. */
  term: string;
  /** As opções só são consultadas com o menu aberto. */
  isMenuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
}

export function useSelectSearch(): SelectSearch {
  const [inputValue, setInputValue] = useState("");
  const [isMenuOpen, setMenuOpen] = useState(false);
  const term = useDebouncedValue(inputValue, SELECT_SEARCH_DEBOUNCE_MS);
  return { inputValue, setInputValue, term, isMenuOpen, setMenuOpen };
}

/** As opções carregadas e o estado das páginas, no formato do `PaginatedSelect`. */
export interface OptionsPagination {
  /** As opções de todas as páginas carregadas, na ordem, sem repetir. */
  options: SelectOption[];
  /** Carregando a primeira página (ou tentando de novo depois de um erro nela). */
  isLoading: boolean;
  /** A primeira página falhou (sem opções) ou a seguinte falhou, e nada está carregando. */
  isError: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  /** Carrega a próxima página, se houver e se nada estiver carregando ou com erro. */
  loadMore: () => void;
  /** Tenta de novo o que falhou: a página seguinte ou a primeira. */
  retry: () => void;
}

type OptionsQuery<Row> = UseInfiniteQueryResult<InfiniteData<OptionsPage<Row>>>;

/** Adapta um `useInfiniteQuery` de opções (`useMemberOptions`, `useCellOptions`) ao seletor. */
export function useOptionsPagination<Row>(
  query: OptionsQuery<Row>,
  toOption: (row: Row) => SelectOption,
): OptionsPagination {
  const { data, isFetching, isError, isFetchNextPageError, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } =
    query;
  const options = useMemo(() => flattenOptionPages(data?.pages, toOption), [data, toOption]);
  // Numa nova tentativa, a consulta continua com erro até responder: enquanto
  // isso, o seletor mostra que está carregando, e não o erro.
  const failed = isError && !isFetching;
  const canLoadMore = hasNextPage && !isFetchingNextPage && !isError;

  // `cancelRefetch: false`: pedidos repetidos antes da resposta (rolagem e
  // clique juntos, por exemplo) não disparam outra consulta da mesma página.
  const loadMore = useCallback(() => {
    if (canLoadMore) void fetchNextPage({ cancelRefetch: false });
  }, [canLoadMore, fetchNextPage]);

  const retry = useCallback(() => {
    void (isFetchNextPageError ? fetchNextPage({ cancelRefetch: false }) : refetch());
  }, [isFetchNextPageError, fetchNextPage, refetch]);

  const isLoading = isFetching && !data;
  return useMemo(
    () => ({ options, isLoading, isError: failed, hasNextPage, isFetchingNextPage, loadMore, retry }),
    [options, isLoading, failed, hasNextPage, isFetchingNextPage, loadMore, retry],
  );
}
