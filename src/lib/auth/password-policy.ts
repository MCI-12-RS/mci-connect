// A política de senha na tela (E2.03, RN-13, DT-06 e AQ-6): a gêmea de
// `private.password_policy_violation`, presa a ela pela tabela de casos
// `supabase/tests/fixtures/password-policy-cases.json`. A lista de senhas
// comuns (regra e) fica só no servidor. Sem React e sem Supabase.
//
// A senha é conferida exatamente como foi digitada: sem `trim` e sem
// normalização Unicode. O tamanho mínimo conta pontos de código (`char_length`
// no banco) e o máximo, bytes em UTF-8 (`octet_length`).

/** Os códigos da política (regras a a g), os mesmos do servidor. */
export type PasswordPolicyCode = "password_too_short" | "password_too_long" | "password_weak" | "password_personal_data";

/** Os códigos das trocas: a política, a regra h e a confirmação. */
export type PasswordChangeCode = PasswordPolicyCode | "password_same_as_current" | "password_mismatch";

export const PASSWORD_POLICY_CODES: readonly PasswordPolicyCode[] = [
  "password_too_short",
  "password_too_long",
  "password_weak",
  "password_personal_data",
];

export function isPasswordPolicyCode(value: unknown): value is PasswordPolicyCode {
  return typeof value === "string" && (PASSWORD_POLICY_CODES as readonly string[]).includes(value);
}

/** Os dados pessoais que a regra (g) confere. Dado que falta não é conferido (DA-6). */
export interface PasswordPersonalData {
  cpf?: string | null;
  mobile?: string | null;
  /** `AAAA-MM-DD`. */
  birth_date?: string | null;
  email?: string | null;
}

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;

/** A senha inicial pública (D11): vazia ou exatamente esta vale como vazia (RN-07). */
export const DEFAULT_INITIAL_PASSWORD = "123456";

/** Quantos caracteres (pontos de código) a senha tem. */
export function passwordLength(password: string): number {
  return Array.from(password).length;
}

/** Quantos bytes a senha ocupa em UTF-8. */
export function passwordBytes(password: string): number {
  return new TextEncoder().encode(password).length;
}

/** A regra "pelo menos 8 caracteres" já foi atendida (o ícone ao vivo, P16)? */
export function meetsMinLength(password: string): boolean {
  return passwordLength(password) >= PASSWORD_MIN_LENGTH;
}

// O `translate` de `private.fold_password`, caractere por caractere.
const FOLD_FROM = Array.from("áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ");
const FOLD_TO = Array.from("aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN");
const FOLD_MAP: ReadonlyMap<string, string> = new Map(FOLD_FROM.map((from, i) => [from, FOLD_TO[i]]));
const COMBINING_MARKS = /[̀-ͯ]/g;

/** Minúsculas só no ASCII, como o `lower(… COLLATE "C")` do banco. */
function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/**
 * A forma dobrada (DA-4): sem os acentos do português, sem as marcas
 * combinantes e em minúsculas ASCII. Igual a `private.fold_password`.
 */
export function foldPassword(password: string): string {
  const translated = Array.from(password, (char) => FOLD_MAP.get(char) ?? char).join("");
  return asciiLower(translated.replace(COMBINING_MARKS, ""));
}

/**
 * Sequência simples numa forma dobrada (regra d, DA-5): só dígitos, crescente
 * ou decrescente de 1 em 1, com a volta de 9 para 0; ou só letras de `a` a
 * `z`, crescente ou decrescente, sem volta. Igual a `private.is_simple_sequence`.
 */
export function isSimpleSequence(folded: string): boolean {
  const chars = Array.from(folded);
  if (chars.length < 2) return false;
  const code = (i: number) => chars[i].charCodeAt(0);

  if (/^[0-9]+$/.test(folded)) {
    const step = (code(1) - code(0) + 10) % 10;
    if (step !== 1 && step !== 9) return false;
    return chars.every((_, i) => i === 0 || (code(i) - code(i - 1) + 10) % 10 === step);
  }
  if (/^[a-z]+$/.test(folded)) {
    const step = code(1) - code(0);
    if (step !== 1 && step !== -1) return false;
    return chars.every((_, i) => i === 0 || code(i) - code(i - 1) === step);
  }
  return false;
}

const ALL_SAME = /^(.)\1*$/su;
const CONTEXT_WORD = /^(senha|mudar|igreja|mci|mci12|mci12rs|g12|connect)[^a-z]*$/su;

function digitsOf(value: string | null | undefined): string {
  return (value ?? "").replace(/[^0-9]/g, "");
}

/** `btrim` do banco: só espaços. */
function trimSpaces(value: string): string {
  return value.replace(/^ +| +$/g, "");
}

/** `AAAA-MM-DD` → `DDMMAAAA`; `null` se não for uma data nesse formato. */
function birthDigits(birthDate: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate ?? "");
  return match ? `${match[3]}${match[2]}${match[1]}` : null;
}

/** Regra (g): contém o CPF, os 8 últimos dígitos do celular ou o nascimento, ou é o e-mail. */
function hasPersonalData(password: string, personal: PasswordPersonalData): boolean {
  const stripped = password.replace(/[.\-/ ]/g, "");
  const cpf = digitsOf(personal.cpf);
  const mobile = digitsOf(personal.mobile);
  const birth = birthDigits(personal.birth_date);
  const email = asciiLower(trimSpaces(personal.email ?? ""));
  return (
    (cpf.length === 11 && stripped.includes(cpf)) ||
    (mobile.length >= 8 && stripped.includes(mobile.slice(-8))) ||
    (birth !== null && stripped.includes(birth)) ||
    (email !== "" && asciiLower(trimSpaces(password)) === email)
  );
}

/**
 * O código da primeira regra violada, na ordem da RN-13 (a, c, d, f, g), ou
 * `null`. A regra (e), a lista de senhas comuns, é só do servidor.
 */
export function passwordPolicyViolation(password: string, personal: PasswordPersonalData = {}): PasswordPolicyCode | null {
  if (passwordLength(password) < PASSWORD_MIN_LENGTH) return "password_too_short";
  if (passwordBytes(password) > PASSWORD_MAX_BYTES) return "password_too_long";
  const folded = foldPassword(password);
  if (ALL_SAME.test(folded) || isSimpleSequence(folded) || CONTEXT_WORD.test(folded)) return "password_weak";
  if (hasPersonalData(password, personal)) return "password_personal_data";
  return null;
}

/** A senha inicial do cadastro (RN-07): vazia ou `123456` exata valem; o resto passa pela política. */
export function initialPasswordViolation(password: string, personal: PasswordPersonalData): PasswordPolicyCode | null {
  if (password === "" || password === DEFAULT_INITIAL_PASSWORD) return null;
  return passwordPolicyViolation(password, personal);
}

/** Os campos das trocas de senha (T2 e T3). */
export type PasswordChangeField = "current_password" | "new_password" | "confirmation";

export interface PasswordChangeInput {
  mode: "forced" | "voluntary";
  /** Só na troca voluntária. */
  currentPassword: string;
  newPassword: string;
  confirmation: string;
  /** O próprio cadastro, na troca voluntária; `null` na obrigatória (só o servidor confere, AQ-6). */
  personal: PasswordPersonalData | null;
}

export type PasswordChangeCheck =
  /** Os campos vazios, na ordem da tela (cada um recebe a sua mensagem). */
  | { kind: "empty"; fields: PasswordChangeField[] }
  | { kind: "invalid"; field: "new_password" | "confirmation"; code: PasswordChangeCode }
  | null;

/**
 * O que a tela confere antes de enviar uma troca (UX-08, DA-7): os campos
 * vazios; depois a política; depois a regra (h), só na voluntária; depois a
 * confirmação. `null`: pode enviar.
 */
export function checkPasswordChange(input: PasswordChangeInput): PasswordChangeCheck {
  const fields: PasswordChangeField[] =
    input.mode === "voluntary" ? ["current_password", "new_password", "confirmation"] : ["new_password", "confirmation"];
  const values: Record<PasswordChangeField, string> = {
    current_password: input.currentPassword,
    new_password: input.newPassword,
    confirmation: input.confirmation,
  };
  const empty = fields.filter((field) => values[field] === "");
  if (empty.length > 0) return { kind: "empty", fields: empty };

  const policy = passwordPolicyViolation(input.newPassword, input.personal ?? {});
  if (policy) return { kind: "invalid", field: "new_password", code: policy };
  if (input.mode === "voluntary" && input.newPassword === input.currentPassword) {
    return { kind: "invalid", field: "new_password", code: "password_same_as_current" };
  }
  if (input.newPassword !== input.confirmation) return { kind: "invalid", field: "confirmation", code: "password_mismatch" };
  return null;
}
