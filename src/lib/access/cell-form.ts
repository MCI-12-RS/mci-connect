// Recusas do formulário de célula (E2.02, T7 e T11; RN-09 e RN-12). Sem React
// e sem Supabase: a tela só mostra o que estas funções decidem.

import { isPermissionDenied, parseAppError } from "@/lib/errors";
import { refusalField } from "./codes";
import { ACCESS_TEXTS } from "./texts";

/** Os campos de pessoa da célula: onde a RN-09 (b) aparece, quando o servidor diz qual. */
export type CellPersonField = "leader_id" | "timothy_id" | "host_id";

export interface CellFormRefusal {
  message: string;
  /** Onde a recusa aparece: embaixo do campo ou, com `null`, no `Alert` do topo. */
  field: CellPersonField | null;
  /** A tela relê o acesso (P13): no 42501. */
  rereadAccess: boolean;
}

function cellPersonField(field: string | null): CellPersonField | null {
  return field === "leader_id" || field === "timothy_id" || field === "host_id" ? field : null;
}

/**
 * A recusa de uma gravação em `cells` (PostgREST), pronta para a tela:
 * - 42501: "Você não tem permissão para esta ação.", no topo, e a tela relê o acesso;
 * - pessoa fora do que se vê (RN-09 b): embaixo do Líder, do Timóteo ou do Anfitrião, quando o servidor diz qual;
 * - as demais regras (RN-09 c `would_leave_scope`, E2.01): no topo, com a mensagem do Negócio.
 *
 * `null` para o que não é recusa (rede, erro técnico): a tela usa o aviso dela.
 */
export function cellRefusalFromError(error: unknown): CellFormRefusal | null {
  if (isPermissionDenied(error)) return { message: ACCESS_TEXTS.permissionDenied, field: null, rereadAccess: true };
  const appError = parseAppError(error);
  if (!appError) return null;
  const field = appError.code === "person_not_visible" ? cellPersonField(refusalField(appError)) : null;
  return { message: appError.message, field, rereadAccess: false };
}
