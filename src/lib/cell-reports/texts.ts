// Todos os textos do formulário de relatório, do bloco da célula e da lista
// de Relatórios (E2.11, "Textos de tela" do Negócio e "Textos" da UX). Nenhum
// outro arquivo do front escreve estes textos.
import { AUDIT_SAVE_TEXTS } from "@/lib/audit/texts";
import { formatList } from "@/lib/format";

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

export const REPORT_FORM_TEXTS = {
  titles: { create: "Novo relatório", edit: "Editar relatório" },
  requiredNote: "Campos com * são obrigatórios.",
  required: " *",
  close: "Fechar",
  errorSummary: (count: number) => `Confira os campos destacados (${count}).`,
  buttons: {
    cancel: "Cancelar",
    send: "Enviar relatório",
    sending: "Enviando…",
    save: "Salvar alterações",
    saving: "Salvando…",
    close: "Fechar",
    editReport: "Editar relatório",
    tryAgain: "Tentar de novo",
  },
  slow: {
    send: "Ainda enviando. Isso pode levar alguns segundos.",
    save: "Ainda salvando. Isso pode levar alguns segundos.",
  },
  connection: {
    send: "Não foi possível enviar o relatório. Verifique a conexão e tente de novo.",
    save: "Não foi possível salvar o relatório. Verifique a conexão e tente de novo.",
  },
  toasts: {
    sent: "Relatório enviado.",
    updated: "Relatório atualizado.",
    unchanged: AUDIT_SAVE_TEXTS.unchanged,
  },
  /** A repetição do mesmo envio com o formulário mudado entre as tentativas (P-REL-29). */
  replayedDifferent: "O relatório foi enviado na primeira tentativa. As alterações feitas depois não foram salvas.",
  /** "Já foi enviado" depois de uma queda neste formulário (P107). */
  replayAfterDrop: "O relatório desta semana já foi enviado. Confira na lista de Relatórios.",
  /** Os participantes salvos não carregaram na edição (não está no spec; "Salvar alterações" espera). */
  participantsLoadFailed: "Não foi possível carregar os participantes. Tente de novo para poder salvar.",
  /** A linha, o contexto ou os participantes da edição não carregaram. */
  editLoadFailed: "Não foi possível carregar o relatório. Verifique a conexão e tente de novo.",
} as const;

export const REPORT_CELL_TEXTS = {
  label: "Célula",
  placeholder: "Buscar por líder, rua ou bairro…",
  chooseHint: "Escolha a célula para preencher o relatório.",
  noResults: "Nenhuma célula encontrada",
  /** A primeira linha da opção do seletor: "{Líder} · {Dia}, {HH:mm}". */
  optionTitle: (leader: string, dayTime: string) => (dayTime ? `${leader} · ${dayTime}` : leader),
  noLeader: "Célula sem líder",
  g12Prefix: "G12:",
} as const;

export const CELL_BLOCK_TEXTS = {
  ariaLabel: "Dados da célula",
  labels: {
    leader: "Líder",
    timothy: "Timóteo",
    host: "Anfitrião",
    g12: "G12",
    type: "Tipo",
    dayTime: "Dia e horário",
    address: "Endereço",
  },
  pastors: "Pastores",
  none: "—",
  noneSr: "nenhum",
  noAddress: "Sem endereço",
  noNumber: "s/n",
  snapshotNote: "Líder, timóteo, anfitrião e tipo registrados no envio.",
  /** "Célula de {líder registrado}" no "Ver relatório". */
  cellOf: (leader: string) => `Célula de ${leader}`,
} as const;

export const LAUNCH_CHECK_TEXTS = {
  checking: "Conferindo o relatório desta semana…",
  failed:
    "Não foi possível conferir se o relatório desta semana já foi enviado. Você pode preencher; a conferência é feita ao enviar.",
  weekTaken: "O relatório para esta semana já foi enviado.",
  weekTakenDetail: (meeting: string, held: boolean) =>
    `Reunião de ${meeting} · ${held ? MEETING_TEXTS.held : MEETING_TEXTS.notHeld}.`,
  notYet: (meeting: string) => `A reunião desta semana ainda não aconteceu. O relatório pode ser enviado a partir de ${meeting}.`,
  cellDeleted: "Esta célula foi excluída e não recebe relatórios.",
  cellNotFound: "Esta célula não existe ou já foi excluída.",
  notAllowed: "Você não pode enviar o relatório desta célula.",
  noPermission: "Você não tem permissão para esta ação.",
} as const;

export const MEETING_TEXTS = {
  legend: "Reunião",
  held: "Célula realizada",
  notHeld: "Não houve célula",
  date: "Data",
  time: "Horário",
  theme: "Tema",
  reason: "Motivo",
  reasonHint: "Por exemplo: feriado, chuva forte, viagem do anfitrião.",
  today: " (hoje)",
  planned: (meeting: string) => `Reunião prevista: ${meeting}`,
  launchHint: (meeting: string) => `Entre ${meeting}, e agora.`,
  editHint: (start: string, end: string) => `Dentro da semana do relatório, de ${start} a ${end}.`,
  cellSwitched: "Data e horário trocados pela reunião desta célula.",
} as const;

export const LEAVING_TEXTS = {
  launch: (items: readonly string[]) =>
    items.length === 1 ? `Ao enviar, não será enviado: ${items[0]}.` : `Ao enviar, não serão enviados: ${formatList(items)}.`,
  edit: (items: readonly string[]) =>
    items.length === 1 ? `Ao salvar, sai do relatório: ${items[0]}.` : `Ao salvar, saem do relatório: ${formatList(items)}.`,
  toHeld: "Ao salvar, o motivo sai do relatório, e o líder, o timóteo e o anfitrião registrados entram como participantes.",
  items: {
    theme: "o tema",
    chosen: (n: number) => plural(n, "participante escolhido", "participantes escolhidos"),
    participants: (n: number) => plural(n, "participante", "participantes"),
    visitors: (n: number) => plural(n, "visitante", "visitantes"),
    offering: (value: string) => `a oferta (R$ ${value})`,
    observations: "as observações",
  },
} as const;

export const PARTICIPANTS_TEXTS = {
  legend: "Participantes",
  autoHint: "O líder, o timóteo e o anfitrião entram automaticamente.",
  editHint: "O líder, o timóteo e o anfitrião registrados no relatório não podem ser retirados dos participantes.",
  others: "Outros participantes",
  placeholder: "Buscar membros…",
  alreadyIn: "Já entra automaticamente.",
  total: (n: number) => `Participantes: ${n}`,
  remove: (name: string) => `Retirar ${name}`,
} as const;

export const VISITORS_TEXTS = {
  legend: "Visitantes",
  hint: "Um nome por campo.",
  placeholder: "Nome do visitante",
  nameLabel: (n: number) => `Nome do visitante ${n}`,
  removeNamed: (name: string) => `Retirar o visitante ${name}`,
  removeNth: (n: number) => `Retirar o visitante ${n}`,
  add: "Adicionar visitante",
  total: (n: number) => `Visitantes: ${n}`,
} as const;

export const OFFERING_TEXTS = {
  label: "Oferta",
  hint: "Se não houve oferta, informe 0,00.",
  placeholder: "0,00",
  currency: "R$",
} as const;

export const OBSERVATIONS_TEXTS = { label: "Observações" } as const;

/** As mensagens das regras (tabela "Formato dos erros"); o servidor manda as mesmas. */
export const REPORT_RULE_TEXTS = {
  cell_required: "Escolha a célula.",
  report_date_required: "Informe a data da reunião.",
  report_date_invalid: "Data inválida.",
  report_time_required: "Informe o horário da reunião.",
  report_time_invalid: "Horário inválido. Informe a hora e os minutos, entre 00:00 e 23:59.",
  theme_required: "Informe o tema ministrado.",
  theme_too_long: "O tema pode ter no máximo 300 caracteres.",
  reason_required: "Informe o motivo de não ter havido célula.",
  reason_too_long: "O motivo pode ter no máximo 2000 caracteres.",
  not_held_with_deleted_participant:
    'Este relatório tem participante com cadastro excluído e não pode passar para "Não houve célula".',
  too_many_participants: "Um relatório pode ter no máximo 1000 participantes.",
  too_many_visitors: "Um relatório pode ter no máximo 1000 visitantes.",
  visitor_name_too_long: "Cada visitante pode ter no máximo 150 caracteres.",
  offering_required: "Informe a oferta. Se não houve oferta, informe R$ 0,00.",
  offering_negative: "A oferta não pode ser negativa.",
  offering_invalid: "Oferta inválida. Informe um valor em reais, com até 2 casas decimais.",
  offering_too_large: "A oferta pode ser de no máximo R$ 999.999,99.",
  observations_too_long: "As observações podem ter no máximo 4000 caracteres.",
  report_in_future: "O relatório não pode ser enviado para uma data ou horário futuros.",
  report_before_meeting: (meeting: string) => `O relatório não pode ser de antes da reunião da célula nesta semana (${meeting}).`,
  report_week_locked: (start: string, end: string) =>
    `Na edição, a data só pode mudar dentro da semana do relatório, de ${start} a ${end}.`,
  report_not_current_week: (start: string, end: string) => `O relatório precisa ser da semana atual, de ${start} a ${end}.`,
  report_cell_immutable: "A célula de um relatório não pode ser trocada.",
  report_gone: "Este relatório não existe ou já foi excluído. As alterações não foram salvas.",
  report_cell_deleted: "A célula deste relatório foi excluída. Restaure a célula para editar o relatório.",
  permission_denied: "Você não tem permissão para esta ação.",
} as const;

/** A lista de Relatórios (T10). */
export const REPORT_LIST_TEXTS = {
  newReport: "Novo relatório",
  g12: (name: string) => `G12: ${name}`,
  noLeader: "Célula sem líder",
} as const;
