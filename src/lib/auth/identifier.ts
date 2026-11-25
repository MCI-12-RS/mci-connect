// Leitura da identificação digitada no login (E1.04, RN-02 a RN-04 e RN-08).
// Gêmea de `private.parse_login_identifier` (migration e104_02): as duas passam
// pela mesma tabela de casos, `supabase/tests/fixtures/login-identifier-cases.json`
// (AQ-3). Mudou uma, mude a outra e a tabela.
//
// A tela usa esta leitura só para o indicador de tipo e para não enviar o que
// não tem a forma de nenhuma identificação. Nunca consulta o servidor, e o que
// é enviado é sempre o texto digitado: quem decide é a função `sign-in`.

import { IDENTIFIER_TYPE_LABELS, type IdentifierType } from "@/lib/auth/session";
import { isValidCpf, normalizeDigits, normalizeMobile } from "@/lib/members/identifiers";

// A leitura do celular e do CPF é a do cadastro (E2.04): uma regra só.
export { isValidCpf, normalizeMobile };

export type IdentifierFormat = "empty" | IdentifierType | "unknown";

/** Acima disso, a identificação é inválida, com ou sem "@" (DA-4). */
const MAX_IDENTIFIER_LENGTH = 254;

/** Sem os espaços (e tabs e quebras de linha) das pontas, como `private.login_identifier_text`. */
function identifierText(raw: string): string {
  return raw.replace(/^\s+|\s+$/g, "");
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

  const isCpf = isValidCpf(normalizeDigits(text));
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
 * senha não é aparada, então só a vazia conta como vazia (RN-09). Depois, o formato: sem "@" e sem a
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
