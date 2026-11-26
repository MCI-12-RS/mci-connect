// A conferência do formulário de célula ao salvar (E2.08, RN-14, P22), como
// *resolver* do react-hook-form: todos os erros de uma vez, cada um no seu
// campo. Só tipos do react-hook-form; a regra é a de `validation.ts`.
import type { FieldErrors, Resolver } from "react-hook-form";
import { validateCellForm } from "./validation";
import type { CellFormValues } from "./write";

export const cellFormResolver: Resolver<CellFormValues> = (values) => {
  const errors = validateCellForm(values);
  if (errors.length === 0) return { values, errors: {} };
  const fieldErrors: FieldErrors<CellFormValues> = {};
  for (const error of errors) fieldErrors[error.field] = { type: error.code, message: error.message };
  return { values: {}, errors: fieldErrors };
};
