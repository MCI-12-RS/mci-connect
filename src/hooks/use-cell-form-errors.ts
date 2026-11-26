import { useEffect, useRef } from "react";
import type { UseFormReturn } from "react-hook-form";
import { CELL_FORM_ERROR_FIELDS, isCellFormErrorField, type CellFormErrorField } from "@/lib/cells/codes";
import { validateCellForm, validateMeetingTimeOnBlur } from "@/lib/cells/validation";
import type { CellFormValues } from "@/lib/cells/write";

type CellForm = UseFormReturn<CellFormValues>;

/** O `type` dos erros que vieram do servidor; os da tela levam o código da regra. */
const SERVER_ERROR = "server";

export type ShownCellErrors = Partial<Record<CellFormErrorField, string>>;

function shownErrors(form: CellForm, formState?: CellForm["formState"]): ShownCellErrors {
  const shown: ShownCellErrors = {};
  for (const field of CELL_FORM_ERROR_FIELDS) {
    const message = form.getFieldState(field, formState).error?.message;
    if (message) shown[field] = message;
  }
  return shown;
}

/**
 * Os erros do formulário de célula (E2.08, P22, T5; o mesmo jeito do E2.04):
 * - ao salvar, o *resolver* põe todos de uma vez;
 * - a cada mudança, o erro da tela que ficou certo sai, e nenhum novo entra;
 * - ao sair do Horário alterado e preenchido, só o formato;
 * - a recusa do servidor entra no campo e sai quando o campo muda.
 * Salvar de novo com erros leva o foco ao próximo campo com erro (UX-10).
 */
export function useCellFormErrors(form: CellForm) {
  const lastFocused = useRef<CellFormErrorField | null>(null);

  useEffect(() => {
    const subscription = form.watch((_values, { name }) => {
      if (!name) return;
      const current = shownErrors(form);
      if (Object.keys(current).length === 0) return;
      const fresh = new Map(validateCellForm(form.getValues()).map((error) => [error.field, error.message]));
      for (const field of CELL_FORM_ERROR_FIELDS) {
        const message = current[field];
        if (!message) continue;
        const { error } = form.getFieldState(field);
        if (error?.type === SERVER_ERROR) {
          if (name === field) form.clearErrors(field);
          continue;
        }
        const now = fresh.get(field);
        if (now === undefined) form.clearErrors(field);
        else if (now !== message) form.setError(field, { type: error?.type, message: now });
      }
    });
    return () => subscription.unsubscribe();
  }, [form]);

  /** Ao sair do Horário (P22): só o formato, e só se a pessoa o alterou. */
  const checkTimeOnBlur = () => {
    if (!form.getFieldState("meeting_time").isDirty) return;
    const error = validateMeetingTimeOnBlur(form.getValues("meeting_time"));
    if (error) form.setError("meeting_time", { type: error.code, message: error.message });
  };

  /** O foco no primeiro campo com erro e, a cada nova tentativa, no seguinte (UX-10). */
  const focusNextError = () => {
    const fields = CELL_FORM_ERROR_FIELDS.filter((field) => shownErrors(form)[field]);
    if (fields.length === 0) return;
    const index = lastFocused.current ? fields.indexOf(lastFocused.current) : -1;
    const next = fields[(index + 1) % fields.length];
    lastFocused.current = next;
    form.setFocus(next);
  };

  /** A recusa do servidor no campo, com o foco nele (UX-11). */
  const showServerError = (field: string, message: string) => {
    if (!isCellFormErrorField(field)) return;
    form.setError(field, { type: SERVER_ERROR, message });
    lastFocused.current = field;
    form.setFocus(field);
  };

  return { shown: shownErrors(form, form.formState), checkTimeOnBlur, focusNextError, showServerError };
}
