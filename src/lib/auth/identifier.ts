// Leitura da identificação digitada no login (E1.04, RN-02 a RN-04 e RN-08).
// Gêmea de `private.parse_login_identifier` (migration e104_02): as duas passam
// pela mesma tabela de casos, `supabase/tests/fixtures/login-identifier-cases.json`
// (AQ-3). Mudou uma, mude a outra e a tabela.
//
// A tela usa esta leitura só para o indicador de tipo e para não enviar o que
// não tem a forma de nenhuma identificação. Nunca consulta o servidor, e o que
// é enviado é sempre o texto digitado: quem decide é a função `sign-in`.

import { IDENTIFIER_TYPE_LABELS, type IdentifierType } from "@/lib/auth/session";

export type IdentifierFormat = "empty" | IdentifierType | "unknown";

/** Acima disso, a identificação é inválida, com ou sem "@" (DA-4). */
const MAX_IDENTIFIER_LENGTH = 254;

/** Sem os espaços (e tabs e quebras de linha) das pontas, como `private.login_identifier_text`. */
function identifierText(raw: string): string {
  return raw.replace(/^\s+|\s+$/g, "");
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * CPF válido (RN-04, P-LOG-16): exatamente 11 dígitos, nem todos iguais, com os
 * dígitos verificadores corretos. Recebe só os dígitos, como `public.is_valid_cpf`.
 */
export function isValidCpf(digits: string): boolean {
  if (!/^[0-9]{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  const check = (length: number): number => {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(digits[i]) * (length + 1 - i);
    const dv = (sum * 10) % 11;
    return dv === 10 ? 0 : dv;
  };
  return check(9) === Number(digits[9]) && check(10) === Number(digits[10]);
}

/**
 * O celular só pelos dígitos (RN-03 a, b e c), como `public.normalize_mobile`:
 * sem os zeros à esquerda e sem o 55 do Brasil quando há 12 ou 13 dígitos. O
 * que sobra precisa ter 10 ou 11 dígitos (DDD e número); senão, `null`.
 */
export function normalizeMobile(raw: string): string | null {
  const withoutZeros = onlyDigits(raw).replace(/^0+/, "");
  const national =
    (withoutZeros.length === 12 || withoutZeros.length === 13) && withoutZeros.startsWith("55")
      ? withoutZeros.slice(2)
      : withoutZeros;
  return national.length === 10 || national.length === 11 ? national : null;
}

/**
 * O formato da identificação, só pela forma (RN-02 a RN-04):
 * - vazia, depois de tirar os espaços das pontas: `empty`;
 * - acima de 254 caracteres: `unknown`;
 * - com "@": `email`;
 * - sem "@", só os dígitos contam: `cpf`, `mobile`, os dois (`cpf_or_mobile`)
 *   ou nenhum (`unknown`).
 */
export function classifyIdentifier(raw: string): IdentifierFormat {
  const text = identifierText(raw);
  if (text === "") return "empty";
  // Em caracteres, como o length() do Postgres (e não em unidades UTF-16).
  if (Array.from(text).length > MAX_IDENTIFIER_LENGTH) return "unknown";
  if (text.includes("@")) return "email";

  const digits = onlyDigits(text);
  const isCpf = digits.length === 11 && isValidCpf(digits);
  const isMobile = normalizeMobile(text) !== null;
  if (isCpf && isMobile) return "cpf_or_mobile";
  if (isCpf) return "cpf";
  if (isMobile) return "mobile";
  return "unknown";
}

/** O texto do indicador de tipo ao lado do rótulo (UXD-5), ou `null` quando não há indicador. */
export function identifierIndicatorLabel(raw: string): string | null {
  const format = classifyIdentifier(raw);
  return format === "empty" || format === "unknown" ? null : IDENTIFIER_TYPE_LABELS[format];
}

/** O que a tela confere antes de enviar (RN-08, UX-01 e UX-19). */
export type PreSubmitProblem =
  | { kind: "empty_fields"; identifierEmpty: boolean; passwordEmpty: boolean }
  | { kind: "invalid_format" };

/**
 * Campos vazios primeiro: a identificação só com espaços conta como vazia; a
 * senha só com espaços não conta (RN-09). Depois, o formato: sem "@" e sem a
 * forma de CPF nem de celular. Com "@", a tentativa é sempre enviada.
 */
export function checkBeforeSubmit(identifier: string, password: string): PreSubmitProblem | null {
  const format = classifyIdentifier(identifier);
  const identifierEmpty = format === "empty";
  const passwordEmpty = password === "";
  if (identifierEmpty || passwordEmpty) return { kind: "empty_fields", identifierEmpty, passwordEmpty };
  if (format === "unknown" && !identifier.includes("@")) return { kind: "invalid_format" };
  return null;
}
