import type { ShownCellErrors } from "@/hooks/use-cell-form-errors";

/** As classes do bloco de um campo: rótulo, campo e mensagens empilhados. */
export const FIELD_BLOCK = "min-w-0 space-y-2";

/** A legenda dos grupos (T1): o estilo dos subtítulos. */
export const LEGEND = "mb-3 text-base font-semibold";

/** A borda de erro do campo (P21): nunca sozinha, sempre com o texto e o ícone. */
export function invalidBorder(invalid: boolean): string | undefined {
  return invalid ? "border-destructive" : undefined;
}

/** O que os grupos do formulário recebem para mostrar os erros (P21, P22). */
export interface CellFieldsUi {
  errors: ShownCellErrors;
}
