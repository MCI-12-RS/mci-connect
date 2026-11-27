import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { CellIdentity } from "@/lib/cell-reports/filters";

/**
 * A identificação de uma célula para o chip do filtro Célula em Relatórios (E2.10, RN-19, DA-10):
 * líder, dia e horário atuais, se quem consulta vê a célula ou um relatório dela. `null` quando não
 * vê (ou não existe): "Célula indisponível", sem nome e sem id.
 */
export function useCellIdentity(cellId: string | null) {
  return useQuery({
    queryKey: ["cells", "identity", cellId],
    enabled: cellId !== null,
    queryFn: async (): Promise<CellIdentity | null> => {
      const { data, error } = await supabase.rpc("cell_identity", { _cell_id: cellId ?? "" });
      if (error) throw error;
      const row = data?.[0];
      return row ? { leader_name: row.leader_name, meeting_day: row.meeting_day, meeting_time: row.meeting_time } : null;
    },
  });
}
