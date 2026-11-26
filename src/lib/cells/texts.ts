// Textos do cadastro de célula (E2.08: "Textos de tela" do Negócio e "Textos"
// da UX). Os do endereço e do CEP ficam em `src/lib/address/texts.ts`, comuns
// ao cadastro de membro. "Sem mudança" e a mensagem de conexão vêm do E2.05 (T5).
import { AUDIT_SAVE_TEXTS } from "@/lib/audit/texts";

/** As mensagens das regras, iguais às do banco (Formato dos erros, AQ-1). */
export const CELL_RULE_TEXTS = {
  leaderRequired: "Escolha o líder da célula.",
  timothyRequired: "Escolha o timóteo da célula.",
  hostRequired: "Escolha o anfitrião da célula.",
  cellTypeInvalid: "Tipo de célula inválido. Escolha Evangelística, Discipulado ou Macrocélula.",
  meetingDayRequired: "Escolha o dia da semana.",
  meetingDayInvalid: "Dia da semana inválido. Escolha de domingo a sábado.",
  meetingTimeRequired: "Informe o horário.",
  meetingTimeInvalid: "Horário inválido. Informe a hora e os minutos, entre 00:00 e 23:59.",
  newCellInactive: "Uma célula nova sempre começa ativa.",
} as const;

/** O formulário de célula (T1 a T6). */
export const CELL_FORM_TEXTS = {
  titles: { create: "Nova célula", edit: "Editar célula" },
  /** O badge do cabeçalho, na edição de uma célula gravada inativa (P60). */
  inactiveBadge: "Inativa",
  requiredNote: "Campos com * são obrigatórios.",
  groups: { people: "Pessoas da célula", meeting: "Reunião", address: "Endereço da célula" },
  labels: {
    leader: "Líder *",
    timothy: "Timóteo *",
    host: "Anfitrião *",
    type: "Tipo *",
    meetingDay: "Dia da semana *",
    meetingTime: "Horário *",
    isActive: "Célula ativa",
  },
  placeholders: {
    leader: "Buscar líder…",
    timothy: "Buscar timóteo…",
    host: "Buscar anfitrião…",
    meetingDay: "Escolha o dia",
    meetingTime: "00:00",
  },
  hints: {
    timothy: "Auxilia o líder e está em formação para liderar.",
    host: "Quem recebe a célula em casa.",
  },
  /** "Célula ativa": a dica pela situação gravada e o aviso do que muda ao salvar (P60). */
  situation: {
    hintActive: "Desligue quando a célula parar de se reunir. A célula inativa sai dos totais e não recebe relatórios.",
    hintInactive: "Ligue quando a célula voltar a se reunir. A célula inativa não conta nos totais e não recebe relatórios.",
    willInactivate: "Ao salvar, a célula fica inativa. Os relatórios que ela já tem continuam.",
    willReactivate: "Ao salvar, a célula volta aos totais e a receber relatórios a partir desta semana.",
  },
  /** O endereço do anfitrião, embaixo do Anfitrião (P61). */
  hostAddress: {
    loading: "Buscando o endereço do anfitrião…",
    full: "Endereço preenchido com o do anfitrião.",
    partial: "Bairro, cidade e estado preenchidos com os do anfitrião. Complete o CEP, a rua e o número.",
    unavailable: "O endereço do anfitrião não está disponível. Preencha o endereço da célula.",
    failed: "Não foi possível carregar o endereço do anfitrião.",
    goToAddress: "Ir para o endereço",
    retry: "Tentar de novo",
  },
  errorSummary: (count: number) => `Confira os campos destacados (${count}).`,
  buttons: {
    cancel: "Cancelar",
    create: "Criar célula",
    save: "Salvar alterações",
    creating: "Criando…",
    saving: "Salvando…",
  },
  close: "Fechar",
  connectionFailed: AUDIT_SAVE_TEXTS.connection.cell,
  discard: {
    title: "Descartar as alterações?",
    description: "O que você digitou não será salvo.",
    confirm: "Descartar",
    keepEditing: "Continuar editando",
  },
  toasts: {
    created: "Célula criada.",
    updated: "Célula atualizada.",
    inactivated: "Célula inativada.",
    reactivated: "Célula reativada.",
    unchanged: AUDIT_SAVE_TEXTS.unchanged,
  },
} as const;

/** A lista de Células (T7). */
export const CELLS_PAGE_TEXTS = {
  newCell: "Nova célula",
  /** A coluna que junta o dia, o horário e o tipo (E2.09, UXD-6). */
  columnMeeting: "Reunião",
  /** O dia ou o horário ausente na reunião (RN-07). */
  missing: "—",
} as const;

/** O formulário de relatório com a célula inativada no meio tempo (T8, RN-11 c, P-CEL-17). */
export const CELL_REPORT_INACTIVE_TEXTS = {
  /** Quem tem "Editar Célula" pode reativá-la. */
  canReactivate: "Esta célula está inativa e não recebe relatórios. Para enviar um relatório, reative a célula.",
  /** Quem não tem pede à liderança. */
  askLeadership:
    "Esta célula está inativa e não recebe relatórios. Se ela voltou a se reunir, peça à sua liderança para reativá-la.",
} as const;

/** O texto da recusa `cell_inactive` no relatório, conforme quem lê pode editar a célula. */
export function cellInactiveReportMessage(canEditCell: boolean): string {
  return canEditCell ? CELL_REPORT_INACTIVE_TEXTS.canReactivate : CELL_REPORT_INACTIVE_TEXTS.askLeadership;
}
