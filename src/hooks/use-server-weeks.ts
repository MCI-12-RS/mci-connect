import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ServerWeeks } from "@/lib/cell-reports/weeks";

/**
 * A data de hoje e as três semanas pelo relógio do servidor, em Brasília (E2.12, RN-10, DA-10): a
 * `server_weeks()` sem argumento. Relida ao voltar para a aba e guardada por 60 s. Sem ela, os
 * atalhos ficam desabilitados; o relógio do aparelho nunca é usado. Nenhuma gravação muda a data,
 * então a chave fica fora das funções de atualização.
 */
export function useServerWeeks() {
  return useQuery({
    queryKey: ["server", "weeks"],
    staleTime: 60_000,
    refetchOnWindowFocus: "always",
    retry: 1,
    queryFn: async (): Promise<ServerWeeks | null> => {
      const { data, error } = await supabase.rpc("server_weeks");
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
}
