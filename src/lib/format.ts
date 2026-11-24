// Formatação de números para exibição, no padrão pt-BR.

const COUNT_FORMAT = new Intl.NumberFormat("pt-BR");

/** Contagem com o separador de milhar do pt-BR: 1530 → "1.530". */
export function formatCount(value: number): string {
  return COUNT_FORMAT.format(value);
}

/** Lista em frase, no padrão pt-BR: "Ana", "Ana e Bruno", "Ana, Bruno e Sara". */
export function formatList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}
