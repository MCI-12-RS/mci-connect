// A oferta digitada em reais (E2.11, RN-13, P101, UXD-9, tabela da T6). Sem
// React e sem Supabase. O campo guarda o texto mostrado ("1.234,56", ou vazio),
// e o valor enviado é o número com 2 casas. Vazio não é zero.

const MAX_DIGITS = 11;

/** Centavos inteiros → "1.234,56". */
export function formatCents(cents: number): string {
  const reais = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, "0");
  return `${String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${rest}`;
}

/** Um valor em reais → o texto do campo ("37,50"); `null` vira vazio. */
export function formatOffering(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return formatCents(Math.round(Math.abs(value) * 100));
}

/**
 * O que a pessoa digitou: só os dígitos contam, e entram pelos centavos
 * ("5000" → "50,00"). Sem dígitos, o campo fica vazio.
 */
export function maskTypedOffering(text: string): string {
  const digits = text
    .replace(/\D/g, "")
    .replace(/^0+(?=\d)/, "")
    .slice(-MAX_DIGITS);
  if (digits === "") return "";
  return formatCents(Number(digits));
}

/**
 * O que a pessoa colou, lido como número pt-BR e arredondado a 2 casas: com
 * vírgula, ela é a decimal (e os pontos, de milhar); só com ponto, ele é de
 * milhar quando separa grupos de 3 ("1.234"), e decimal nos outros casos; só
 * com dígitos, o valor é em reais ("50" → "50,00"). O sinal de menos e o "R$"
 * são ignorados. `null` quando não há número (o campo não muda).
 */
export function readPastedOffering(text: string): string | null {
  const cleaned = text.replace(/R\$/gi, "").replace(/[\s-]/g, "");
  if (!/^[\d.,]+$/.test(cleaned) || !/\d/.test(cleaned)) return null;
  let normalized: string;
  if (cleaned.includes(",")) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".").replace(/,/g, "");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    normalized = cleaned.replace(/\./g, "");
  } else {
    normalized = cleaned;
  }
  const [whole, fraction = ""] = normalized.split(".");
  // Em texto, sem ponto flutuante: 10,555 arredonda para 10,56.
  let cents = Number(whole || "0") * 100 + Number(`${fraction}00`.slice(0, 2));
  if (fraction.length > 2 && Number(fraction[2]) >= 5) cents += 1;
  if (!Number.isSafeInteger(cents)) return null;
  return formatCents(cents);
}

/** O texto do campo → o valor enviado (37.5 para "37,50"); vazio → `null`. */
export function offeringValue(text: string): number | null {
  const digits = text.replace(/\D/g, "");
  if (digits === "") return null;
  return Number(digits) / 100;
}
