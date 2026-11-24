import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { MEMBER_ROW_SELECT, type MemberRow } from "@/lib/members/fields";

/**
 * Um membro visível, da `members_view`, com as colunas do formulário (por
 * exemplo, o discípulo aberto pelo bloqueio da exclusão, E2.01 T3). `null` se
 * ele não existir, tiver sido excluído ou estiver fora do escopo.
 */
export function useMember(memberId: string) {
  return useQuery({
    queryKey: ["members", "detail", memberId],
    queryFn: async (): Promise<MemberRow | null> => {
      const { data, error } = await supabase
        .from("members_view")
        .select(MEMBER_ROW_SELECT)
        .eq("id", memberId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
