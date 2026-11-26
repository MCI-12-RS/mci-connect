// Os erros à vista no formulário de membro (E2.04, P22, UX-08 a UX-10, UX-12).
// Sem React e sem Supabase.
//
// - Ao salvar, a tela confere tudo de uma vez e mostra cada erro no seu campo.
// - Depois, um erro da tela some assim que o valor fica certo, e nenhum erro
//   novo aparece enquanto a pessoa digita.
// - A recusa do servidor some quando a pessoa muda aquele campo.

import { MEMBER_FIELDS } from "./codes";

/**
 * Os campos que mostram erro, na ordem da tela (T1): os do E2.04 e, no fim, a
 * Função (E2.02) e a senha inicial do cadastro novo (E2.03, RN-07).
 */
export const MEMBER_FORM_ERROR_FIELDS = [...MEMBER_FIELDS, "role_id", "password"] as const;

export type MemberFormErrorField = (typeof MEMBER_FORM_ERROR_FIELDS)[number];

const ERROR_FIELDS: ReadonlySet<string> = new Set(MEMBER_FORM_ERROR_FIELDS);

export function isMemberFormErrorField(value: string): value is MemberFormErrorField {
  return ERROR_FIELDS.has(value);
}

/** Um erro da tela, com o campo e o código da regra. */
export interface MemberFormFieldError {
  field: MemberFormErrorField;
  code: string;
  message: string;
}

/** Um erro à vista: o texto e se veio do servidor. */
export interface ShownFieldError {
  message: string;
  server: boolean;
}

export type ShownFieldErrors = Partial<Record<MemberFormErrorField, ShownFieldError>>;

/**
 * Os erros que uma mudança no valor `name` do formulário pode tirar:
 * - Celular, E-mail e CPF também mexem no grupo Identificação (RN-08);
 * - os interruptores e o Líder, no erro do pastor e no do Líder (RN-11, RN-12);
 * - "Batizado(a)?", no da data do batismo (RN-16).
 */
export function errorFieldsOfChange(name: string): MemberFormErrorField[] {
  switch (name) {
    case "mobile_whatsapp":
    case "email":
    case "cpf":
      return [name, "identification"];
    case "is_pastor":
    case "has_leadership":
    case "leader_id":
      return ["is_pastor", "leader_id"];
    case "is_baptized":
    case "baptism_date":
      return ["baptism_date"];
    default:
      return isMemberFormErrorField(name) ? [name] : [];
  }
}

/**
 * Os erros que continuam à vista depois de uma mudança (P22, UX-09):
 * - o da tela fica só enquanto a conferência atual (`fresh`) ainda o acusa, com o texto atual;
 * - o do servidor sai quando a mudança é no campo dele;
 * - nenhum erro novo entra.
 */
export function reconcileShownErrors(
  current: ShownFieldErrors,
  fresh: readonly MemberFormFieldError[],
  changed: readonly MemberFormErrorField[],
): ShownFieldErrors {
  const freshMessages = new Map(fresh.map((error) => [error.field, error.message]));
  const next: ShownFieldErrors = {};
  for (const field of MEMBER_FORM_ERROR_FIELDS) {
    const shown = current[field];
    if (!shown) continue;
    if (shown.server) {
      if (!changed.includes(field)) next[field] = shown;
      continue;
    }
    const message = freshMessages.get(field);
    if (message !== undefined) next[field] = { message, server: false };
  }
  return next;
}

/** Quantos campos têm erro (o resumo do rodapé, UX-10). */
export function shownErrorCount(errors: ShownFieldErrors): number {
  return MEMBER_FORM_ERROR_FIELDS.filter((field) => errors[field]).length;
}

/** O primeiro campo com erro, na ordem da tela, que recebe o foco (UX-08). */
export function firstErrorField(errors: ShownFieldErrors): MemberFormErrorField | null {
  return MEMBER_FORM_ERROR_FIELDS.find((field) => errors[field]) ?? null;
}

/** O que o formulário mostra, para saber se um campo está na tela. */
export interface MemberFormVisibility {
  /** Celular, E-mail e CPF (E1.08). */
  sensitiveVisible: boolean;
  /** Dados ministeriais e Cônjuge ("Editar Membro"). */
  canEditMinistry: boolean;
  /** "É Pastor(a)?" é um interruptor (igreja toda). */
  pastorSwitch: boolean;
  /** O campo Líder está à vista. */
  leaderShown: boolean;
  /** A data do batismo está à vista ("Batizado(a)?" ligado). */
  baptismDateShown: boolean;
  /** A Função é um seletor. */
  roleSelect: boolean;
}

/**
 * O campo está na tela? A recusa do servidor só vai para o campo à vista;
 * senão, vai para o `Alert` do topo (T5).
 */
export function isMemberFormFieldShown(field: MemberFormErrorField, visibility: MemberFormVisibility): boolean {
  switch (field) {
    case "identification":
    case "mobile_whatsapp":
    case "email":
    case "cpf":
      return visibility.sensitiveVisible;
    case "spouse_id":
      return visibility.canEditMinistry;
    case "is_pastor":
      return visibility.canEditMinistry && visibility.pastorSwitch;
    case "leader_id":
      return visibility.canEditMinistry && visibility.leaderShown;
    case "baptism_date":
      return visibility.canEditMinistry && visibility.baptismDateShown;
    case "role_id":
      return visibility.roleSelect;
    default:
      return true;
  }
}

/** As mensagens de uma recusa só nos campos que estão na tela; vazio: a recusa vai para o topo (T5). */
export function refusalFieldsShown(
  fields: Partial<Record<MemberFormErrorField, string>>,
  visibility: MemberFormVisibility,
): Partial<Record<MemberFormErrorField, string>> {
  const shown: Partial<Record<MemberFormErrorField, string>> = {};
  for (const field of MEMBER_FORM_ERROR_FIELDS) {
    const message = fields[field];
    if (message && isMemberFormFieldShown(field, visibility)) shown[field] = message;
  }
  return shown;
}
