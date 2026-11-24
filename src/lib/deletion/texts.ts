// Textos da exclusão e da restauração de membros, células e relatórios
// (E2.01: "Textos de tela" do Negócio e "Textos" da Experiência). Os textos de
// tela desses fluxos ficam só aqui.
//
// As mensagens de regra também vêm prontas do banco (`message` do erro
// `app_error`), e a tela mostra a que veio. As cópias aqui servem para os
// testes e para quando a tela decide sem chamar o servidor.
//
// Os marcados "derivado" seguem um texto do spec para outra entidade e não
// estão escritos nele; os marcados "não está no spec" foram criados aqui.

/** Marca de uma pessoa cujo cadastro foi excluído, ao lado do nome. */
const PERSON_DELETED = "(cadastro excluído)";

/** Comuns às três entidades. */
export const DELETION_TEXTS = {
  cancel: "Cancelar",
  close: "Fechar",
  deleting: "Excluindo…",
  restoring: "Restaurando…",
  restore: "Restaurar",
  tryAgain: "Tentar de novo",
  /** Recusa 42501, em qualquer ação deste fluxo (UX-39). */
  permissionDenied: "Você não tem permissão para esta ação.",
  deleteNetworkError: "Não foi possível excluir. Verifique a conexão e tente de novo.",
  /** Não está no spec: falha que não é de conexão nem de regra (RN-20, "pede para tentar de novo"). */
  deleteFailed: "Não foi possível excluir. Tente de novo.",
  restoreNetworkError: "Não foi possível restaurar. Verifique a conexão e tente de novo.",
  /** Não está no spec: falha que não é de conexão nem de regra, na restauração (derivado de `deleteFailed`). */
  restoreFailed: "Não foi possível restaurar. Tente de novo.",
} as const;

// Os rótulos dos botões de ícone das linhas (`actionsLabel`, `deleteLabel`,
// `editLabel`…) trazem o item, porque cada linha repete o mesmo ícone (T1 e
// Acessibilidade).

/** Membros: exclusão (T1, T2), atalho de inativar e corrida na edição (DT-19). */
export const MEMBER_DELETION_TEXTS = {
  actionsLabel: (name: string) => `Ações de ${name}`,
  deleteLabel: (name: string) => `Excluir ${name}`,
  /** Derivado do "Excluir {Nome}": o ícone "Editar" da linha. */
  editLabel: (name: string) => `Editar ${name}`,
  /** Item do menu "⋯" e botão de confirmar. */
  deleteAction: "Excluir cadastro",
  confirmTitle: (name: string) => `Excluir ${name}?`,
  consequences: [
    "O cadastro sai das listas, dos totais e do dashboard.",
    "A pessoa perde o acesso ao sistema.",
    "Os relatórios em que ela aparece continuam no histórico.",
    "Um administrador pode restaurar o cadastro depois.",
  ],
  inactivateHint: "Se a pessoa só deixou de frequentar, prefira marcá-la como inativa.",
  inactivateAction: "Marcar como inativo",
  inactivated: "Cadastro marcado como inativo.",
  /** Não está no spec. */
  inactivateNetworkError: "Não foi possível marcar como inativo. Verifique a conexão e tente de novo.",
  /** Não está no spec. */
  inactivateFailed: "Não foi possível marcar como inativo. Tente de novo.",
  checking: "Verificando se o cadastro pode ser excluído…",
  checkingAction: "Verificando…",
  deleted: "Cadastro excluído.",
  notFoundOrDeleted: "Este cadastro não existe ou já foi excluído.",
  selfDelete: "Você não pode excluir o seu próprio cadastro.",
  roleAbove: "Você não tem permissão para excluir este membro.",
  chosenDeleted: "Este membro foi excluído e não pode ser escolhido.",
  /** Edição de um cadastro excluído no meio tempo ("0 linhas", DT-19). */
  deletedWhileEditing: "Este cadastro não existe ou já foi excluído. As alterações não foram salvas.",
  /** Não está no spec: o cadastro aberto pelo bloqueio (T3) não carregou. */
  loadFailed: "Não foi possível carregar o cadastro.",
} as const;

/** Bloqueio da exclusão de membro com ligações (T3, RN-04). */
export const MEMBER_LINKS_TEXTS = {
  blockedTitle: (name: string) => `Não é possível excluir ${name}`,
  intro: "Antes, reatribua:",
  disciples: (total: number) => (total === 1 ? "1 discípulo" : `${total} discípulos`),
  cells: (total: number) => (total === 1 ? "1 célula" : `${total} células`),
  /** "{Papel} na célula de {Líder}"; o dia e a hora vêm depois, separados por vírgula. */
  cellRole: (roles: string, leader: string) => `${roles} na célula de ${leader}`,
  inactiveMember: "(inativo)",
  inactiveCell: "(inativa)",
  more: (count: number) => `e mais ${count}`,
  help:
    "Discípulos e células inativos também contam. Para reatribuir um discípulo, abra o cadastro dele e " +
    "escolha outro líder. Para uma célula, troque a pessoa na célula ou exclua a célula.",
  openMember: (name: string) => `Abrir o cadastro de ${name}`,
} as const;

/** Membros: restauração (T5, T6). */
export const MEMBER_RESTORE_TEXTS = {
  restoreLabel: (name: string) => `Restaurar ${name}`,
  confirmTitle: (name: string) => `Restaurar o cadastro de ${name}?`,
  backWithRole: (role: string) => `O cadastro volta às listas e aos totais, com os mesmos dados e a função ${role}.`,
  /** Não está no spec: o cadastro sem função e sem conta de acesso volta sem função (DA-2). */
  backWithoutRole: "O cadastro volta às listas e aos totais, com os mesmos dados.",
  backWithAccess: "A pessoa volta a entrar no sistema com a mesma senha.",
  spouseNotBack: "O vínculo de cônjuge não volta. Se havia, refaça-o no cadastro.",
  backWithoutLeader: (leader: string) => `Volta sem líder, porque o líder anterior (${leader}) foi excluído.`,
  confirmAction: "Restaurar cadastro",
  resultTitle: "Cadastro restaurado",
  restoredWithoutLeader: (leader: string) =>
    `Cadastro restaurado sem líder, porque o líder anterior (${leader}) foi excluído. Defina o novo líder.`,
  roleResetToDefault: (role: string) =>
    `O cadastro voltou com a função padrão (${role}), porque a função anterior foi apagada.`,
  defineLeader: "Definir líder",
  notNow: "Agora não",
  restored: "Cadastro restaurado.",
  notDeleted: "Este cadastro não está excluído.",
  refusedTitle: (name: string) => `Não é possível restaurar ${name}`,
  roleAbove: "Você não tem permissão para restaurar este membro.",
  valueInUse: (field: string) => `Não é possível restaurar: outro cadastro já usa este ${field}.`,
  /** Nomes dos campos de `restore_value_in_use`. */
  fieldLabels: { email: "e-mail", mobile: "celular", cpf: "CPF" },
} as const;

/** Células: exclusão (T1, T2), atalho de inativar e corrida na edição. */
export const CELL_DELETION_TEXTS = {
  actionsLabel: (leader: string) => `Ações da célula de ${leader}`,
  deleteLabel: (leader: string) => `Excluir a célula de ${leader}`,
  /** Derivado do "Excluir a célula de {Líder}": o ícone "Editar" da linha. */
  editLabel: (leader: string) => `Editar a célula de ${leader}`,
  /** Derivado do "Excluir a célula de {Líder}": o ícone "Novo relatório" da linha. */
  newReportLabel: (leader: string) => `Novo relatório da célula de ${leader}`,
  /** Item do menu "⋯" e botão de confirmar. */
  deleteAction: "Excluir célula",
  confirmTitle: (leader: string) => `Excluir a célula de ${leader}?`,
  /** Linha que identifica a célula: "{Dia}, {hora} · {endereço}". O que estiver vazio fica de fora. */
  summary: (day: string, time: string, address: string) =>
    [[day, time].filter(Boolean).join(", "), address].filter(Boolean).join(" · "),
  consequences: [
    "A célula sai das listas e dos totais.",
    "Os relatórios dela continuam no histórico.",
    "Um administrador pode restaurá-la depois.",
  ],
  inactivateHint: "Se a célula só parou de se reunir, prefira marcá-la como inativa.",
  inactivateAction: "Marcar como inativa",
  inactivated: "Célula marcada como inativa.",
  /** Não está no spec. */
  inactivateNetworkError: "Não foi possível marcar como inativa. Verifique a conexão e tente de novo.",
  /** Não está no spec. */
  inactivateFailed: "Não foi possível marcar como inativa. Tente de novo.",
  deleted: "Célula excluída.",
  notFoundOrDeleted: "Esta célula não existe ou já foi excluída.",
  /** Derivado do texto de membro (DT-19). */
  deletedWhileEditing: "Esta célula não existe ou já foi excluída. As alterações não foram salvas.",
  noReports: "Esta célula foi excluída e não recebe relatórios.",
  /** Não está no spec: a célula aberta pelo bloqueio da exclusão de membro (T3) não carregou. */
  loadFailed: "Não foi possível carregar a célula.",
} as const;

/** Células: restauração (T6). */
export const CELL_RESTORE_TEXTS = {
  restoreLabel: (leader: string) => `Restaurar a célula de ${leader}`,
  /** Não está no spec: o nome do botão enquanto restaura, com o texto visível "Restaurando…" (WCAG 2.5.3). */
  restoringLabel: (leader: string) => `Restaurando a célula de ${leader}…`,
  restored: "Célula restaurada.",
  notDeleted: "Esta célula não está excluída.",
  refusedTitle: (leader: string) => `Não é possível restaurar a célula de ${leader}`,
  /** `role` em minúsculas: "líder", "timóteo" ou "anfitrião". */
  personDeleted: (role: string, name: string) =>
    `Não é possível restaurar a célula: o ${role} ${name} foi excluído. Restaure o cadastro dele antes ou crie uma célula nova.`,
  /** Ação do bloqueio: abre `/members/deleted?q={Nome}`. */
  seeDeletedMembers: "Ver membros excluídos",
} as const;

/** Relatórios: exclusão (T1, T2), "Célula excluída" (T7) e formulário (T8). */
export const CELL_REPORT_DELETION_TEXTS = {
  // O spec diz "do relatório de {data}"; o líder entra porque muitas células
  // se reúnem no mesmo dia, e o rótulo só com a data se repetiria na lista.
  actionsLabel: (date: string, leader: string) => `Ações do relatório de ${date} da célula de ${leader}`,
  deleteLabel: (date: string, leader: string) => `Excluir o relatório de ${date} da célula de ${leader}`,
  /** Derivado do "Excluir o relatório…": o ícone "Editar" da linha. */
  editLabel: (date: string, leader: string) => `Editar o relatório de ${date} da célula de ${leader}`,
  /** Item do menu "⋯" e botão de confirmar. */
  deleteAction: "Excluir relatório",
  confirmTitle: (date: string, leader: string) => `Excluir o relatório de ${date} da célula de ${leader}?`,
  consequences: [
    "Ele sai das listas e das somas.",
    "A célula poderá enviar outro relatório para a semana dele, se ainda for a semana atual.",
    "Um administrador pode restaurá-lo depois.",
  ],
  deleted: "Relatório excluído.",
  notFoundOrDeleted: "Este relatório não existe ou já foi excluído.",
  /** Derivado do texto de membro (DT-19). */
  deletedWhileEditing: "Este relatório não existe ou já foi excluído. As alterações não foram salvas.",
  cellDeleted: "Célula excluída",
  viewReport: "Ver relatório",
  /** O spec diz "Ver o relatório de {data}"; o líder entra pela mesma razão dos outros rótulos da linha. */
  viewReportLabel: (date: string, leader: string) => `Ver o relatório de ${date} da célula de ${leader}`,
  editCellDeleted: "A célula deste relatório foi excluída. Restaure a célula para editar o relatório.",
  /** Participantes excluídos na edição do relatório (T8). */
  deletedParticipants: (names: string) => `Continuam no relatório (cadastros excluídos): ${names}.`,
  participantRemoval: "Não é possível retirar um participante cujo cadastro foi excluído.",
  /** Participante excluído entre a escolha e o envio (T8, UX-30): mensagem embaixo do campo. */
  chosenDeleted: "Este membro foi excluído e não pode ser escolhido.",
  /** Marca no chip desse participante (T8, UX-30). */
  chosenDeletedMark: PERSON_DELETED,
} as const;

/** "Ver relatório" (T7): o painel de consulta (`Sheet`) do relatório de célula excluída. */
export const CELL_REPORT_SHEET_TEXTS = {
  /** O nome do painel enquanto carrega, com erro ou sem o relatório (o `Sheet` "Relatório" da T7); só para leitor de tela. */
  title: "Relatório",
  reportOf: (date: string) => `Relatório de ${date}`,
  cellOf: (leader: string) => `Célula de ${leader}`,
  /** Do wireframe da T7: "Quarta, 19/11/2026 às 20:00"; sem hora, "Quarta, 19/11/2026". */
  dateTime: (weekday: string, date: string, time: string) =>
    time ? `${weekday}, ${date} às ${time}` : `${weekday}, ${date}`,
  fields: {
    dateTime: "Data e hora",
    status: "Situação",
    reason: "Motivo",
    theme: "Tema",
    offering: "Oferta",
    observations: "Observações",
  },
  participants: (count: number) => `Participantes (${count})`,
  visitors: (count: number) => `Visitantes (${count})`,
  notInformed: "Não informado",
  noMembers: "Nenhum membro.",
  /** Não está no spec: "Visitantes (0)", como o "Nenhum membro." dos participantes. */
  noVisitors: "Nenhum visitante.",
  /** Abre `/cells/deleted?q={Líder}`; só para o administrador. */
  seeDeletedCells: "Ver células excluídas",
  /** Não está no spec: anúncio do carregamento para leitor de tela. */
  loading: "Carregando o relatório…",
  loadFailed: "Não foi possível carregar o relatório.",
  tryAgain: DELETION_TEXTS.tryAgain,
  close: DELETION_TEXTS.close,
} as const;

/** Relatórios: restauração (T6). */
export const CELL_REPORT_RESTORE_TEXTS = {
  // O spec diz "o relatório de {data}"; o líder entra pela mesma razão do
  // `CELL_REPORT_DELETION_TEXTS`: só com a data, o rótulo se repetiria na lista.
  restoreLabel: (date: string, leader: string) => `Restaurar o relatório de ${date} da célula de ${leader}`,
  /** Não está no spec: o nome do botão enquanto restaura, com o texto visível "Restaurando…" (WCAG 2.5.3). */
  restoringLabel: (date: string, leader: string) => `Restaurando o relatório de ${date} da célula de ${leader}…`,
  restored: "Relatório restaurado.",
  notDeleted: "Este relatório não está excluído.",
  refusedTitle: (date: string, leader: string) => `Não é possível restaurar o relatório de ${date} da célula de ${leader}`,
  weekTaken: "Esta célula já tem outro relatório na mesma semana. Exclua-o antes de restaurar este.",
  /** Ação do bloqueio: abre `/cell-reports?q={Líder}`. */
  seeCellReports: "Ver relatórios da célula",
} as const;

/** Os dados que combinaram com um cadastro excluído (RN-18), como entram nas frases: "com este celular e este CPF". */
const MATCHED_FIELD_PHRASES = { email: "este e-mail", mobile: "este celular", cpf: "este CPF" } as const;

/**
 * Cadastro de membro novo com o e-mail, o celular ou o CPF de um membro
 * excluído (T9, RN-18). `fields` é a frase dos dados que combinaram, montada
 * com `fieldPhrases` ("este e-mail", "este celular e este CPF").
 */
export const DELETED_MATCHES_TEXTS = {
  fieldPhrases: MATCHED_FIELD_PHRASES,
  /** Não está no spec: a correspondência que não disse qual dado combinou. */
  anyField: "estes dados",
  // Administrador (os cadastros que ele veria na lista Excluídos, DA-8).
  adminTitle: (count: number) =>
    count === 1 ? "Há um cadastro excluído com estes dados" : `Há ${count} cadastros excluídos com estes dados`,
  /**
   * "Já existe um cadastro excluído com este e-mail: Bruno, excluído em 10/11/2026.".
   * Derivados: mais de um dado do mesmo cadastro ("com este e-mail e este CPF")
   * e a correspondência sem data ("…: Bruno.").
   */
  adminMatch: (fields: string, name: string, date: string | null) =>
    date
      ? `Já existe um cadastro excluído com ${fields}: ${name}, excluído em ${date}.`
      : `Já existe um cadastro excluído com ${fields}: ${name}.`,
  restore: (name: string) => `Restaurar ${name}`,
  explanation: "Ao restaurar, o cadastro volta como estava e abre para você conferir. O que você digitou aqui não é gravado.",
  accountEmailHint: "Para cadastrar outra pessoa, volte e use outro e-mail.",
  // Quem não é administrador, e o administrador para os cadastros que ele não vê (DA-8).
  /**
   * "Há um cadastro excluído com este celular" (CPF; "com este celular e este
   * CPF") e, com cadastros diferentes, "Há cadastros excluídos com este celular
   * e este CPF". Derivados: os com o e-mail sem conta ("com este e-mail") e o
   * plural com um dado só ("Há cadastros excluídos com este celular").
   */
  othersTitle: (fields: string, several: boolean) =>
    several ? `Há cadastros excluídos com ${fields}` : `Há um cadastro excluído com ${fields}`,
  othersText:
    "Se for a mesma pessoa, peça a um administrador para restaurá-lo. Se for outra pessoa, você pode cadastrar mesmo assim.",
  /** E-mail da conta de um excluído, para quem não o vê: erro embaixo do campo E-mail, sem diálogo (UXD-9). */
  accountEmailError: "Este e-mail pertence a um cadastro excluído. Peça a um administrador para restaurá-lo ou use outro e-mail.",
  registerAnyway: "Cadastrar mesmo assim",
  /** O "Salvando…" da tabela Estados, no botão "Cadastrar mesmo assim". */
  registering: "Salvando…",
  backToForm: "Voltar ao formulário",
  /** O `Alert` do formulário depois de restaurar (UX-32). */
  restoredFromForm: (name: string) => `Cadastro de ${name} restaurado. Confira os dados e, se precisar, altere e salve.`,
} as const;

/** Listas de excluídos (T4, P7). */
export const DELETED_LIST_TEXTS = {
  subtitle: "Restaure o que foi excluído por engano. Os excluídos mais recentes aparecem primeiro.",
  emptyHint: "Quando alguém excluir, o registro aparece aqui para ser restaurado.",
  clearSearch: "Limpar busca",
  noAccess: "Você não tem acesso a esta lista.",
  deletedBy: (name: string) => `por ${name}`,
  authorNotRecorded: "Autor não registrado",
  /** Coluna "Excluído por", no desktop. */
  authorNotRecordedShort: "Não registrado",
  /** Coluna "Excluído em", no desktop (wireframe da T4): "10/11/2026 14:32". */
  deletedAtShort: (date: string, time: string) => `${date} ${time}`,
  personDeleted: PERSON_DELETED,
  weekTaken: "Já há outro relatório desta célula na mesma semana.",
  /** Do wireframe da T4: uma pessoa e o papel dela no card ("Líder: Gil Souza"). */
  personLine: (role: string, name: string) => `${role}: ${name}`,
  /** Do wireframe da T4: o membro excluído que não tinha líder. */
  noLeader: "Sem líder",
  /** Do wireframe da T4: o tema do relatório no card. */
  themeLine: (theme: string) => `Tema: ${theme}`,
  /** Não está no spec: cabeçalho, só para leitor de tela, da coluna do "Restaurar" no desktop. */
  actionsColumn: "Ações",
  members: {
    button: "Excluídos",
    buttonLabel: "Ver membros excluídos",
    title: "Membros excluídos",
    back: "← Membros",
    backTo: "Voltar para Membros",
    deletedAt: (date: string, time: string) => `Excluído em ${date} às ${time}`,
    empty: "Nenhum cadastro excluído.",
    noResults: "Nenhum cadastro excluído encontrado para esta busca.",
    loadFailed: "Não foi possível carregar os cadastros excluídos.",
    countLabel: ["cadastro excluído", "cadastros excluídos"],
    /** O mesmo da lista de Membros (T4: "o mesmo placeholder da lista principal"). */
    searchPlaceholder: "Buscar por nome, e-mail ou CPF...",
    /** Não está no spec: rótulo do campo de busca para leitor de tela. */
    searchLabel: "Buscar membros excluídos",
    /** Colunas no desktop (T4). */
    columns: { name: "Nome", leader: "Líder", status: "Situação", deletedAt: "Excluído em", deletedBy: "Excluído por" },
  },
  cells: {
    button: "Excluídas",
    buttonLabel: "Ver células excluídas",
    title: "Células excluídas",
    back: "← Células",
    backTo: "Voltar para Células",
    deletedAt: (date: string, time: string) => `Excluída em ${date} às ${time}`,
    empty: "Nenhuma célula excluída.",
    /** Derivado do texto de membros. */
    noResults: "Nenhuma célula excluída encontrada para esta busca.",
    /** Derivado do texto de membros. */
    loadFailed: "Não foi possível carregar as células excluídas.",
    countLabel: ["célula excluída", "células excluídas"],
    itemTitle: (leader: string) => `Célula de ${leader}`,
    /** O mesmo da lista de Células. */
    searchPlaceholder: "Líder, timóteo, anfitrião, rua ou bairro...",
    /** Não está no spec: rótulo do campo de busca para leitor de tela. */
    searchLabel: "Buscar células excluídas",
    /** Colunas no desktop (T4). */
    columns: {
      leader: "Líder",
      schedule: "Dia / Hora",
      type: "Tipo",
      neighborhood: "Bairro",
      deletedAt: "Excluída em",
      deletedBy: "Excluída por",
    },
  },
  cellReports: {
    button: "Excluídos",
    buttonLabel: "Ver relatórios excluídos",
    title: "Relatórios excluídos",
    back: "← Relatórios",
    backTo: "Voltar para Relatórios",
    deletedAt: (date: string, time: string) => `Excluído em ${date} às ${time}`,
    empty: "Nenhum relatório excluído.",
    /** Derivado do texto de membros. */
    noResults: "Nenhum relatório excluído encontrado para esta busca.",
    /** Derivado do texto de membros. */
    loadFailed: "Não foi possível carregar os relatórios excluídos.",
    countLabel: ["relatório excluído", "relatórios excluídos"],
    itemTitle: (date: string) => `Relatório de ${date}`,
    /** O mesmo da lista de Relatórios. */
    searchPlaceholder: "Buscar por líder ou tema...",
    /** Não está no spec: rótulo do campo de busca para leitor de tela. */
    searchLabel: "Buscar relatórios excluídos",
    /** Colunas no desktop (T4). */
    columns: {
      cell: "Célula (Líder)",
      dateTime: "Data / Hora",
      status: "Situação",
      theme: "Tema",
      deletedAt: "Excluído em",
      deletedBy: "Excluído por",
    },
  },
} as const;
