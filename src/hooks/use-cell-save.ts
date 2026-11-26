import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { refreshAccess } from "@/hooks/use-access";
import { requestSessionCheck, requestSessionCheckOnDenied } from "@/lib/auth/session-check";
import type { CellPatch } from "@/lib/cells/changes";
import { classifyCellSaveError, type CellSaveFailure } from "@/lib/cells/codes";
import type { CellSaveOutcome } from "@/lib/cells/situation";
import type { CellInsert } from "@/lib/cells/write";
import { refreshAfterCellWrite } from "@/lib/query-refresh";

/** O cadastro novo, com o `id` gerado ao abrir o formulário (DT-09). */
export interface CreateCellRequest {
  kind: "create";
  insert: CellInsert & { id: string };
}

/** A edição: só o que mudou (E2.05), e o toast que ela dá (P60). */
export interface UpdateCellRequest {
  kind: "update";
  cellId: string;
  patch: CellPatch;
  outcome: Exclude<CellSaveOutcome, "created" | "unchanged">;
}

export type CellSaveRequest = CreateCellRequest | UpdateCellRequest;

export type CellSaveResult =
  | { kind: "saved"; outcome: CellSaveOutcome }
  /** A edição voltou sem linha: a célula foi excluída ou saiu do escopo (E2.01, DT-19). */
  | { kind: "gone" }
  | { kind: "failed"; failure: Exclude<CellSaveFailure, { kind: "duplicate" | "gone" }> };

/**
 * A gravação do formulário de célula (E2.08, DT-09; E2.01, DT-19). Não lança:
 * resolve com o resultado classificado.
 *
 * - Cadastro: INSERT com o `id` da abertura, sem RETURNING. A nova tentativa
 *   depois de uma falha de rede, 5xx ou erro desconhecido confere antes na
 *   `cells_view` se a célula já existe; e o 23505 de `cells_pkey` também vale
 *   como sucesso. Assim, a repetição nunca cria uma segunda célula.
 * - Edição: PATCH só do que mudou, pedindo o `id` de volta; sem linha, `gone`.
 * - Depois de gravar, as telas com totais, G12 e o acesso recarregam (P44, AQ-8).
 */
export function useCellSave() {
  const queryClient = useQueryClient();
  // As tentativas de cadastro que podem ter chegado ao servidor sem resposta.
  const uncertainAttempts = useRef(new Set<string>());

  const failed = (error: unknown): CellSaveResult => {
    // 42501 e "0 linhas" também são o que um membro excluído recebe: confere a própria sessão.
    requestSessionCheckOnDenied(error);
    const failure = classifyCellSaveError(error);
    if (failure.kind === "gone") {
      requestSessionCheck();
      return { kind: "gone" };
    }
    if (failure.kind === "duplicate") return { kind: "saved", outcome: "created" };
    if (failure.kind === "top" && failure.rereadAccess) void refreshAccess(queryClient);
    return { kind: "failed", failure };
  };

  const create = async ({ insert }: CreateCellRequest): Promise<CellSaveResult> => {
    if (uncertainAttempts.current.has(insert.id)) {
      const { data, error } = await supabase.from("cells_view").select("id").eq("id", insert.id).maybeSingle();
      if (!error && data) return { kind: "saved", outcome: "created" };
    }
    uncertainAttempts.current.add(insert.id);
    const { error } = await supabase.from("cells").insert(insert);
    if (!error) return { kind: "saved", outcome: "created" };
    const result = failed(error);
    // Uma recusa do servidor é certa: nada foi gravado.
    if (result.kind === "failed" && result.failure.kind !== "connection" && result.failure.kind !== "recalc") {
      uncertainAttempts.current.delete(insert.id);
    }
    return result;
  };

  const update = async ({ cellId, patch, outcome }: UpdateCellRequest): Promise<CellSaveResult> => {
    const { data, error } = await supabase.from("cells").update(patch).eq("id", cellId).select("id");
    if (error) return failed(error);
    if (!data?.length) {
      requestSessionCheck();
      return { kind: "gone" };
    }
    return { kind: "saved", outcome };
  };

  const mutation = useMutation({
    mutationFn: async (request: CellSaveRequest): Promise<CellSaveResult> => {
      try {
        return await (request.kind === "create" ? create(request) : update(request));
      } catch {
        return { kind: "failed", failure: { kind: "connection" } };
      }
    },
    onSuccess: (result) => {
      if (result.kind === "saved") void refreshAfterCellWrite(queryClient);
      // A lista recarrega já: "Fechar", "Cancelar", o X e o Esc voltam para ela sem a célula.
      if (result.kind === "gone") void queryClient.invalidateQueries({ queryKey: ["cells", "list"] });
    },
  });

  return { save: mutation.mutateAsync, isPending: mutation.isPending };
}
