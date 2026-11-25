// Máscaras de Celular e CPF (E2.04, P23, RN-06, RN-07; UX-06 e UX-07).
//
// - Formatam enquanto a pessoa digita, mas nunca cortam nem trocam dígitos: o
//   que não cabe na máscara fica como foi digitado, e a regra decide ao sair
//   do campo ou ao salvar.
// - Preservam o cursor: ele fica depois do mesmo dígito em que estava.
// - Ao sair do campo, o celular lido aparece na forma lida (sem o +55 e sem o
//   zero na frente); o ilegível fica como está.

import { formatCpf, formatMobile, normalizeMobile } from "@/lib/members/identifiers";

/** O valor do campo e a posição do cursor. */
export interface MaskedInput {
  value: string;
  caret: number;
}

// Só dígitos e os caracteres que a própria máscara põe.
const MOBILE_MASK_CHARS = /^[\d\s()-]*$/;
const CPF_MASK_CHARS = /^[\d\s.-]*$/;

const digitsOf = (value: string): string => value.replace(/\D/g, "");

/**
 * Celular enquanto a pessoa digita: com 10 ou 11 dígitos, "(51) 3333-4444" ou
 * "(51) 98888-7777". Com menos, ainda não se sabe se há DDD, e o texto fica
 * como foi digitado ("98888-1234" não vira "(98) 8881-234"). Também fica como
 * foi digitado com "+", com zero na frente, com mais de 11 dígitos ou com
 * outros caracteres.
 */
export function maskMobileTyping(value: string): string {
  const digits = digitsOf(value);
  if (!MOBILE_MASK_CHARS.test(value) || digits.startsWith("0") || (digits.length !== 10 && digits.length !== 11)) {
    return value;
  }
  return formatMobile(digits);
}

/**
 * Celular ao sair do campo e ao colar (RN-06): o número lido, com a máscara.
 * O que não se lê fica como está, para o erro aparecer sobre o que foi digitado.
 */
export function maskMobileOnBlur(value: string): string {
  const mobile = normalizeMobile(value);
  return mobile === null ? value : formatMobile(mobile);
}

/**
 * O celular gravado, para abrir o formulário (P23, T6): o legível com a
 * máscara; o ilegível como está, sem máscara ("98887777" não vira "(98) 8877-77").
 */
export function mobileDisplayValue(stored: string | null | undefined): string {
  if (stored == null) return "";
  return maskMobileOnBlur(stored);
}

/**
 * CPF enquanto a pessoa digita e ao sair: "000.000.000-00", em grupos de 3
 * com o resto depois do hífen, sem cortar dígitos ("1144477735" →
 * "114.447.773-5"; "111444777350" → "111.444.777-350"). Com outros
 * caracteres, fica como foi digitado.
 */
export function maskCpf(value: string): string {
  const digits = digitsOf(value);
  if (digits === "" || !CPF_MASK_CHARS.test(value)) return value;
  if (digits.length === 11) return formatCpf(digits);
  const groups = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 9)].filter((group) => group !== "");
  const rest = digits.slice(9);
  return groups.join(".") + (rest === "" ? "" : `-${rest}`);
}

/** O CPF gravado (11 dígitos), para abrir o formulário. */
export function cpfDisplayValue(stored: string | null | undefined): string {
  return stored == null ? "" : maskCpf(stored);
}

/**
 * Aplica uma máscara ao que a pessoa digitou, com o cursor depois do mesmo
 * dígito em que estava (UX-06: corrigir o 3º dígito de "(51) 98888-7777"
 * deixa o cursor logo depois dele). `caret` é o `selectionStart` do campo.
 */
export function applyMask(value: string, caret: number, mask: (value: string) => string): MaskedInput {
  const masked = mask(value);
  if (masked === value) return { value, caret };
  const digitsBefore = digitsOf(value.slice(0, caret)).length;
  if (digitsBefore === 0) {
    // Antes de qualquer dígito: logo antes do primeiro dígito da máscara.
    const first = masked.search(/\d/);
    return { value: masked, caret: first < 0 ? masked.length : first };
  }
  let seen = 0;
  for (let i = 0; i < masked.length; i++) {
    if (/\d/.test(masked[i])) seen++;
    if (seen === digitsBefore) return { value: masked, caret: i + 1 };
  }
  return { value: masked, caret: masked.length };
}

/** CEP: "00000-000", até 8 dígitos (sem regra própria: o endereço é opcional). */
export function maskCep(value: string): string {
  const digits = digitsOf(value).slice(0, 8);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}
