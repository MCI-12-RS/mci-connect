// Leitura do e-mail, do celular e do CPF do cadastro de membro (E2.04, RN-04 a
// RN-09) e do login (E1.04, RN-03 e RN-04). Uma só regra para a tela inteira:
// o `src/lib/auth/identifier.ts` do login importa daqui.
//
// Gêmeas das funções do banco, e conferidas pelas mesmas tabelas de casos:
// - `normalizeEmail` ↔ `public.normalize_email`;
// - `isValidEmail` ↔ `public.is_valid_email`;
// - `isPlaceholderEmail` ↔ `public.is_placeholder_email` (lista em `public.placeholder_email_domains()`);
// - `normalizeDigits` ↔ `public.normalize_digits`;
// - `normalizeMobile` ↔ `public.normalize_mobile`;
// - `mobileMatchKey` ↔ `public.mobile_match_key`;
// - `isValidCpf` ↔ `public.is_valid_cpf`;
// - `hasLoginIdentifier` ↔ `public.member_has_login_identifier`.
// Tabelas: `supabase/tests/fixtures/member-validation-cases.json` e
// `login-identifier-cases.json`. Mudou uma regra, mude a função do banco e a tabela.

/**
 * Domínios dos e-mails fictícios (RN-05, D7, DT-18), na ordem de
 * `public.placeholder_email_domains()`. O teste confere com a tabela de casos.
 */
export const PLACEHOLDER_EMAIL_DOMAINS = ["mci12fakemail.com"] as const;

/** DA-3: o maior e-mail aceito, em caracteres (como o `length()` do Postgres). */
export const MAX_EMAIL_LENGTH = 254;

/** Tira só os espaços das pontas, como o `btrim(texto)` do Postgres (tabulações ficam). */
function trimSpaces(value: string): string {
  return value.replace(/^ +| +$/g, "");
}

/** RN-04: sem os espaços das pontas e em minúsculas. Vazio vira `null`. */
export function normalizeEmail(value: string | null | undefined): string | null {
  if (value == null) return null;
  const email = trimSpaces(value).toLowerCase();
  return email === "" ? null : email;
}

// Sem espaços, um "@", algo antes dele e, depois, pelo menos um ponto, com
// algo antes e depois de cada ponto.
const EMAIL_FORMAT = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/u;

/**
 * RN-04 e DA-3 sobre o e-mail como está (o banco recebe o normalizado): o
 * formato e no máximo 254 caracteres.
 */
export function isValidEmail(value: string | null | undefined): boolean {
  if (value == null) return false;
  return Array.from(value).length <= MAX_EMAIL_LENGTH && EMAIL_FORMAT.test(value);
}

/** RN-05: o domínio, depois do último "@" do e-mail normalizado, é um dos fictícios. */
export function isPlaceholderEmail(value: string | null | undefined): boolean {
  const email = normalizeEmail(value);
  if (email === null) return false;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1);
  return PLACEHOLDER_EMAIL_DOMAINS.some((placeholder) => placeholder === domain);
}

/** Só os dígitos. Sem nenhum, `null`. */
export function normalizeDigits(value: string | null | undefined): string | null {
  if (value == null) return null;
  const digits = value.replace(/\D/g, "");
  return digits === "" ? null : digits;
}

/**
 * RN-06 (e RN-03 do E1.04): o celular lido só pelos dígitos, sem os zeros à
 * esquerda e sem o 55 do Brasil quando há 12 ou 13 dígitos. O que sobra
 * precisa ter 10 ou 11 dígitos (DDD e número); senão, `null`.
 */
export function normalizeMobile(value: string | null | undefined): string | null {
  const withoutZeros = (normalizeDigits(value) ?? "").replace(/^0+/, "");
  const national =
    (withoutZeros.length === 12 || withoutZeros.length === 13) && withoutZeros.startsWith("55")
      ? withoutZeros.slice(2)
      : withoutZeros;
  return national.length === 10 || national.length === 11 ? national : null;
}

/**
 * RN-09 (P-VAL-07): a chave de comparação do celular, com a equivalência do
 * 9º dígito. 11 dígitos com 9 depois do DDD valem o mesmo que os 10 sem o 9.
 */
export function mobileMatchKey(value: string | null | undefined): string | null {
  const mobile = normalizeMobile(value);
  if (mobile === null) return null;
  return mobile.length === 11 && mobile[2] === "9" ? mobile.slice(0, 2) + mobile.slice(3) : mobile;
}

/**
 * O celular lido (10 ou 11 dígitos) com a máscara: "(51) 98888-7777" ou
 * "(51) 3333-4444". Qualquer outra coisa volta como veio.
 */
export function formatMobile(mobile: string): string {
  if (!/^\d{10,11}$/.test(mobile)) return mobile;
  const split = mobile.length - 4;
  return `(${mobile.slice(0, 2)}) ${mobile.slice(2, split)}-${mobile.slice(split)}`;
}

/** RN-07: o CPF só com os dígitos, com os zeros à esquerda. Sem nenhum, `null`. */
export function normalizeCpf(value: string | null | undefined): string | null {
  return normalizeDigits(value);
}

/**
 * RN-07 (e RN-04 do E1.04): CPF válido. Recebe só os dígitos, como
 * `public.is_valid_cpf`: exatamente 11, nem todos iguais e com os dígitos
 * verificadores corretos.
 */
export function isValidCpf(digits: string | null | undefined): boolean {
  if (digits == null || !/^[0-9]{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  const check = (length: number): number => {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(digits[i]) * (length + 1 - i);
    const dv = (sum * 10) % 11;
    return dv === 10 ? 0 : dv;
  };
  return check(9) === Number(digits[9]) && check(10) === Number(digits[10]);
}

/** Os 11 dígitos do CPF com a máscara: "529.982.247-25". Qualquer outra coisa volta como veio. */
export function formatCpf(digits: string): string {
  if (!/^\d{11}$/.test(digits)) return digits;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

/** Os três identificadores de login do cadastro, como digitados ou gravados. */
export interface LoginIdentifiers {
  email: string | null | undefined;
  mobile: string | null | undefined;
  cpf: string | null | undefined;
}

/** RN-08: um e-mail real no formato, um celular legível ou um CPF válido. */
export function hasLoginIdentifier({ email, mobile, cpf }: LoginIdentifiers): boolean {
  return (
    (isValidEmail(normalizeEmail(email)) && !isPlaceholderEmail(email)) ||
    normalizeMobile(mobile) !== null ||
    isValidCpf(normalizeCpf(cpf))
  );
}
