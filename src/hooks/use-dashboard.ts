import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { retryUnlessPermissionDenied } from "@/lib/errors";

// Dashboard calculado no banco (E1.08, RN-02, RN-08 e RN-09): cada hook chama
// uma RPC, sem agregar nada no cliente. Sem view_dashboard e sem
// view_own_ministry_dashboard as três respondem 42501, que não é repetido.

type DashboardFunctions = Database["public"]["Functions"];

/** Os cards da semana e os cards gerais de membros, com a semana (`YYYY-MM-DD`) no horário de Brasília. */
export type DashboardSummary = DashboardFunctions["dashboard_summary"]["Returns"][number];
/** Total de células visíveis de um tipo. */
export type DashboardCellsByType = DashboardFunctions["dashboard_cells_by_type"]["Returns"][number];
/** Um casal G12, com as células da subárvore. `spouse_name` é nulo quando não há cônjuge visível e ativo. */
export type DashboardG12Couple = DashboardFunctions["dashboard_g12_ranking"]["Returns"][number];

/** Uma linha só; resultado vazio vira erro (PGRST116, via `.single()`). */
export function useDashboardSummary() {
  return useQuery({
    queryKey: ["dashboard", "summary"],
    retry: retryUnlessPermissionDenied,
    queryFn: async (): Promise<DashboardSummary> => {
      const { data, error } = await supabase.rpc("dashboard_summary").single();
      if (error) throw error;
      return data;
    },
  });
}

/** Já vem ordenado pelo tipo. */
export function useDashboardCellsByType() {
  return useQuery({
    queryKey: ["dashboard", "cells-by-type"],
    retry: retryUnlessPermissionDenied,
    queryFn: async (): Promise<DashboardCellsByType[]> => {
      const { data, error } = await supabase.rpc("dashboard_cells_by_type");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Já vem ordenado pelo total de células (maior primeiro); inclui casais com 0 células. */
export function useDashboardG12Ranking() {
  return useQuery({
    queryKey: ["dashboard", "g12-ranking"],
    retry: retryUnlessPermissionDenied,
    queryFn: async (): Promise<DashboardG12Couple[]> => {
      const { data, error } = await supabase.rpc("dashboard_g12_ranking");
      if (error) throw error;
      return data ?? [];
    },
  });
}
