// A conferência do formulário de membro ao salvar (E2.04, RN-19, P22), como
// *resolver* do react-hook-form: tudo o que a tela sabe conferir, de uma vez,
// cada erro no seu campo. Só tipos do react-hook-form; a regra é a de
// `validation.ts`.

import type { FieldErrors, Resolver } from "react-hook-form";
import type { MinistryFieldsView } from "@/lib/access/member-form";
import { MEMBER_FORM_TEXTS } from "@/lib/access/texts";
import type { MemberFormFieldError } from "./form-errors";
import { memberRuleValues, memberWriteValues, type MemberFormFields } from "./form-values";
import { validateMemberForm, type MemberValidationContext } from "./validation";

/** O que a conferência precisa saber além dos valores. */
export interface MemberFormContext {
  validation: MemberValidationContext;
  /** Os dados ministeriais que quem edita vê (E2.02). */
  view: MinistryFieldsView;
  /** O campo Função: obrigatório quando é um seletor (E2.02), com a escolha inicial de `role_options`. */
  role: { required: boolean; initial: string | null };
}

/** A função que vale: a escolhida ou, sem escolha, a inicial. */
export function effectiveRoleId(fields: Pick<MemberFormFields, "role_id">, role: MemberFormContext["role"]): string | null {
  return fields.role_id ?? role.initial;
}

/** Todos os erros de preenchimento do formulário, na ordem da tela. Vazio: pode enviar. */
export function validateMemberFormFields(fields: MemberFormFields, context: MemberFormContext): MemberFormFieldError[] {
  const values = memberWriteValues(fields, context.view, effectiveRoleId(fields, context.role));
  const errors: MemberFormFieldError[] = validateMemberForm(memberRuleValues(values), context.validation);
  if (context.role.required && !effectiveRoleId(fields, context.role)) {
    errors.push({ field: "role_id", code: "role_required", message: MEMBER_FORM_TEXTS.roleRequired });
  }
  return errors;
}

/** O *resolver* do formulário: os erros vão para os campos, com o código da regra no `type`. */
export const memberFormResolver: Resolver<MemberFormFields, MemberFormContext> = (values, context) => {
  const errors = context ? validateMemberFormFields(values, context) : [];
  if (errors.length === 0) return { values, errors: {} };
  const fieldErrors: FieldErrors<MemberFormFields> = {};
  for (const error of errors) fieldErrors[error.field] = { type: error.code, message: error.message };
  return { values: {}, errors: fieldErrors };
};
