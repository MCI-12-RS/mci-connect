// O que a tela faz com a falha de uma exclusão ou de outra gravação do fluxo
// (E2.01, "Estados", T2 e UX-11, UX-24, UX-39). Vale para as três entidades.
import {
  isJsonObject,
  isNetworkError,
  isPermissionDenied,
  parseAppError,
  toAppError,
  type AppError,
} from "@/lib/errors";
import type { DeletionErrorCode } from "./codes";

/** Código de "não existe, já foi excluído ou está fora do escopo" (RN-02, RN-07). */
const NOT_FOUND_OR_DELETED: DeletionErrorCode = "not_found_or_deleted";

export type WriteFailure =
  /** Sumiu no meio tempo: toast informativo, o diálogo fecha e a lista recarrega (UX-24). */
  | { kind: "gone"; message: string }
  /** Recusa de regra (RN-03, RN-04 e outras): o diálogo de bloqueio, com a mensagem (UX-11). */
  | { kind: "refused"; refusal: AppError }
  /** 42501: o toast "Você não tem permissão para esta ação." (UX-39). */
  | { kind: "forbidden" }
  /** Queda de conexão: o diálogo fica aberto, com o aviso de conexão. */
  | { kind: "network" }
  /** Qualquer outra falha (técnica): o diálogo fica aberto e pede para tentar de novo (RN-20). */
  | { kind: "unexpected" };

/** Resultado de uma gravação do fluxo (excluir, inativar): feita, ou a falha já classificada. */
export type WriteResult = { kind: "done" } | WriteFailure;

/** A lista recarrega quando a gravação valeu ou quando o registro já tinha sumido (UX-07, UX-24). */
export function refreshesList(result: WriteResult): boolean {
  return result.kind === "done" || result.kind === "gone";
}

/** A recusa diz que o registro não existe, já foi excluído ou não é visível? */
export function isGone(refusal: AppError): boolean {
  return refusal.code === NOT_FOUND_OR_DELETED;
}

/** Recusa de regra: o registro sumiu ou uma regra impede a ação. */
export type WriteRefusal = Extract<WriteFailure, { kind: "gone" | "refused" }>;

function fromRefusal(refusal: AppError): WriteRefusal {
  return isGone(refusal) ? { kind: "gone", message: refusal.message } : { kind: "refused", refusal };
}

/** Classifica o erro de uma RPC `delete_*` ou de um PATCH do fluxo (o atalho de inativar). */
export function classifyWriteError(error: unknown): WriteFailure {
  if (isPermissionDenied(error)) return { kind: "forbidden" };
  const refusal = parseAppError(error);
  if (refusal) return fromRefusal(refusal);
  if (isNetworkError(error)) return { kind: "network" };
  return { kind: "unexpected" };
}

/** Resultado da pré-checagem da exclusão de membro (AQ-1). */
export type DeletionCheck =
  | { canDelete: true }
  | { canDelete: false; failure: WriteRefusal };

/**
 * Lê a resposta de `check_member_deletion`: `{ can_delete: true }` ou
 * `{ can_delete: false, code, message, … }`, com o mesmo conteúdo da recusa
 * de `delete_member` (DT-11). `null` num formato inesperado.
 */
export function parseDeletionCheck(value: unknown): DeletionCheck | null {
  if (!isJsonObject(value)) return null;
  if (value.can_delete === true) return { canDelete: true };
  if (value.can_delete !== false) return null;
  const refusal = toAppError(value);
  if (!refusal) return null;
  return { canDelete: false, failure: fromRefusal(refusal) };
}
