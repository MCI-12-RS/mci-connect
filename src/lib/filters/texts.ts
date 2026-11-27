// Textos comuns dos filtros de lista (E2.07, P50 a P54). Os textos de cada lista (rótulos, opções,
// chips) ficam no módulo de textos dela, por exemplo `src/lib/members/filter-texts.ts`.

export const FILTER_TEXTS = {
  button: "Filtros",
  buttonCount: (count: number) => `Filtros (${count})`,
  /** O fim do nome acessível do botão, só para o leitor de tela: "Filtros (2 ativos)". */
  buttonCountSrSuffix: " ativos",
  clearAll: "Limpar filtros",
  sheetTitle: "Filtros",
  sheetDescription: "As mudanças valem quando você toca em Aplicar filtros.",
  sheetClose: "Fechar filtros",
  clear: "Limpar",
  apply: "Aplicar filtros",
  /** Escolha única e múltipla sem nada escolhido. */
  all: "Todos",
  removeChip: (text: string) => `Remover filtro ${text}`,
} as const;
