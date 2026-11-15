import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toRange } from "@/lib/pagination";
import { toSearchPatterns } from "@/lib/search";
import { MEMBER_ROW_SELECT, type MemberRow } from "@/lib/members/fields";

export interface ListParams {
  page: number;
  pageSize: number;
  search: string;
}

export interface ListResult<T> {
  rows: T[];
  total: number;
}

// O PostgREST responde 416 (PGRST103) quando a página pedida passa do fim,
// por exemplo depois de uma exclusão. A tela então volta para a última página.
const RANGE_NOT_SATISFIABLE = "PGRST103";

/** Membros visíveis, paginados no servidor, com total exato (E1.08, RN-01 a RN-04). */
export function useMembersList({ page, pageSize, search }: ListParams) {
  return useQuery({
    queryKey: ["members", "list", { page, pageSize, search }],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<ListResult<MemberRow>> => {
      const patterns = toSearchPatterns(search);
      const [from, to] = toRange(page, pageSize);

      let query = supabase.from("members_view").select(MEMBER_ROW_SELECT, { count: "exact" });
      for (const pattern of patterns) query = query.ilike("search_text", pattern);
      const { data, count, error } = await query.order("name").order("id").range(from, to);

      if (error?.code === RANGE_NOT_SATISFIABLE) {
        let countQuery = supabase.from("members_view").select("id", { count: "exact", head: true });
        for (const pattern of patterns) countQuery = countQuery.ilike("search_text", pattern);
        const { count: total, error: countError } = await countQuery;
        if (countError) throw countError;
        return { rows: [], total: total ?? 0 };
      }
      if (error) throw error;
      return { rows: data ?? [], total: count ?? 0 };
    },
  });
}
