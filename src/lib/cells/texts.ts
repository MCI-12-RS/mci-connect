// Textos do cadastro de célula (E2.08, "Textos de tela" do spec). O PR 5 traz o
// restante; o ajuste mínimo do PR 2 usa só as mensagens dos campos obrigatórios.

export const CELL_RULE_TEXTS = {
  leaderRequired: "Escolha o líder da célula.",
  timothyRequired: "Escolha o timóteo da célula.",
  hostRequired: "Escolha o anfitrião da célula.",
  meetingDayRequired: "Escolha o dia da semana.",
  meetingTimeRequired: "Informe o horário.",
} as const;
