// Conferência do formulário de membro na tela (E2.04, RN-02 a RN-08, RN-11 a
// RN-17, RN-19; P-VAL-19, P22, P24). Adianta as regras do banco
// (`ad_enforce_member_rules`), na mesma ordem e com os mesmos códigos, para a
// pessoa ver todos os erros de uma vez. Quem decide é o banco: o dado em uso
// (RN-09) e o ciclo (RN-13) só ele confere, e só ao salvar.
//
// Tipo (a) vale sempre; tipo (b) vale no cadastro novo e no campo que muda,
// "mudou" lido pela regra do campo (RN-17, DT-05).

import { birthDateProblem } from "./birth-date";
import { memberFieldChanged } from "./changes";
import { MEMBER_FIELDS, type MemberField, type MemberRuleCode } from "./codes";
import {
  hasLoginIdentifier,
  isPlaceholderEmail,
  isValidCpf,
  isValidEmail,
  normalizeDigits,
  normalizeEmail,
  normalizeMobile,
} from "./identifiers";
import { isValidPersonName } from "./name";
import { MEMBER_LEGACY_TEXTS, MEMBER_RULE_TEXTS } from "./texts";

/** Os campos que as regras leem, como estão no formulário ou gravados. Datas em "aaaa-mm-dd". */
export interface MemberRuleValues {
  name?: string | null;
  gender?: string | null;
  birth_date?: string | null;
  mobile_whatsapp?: string | null;
  email?: string | null;
  cpf?: string | null;
  spouse_id?: string | null;
  is_pastor?: boolean | null;
  /** `null` ou ausente: omitido, resolvido como no banco (DT-06). */
  has_leadership?: boolean | null;
  leader_id?: string | null;
  is_baptized?: boolean | null;
  baptism_date?: string | null;
}

export interface MemberValidationContext {
  /** O cadastro como está gravado (edição). `null` no cadastro novo. */
  stored: MemberRuleValues | null;
  /** O id do cadastro (edição), para "líder de si mesmo" e "cônjuge de si mesmo". */
  memberId: string | null;
  /** O "hoje" de Brasília, de `spToday()`. */
  today: string;
  /** Quem edita vê (e altera) Celular, E-mail e CPF (E1.08). Sem isso, o grupo Identificação não é conferido. */
  sensitiveVisible: boolean;
  /** Quem edita altera os dados ministeriais ("Editar Membro"). Sem isso, eles não são conferidos. */
  canEditMinistry: boolean;
  /** Quem edita vê a igreja toda: muda o texto do líder obrigatório (DA-2). */
  seesWholeChurch: boolean;
  /**
   * O Líder é sempre obrigatório, sem "Tem Liderança?" (quem vê só o
   * ministério, `ministryFieldsView().leader === "required"`, E2.02).
   */
  leaderAlwaysRequired?: boolean;
}

/** Um erro de preenchimento, no campo em que aparece. */
export interface MemberFieldError {
  field: MemberField;
  code: MemberRuleCode;
  message: string;
}

const isBlank = (value: string | null | undefined): boolean => value == null || value.trim() === "";

/** O campo conta para uma regra do tipo (b): cadastro novo, ou o valor mudou. */
function counts(
  field: "name" | "birth_date" | "mobile_whatsapp" | "email" | "cpf",
  values: MemberRuleValues,
  stored: MemberRuleValues | null,
): boolean {
  return stored === null || memberFieldChanged(field, stored[field], values[field]);
}

function nameError(name: string | null | undefined): MemberFieldError | null {
  return isValidPersonName(name) ? null : { field: "name", code: "name_invalid", message: MEMBER_RULE_TEXTS.nameInvalid };
}

function birthDateError(birth: string | null | undefined, today: string): MemberFieldError | null {
  const problem = birthDateProblem(isBlank(birth) ? null : birth, today);
  if (problem === null) return null;
  const message = problem === "birth_date_future" ? MEMBER_RULE_TEXTS.birthDateFuture : MEMBER_RULE_TEXTS.birthDateTooOld;
  return { field: "birth_date", code: problem, message };
}

// Celular e CPF: um texto preenchido que não se lê é recusado, mesmo sem
// dígitos ("abc"). O banco o gravaria vazio; a tela não apaga nada em silêncio.
function mobileError(mobile: string | null | undefined): MemberFieldError | null {
  if (isBlank(mobile) || normalizeMobile(mobile) !== null) return null;
  return { field: "mobile_whatsapp", code: "mobile_invalid", message: MEMBER_RULE_TEXTS.mobileInvalid };
}

/** RN-05 antes da RN-04, como no banco. */
function emailError(email: string | null | undefined): MemberFieldError | null {
  const normalized = normalizeEmail(email);
  if (normalized === null) return null;
  if (isPlaceholderEmail(normalized)) {
    return { field: "email", code: "email_placeholder", message: MEMBER_RULE_TEXTS.emailPlaceholder };
  }
  return isValidEmail(normalized) ? null : { field: "email", code: "email_invalid", message: MEMBER_RULE_TEXTS.emailInvalid };
}

function cpfError(cpf: string | null | undefined): MemberFieldError | null {
  if (isBlank(cpf) || isValidCpf(normalizeDigits(cpf))) return null;
  return { field: "cpf", code: "cpf_invalid", message: MEMBER_RULE_TEXTS.cpfInvalid };
}

const identifiersOf = (values: MemberRuleValues) => ({
  email: values.email,
  mobile: values.mobile_whatsapp,
  cpf: values.cpf,
});

/**
 * "Tem Liderança?" como o banco a resolve (`a0_normalize_member`, DT-06):
 * omitida, fica ligada no cadastro novo (desligada para pastor) e como estava
 * na edição; com líder, liga; quem vira pastor sem líder perde a chave herdada.
 */
export function effectiveHasLeadership(values: MemberRuleValues, stored: MemberRuleValues | null): boolean {
  const isPastor = values.is_pastor === true;
  let hasLeadership = values.has_leadership ?? (stored === null ? !isPastor : stored.has_leadership === true);
  if (values.leader_id) hasLeadership = true;
  if (stored !== null && isPastor && !values.leader_id && hasLeadership && stored.has_leadership === true) hasLeadership = false;
  return hasLeadership;
}

function leadershipChanged(values: MemberRuleValues, stored: MemberRuleValues | null): boolean {
  if (stored === null) return true;
  return (
    (values.is_pastor === true) !== (stored.is_pastor === true) ||
    effectiveHasLeadership(values, stored) !== (stored.has_leadership === true) ||
    (values.leader_id ?? null) !== (stored.leader_id ?? null)
  );
}

function ministryErrors(values: MemberRuleValues, context: MemberValidationContext): MemberFieldError[] {
  const { stored, memberId } = context;
  const errors: MemberFieldError[] = [];
  const leaderId = values.leader_id ?? null;

  if (values.spouse_id && memberId && values.spouse_id === memberId) {
    errors.push({ field: "spouse_id", code: "spouse_self", message: MEMBER_RULE_TEXTS.spouseSelf });
  }

  if (leadershipChanged(values, stored)) {
    const isPastor = values.is_pastor === true;
    const hasLeadership = effectiveHasLeadership(values, stored);
    if (isPastor && (leaderId || hasLeadership)) {
      errors.push({ field: "is_pastor", code: "pastor_with_leader", message: MEMBER_RULE_TEXTS.pastorWithLeader });
    } else if (!isPastor && !leaderId && (hasLeadership || context.leaderAlwaysRequired)) {
      const message =
        context.seesWholeChurch && !context.leaderAlwaysRequired
          ? MEMBER_RULE_TEXTS.leaderRequiredWholeChurch
          : MEMBER_RULE_TEXTS.leaderRequired;
      errors.push({ field: "leader_id", code: "leader_required", message });
    }
  }

  if (leaderId && memberId && leaderId === memberId) {
    errors.push({ field: "leader_id", code: "leader_self", message: MEMBER_RULE_TEXTS.leaderSelf });
  }

  // RN-16, depois da derivação do banco: desligar "Batizado(a)?" sem mexer na data a apaga.
  const keepsStoredDate =
    stored !== null && stored.is_baptized === true && (stored.baptism_date ?? null) === (values.baptism_date ?? null);
  if (values.is_baptized !== true && !isBlank(values.baptism_date) && !keepsStoredDate) {
    errors.push({
      field: "baptism_date",
      code: "baptism_date_without_baptism",
      message: MEMBER_RULE_TEXTS.baptismDateWithoutBaptism,
    });
  }
  return errors;
}

function byScreenOrder(errors: Array<MemberFieldError | null>): MemberFieldError[] {
  const present = errors.filter((error): error is MemberFieldError => error !== null);
  return MEMBER_FIELDS.flatMap((field) => present.filter((error) => error.field === field).slice(0, 1));
}

/**
 * Todos os erros de preenchimento de uma vez (RN-19), na ordem da tela, no
 * máximo um por campo. Vazio: pode enviar.
 *
 * O erro do grupo Identificação (RN-08) só aparece quando nenhum dos três
 * campos tem erro de formato: com um formato errado, o erro do próprio campo
 * já explica o que falta.
 */
export function validateMemberForm(values: MemberRuleValues, context: MemberValidationContext): MemberFieldError[] {
  const { stored, today } = context;
  const errors: Array<MemberFieldError | null> = [];

  if (counts("name", values, stored)) errors.push(nameError(values.name));
  if (values.gender !== "M" && values.gender !== "F") {
    errors.push({ field: "gender", code: "gender_required", message: MEMBER_RULE_TEXTS.genderRequired });
  }
  if (counts("birth_date", values, stored)) errors.push(birthDateError(values.birth_date, today));

  if (context.sensitiveVisible) {
    const formatErrors = [
      counts("mobile_whatsapp", values, stored) ? mobileError(values.mobile_whatsapp) : null,
      counts("email", values, stored) ? emailError(values.email) : null,
      counts("cpf", values, stored) ? cpfError(values.cpf) : null,
    ];
    errors.push(...formatErrors);
    const required = stored === null || hasLoginIdentifier(identifiersOf(stored));
    if (formatErrors.every((error) => error === null) && required && !hasLoginIdentifier(identifiersOf(values))) {
      errors.push({ field: "identification", code: "identifier_required", message: MEMBER_RULE_TEXTS.identifierRequired });
    }
  }

  if (context.canEditMinistry) errors.push(...ministryErrors(values, context));
  return byScreenOrder(errors);
}

/** Os campos conferidos ao sair deles (P-VAL-19). */
export type BlurCheckedField = "name" | "birth_date" | "mobile_whatsapp" | "email" | "cpf";

/**
 * Ao sair de um campo (P-VAL-19, UX-09): só o formato daquele campo, sem o
 * servidor. Campo vazio não mostra erro, e o valor igual ao gravado (lido pela
 * regra) também não: o campo volta a não contar como alterado (P24).
 */
export function validateOnBlur(
  field: BlurCheckedField,
  value: string | null | undefined,
  context: Pick<MemberValidationContext, "stored" | "today">,
): MemberFieldError | null {
  if (isBlank(value)) return null;
  if (!counts(field, { [field]: value }, context.stored)) return null;
  switch (field) {
    case "name":
      return nameError(value);
    case "birth_date":
      return birthDateError(value, context.today);
    case "mobile_whatsapp":
      return mobileError(value);
    case "email":
      return emailError(value);
    case "cpf":
      return cpfError(value);
  }
}

/** Os campos que podem ter aviso de dado antigo (T6). */
export type LegacyWarningField = "name" | "birth_date" | "identification" | "mobile_whatsapp";

export type LegacyWarnings = Partial<Record<LegacyWarningField, string>>;

export interface LegacyWarningVisibility {
  /** Quem edita vê Celular, E-mail e CPF (E1.08). */
  sensitiveVisible: boolean;
  /** "Ver meus dados" só para leitura (E2.02): sem avisos (UX-23). */
  readOnly: boolean;
  /** O "hoje" de Brasília. */
  today: string;
}

/**
 * Os avisos de dado antigo fora das regras do tipo (b) (RN-17, P24, T6), pelo
 * que está gravado: nome de uma palavra só, celular ilegível, data de
 * nascimento fora do intervalo e nenhum identificador. Só nos campos que quem
 * edita vê. Não impedem salvar.
 */
export function legacyWarnings(stored: MemberRuleValues, visibility: LegacyWarningVisibility): LegacyWarnings {
  if (visibility.readOnly) return {};
  const warnings: LegacyWarnings = {};
  if (!isValidPersonName(stored.name)) warnings.name = MEMBER_LEGACY_TEXTS.name;
  if (birthDateProblem(stored.birth_date, visibility.today) !== null) warnings.birth_date = MEMBER_LEGACY_TEXTS.birthDate;
  if (visibility.sensitiveVisible) {
    if (!hasLoginIdentifier(identifiersOf(stored))) warnings.identification = MEMBER_LEGACY_TEXTS.identification;
    if (!isBlank(stored.mobile_whatsapp) && normalizeMobile(stored.mobile_whatsapp) === null) {
      warnings.mobile_whatsapp = MEMBER_LEGACY_TEXTS.mobile;
    }
  }
  return warnings;
}

/**
 * Os avisos que continuam à vista com os valores atuais (P24): o do campo some
 * quando a pessoa o muda e volta quando ela volta ao valor gravado; o da
 * Identificação some quando algum dos três passa a ser um identificador real.
 */
export function visibleLegacyWarnings(
  warnings: LegacyWarnings,
  stored: MemberRuleValues,
  values: MemberRuleValues,
): LegacyWarnings {
  const visible: LegacyWarnings = {};
  for (const field of ["name", "birth_date", "mobile_whatsapp"] as const) {
    if (warnings[field] && !memberFieldChanged(field, stored[field], values[field])) visible[field] = warnings[field];
  }
  if (warnings.identification && !hasLoginIdentifier(identifiersOf(values))) visible.identification = warnings.identification;
  return visible;
}
