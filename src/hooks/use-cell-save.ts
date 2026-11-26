import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { refreshAccess } from "@/hooks/use-access";
import { unchangedOnServer } from "@/lib/audit/save";
import { requestSessionCheck, requestSessionCheckOnDenied } from "@/lib/auth/session-check";
import { retriedCellPatch, type CellPatch } from "@/lib/cells/changes";
import { classifyCellSaveError, type CellSaveFailure } from "@/lib/cells/codes";
import { CELL_STORED_SELECT } from "@/lib/cells/fields";
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
  /** O `updated_at` da linha que abriu o formulário (E2.05, AQ-7); indefinido, não compara. */
  loadedUpdatedAt?: string | null;
}

export type CellSaveRequest = CreateCellRequest | UpdateCellRequest;

/**
 * Tempo-limite da gravação, o mesmo do cadastro de membro (E2.04, T7). Sem
 * rede a chamada pode nunca voltar; passado o limite, é uma queda de conexão,
 * e a nova tentativa é segura (o cadastro confere antes; o PATCH é o mesmo).
 */
export const CELL_SAVE_TIMEOUT_MS = 20_000;

/** A chamada com um sinal que a cancela depois do tempo-limite. */
async function withTimeout<T>(run: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CELL_SAVE_TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

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
 *   `cells_view` se a célula já existe, e o 23505 de `cells_pkey` leva à mesma
 *   conferência. Assim, a repetição nunca cria uma segunda célula. A célula
 *   achada só vale como sucesso se for a mesma do envio; se a pessoa corrigiu
 *   o formulário depois da tentativa sem resposta, as correções vão num PATCH
 *   (só o que mudou) e o resultado é o desse PATCH.
 * - Edição: PATCH só do que mudou, pedindo o `id` e o `updated_at` de volta;
 *   sem linha, `gone`. O `updated_at` igual ao carregado quer dizer que o
 *   servidor não mudou nada: o resultado é `unchanged` (E2.05, AQ-7).
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
    if (failure.kind === "duplicate") return { kind: "failed", failure: { kind: "connection" } };
    if (failure.kind === "top" && failure.rereadAccess) void refreshAccess(queryClient);
    return { kind: "failed", failure };
  };

  /**
   * O PATCH pedindo o `id` e o `updated_at` de volta; sem linha, `gone` (E2.01,
   * DT-19). Com a versão carregada, o mesmo `updated_at` é `unchanged` (AQ-7).
   */
  const patchCell = async (
    cellId: string,
    patch: CellPatch,
    outcome: CellSaveOutcome,
    loadedUpdatedAt?: string | null,
  ): Promise<CellSaveResult> => {
    const { data, error } = await withTimeout((signal) =>
      supabase.from("cells").update(patch).eq("id", cellId).select("id, updated_at").abortSignal(signal),
    );
    if (error) return failed(error);
    const row = data?.[0];
    if (!row) {
      requestSessionCheck();
      return { kind: "gone" };
    }
    return { kind: "saved", outcome: unchangedOnServer(loadedUpdatedAt, row.updated_at) ? "unchanged" : outcome };
  };

  /**
   * A célula do `id` da tentativa já existe? Igual ao envio, o cadastro deu
   * certo; diferente, as correções vão num PATCH (DT-09). `null`: não achou.
   */
  const reconcileExisting = async (insert: CreateCellRequest["insert"]): Promise<CellSaveResult | null> => {
    const { data, error } = await withTimeout((signal) =>
      supabase.from("cells_view").select(CELL_STORED_SELECT).eq("id", insert.id).abortSignal(signal).maybeSingle(),
    );
    if (error) return failed(error);
    if (!data) return null;
    const patch = retriedCellPatch(data, insert);
    if (Object.keys(patch).length === 0) return { kind: "saved", outcome: "created" };
    return patchCell(insert.id, patch, "created");
  };

  const create = async ({ insert }: CreateCellRequest): Promise<CellSaveResult> => {
    if (uncertainAttempts.current.has(insert.id)) {
      const existing = await reconcileExisting(insert);
      if (existing) return existing;
    }
    uncertainAttempts.current.add(insert.id);
    const { error } = await withTimeout((signal) => supabase.from("cells").insert(insert).abortSignal(signal));
    if (!error) return { kind: "saved", outcome: "created" };
    // 23505 em `cells_pkey`: a tentativa anterior chegou ao servidor. Confere se é a mesma célula.
    if (classifyCellSaveError(error).kind === "duplicate") {
      // Gravada, mas fora da leitura de quem cadastra: o cadastro deu certo (DT-09).
      return (await reconcileExisting(insert)) ?? { kind: "saved", outcome: "created" };
    }
    const result = failed(error);
    // Uma recusa do servidor é certa: nada foi gravado.
    if (result.kind === "failed" && result.failure.kind !== "connection" && result.failure.kind !== "recalc") {
      uncertainAttempts.current.delete(insert.id);
    }
    return result;
  };

  const update = ({ cellId, patch, outcome, loadedUpdatedAt }: UpdateCellRequest): Promise<CellSaveResult> =>
    patchCell(cellId, patch, outcome, loadedUpdatedAt);

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
