import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CELL_DETAIL_SELECT, type CellDetailRow } from "@/lib/cells/fields";

/**
 * Uma célula visível, da `cells_view`, por id: o detalhe (E2.10, RN-14 e
 * RN-15) e a célula aberta pelo bloqueio da exclusão de membro (E2.01, T3).
 * `null` se ela não existir, tiver sido excluída ou estiver fora do escopo:
 * as quatro respostas são iguais ("Célula não encontrada.").
 */
export function useCell(cellId: string, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["cells", "detail", cellId],
    enabled,
    queryFn: async (): Promise<CellDetailRow | null> => {
      const { data, error } = await supabase.from("cells_view").select(CELL_DETAIL_SELECT).eq("id", cellId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
