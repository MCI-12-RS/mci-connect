// Formatação de números para exibição, no padrão pt-BR.

const COUNT_FORMAT = new Intl.NumberFormat("pt-BR");

/** Contagem com o separador de milhar do pt-BR: 1530 → "1.530". */
export function formatCount(value: number): string {
  return COUNT_FORMAT.format(value);
}
