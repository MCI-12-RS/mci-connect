// Seletores com busca e paginação no servidor (E1.08, RN-07): 20 opções por
// página. Cada página pede uma linha a mais; a 21ª só indica que há outra
// página e não é exibida.

export const OPTIONS_PAGE_SIZE = 20;

/**
 * Por quanto tempo as opções já carregadas valem sem nova consulta. Fechar e
 * reabrir o seletor nesse intervalo não repete as consultas de todas as
 * páginas carregadas.
 */
export const OPTIONS_STALE_TIME_MS = 60_000;

/** Uma opção de seletor: o id e o texto exibido. */
export interface SelectOption {
  value: string;
  label: string;
  /**
   * Por que a opção não pode ser escolhida (P5 de Escolas): ela aparece
   * desabilitada, com o motivo escrito embaixo do nome.
   */
  disabledReason?: string;
  /** Uma segunda linha, só no menu (a opção de célula do relatório, E2.11 T2). Entra no nome acessível. */
  description?: string;
  /**
   * Um complemento entre parênteses depois do nome, só no menu (o nível do líder no filtro de
   * Células, E2.10 UXD-2): o texto visível, sem ser lido, e o que o leitor de tela ouve no lugar.
   */
  suffix?: { text: string; spoken: string };
}

/** As opções de uma página e o `offset` da próxima, ou `null` quando acabou. */
export interface OptionsPage<T> {
  items: T[];
  nextOffset: number | null;
}

/** Faixa do `.range(from, to)` (inclusiva) da página que começa em `offset`: 21 linhas. */
export function optionsPageRange(offset: number): [from: number, to: number] {
  return [offset, offset + OPTIONS_PAGE_SIZE];
}

/** Separa as 20 opções exibidas da 21ª linha, que só indica que há mais. */
export function toOptionsPage<T>(rows: readonly T[], offset: number): OptionsPage<T> {
  return {
    items: rows.slice(0, OPTIONS_PAGE_SIZE),
    nextOffset: rows.length > OPTIONS_PAGE_SIZE ? offset + OPTIONS_PAGE_SIZE : null,
  };
}

/**
 * As opções de todas as páginas carregadas, na ordem, cada valor uma vez só.
 * Com paginação por `offset`, um cadastro feito entre duas páginas pode
 * repetir uma linha; a repetição não aparece no seletor.
 */
export function flattenOptionPages<T>(
  pages: readonly OptionsPage<T>[] | undefined,
  toOption: (row: T) => SelectOption,
): SelectOption[] {
  const seen = new Set<string>();
  const options: SelectOption[] = [];
  for (const page of pages ?? []) {
    for (const row of page.items) {
      const option = toOption(row);
      if (seen.has(option.value)) continue;
      seen.add(option.value);
      options.push(option);
    }
  }
  return options;
}

/**
 * O único item, quando a primeira página é a última e tem um item só; senão
 * `null`. É a escolha que o seletor já pode trazer feita (E2.02, UXD-9: a
 * única célula em que a pessoa pode lançar o relatório).
 */
export function onlyItem<T>(firstPage: OptionsPage<T> | undefined): T | null {
  if (!firstPage || firstPage.nextOffset !== null || firstPage.items.length !== 1) return null;
  return firstPage.items[0];
}
