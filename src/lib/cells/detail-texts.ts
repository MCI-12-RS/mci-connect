// Textos do detalhe da célula (E2.10, T8 a T14; Textos de tela do Negócio e
// Textos da UX). Os da situação do relatório ficam em `report-status.ts`
// (E2.09), e os das ações de exclusão em `src/lib/deletion/texts.ts`.

export const CELL_DETAIL_TEXTS = {
  /** O `h1`: "Célula de André Souza" (sem o nível, T8). */
  title: (leader: string) => `Célula de ${leader}`,
  /** O `h1` enquanto carrega por link ou na falha sem a linha da lista (T13). */
  titleLoading: "Célula",
  /** O começo do complemento, só para o leitor de tela: "Reunião: Quarta, 20:00, Evangelística". */
  meetingSpoken: "Reunião: ",
  back: {
    list: "Voltar para Células",
    home: "Ir para o início",
  },
  actions: {
    newReport: "Novo relatório",
    editCell: "Editar célula",
    deleteCell: "Excluir célula",
  },
  sections: {
    reportStatus: "Situação do relatório",
    people: "Pessoas da célula",
    address: "Endereço da célula",
    recentReports: "Últimos relatórios",
    evolution: "Evolução",
  },
  people: {
    leader: "Líder",
    timothy: "Timóteo",
    host: "Anfitrião",
    g12: "G12",
  },
  noAddress: "Sem endereço",
  /** "s/n" no lugar do número, como na lista. */
  noNumber: "s/n",
  cep: (cep: string) => `CEP ${cep}`,
  reports: {
    /** P82: só quando pelo menos um relatório mostra uma seta. */
    trendHint: "As setas comparam com o relatório anterior de célula realizada.",
    empty: "Nenhum relatório para mostrar.",
    /** "Quarta, 18/11/2026 às 20:00". */
    heading: (weekday: string, date: string, time: string) => (time ? `${weekday}, ${date} às ${time}` : `${weekday}, ${date}`),
    held: "Célula realizada",
    notHeld: "Não houve célula",
    theme: "Tema:",
    reason: "Motivo:",
    observations: "Observações:",
    participants: "Participantes",
    visitors: "Visitantes",
    offering: "Oferta",
    dateTime: "Data e hora",
    report: "Relatório",
    actions: "Ações",
    /** O "—" da tabela no relatório de "Não houve célula". */
    notApplicable: "—",
    notApplicableSpoken: "não se aplica",
    viewAll: "Ver todos os relatórios",
    /** O fim do nome acessível de "Ver todos os relatórios", em `sr-only`. */
    viewAllSpoken: (leader: string) => ` da célula de ${leader}`,
    loadFailed: "Não foi possível carregar os relatórios desta célula. Verifique a conexão e tente de novo.",
  },
  evolution: {
    chartTab: "Gráfico",
    tableTab: "Tabela",
    participants: "Participantes",
    visitors: "Visitantes",
    notHeld: "Não houve célula",
    date: "Data",
    chartSummary: (count: number, from: string, to: string) =>
      `Gráfico de linhas com participantes e visitantes de ${count} ${count === 1 ? "relatório" : "relatórios"}, de ${from} a ${to}. Os números estão na aba Tabela.`,
    tableCaption: "Participantes e visitantes por relatório, do mais antigo para o mais recente.",
  },
  notFound: {
    title: "Célula não encontrada",
    description: "Ela não existe, foi excluída ou não está disponível para você.",
  },
  loadFailed: "Não foi possível carregar a célula. Verifique a conexão e tente de novo.",
  tryAgain: "Tentar de novo",
  /**
   * O começo do nome acessível do link de cada célula na lista, em `sr-only` (P81): com o nome e o
   * nível do `CellLeader`, o leitor ouve "Célula de André Souza, nível 144".
   */
  listLinkPrefix: "Célula de ",
} as const;
