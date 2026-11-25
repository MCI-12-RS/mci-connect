import { useEffect, useRef } from "react";
import type { UseFormReturn } from "react-hook-form";
import {
  MEMBER_FORM_ERROR_FIELDS,
  errorFieldsOfChange,
  firstErrorField,
  reconcileShownErrors,
  type MemberFormErrorField,
  type ShownFieldErrors,
} from "@/lib/members/form-errors";
import { validateMemberFormFields, type MemberFormContext } from "@/lib/members/form-resolver";
import type { MemberFormFields } from "@/lib/members/form-values";
import { validateOnBlur, type BlurCheckedField } from "@/lib/members/validation";

type MemberForm = UseFormReturn<MemberFormFields, MemberFormContext>;

/** O `type` dos erros que vieram do servidor; os da tela levam o código da regra. */
const SERVER_ERROR = "server";

/**
 * Os erros à vista. Com `formState` (na renderização), a leitura assina as
 * mudanças dos erros; sem ele (nos eventos), lê o estado atual do formulário.
 */
function shownErrors(form: MemberForm, formState?: MemberForm["formState"]): ShownFieldErrors {
  const shown: ShownFieldErrors = {};
  for (const field of MEMBER_FORM_ERROR_FIELDS) {
    const { error } = form.getFieldState(field, formState);
    if (error?.message) shown[field] = { message: error.message, server: error.type === SERVER_ERROR };
  }
  return shown;
}

/** O campo que recebe o foco por um erro: o grupo Identificação leva ao Celular (T5). */
const focusTarget = (field: MemberFormErrorField) => (field === "identification" ? "mobile_whatsapp" : field);

/**
 * Os erros do formulário de membro no react-hook-form (P22, UX-08 a UX-10):
 * - ao salvar, o *resolver* põe todos de uma vez;
 * - a cada mudança, os erros à vista que ficaram certos saem, e nenhum novo entra;
 * - ao sair de um campo alterado e preenchido, só o formato dele;
 * - as recusas do servidor entram como `server` e saem quando o campo muda.
 */
export function useMemberFormErrors(form: MemberForm, context: MemberFormContext) {
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    const subscription = form.watch((_values, { name }) => {
      if (!name) return;
      const current = shownErrors(form);
      if (Object.keys(current).length === 0) return;
      const fresh = validateMemberFormFields(form.getValues(), contextRef.current);
      const next = reconcileShownErrors(current, fresh, errorFieldsOfChange(name));
      for (const field of MEMBER_FORM_ERROR_FIELDS) {
        const before = current[field];
        const after = next[field];
        if (before && !after) form.clearErrors(field);
        else if (after && after.message !== before?.message) form.setError(field, { type: "rule", message: after.message });
      }
    });
    return () => subscription.unsubscribe();
  }, [form]);

  /** Ao sair do campo (P-VAL-19): só o formato, sem o servidor. */
  const checkOnBlur = (field: BlurCheckedField) => {
    const { validation } = contextRef.current;
    const error = validateOnBlur(field, form.getValues(field), { stored: validation.stored, today: validation.today });
    if (error) form.setError(field, { type: error.code, message: error.message });
  };

  /** Leva o foco ao primeiro campo com erro, na ordem da tela (UX-08, UX-10). */
  const focusFirstError = () => {
    const field = firstErrorField(shownErrors(form));
    if (field) form.setFocus(focusTarget(field));
  };

  /** Mostra as recusas do servidor nos campos e leva o foco à primeira (UX-12). */
  const showServerErrors = (errors: Partial<Record<MemberFormErrorField, string>>) => {
    for (const field of MEMBER_FORM_ERROR_FIELDS) {
      const message = errors[field];
      if (message) form.setError(field, { type: SERVER_ERROR, message });
    }
    focusFirstError();
  };

  return { shown: shownErrors(form, form.formState), checkOnBlur, focusFirstError, showServerErrors };
}
