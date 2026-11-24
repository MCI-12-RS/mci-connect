import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CELL_ROW_SELECT, type CellRow } from "@/lib/cells/fields";

/**
 * Uma célula visível, da `cells_view`, com as colunas do formulário (por
 * exemplo, a célula aberta pelo bloqueio da exclusão de membro, E2.01 T3).
 * `null` se ela não existir, tiver sido excluída ou estiver fora do escopo.
 */
export function useCell(cellId: string) {
  return useQuery({
    queryKey: ["cells", "detail", cellId],
    queryFn: async (): Promise<CellRow | null> => {
      const { data, error } = await supabase.from("cells_view").select(CELL_ROW_SELECT).eq("id", cellId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
