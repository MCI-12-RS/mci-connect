import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DashboardG12Couple, DashboardSummary } from "@/lib/dashboard/cards";
import { retryUnlessPermissionDenied } from "@/lib/errors";

// Dashboard calculado no banco (E1.08, RN-02; E2.14, DT-02): duas RPCs, sem
// agregar nada no cliente. Os tipos de célula vêm no resumo (AQ-3). Sem
// "Visualizar Dashboard" as duas respondem 42501, que não é repetido.

export type { DashboardG12Couple, DashboardSummary } from "@/lib/dashboard/cards";

export const DASHBOARD_SUMMARY_KEY = ["dashboard", "summary"] as const;
export const DASHBOARD_G12_RANKING_KEY = ["dashboard", "g12-ranking"] as const;

/** `enabled`: falso para quem o acesso já diz que não tem o Dashboard (RN-07, T9): nenhuma consulta. */
export interface DashboardQueryOptions {
  enabled?: boolean;
}

/** Uma linha só; resultado vazio vira erro (PGRST116, via `.single()`). */
export function useDashboardSummary({ enabled = true }: DashboardQueryOptions = {}) {
  return useQuery({
    enabled,
    queryKey: DASHBOARD_SUMMARY_KEY,
    retry: retryUnlessPermissionDenied,
    queryFn: async (): Promise<DashboardSummary> => {
      const { data, error } = await supabase.rpc("dashboard_summary").single();
      if (error) throw error;
      return data;
    },
  });
}

/** Já vem ordenado pelo total de células (maior primeiro); inclui casais com 0 células. */
export function useDashboardG12Ranking({ enabled = true }: DashboardQueryOptions = {}) {
  return useQuery({
    enabled,
    queryKey: DASHBOARD_G12_RANKING_KEY,
    retry: retryUnlessPermissionDenied,
    queryFn: async (): Promise<DashboardG12Couple[]> => {
      const { data, error } = await supabase.rpc("dashboard_g12_ranking");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * A consulta foi invalidada (por uma gravação desta aba, pelas funções de
 * `query-refresh.ts`, ou pela mudança do próprio acesso) e ainda não buscou com
 * sucesso (E2.14, DT-07, DA-3). Lido no render, que se repete a cada mudança
 * da consulta; a busca que falha não limpa a marca, e a que dá certo limpa.
 */
export function useInvalidatedByWrite(queryKey: QueryKey): boolean {
  const queryClient = useQueryClient();
  return queryClient.getQueryState(queryKey)?.isInvalidated === true;
}
