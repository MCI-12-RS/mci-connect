import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toRange } from "@/lib/pagination";
import { toSearchPatterns } from "@/lib/search";
import { fetchListPage, withSearch, type ListParams, type ListResult } from "@/lib/list-query";
import { MEMBER_ROW_SELECT, type MemberRow } from "@/lib/members/fields";

/** Membros visíveis, paginados no servidor, com total exato (E1.08, RN-01 a RN-04). */
export function useMembersList({ page, pageSize, search }: ListParams) {
  return useQuery({
    queryKey: ["members", "list", { page, pageSize, search }],
    placeholderData: keepPreviousData,
    queryFn: (): Promise<ListResult<MemberRow>> => {
      const patterns = toSearchPatterns(search);
      const [from, to] = toRange(page, pageSize);
      return fetchListPage(
        withSearch(supabase.from("members_view").select(MEMBER_ROW_SELECT, { count: "exact" }), patterns)
          .order("name")
          .order("id")
          .range(from, to),
        () => withSearch(supabase.from("members_view").select("id", { count: "exact", head: true }), patterns),
      );
    },
  });
}
