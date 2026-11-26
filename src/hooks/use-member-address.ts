import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { MEMBER_ADDRESS_SELECT, type MemberAddress } from "@/lib/members/fields";

/** A chave da leitura do endereço de um membro. */
export const memberAddressQueryKey = (memberId: string | null | undefined) => ["members", "address", memberId] as const;

/**
 * Endereço de um membro visível, da `members_view` (E1.08, RN-11). Sem
 * `sensitive_visible`, rua, número, complemento e CEP vêm nulos. `null` se o
 * membro não estiver no escopo de quem consulta.
 */
export async function fetchMemberAddress(memberId: string): Promise<MemberAddress | null> {
  const { data, error } = await supabase.from("members_view").select(MEMBER_ADDRESS_SELECT).eq("id", memberId).maybeSingle();
  if (error) throw error;
  return data;
}

export function useMemberAddress(memberId: string | null | undefined) {
  return useQuery({
    queryKey: memberAddressQueryKey(memberId),
    enabled: !!memberId,
    queryFn: () => fetchMemberAddress(memberId ?? ""),
  });
}
