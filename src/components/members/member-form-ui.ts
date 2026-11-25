import type { ShownFieldErrors, MemberFormErrorField } from "@/lib/members/form-errors";
import type { BlurCheckedField, LegacyWarnings } from "@/lib/members/validation";

/** O que as seções do formulário de membro recebem para mostrar mensagens (P21, P22, P24). */
export interface MemberFieldsUi {
  /** "Meus dados" só para leitura (E2.02): campos `readOnly`, sem avisos nem erros. */
  readOnly: boolean;
  errors: ShownFieldErrors;
  /** Os avisos de dado antigo ainda à vista (T6). */
  warnings: LegacyWarnings;
  /** Confere o formato ao sair de um campo (P-VAL-19). */
  onBlurCheck: (field: BlurCheckedField) => void;
}

/** O texto do erro de um campo, ou `null`. */
export function errorOf(ui: MemberFieldsUi, field: MemberFormErrorField): string | null {
  return ui.errors[field]?.message ?? null;
}

/** A borda de erro do campo (P21): nunca sozinha, sempre com o texto e o ícone. */
export function invalidBorder(invalid: boolean): string | undefined {
  return invalid ? "border-destructive" : undefined;
}

/** As classes do bloco de um campo: rótulo, campo e mensagens empilhados. */
export const FIELD_BLOCK = "min-w-0 space-y-2";
