// A conferência do formulário de membro ao salvar (E2.04, RN-19, P22), como
// *resolver* do react-hook-form: tudo o que a tela sabe conferir, de uma vez,
// cada erro no seu campo. Só tipos do react-hook-form; a regra é a de
// `validation.ts`.

import type { FieldErrors, Resolver } from "react-hook-form";
import type { MinistryFieldsView } from "@/lib/access/member-form";
import { MEMBER_FORM_TEXTS } from "@/lib/access/texts";
import { initialPasswordViolation } from "@/lib/auth/password-policy";
import { initialPasswordErrorMessage } from "@/lib/auth/password-texts";
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
  /** Cadastro novo: a senha inicial passa pela política (E2.03, RN-07). */
  initialPassword?: boolean;
}

/**
 * O erro da senha inicial (E2.03, RN-07 e UX-31), com o CPF, o celular, o
 * nascimento e o e-mail digitados no formulário. Vazia e `123456` não dão erro.
 */
export function initialPasswordError(fields: MemberFormFields): MemberFormFieldError | null {
  const code = initialPasswordViolation(fields.password, {
    cpf: fields.cpf,
    mobile: fields.mobile_whatsapp,
    birth_date: fields.birth_date,
    email: fields.email,
  });
  return code ? { field: "password", code, message: initialPasswordErrorMessage(code) } : null;
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
  const password = context.initialPassword ? initialPasswordError(fields) : null;
  if (password) errors.push(password);
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
