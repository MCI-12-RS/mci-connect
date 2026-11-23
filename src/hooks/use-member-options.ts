import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { MemberViewRow } from "@/lib/members/fields";
import { withSearch } from "@/lib/list-query";
import { toSearchPatterns } from "@/lib/search";
import {
  OPTIONS_STALE_TIME_MS,
  optionsPageRange,
  toOptionsPage,
  type OptionsPage,
  type SelectOption,
} from "@/lib/selectors";

export type MemberOptionRow = Pick<MemberViewRow, "id" | "name">;

export interface MemberOptionsParams {
  /** Texto digitado (já com o atraso de digitação). */
  search: string;
  /** Só membros ativos (participantes do relatório). */
  activeOnly?: boolean;
  /** Membro que não pode ser escolhido (o próprio, ao escolher líder ou cônjuge). */
  excludeId?: string | null;
  /** Só consulta com o seletor aberto. */
  enabled?: boolean;
}

export function toMemberOption(member: MemberOptionRow): SelectOption {
  return { value: member.id, label: member.name };
}

/**
 * Opções de membro dos seletores, 20 por página, da `members_view` (E1.08,
 * RN-05 e RN-07): só os membros visíveis, em ordem alfabética, com a busca por
 * palavra em `search_text`. Mudar a busca troca a chave e recomeça da página 1.
 */
export function useMemberOptions({ search, activeOnly = false, excludeId = null, enabled = true }: MemberOptionsParams) {
  return useInfiniteQuery({
    queryKey: ["members", "options", { search, activeOnly, excludeId }],
    enabled,
    staleTime: OPTIONS_STALE_TIME_MS,
    initialPageParam: 0,
    getNextPageParam: (lastPage: OptionsPage<MemberOptionRow>) => lastPage.nextOffset,
    queryFn: async ({ pageParam }): Promise<OptionsPage<MemberOptionRow>> => {
      const [from, to] = optionsPageRange(pageParam);
      let query = withSearch(supabase.from("members_view").select("id, name"), toSearchPatterns(search));
      if (activeOnly) query = query.eq("is_active", true);
      if (excludeId) query = query.neq("id", excludeId);
      const { data, error } = await query.order("name").order("id").range(from, to);
      if (error) throw error;
      return toOptionsPage(data ?? [], pageParam);
    },
  });
}

/**
 * Nome do membro escolhido num seletor, pela RPC `member_names`, que resolve
 * também quem está fora do escopo de quem edita (por exemplo, o pastor acima
 * de um G12). `null` se o id não existir.
 */
export function useMemberName(memberId: string | null | undefined, { enabled = true } = {}) {
  return useQuery({
    queryKey: ["members", "name", memberId],
    enabled: enabled && !!memberId,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase.rpc("member_names", { _ids: [memberId] });
      if (error) throw error;
      return data?.[0]?.name ?? null;
    },
  });
}
