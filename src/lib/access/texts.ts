// Textos do E2.02 (perfis e escopo): "Textos de tela" do Negócio e "Textos" da
// Experiência (UX). Todos os textos de tela deste passo ficam só aqui. Os
// rótulos e as dicas das permissões ficam no catálogo (`permissions.ts`).
//
// As mensagens de regra também vêm prontas do banco (`message` do erro
// `app_error`), e a tela mostra a que veio. As cópias aqui servem para os
// testes e para quando a tela decide sem chamar o servidor.

import { DELETION_TEXTS } from "@/lib/deletion/texts";

/** Acesso relido, tela sem acesso e falha ao ler o acesso (T12, P13, UXD-11). */
export const ACCESS_TEXTS = {
  updated: "Seu acesso foi atualizado.",
  /** A variação das listas de excluídos (P13), "… a esta lista.", é a do E2.01: `DELETED_LIST_TEXTS.noAccess`. */
  noAccessScreen: "Você não tem acesso a esta tela.",
  goHome: "Ir para o início",
  loadFailed: "Não foi possível carregar o seu acesso. Verifique a conexão e tente de novo.",
  tryAgain: "Tentar de novo",
  /** Não está no spec: texto para leitor de tela enquanto o acesso carrega (menu e rota). */
  loading: "Carregando…",
  /** Recusa 42501 (UX-30): o texto do E2.01. */
  permissionDenied: DELETION_TEXTS.permissionDenied,
} as const;

/** Menu lateral (T1, UXD-13, UXD-14). */
export const MENU_TEXTS = {
  dashboard: "Dashboard",
  members: "Membros",
  cells: "Células",
  reports: "Relatórios",
  ministries: "Ministérios",
  roles: "Funções",
  events: "Auditoria",
  noRole: "Sem função",
  editOwnData: "Editar meus dados",
  viewOwnData: "Ver meus dados",
  signOut: "Sair",
  /** Não está no spec: rótulo do botão que abre o menu no celular. */
  openMenu: "Abrir menu",
  /** Não está no spec: nome acessível do menu no celular (só para leitor de tela). */
  menuTitle: "Menu",
} as const;

/** "Meus dados" só para leitura (T6, UXD-13, UX-09). */
export const OWN_DATA_TEXTS = {
  title: "Meus dados",
  /** Não está no spec: o título do diálogo de quem pode editar, como era antes. */
  editTitle: "Editar Meus Dados",
  readOnlyNotice:
    "Você pode consultar os seus dados, mas não alterá-los. Para corrigir alguma informação, fale com o seu líder.",
  close: "Fechar",
} as const;

/** Títulos (`h1`) das telas, para o estado sem acesso manter o da rota (T12). */
export const SCREEN_TITLES = {
  members: "Membros",
  cells: "Células",
  cellReports: "Relatórios de Células",
  ministries: "Ministérios",
  roles: "Funções",
  events: "Auditoria",
} as const;

/** Subtítulos de alcance das listas (P10, UXD-5). */
export const LIST_SUBTITLES = {
  members: { ministry: "Membros do seu ministério", church: "Membros de toda a igreja" },
  cells: { ministry: "Células do seu ministério", church: "Células de toda a igreja" },
  cellReports: {
    ministry: "Relatórios das células do seu ministério",
    church: "Relatórios das células de toda a igreja",
  },
} as const;

/** Dashboard (T9, RN-22, RN-07). */
export const DASHBOARD_TEXTS = {
  churchSubtitle: "Visão geral da igreja",
  ministrySubtitle: "Visão do seu ministério",
  ministryBadge: "Meu Ministério",
  noAccess: "Você não tem acesso ao dashboard.",
  noRole: "Sua conta ainda não tem uma função. Fale com um administrador.",
  noMember: "Seu acesso ainda não está ligado a um cadastro de membro. Fale com um administrador.",
  newReport: "Novo relatório",
} as const;

/**
 * Ministérios (T10). Com a DA-6 (PR 1), a árvore começa no topo do escopo, e
 * o estado vazio fica só para quem não vê ninguém (AQ-10). Os dois textos do
 * vazio substituem os do E1.08 ("Nenhum pastor visível…"), que deixaram de
 * valer; aguardam a revisão do `ux-designer`.
 */
export const MINISTRIES_TEXTS = {
  emptyTitle: "Ninguém visível para você na árvore.",
  emptyDescription: "As pessoas do seu ministério aparecem em Membros.",
  /** Sem acesso a Membros: não aponta para uma tela que a pessoa não vê. */
  emptyDescriptionNoMembers: "Fale com um administrador.",
  goToMembers: "Ver membros do seu ministério",
} as const;

/** Seletores de pessoa e de célula (P11, UXD-4, UXD-9). */
export const SELECT_TEXTS = {
  /** Busca sem resultado de quem vê a igreja toda (o texto de antes do E2.02). */
  noMembers: "Nenhum membro encontrado",
  noMembersInMinistry: "Nenhum membro do seu ministério encontrado.",
  noCellsToReport: "Você não pode enviar o relatório de nenhuma célula.",
} as const;

/** Formulário de membro (T6). */
export const MEMBER_FORM_TEXTS = {
  leaderLabel: "Líder *",
  leaderHint: "O líder é obrigatório e é escolhido entre as pessoas do seu ministério.",
  leaderRequired: "Escolha o líder.",
  spouseHint: "Escolha entre as pessoas do seu ministério. Se o cônjuge é de outro ministério, peça a um administrador.",
  pastorLabel: "Pastor(a)",
  pastorReason: "Só quem vê a igreja toda pode mudar esta marcação.",
  noLeadershipLabel: "Sem liderança",
  noLeadershipReason: "Para definir um líder, escolha uma pessoa do seu ministério.",
  roleLabel: "Função *",
  /** Não está no spec: o rótulo do campo Função quando ele é só texto (P12). */
  roleTextLabel: "Função",
  defaultRole: (name: string) => `${name} (padrão)`,
  defaultRoleHint: "Novos membros recebem a função padrão.",
  ownRole: "Ninguém pode alterar a própria função.",
  roleChangeNotAllowed: "Você não tem permissão para alterar a função deste membro.",
  newMemberBlockedTitle: "Não é possível cadastrar membros",
  close: "Fechar",
  /** Botão da lista e título do diálogo (T5, UX-10). */
  newMember: "Novo membro",
  /** Botão de envio do cadastro novo (fluxo F4). */
  createMember: "Criar membro",
  /** O seletor de função enquanto `role_options` carrega (Estados, coluna Membros). */
  roleLoading: "Carregando…",
  /** Não está no spec: falha ao ler as opções de função (o texto de antes do E2.02). */
  roleLoadFailed: "Não foi possível carregar as funções.",
  /** Não está no spec: seletor de função vazio no envio (o texto de antes do E2.02, agora embaixo do campo). */
  roleRequired: "Selecione uma função para o membro.",
  /** Não está no spec: falha sem regra ao salvar o cadastro (40P01, erro técnico), sem o texto técnico (UX-30). */
  saveFailed: "Não foi possível salvar o cadastro. Tente de novo.",
  /** Não está no spec: queda de conexão ao salvar o cadastro. */
  saveNetworkError: "Não foi possível salvar o cadastro. Verifique a conexão e tente de novo.",
} as const;

/** Formulário de célula (T7). */
export const CELL_FORM_TEXTS = {
  peopleHint: "Líder, timóteo e anfitrião são escolhidos entre as pessoas do seu ministério.",
} as const;

/** Formulário de relatório (T8). */
export const REPORT_FORM_TEXTS = {
  /** O título do diálogo de relatório novo (o de Células e Relatórios), usado pelo atalho do Dashboard (T9). */
  newReportTitle: "Novo Relatório de Célula",
  participantsHint: "Aparecem só as pessoas do seu ministério.",
  hiddenParticipants: "Alguns participantes não são do seu ministério: se você retirá-los, não poderá incluí-los de novo.",
} as const;

/** Mensagens das regras (Formato dos erros, AQ-5; T11). */
export const RULE_TEXTS = {
  personNotVisible: "Você só pode escolher pessoas que você vê.",
  pastorOrNoLeadership: "Só quem vê a igreja toda pode marcar um membro como pastor ou como sem liderança.",
  reportSubmitNotAllowed: "Você não pode enviar o relatório desta célula.",
  wouldLeaveScopeMember: "Com esta alteração, você deixaria de ver este cadastro. As alterações não foram salvas.",
  wouldLeaveScopeCell:
    "Com esta alteração, você deixaria de ver esta célula. Mantenha pelo menos uma pessoa do seu ministério como líder, timóteo ou anfitrião. As alterações não foram salvas.",
  defaultRoleNotCovered: "A função padrão tem permissões que você não tem. Peça a um administrador para fazer este cadastro.",
  ownRole: "Ninguém pode alterar a própria função.",
  roleChangeNotAllowed: "Você não tem permissão para alterar a função deste membro.",
  roleNotAssignable: "Você não tem permissão para atribuir esta função.",
  ownDataOnly: (fields: string) => `Você só pode alterar os seus dados pessoais. Não é permitido alterar: ${fields}.`,
  lastAdmin: "Não é possível tirar a função Administrador do último administrador.",
  adminRoleProtected: {
    update: "A função Administrador não pode ser alterada.",
    delete: "A função Administrador não pode ser excluída.",
    default: "A função Administrador não pode ser a função padrão.",
  },
  roleIsDefault: "Esta é a função padrão. Escolha outra função padrão antes de excluí-la.",
  roleDefaultRequired: "Esta é a função padrão. Para trocar, marque outra função como padrão.",
  roleInUse: (count: number) =>
    `Esta função é usada por ${count === 1 ? "1 membro" : `${count} membros`}. Troque a função deles antes de excluí-la.`,
  roleNameRequired: "Informe o nome da função.",
  roleNameTaken: "Já existe uma função com este nome.",
  roleChanged: "Esta função foi alterada em outra tela.",
  permissionRetired: "Esta permissão não existe mais.",
  permissionNotCovered: "Você não pode dar a uma função uma permissão que você não tem.",
} as const;

/** Funções: lista, formulário, exclusão e toasts (T2 a T4). */
export const ROLE_TEXTS = {
  title: "Funções",
  subtitle: "Gerenciar funções e permissões",
  newRole: "Nova função",
  permissionCount: (count: number) => (count === 1 ? "1 permissão" : `${count} permissões`),
  memberCount: (count: number) => (count === 0 ? "Nenhum membro" : count === 1 ? "1 membro" : `${count} membros`),
  showPermissions: "Ver permissões",
  hidePermissions: "Ocultar permissões",
  defaultBadge: "Padrão",
  adminDescription: "Todas as permissões, inclusive as novas. Esta função não pode ser alterada nem excluída.",
  noPermissions:
    "Sem permissões: quem tiver esta função vê só o próprio cadastro, as células em que é líder, timóteo ou anfitrião e os relatórios delas, e não altera nada.",
  editLabel: (name: string) => `Editar a função ${name}`,
  actionsLabel: (name: string) => `Ações da função ${name}`,
  deleteLabel: (name: string) => `Excluir a função ${name}`,
  /** Cabeçalhos da tabela (desktop). "Ações" não está no spec: só para leitor de tela. */
  columns: { role: "Função", description: "Descrição", permissions: "Permissões", members: "Membros", actions: "Ações" },
  loadFailed: "Não foi possível carregar as funções.",
  tryAgain: "Tentar de novo",
  // Formulário
  editRole: "Editar função",
  nameLabel: "Nome *",
  descriptionLabel: "Descrição",
  permissionsLabel: "Permissões",
  checkedCount: (count: number) => (count === 1 ? "1 marcada" : `${count} marcadas`),
  scopeNote: "Fora a Auditoria, todas as permissões valem só para o que a pessoa vê.",
  defaultLabel: "Função padrão",
  defaultHint: "Novos membros recebem esta função quando quem cadastra não escolhe outra.",
  defaultLocked: "Esta é a função padrão. Para trocar, marque outra função como padrão.",
  defaultSwitchWarning: (name: string) =>
    `A função ${name} deixa de ser a padrão. Quem cadastra membros sem poder escolher a função precisa ter todas as permissões da função padrão.`,
  nameRequired: "Informe o nome da função.",
  cancel: "Cancelar",
  save: "Salvar função",
  create: "Criar função",
  saving: "Salvando…",
  discardTitle: "Descartar as alterações?",
  discard: "Descartar",
  keepEditing: "Continuar editando",
  // Exclusão
  deleteTitle: (name: string) => `Excluir a função ${name}?`,
  /** O texto da T4 ("Nenhum membro usa esta função. Depois de excluída, …") em dois tópicos, no `ConfirmDeleteContent` do E2.01. */
  deleteNoMembers: "Nenhum membro usa esta função.",
  /** Sem a contagem de membros, a confirmação diz só esta frase. */
  deleteIrreversible: "Depois de excluída, ela não pode ser recuperada.",
  deleteAction: "Excluir função",
  deleting: "Excluindo…",
  /** Queda de conexão e falha técnica na exclusão: os textos do E2.01. */
  deleteNetworkError: DELETION_TEXTS.deleteNetworkError,
  deleteFailed: DELETION_TEXTS.deleteFailed,
  deleteBlockedTitle: (name: string) => `Não é possível excluir a função ${name}`,
  close: "Fechar",
  // Toasts
  created: "Função criada.",
  createdAsDefault: (name: string) => `Função criada. ${name} agora é a função padrão.`,
  updated: "Função atualizada.",
  deleted: "Função excluída.",
  updatedAsDefault: (name: string) => `Função atualizada. ${name} agora é a função padrão.`,
  changedElsewhere: "Esta função foi alterada em outra tela.",
  saveNetworkError: "Não foi possível salvar a função. Verifique a conexão e tente de novo.",
  /** Não está no spec: falha que não é de conexão nem de regra (derivado de `saveNetworkError` e do `deleteFailed` do E2.01). */
  saveFailed: "Não foi possível salvar a função. Tente de novo.",
} as const;
