import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import {
  clearMemberFilters,
  parseMemberFilters,
  removeMemberFilterChip,
  writeMemberFilters,
  type MemberFilterChipKey,
  type MemberFilters,
} from "@/lib/members/filters";

export interface MemberFiltersState {
  /** Os filtros da URL, já sem os valores inválidos. */
  filters: MemberFilters;
  /** A URL trouxe mais de 10 pessoas na Liderança (RN-04): "Escolha até 10 pessoas." até a Liderança mudar. */
  leadersTruncated: boolean;
  /** As datas da URL estão invertidas (DA-4): o painel mostra a mensagem. */
  dateRangeInverted: boolean;
  /** Aplica os filtros e volta para a página 1. */
  apply: (filters: MemberFilters) => void;
  /** Tira o valor de um chip, na hora, e volta para a página 1. */
  removeChip: (key: MemberFilterChipKey) => void;
  /** "Limpar filtros": os filtros, a busca e a página; mantém o tamanho (RN-14). */
  clearAll: () => void;
}

/**
 * O estado dos filtros de Membros na URL (E2.07, RN-14; UX-11). Na primeira leitura, a URL perde os
 * valores inválidos, com `replace`. Convive com o `useListSearchParams` (`q`, `page` e `size`) pelas
 * atualizações funcionais do `setSearchParams`, e toda troca é com `replace`, sem entrada no
 * histórico.
 */
export function useMemberFilters(): MemberFiltersState {
  const [searchParams, setSearchParams] = useSearchParams();
  const { state: navigationState } = useLocation();
  const parsed = useMemo(() => parseMemberFilters(searchParams), [searchParams]);
  const [leadersTruncated, setLeadersTruncated] = useState(parsed.leadersTruncated);

  useEffect(() => {
    if (parsed.leadersTruncated) setLeadersTruncated(true);
    if (!parsed.cleanParams) return;
    setSearchParams((prev) => parseMemberFilters(prev).cleanParams ?? prev, { replace: true, state: navigationState });
  }, [parsed, setSearchParams, navigationState]);

  const update = useCallback(
    (change: (prev: URLSearchParams) => URLSearchParams) =>
      setSearchParams((prev) => change(prev), { replace: true, state: navigationState }),
    [setSearchParams, navigationState],
  );

  const apply = useCallback(
    (next: MemberFilters) => {
      if (next.leaders.join() !== parsed.filters.leaders.join()) setLeadersTruncated(false);
      update((prev) => writeMemberFilters(prev, next));
    },
    [update, parsed.filters.leaders],
  );

  const removeChip = useCallback(
    (key: MemberFilterChipKey) => {
      if (key.startsWith("leaders:")) setLeadersTruncated(false);
      update((prev) => writeMemberFilters(prev, removeMemberFilterChip(parseMemberFilters(prev).filters, key)));
    },
    [update],
  );

  const clearAll = useCallback(() => {
    setLeadersTruncated(false);
    update(clearMemberFilters);
  }, [update]);

  return {
    filters: parsed.filters,
    leadersTruncated,
    dateRangeInverted: parsed.dateRangeInverted,
    apply,
    removeChip,
    clearAll,
  };
}
