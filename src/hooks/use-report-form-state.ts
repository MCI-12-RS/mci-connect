import { useCallback, useRef, useState } from "react";
import {
  REPORT_FORM_FIELDS,
  validateReportForm,
  validateTimeOnBlur,
  type ReportFormField,
  type ReportFormValues,
  type ReportValidationContext,
} from "@/lib/cell-reports/validation";

/** Um erro mostrado: da tela (some quando o valor fica certo) ou do servidor (some quando o campo muda). */
interface ShownError {
  message: string;
  source: "screen" | "server";
}

export type ShownReportErrors = Partial<Record<ReportFormField, string>>;

/** Como levar o foco a cada campo (o seletor, o `Select` da data, a opção marcada). */
export type FocusTarget = () => void;

/**
 * O estado do formulário de relatório (E2.11, P22, T7): os valores, os erros
 * mostrados e o foco. As regras ficam em `src/lib/cell-reports/validation.ts`;
 * aqui, só quando conferir e onde pôr o foco:
 * - ao enviar, todos de uma vez, com o foco no primeiro e, a cada nova
 *   tentativa, no seguinte;
 * - a cada mudança, o erro da tela que ficou certo sai, e nenhum novo entra;
 * - ao sair do Horário alterado e preenchido, só o formato;
 * - a recusa do servidor entra no campo e sai quando o campo muda.
 */
export function useReportFormState(initial: ReportFormValues, context: () => ReportValidationContext) {
  const [values, setValues] = useState<ReportFormValues>(initial);
  const [errors, setErrors] = useState<Partial<Record<ReportFormField, ShownError>>>({});
  const focusTargets = useRef(new Map<ReportFormField, FocusTarget>());
  const lastFocused = useRef<ReportFormField | null>(null);
  const valuesRef = useRef(values);
  const contextRef = useRef(context);
  contextRef.current = context;

  const registerFocus = useCallback((field: ReportFormField, target: FocusTarget | null) => {
    if (target) focusTargets.current.set(field, target);
    else focusTargets.current.delete(field);
  }, []);

  const recheck = useCallback((next: ReportFormValues, changed: ReportFormField[]) => {
    setErrors((current) => {
      if (Object.keys(current).length === 0) return current;
      const fresh = new Map(validateReportForm(next, contextRef.current()).map((error) => [error.field, error.message]));
      const result: Partial<Record<ReportFormField, ShownError>> = {};
      for (const field of REPORT_FORM_FIELDS) {
        const shown = current[field];
        if (!shown) continue;
        if (shown.source === "server") {
          if (!changed.includes(field)) result[field] = shown;
          continue;
        }
        const now = fresh.get(field);
        if (now !== undefined) result[field] = { message: now, source: "screen" };
      }
      return result;
    });
  }, []);

  /** Muda campos. `fields` são os campos de erro afetados (o par Data e Horário afeta os dois). */
  const update = useCallback(
    (patch: Partial<ReportFormValues>, fields: ReportFormField[]) => {
      const next = { ...valuesRef.current, ...patch };
      valuesRef.current = next;
      setValues(next);
      recheck(next, fields);
    },
    [recheck],
  );

  const focusField = useCallback((field: ReportFormField) => {
    lastFocused.current = field;
    focusTargets.current.get(field)?.();
  }, []);

  /** Confere tudo ao enviar. `true` sem erros. */
  const validateAll = (): boolean => {
    const found = validateReportForm(valuesRef.current, contextRef.current());
    const next: Partial<Record<ReportFormField, ShownError>> = {};
    for (const error of found) if (!next[error.field]) next[error.field] = { message: error.message, source: "screen" };
    setErrors(next);
    if (found.length === 0) {
      lastFocused.current = null;
      return true;
    }
    const fields = REPORT_FORM_FIELDS.filter((field) => next[field] && focusTargets.current.has(field));
    const index = lastFocused.current ? fields.indexOf(lastFocused.current) : -1;
    const target = fields[(index + 1) % Math.max(fields.length, 1)] ?? fields[0];
    // Depois do render: o campo com erro pode ter acabado de aparecer.
    if (target) setTimeout(() => focusField(target), 0);
    return false;
  };

  /** Ao sair do Horário (P22): só o formato, e só se a pessoa o alterou. */
  const checkTimeOnBlur = (changed: boolean) => {
    if (!changed) return;
    const error = validateTimeOnBlur(valuesRef.current.time);
    if (error) setErrors((current) => ({ ...current, time: { message: error.message, source: "screen" } }));
  };

  /** A recusa do servidor no campo, com o foco nele (T7). */
  const showServerError = (field: ReportFormField, message: string) => {
    setErrors((current) => ({ ...current, [field]: { message, source: "server" } }));
    setTimeout(() => focusField(field), 0);
  };

  const clearErrors = () => setErrors({});

  const shown: ShownReportErrors = {};
  for (const field of REPORT_FORM_FIELDS) {
    const error = errors[field];
    if (error) shown[field] = error.message;
  }

  return { values, update, errors: shown, validateAll, checkTimeOnBlur, showServerError, clearErrors, registerFocus, valuesRef };
}
