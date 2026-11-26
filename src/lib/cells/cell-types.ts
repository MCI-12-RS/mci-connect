// Tipos de célula (`cells.type`), exatamente como gravados no banco (E2.08, RN-07).
// Lista única do front, espelho de `public.cell_types()` e `public.cell_default_type()`;
// a tabela de casos (`supabase/tests/fixtures/cell-rules-cases.json`) confere os dois lados.

export const CELL_TYPES = ["Evangelística", "Discipulado", "Macrocélula"] as const;

export type CellType = (typeof CELL_TYPES)[number];

/** O tipo da célula nova (P-CEL-03). */
export const DEFAULT_CELL_TYPE: CellType = "Evangelística";

/** Valor da lista, comparado exatamente (sem normalizar maiúsculas nem acentos). */
export function isCellType(value: string | null | undefined): value is CellType {
  return CELL_TYPES.some((type) => type === value);
}
