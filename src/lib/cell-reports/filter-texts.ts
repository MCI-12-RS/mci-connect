// Os textos da lista de Relatórios com filtros e atalhos de semana (E2.12, "Textos de tela" do
// Negócio e "Experiência (UX) > Textos"). Os comuns a todas as listas ficam em
// `src/lib/filters/texts.ts`; os da consulta "Ver relatório", em `texts.ts`.

export const CELL_REPORT_FILTER_LABELS = {
  cell: "Célula",
  leaders: "Líder",
  g12: "G12",
  dates: "Período",
  from: "De",
  to: "Até",
  type: "Tipo",
  held: "Reunião",
} as const;

export const HELD_LABELS = { yes: "Célula realizada", no: "Não houve célula" } as const;

const personTexts = {
  placeholder: "Escolha uma ou mais pessoas",
  limit: "Escolha até 10 pessoas.",
  unavailableName: "Pessoa indisponível",
  unavailable: (count: number) =>
    count > 1 ? "Estas pessoas não estão disponíveis para você." : "Esta pessoa não está disponível para você.",
  loadingName: "Carregando…",
  nameNotLoaded: "nome não carregado",
} as const;

/** O total: "1 relatório", "3 relatórios". */
const REPORT_COUNT_LABEL: [string, string] = ["relatório", "relatórios"];

export const CELL_REPORT_FILTER_TEXTS = {
  title: "Relatórios",
  newReport: "Novo relatório",
  search: { label: "Buscar", placeholder: "Líder ou tema" },
  leaders: {
    ...personTexts,
    label: CELL_REPORT_FILTER_LABELS.leaders,
    hint: "Mostra os relatórios em que a pessoa escolhida era a líder da célula.",
    noResults: "Nenhum líder encontrado.",
  },
  g12: {
    ...personTexts,
    label: CELL_REPORT_FILTER_LABELS.g12,
    hint: "Mostra os relatórios das células do ministério de cada pessoa escolhida, inclusive os da célula dela. Para o ministério de um casal, escolha os dois.",
    noResults: "Nenhum G12 encontrado.",
  },
  typeHint: "Pelo tipo que a célula tinha quando o relatório foi enviado.",
  /** A Reunião sem escolha. O Tipo usa o "Todos" comum. */
  allFeminine: "Todas",
  invalidDate: "Data inválida. Use o formato dd/mm/aaaa.",
  invertedDates: "O fim do período precisa ser igual ou posterior ao início.",
  cell: {
    loading: "Célula: carregando…",
    failed: "Célula: não carregada",
    unavailable: "Célula indisponível",
    unavailableHint: "Esta célula não está disponível para você.",
  },
  /** "Célula de André Souza · Quarta · 20:00" (o dia na forma curta). */
  cellChipText: (leader: string, day: string, time: string) => [`Célula de ${leader}`, day, time].filter(Boolean).join(" · "),
  chips: {
    labeled: (label: string, value: string) => `${label}: ${value}`,
  },
  weeks: {
    groupLabel: "Atalhos de semana",
    this: "Esta semana",
    last: "Semana passada",
    beforeLast: "Semana retrasada",
    /** "Esta semana, de 22/11/2026 a 28/11/2026". */
    spoken: (label: string, start: string, end: string) => `${label}, de ${start} a ${end}`,
  },
  count: REPORT_COUNT_LABEL,
  emptyFiltered: "Nenhum relatório encontrado com estes filtros.",
  empty: "Nenhum relatório encontrado.",
  loadFailed: "Não foi possível carregar os relatórios. Verifique a conexão e tente de novo.",
  tryAgain: "Tentar de novo",
  /** A legenda da tabela, só para o leitor de tela (T2). */
  tableCaption: "Relatórios, do mais recente para o mais antigo.",
  columns: {
    cell: "Célula",
    dateTime: "Data e horário",
    meeting: "Reunião",
    participants: "Participantes",
    visitors: "Visitantes",
    offering: "Oferta",
    actions: "Ações",
  },
} as const;

/** A linha da lista (RN-15, T1, T2). */
export const REPORT_ROW_TEXTS = {
  g12: (name: string) => `G12: ${name}`,
  g12Label: "G12:",
  none: "—",
  noneSpoken: "nenhum",
  notApplicable: "não se aplica",
  noAddress: "Sem endereço",
  noNumber: "s/n",
  theme: "Tema:",
  reason: "Motivo:",
  participants: "Participantes:",
  visitors: "Visitantes:",
  offering: "Oferta:",
  noLeader: "Líder não informado",
  /** O nome acessível do botão que abre a consulta (P91): "Ver o relatório de 18/11/2026, André Souza". */
  openLabel: (date: string, leader: string) => `Ver o relatório de ${date}, ${leader}`,
} as const;
