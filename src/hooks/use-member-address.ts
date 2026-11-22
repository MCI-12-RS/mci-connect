import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { MEMBER_ADDRESS_SELECT, type MemberAddress } from "@/lib/members/fields";

/**
 * Endereço de um membro visível, da `members_view` (E1.08, RN-11). Sem
 * `sensitive_visible`, rua, número, complemento e CEP vêm nulos. `null` se o
 * membro não estiver no escopo de quem consulta.
 */
export function useMemberAddress(memberId: string | null | undefined) {
  return useQuery({
    queryKey: ["members", "address", memberId],
    enabled: !!memberId,
    queryFn: async (): Promise<MemberAddress | null> => {
      const { data, error } = await supabase
        .from("members_view")
        .select(MEMBER_ADDRESS_SELECT)
        .eq("id", memberId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
