// Textos do E2.05 (autoria e Auditoria). Todos os textos do spec ficam aqui;
// os módulos de domínio reaproveitam os daqui, sem repetir a string.

/** Salvar nos formulários de membro, célula e relatório (T5, UXD-9, RN-04 b e RN-14). */
export const AUDIT_SAVE_TEXTS = {
  /** Na edição, sem nenhuma mudança: o formulário fecha sem gravar (UXD-9, P-AUD-20). */
  unchanged: "Nenhuma alteração para salvar.",
  /**
   * A gravação não aconteceu por falha da Auditoria, do servidor ou da rede, ou por um erro que a
   * tela não reconhece (RN-14, AQ-8): junto da ação primária, com os dados mantidos.
   */
  connection: {
    /** O texto do E2.04 (T7). */
    member: "Não foi possível salvar o cadastro. Verifique a conexão e tente de novo.",
    cell: "Não foi possível salvar a célula. Verifique a conexão e tente de novo.",
    report: "Não foi possível salvar o relatório. Verifique a conexão e tente de novo.",
  },
} as const;

/** A autoria no registro aberto (T1, P30; textos do Negócio). */
export const AUTHORSHIP_TEXTS = {
  verbs: {
    member: { created: "Cadastrado", updated: "Alterado" },
    cell: { created: "Cadastrada", updated: "Alterada" },
    cell_report: { created: "Enviado", updated: "Alterado" },
  },
  by: (author: string) => ` por ${author}`,
  at: (date: string, time: string) => ` em ${date} às ${time}`,
  authorNotRecorded: " · autor não registrado",
  dateNotRecorded: " · data não registrada",
  system: "Sistema",
  /** O nome do legado com a marca (RN-10). "AdminUser" vira "Administrador" antes (RN-10 b). */
  legacy: (name: string) => `${name} (sistema anterior)`,
  legacyAdmin: "Administrador",
  loadFailed: "Não foi possível carregar quem cadastrou e quem alterou.",
  tryAgain: "Tentar de novo",
  viewHistory: "Ver histórico",
  /** O nome acessível de "Ver histórico" (contém o texto visível, WCAG 2.5.3). */
  viewHistoryLabel: {
    member: (name: string) => `Ver histórico de ${name}`,
    cell: (leader: string) => `Ver histórico da célula de ${leader}`,
    cell_report: (date: string) => `Ver histórico do relatório de ${date}`,
  },
} as const;

/** A Auditoria (T7 a T10). */
export const AUDIT_TEXTS = {
  title: "Auditoria",
  subtitle: "Eventos de toda a igreja",
  retention: "Os eventos ficam guardados por 2 anos. Login e logout, por 1 ano. Falhas, recusas e bloqueios, por 90 dias.",
  search: {
    label: "Buscar",
    placeholder: "Autor, registro ou descrição",
    historyPlaceholder: "Autor ou descrição",
  },
  filters: {
    button: "Filtros",
    buttonCount: (count: number) => `Filtros (${count})`,
    sheetTitle: "Filtros",
    action: "Ação",
    entity: "Entidade",
    status: "Status",
    period: "Período",
    from: "De",
    to: "Até",
    allFeminine: "Todas",
    allMasculine: "Todos",
    success: "Sucesso",
    error: "Erro",
    apply: "Aplicar filtros",
    clear: "Limpar",
    clearAll: "Limpar filtros",
    periodInvalid: "O fim do período precisa ser igual ou posterior ao início.",
  },
  chips: {
    action: (label: string) => `Ação: ${label}`,
    entity: (label: string) => `Entidade: ${label}`,
    status: (label: string) => `Status: ${label}`,
    from: (date: string) => `De: ${date}`,
    to: (date: string) => `Até: ${date}`,
    remove: (text: string) => `Remover filtro ${text}`,
  },
  count: ["evento", "eventos"] as [string, string],
  columns: {
    occurredAt: "Data/Hora",
    actor: "Autor",
    action: "Ação",
    entity: "Entidade",
    description: "Descrição",
    status: "Status",
  },
  statusOk: "OK",
  statusError: "Erro",
  noActor: "—",
  empty: "Nenhum evento registrado.",
  emptyFiltered: "Nenhum evento encontrado para estes filtros.",
  loadFailed: "Não foi possível carregar a Auditoria. Verifique a conexão e tente de novo.",
  /** A lista anterior continua na tela, mas a nova consulta (página, filtro ou atualização) falhou. */
  refreshFailed: "Não foi possível atualizar a lista. Os eventos mostrados podem estar desatualizados.",
  tryAgain: "Tentar de novo",
  /** "dd/mm/aaaa às HH:mm" (cards e painel). */
  dateTime: (date: string, time: string) => `${date} às ${time}`,
  /** "dd/mm/aaaa HH:mm" (tabela). */
  dateTimeShort: (date: string, time: string) => `${date} ${time}`,
  secondLine: {
    andMore: (count: number) => ` e mais ${count}`,
    permissions: (count: number) => (count === 1 ? "1 permissão" : `${count} permissões`),
    permissionsAdded: (count: number) => (count === 1 ? "1 permissão incluída" : `${count} permissões incluídas`),
    permissionsRemoved: (count: number) => (count === 1 ? "1 permissão retirada" : `${count} permissões retiradas`),
    participants: (count: number) => (count === 1 ? "1 participante" : `${count} participantes`),
    participantsAdded: (count: number) => (count === 1 ? "1 participante incluído" : `${count} participantes incluídos`),
    participantsRemoved: (count: number) => (count === 1 ? "1 participante retirado" : `${count} participantes retirados`),
  },
  sheet: {
    title: "Detalhes do evento",
    actor: "Autor",
    action: "Ação",
    entity: "Entidade",
    record: "Registro",
    description: "Descrição",
    changedFields: "Campos alterados",
    permissions: "Permissões",
    permissionsAdded: "Permissões incluídas",
    permissionsRemoved: "Permissões retiradas",
    participants: "Participantes",
    participantsAdded: "Participantes incluídos",
    participantsRemoved: "Participantes retirados",
    close: "Fechar",
    viewHistory: {
      member: "Ver histórico deste membro",
      cell: "Ver histórico desta célula",
      cell_report: "Ver histórico deste relatório",
    },
  },
  change: {
    empty: "(vazio)",
    yes: "Sim",
    no: "Não",
    active: { member: "Ativo", cell: "Ativa" },
    inactive: { member: "Inativo", cell: "Inativa" },
    male: "Masculino",
    female: "Feminino",
    /** O texto para o leitor de tela no lugar da seta (P32). */
    srFromTo: (from: string, to: string) => `de ${from} para ${to}`,
  },
  history: {
    back: "Ver toda a Auditoria",
    loadingTitle: "Histórico",
    unknownTitle: "Histórico do registro",
    title: {
      member: (name: string) => `Histórico de ${name}`,
      cell: (leader: string) => `Histórico da célula de ${leader}`,
      cell_report: (date: string, leader: string) => `Histórico do relatório de ${date} da célula de ${leader}`,
    },
    deleted: { member: "Cadastro excluído", cell: "Célula excluída", cell_report: "Relatório excluído" },
    subtitle: {
      member: "Cadastro, alterações, exclusões e restaurações deste membro.",
      cell: "Cadastro, alterações, exclusões e restaurações desta célula.",
      cell_report: "Cadastro, alterações, exclusões e restaurações deste relatório, com os participantes incluídos e retirados.",
    },
    empty: {
      member: "Nenhum evento deste membro na Auditoria.",
      cell: "Nenhum evento desta célula na Auditoria.",
      cell_report: "Nenhum evento deste relatório na Auditoria.",
    },
    emptyExplanation:
      "As alterações feitas no sistema anterior não estão na Auditoria, e os eventos com mais de 2 anos já saíram.",
    leaderNotInformed: "líder não informado",
  },
} as const;
