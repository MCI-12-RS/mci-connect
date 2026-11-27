import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toLaunchCheckState, type LaunchCheckState } from "@/lib/cell-reports/launch-check";

/**
 * A chave da conferência. Fora de `["cell_reports"]` (divergência da AQ-9): a gravação desatualiza a lista
 * com o formulário ainda aberto, e a conferência não deve ser relida nesse instante. Ela não fica em cache
 * (`gcTime: 0`): cada abertura e cada escolha de célula conferem de novo.
 */
export const launchCheckKey = (cellId: string | null) => ["cell_report_form", "launch_check", cellId] as const;

/**
 * A conferência antes de preencher (E2.11, RN-19, P100, AQ-1): a situação da
 * semana da célula, o "agora" do servidor, a reunião e as datas aceitas. Lida a
 * cada abertura e a cada escolha de célula (`staleTime: 0`), sem nova tentativa
 * automática: a falha libera os campos com o aviso (UXD-4).
 */
export function useCellReportLaunchCheck(cellId: string | null) {
  return useQuery({
    queryKey: launchCheckKey(cellId),
    enabled: !!cellId,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    // Sem rede, a busca roda e falha (em vez de ficar pausada): a tela cai no caminho da falha.
    networkMode: "always",
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<LaunchCheckState> => {
      const { data, error } = await supabase.rpc("cell_report_launch_check", { _cell_id: cellId ?? "" });
      if (error) throw error;
      return toLaunchCheckState(data?.[0]);
    },
  });
}
