// Os textos da lista de Células com filtros (E2.10, "Textos de tela" do Negócio e "Experiência
// (UX) > Textos"). Os da Situação do relatório ficam em `report-status.ts` (E2.09), e os comuns a
// todas as listas, em `src/lib/filters/texts.ts`.

export const CELL_FILTER_LABELS = {
  leaders: "Líder",
  g12: "G12",
  street: "Rua",
  neighborhood: "Bairro",
  city: "Cidade",
  type: "Tipo",
  day: "Dia da semana",
  /** O rótulo curto do dia no chip ("Dia: Quarta-feira"). */
  dayChip: "Dia",
  status: "Situação",
  dates: "Data de cadastro",
  from: "Cadastrada a partir de",
  to: "Cadastrada até",
} as const;

export const CELL_STATUS_LABELS = { active: "Ativa", inactive: "Inativa" } as const;

const personTexts = {
  placeholder: "Escolha uma ou mais pessoas",
  limit: "Escolha até 10 pessoas.",
  unavailableName: "Pessoa indisponível",
  unavailable: (count: number) =>
    count > 1 ? "Estas pessoas não estão disponíveis para você." : "Esta pessoa não está disponível para você.",
  loadingName: "Carregando…",
  nameNotLoaded: "nome não carregado",
} as const;

/** O total: "1 célula", "3 células". */
const CELL_COUNT_LABEL: [string, string] = ["célula", "células"];

export const CELL_FILTER_TEXTS = {
  search: { label: "Buscar", placeholder: "Líder, timóteo, anfitrião, rua ou bairro" },
  leaders: {
    ...personTexts,
    label: CELL_FILTER_LABELS.leaders,
    hint: "Mostra as células lideradas pelas pessoas escolhidas.",
    noResults: "Nenhum líder de célula encontrado.",
  },
  g12: {
    ...personTexts,
    label: CELL_FILTER_LABELS.g12,
    hint: "Mostra as células do ministério de cada pessoa escolhida, inclusive as que ela lidera. Para o ministério de um casal, escolha os dois.",
    noResults: "Nenhum G12 encontrado.",
  },
  /** A Situação sem escolha ("Todas"); Tipo e Dia da semana usam o "Todos" comum. */
  allFeminine: "Todas",
  datesHint: "Células antigas sem data de cadastro não aparecem quando há filtro de data.",
  invalidDate: "Data inválida. Use o formato dd/mm/aaaa.",
  invertedDates: "A data inicial precisa ser igual ou anterior à data final.",
  chips: {
    labeled: (label: string, value: string) => `${label}: ${value}`,
    from: (date: string) => `${CELL_FILTER_LABELS.from} ${date}`,
    to: (date: string) => `${CELL_FILTER_LABELS.to} ${date}`,
  },
  count: CELL_COUNT_LABEL,
  emptyFiltered: "Nenhuma célula encontrada com estes filtros.",
  empty: "Nenhuma célula encontrada.",
  loadFailed: "Não foi possível carregar as células. Verifique a conexão e tente de novo.",
  tryAgain: "Tentar de novo",
  /** A legenda da tabela, só para o leitor de tela (T1, RN-13). */
  tableCaption: "Células, da cadastrada mais recentemente para a mais antiga.",
} as const;
