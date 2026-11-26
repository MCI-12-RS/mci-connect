import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { MemberViewRow } from "@/lib/members/fields";

export type MemberStatus = Pick<MemberViewRow, "id" | "is_active" | "gender">;

/**
 * A situação e o sexo das pessoas gravadas na célula (líder, timóteo e
 * anfitrião), para a marca "(inativo)" (E2.08, P63, DA-10, AQ-2). Lê a
 * `members_view`: quem está fora do escopo de quem edita não volta e fica sem
 * marca, só com o nome (P11). Uma consulta só, pelos ids.
 */
export function useMemberStatuses(ids: ReadonlyArray<string | null | undefined>) {
  const unique = [...new Set(ids.filter((id): id is string => !!id))].sort();
  return useQuery({
    queryKey: ["members", "statuses", unique],
    enabled: unique.length > 0,
    queryFn: async (): Promise<ReadonlyMap<string, MemberStatus>> => {
      const { data, error } = await supabase.from("members_view").select("id, is_active, gender").in("id", unique);
      if (error) throw error;
      return new Map((data ?? []).flatMap((row) => (row.id ? [[row.id, row]] : [])));
    },
  });
}
