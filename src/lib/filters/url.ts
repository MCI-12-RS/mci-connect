// Leitura e escrita dos filtros de uma lista na URL (E2.07, P50; RN-14). Sem React.
//
// Um filtro de múltipla escolha vai como uma lista separada por vírgula, sem repetidos. Um valor
// fora das opções conhecidas é inválido: sai da URL e não é aplicado. Os valores padrão não
// aparecem.

export { isUuid } from "@/lib/ids";

/** Separa "a,b,,c" em ["a", "b", "c"], sem os vazios. */
export function splitList(raw: string): string[] {
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

/**
 * Lê um parâmetro de múltipla escolha. Só ficam os valores aceitos por `isValid`, cada um uma vez,
 * na ordem das opções (`order`) ou, sem ela, na ordem em que vieram (a Liderança, P53).
 */
export function readListParam<T extends string>(
  params: URLSearchParams,
  key: string,
  isValid: (value: string) => value is T,
  order?: readonly T[],
): T[] {
  const raw = params.get(key);
  if (raw === null) return [];
  const seen = new Set<T>();
  for (const part of splitList(raw)) if (isValid(part)) seen.add(part);
  return order ? order.filter((option) => seen.has(option)) : [...seen];
}

/** A lista como vai para a URL ("" se vazia: o padrão não aparece). */
export function writeList(values: readonly string[]): string {
  return values.join(",");
}

/** Grava (ou tira) um parâmetro: vazio ou nulo sai da URL. */
export function setParam(params: URLSearchParams, key: string, value: string | null): void {
  if (value === null || value === "") params.delete(key);
  else params.set(key, value);
}

/** Um teste de pertença a uma lista fixa de opções, que estreita o tipo. */
export function oneOf<T extends string>(options: readonly T[]): (value: string) => value is T {
  return (value: string): value is T => options.some((option) => option === value);
}
