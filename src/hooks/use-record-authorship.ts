import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AUTHORSHIP_SELECT, type Authorship, type AuthorshipEntity } from "@/lib/audit/authorship";
import { retryOnceOnNetworkError } from "@/lib/errors";

/** A view de cada registro com autoria (AQ-1) e a chave do cache da entidade (recarregada depois de gravar). */
const SOURCES = {
  member: { view: "members_view", cacheKey: "members" },
  cell: { view: "cells_view", cacheKey: "cells" },
  cell_report: { view: "cell_reports_view", cacheKey: "cell_reports" },
} as const;

async function fetchAuthorship(entity: AuthorshipEntity, recordId: string): Promise<Authorship | null> {
  const query =
    entity === "member"
      ? supabase.from(SOURCES.member.view).select(AUTHORSHIP_SELECT)
      : entity === "cell"
        ? supabase.from(SOURCES.cell.view).select(AUTHORSHIP_SELECT)
        : supabase.from(SOURCES.cell_report.view).select(AUTHORSHIP_SELECT);
  const { data, error } = await query.eq("id", recordId).maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * A autoria de um registro gravado (E2.05, T1, AQ-1, DT-15), lida por id na view da entidade ao abrir
 * o registro: as listas não pedem essas colunas. Vem só para quem pode ler o registro (RN-07). `null`
 * se o registro não vier (excluído no meio tempo ou fora do escopo). Na queda de conexão, tenta de novo
 * uma vez só, para o erro não demorar a aparecer.
 */
export function useRecordAuthorship(entity: AuthorshipEntity, recordId: string | null, { enabled = true } = {}) {
  return useQuery({
    queryKey: [SOURCES[entity].cacheKey, "authorship", recordId],
    enabled: !!recordId && enabled,
    retry: retryOnceOnNetworkError,
    queryFn: () => fetchAuthorship(entity, recordId ?? ""),
  });
}
