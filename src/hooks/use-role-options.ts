import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parseRoleOptions, type RoleOptions } from "@/lib/access/member-form";

/** Prefixo da chave: `["role-options", memberId | "new"]`. Invalidado depois de gravar um membro. */
export const ROLE_OPTIONS_QUERY_KEY = ["role-options"] as const;

/** O JSON de `role_options` não veio no formato esperado. */
export class RoleOptionsFormatError extends Error {
  constructor() {
    super("role_options: formato inesperado");
    this.name = "RoleOptionsFormatError";
  }
}

/**
 * As funções que quem está logado pode atribuir no cadastro (E2.02, RN-18,
 * AQ-3), pela `role_options` com a sessão: a atual do membro (`current`), se
 * pode trocar e por quê, as opções e a padrão. `memberId` nulo é o cadastro
 * novo. Nenhuma leitura de `roles`, `role_permissions` nem da `role_id` de
 * outra pessoa.
 */
export function useRoleOptions(memberId: string | null, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [...ROLE_OPTIONS_QUERY_KEY, memberId ?? "new"],
    enabled,
    queryFn: async (): Promise<RoleOptions> => {
      const { data, error } = await supabase.rpc("role_options", memberId ? { _member_id: memberId } : {});
      if (error) throw error;
      const options = parseRoleOptions(data);
      if (!options) throw new RoleOptionsFormatError();
      return options;
    },
  });
}
