import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { MemberViewRow } from "@/lib/members/fields";
import { withSearch } from "@/lib/list-query";
import { MEMBER_HINT_TEXTS } from "@/lib/members/texts";
import { personLabel } from "@/lib/members/labels";
import { toSearchPatterns } from "@/lib/search";
import {
  OPTIONS_STALE_TIME_MS,
  optionsPageRange,
  toOptionsPage,
  type OptionsPage,
  type SelectOption,
} from "@/lib/selectors";

export type MemberOptionRow = Pick<MemberViewRow, "id" | "name"> &
  Partial<Pick<MemberViewRow, "is_active" | "gender">> & {
  /** Discípulo (direto ou indireto) da pessoa do cadastro: não pode ser o líder dela (RN-13, AQ-4). */
  is_descendant?: boolean;
};

export interface MemberOptionsParams {
  /** Texto digitado (já com o atraso de digitação). */
  search: string;
  /** Só membros ativos (participantes do relatório). */
  activeOnly?: boolean;
  /** Membro que não pode ser escolhido (o próprio, ao escolher líder ou cônjuge). */
  excludeId?: string | null;
  /** Só consulta com o seletor aberto. */
  enabled?: boolean;
  /**
   * O cadastro cujo líder se escolhe (E2.04, AQ-4): as opções que são
   * discípulas dele vêm marcadas, pela `member_descendants_among`. Só na
   * edição; no cadastro novo ninguém é discípulo da pessoa.
   */
  descendantOf?: string | null;
}

export function toMemberOption(member: MemberOptionRow): SelectOption {
  const option = { value: member.id, label: member.name };
  return member.is_descendant ? { ...option, disabledReason: MEMBER_HINT_TEXTS.discipleOfThisPerson } : option;
}

/**
 * A opção com a marca de situação (E2.08, P63): "Fábio Lima (inativo)". A
 * pessoa inativa continua escolhível (RN-04).
 */
export function toMarkedMemberOption(member: MemberOptionRow): SelectOption {
  return { ...toMemberOption(member), label: personLabel(member) };
}

/**
 * Marca os discípulos da pessoa entre as opções da página (AQ-4). Se a
 * consulta falhar, a página vem sem as marcas, e a recusa do ciclo vem ao
 * salvar (padrão da UX).
 */
async function markDescendants(rows: MemberOptionRow[], memberId: string): Promise<MemberOptionRow[]> {
  if (rows.length === 0) return rows;
  const { data, error } = await supabase.rpc("member_descendants_among", {
    _member_id: memberId,
    _candidate_ids: rows.map((row) => row.id),
  });
  if (error || !data) return rows;
  const descendants = new Set(data);
  return rows.map((row) => (descendants.has(row.id) ? { ...row, is_descendant: true } : row));
}

/**
 * Opções de membro dos seletores, 20 por página, da `members_view` (E1.08,
 * RN-05 e RN-07): só os membros visíveis, em ordem alfabética, com a busca por
 * palavra em `search_text`. Mudar a busca troca a chave e recomeça da página 1.
 */
export function useMemberOptions({
  search,
  activeOnly = false,
  excludeId = null,
  enabled = true,
  descendantOf = null,
}: MemberOptionsParams) {
  return useInfiniteQuery({
    queryKey: ["members", "options", { search, activeOnly, excludeId, descendantOf }],
    enabled,
    staleTime: OPTIONS_STALE_TIME_MS,
    initialPageParam: 0,
    getNextPageParam: (lastPage: OptionsPage<MemberOptionRow>) => lastPage.nextOffset,
    queryFn: async ({ pageParam }): Promise<OptionsPage<MemberOptionRow>> => {
      const [from, to] = optionsPageRange(pageParam);
      let query = withSearch(supabase.from("members_view").select("id, name, is_active, gender"), toSearchPatterns(search));
      if (activeOnly) query = query.eq("is_active", true);
      if (excludeId) query = query.neq("id", excludeId);
      const { data, error } = await query.order("name").order("id").range(from, to);
      if (error) throw error;
      const page = toOptionsPage(data ?? [], pageParam);
      return descendantOf ? { ...page, items: await markDescendants(page.items, descendantOf) } : page;
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
