import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ListParams, ListResult } from "@/lib/list-query";
import { MEMBER_ROW_SELECT, type MemberRow } from "@/lib/members/fields";
import { toMembersListArgs, type MemberFilters } from "@/lib/members/filters";

/**
 * Membros visíveis, filtrados e paginados no servidor, com o total exato (E2.07, DT-01 a DT-05): a
 * página pela `members_list` e o total pela `members_list_count`, em paralelo. A ordem (nível e nome,
 * RN-15) é a da RPC: nada de `.order()` aqui.
 */
export function useMembersList({ page, pageSize, search }: ListParams, filters: MemberFilters) {
  return useQuery({
    queryKey: ["members", "list", { page, pageSize, search, filters }],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<ListResult<MemberRow>> => {
      const args = toMembersListArgs(filters, search);
      const [rowsResult, countResult] = await Promise.all([
        supabase
          .rpc("members_list", { ...args, _limit: pageSize, _offset: (page - 1) * pageSize })
          .select(MEMBER_ROW_SELECT),
        supabase.rpc("members_list_count", args),
      ]);
      if (rowsResult.error) throw rowsResult.error;
      if (countResult.error) throw countResult.error;
      return { rows: rowsResult.data ?? [], total: countResult.data ?? 0 };
    },
  });
}
