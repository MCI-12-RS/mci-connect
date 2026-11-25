// Textos da hierarquia e dos totais (E2.06: "Textos de tela" do Negócio e
// "Textos" da Experiência). Os textos de tela deste spec ficam só aqui; as
// regras que escolhem entre eles ficam em `level.ts`, `leadership.ts` e
// `totals.ts`.
//
// Os textos das alternativas Q-1, Q-2 e Q-3 não entram: o spec adota o padrão.

/** Rótulo do nível (P40, RN-02). */
export const LEVEL_TEXTS = {
  pastor: "Pastor",
  pastora: "Pastora",
  /** Pastor sem sexo registrado (cadastro antigo). */
  pastorUnknownGender: "Pastor(a)",
  /** Nó com dois pastores e o filtro (E2.07). Nunca para uma pessoa só. */
  pastors: "Pastores",
  g12: "G12",
  /** Nível 5 ou mais. */
  deepLevel: (level: number) => `Nível ${level}`,
  noLeadership: "Sem liderança",
  /** Leitor de tela: prefixo dos rótulos só com número ("nível 144"). */
  numericPrefix: "nível",
} as const;

/** Liderança de uma pessoa (P41, RN-10). */
export const LEADERSHIP_TEXTS = {
  /** Pastor: na tabela. */
  none: "—",
  /** Leitor de tela, no lugar do "—". */
  noneSpoken: "Nenhuma",
  noLeadership: "Sem liderança",
  separator: "/",
  /** Cartão do celular: "Liderança: {valor}", só para quem tem líder. */
  cardLabel: "Liderança:",
  spokenLeader: (leader: string) => `Líder ${leader}`,
  spokenG12IsLeader: (name: string) => `G12 e líder ${name}`,
  spokenChain: (g12: string, leader: string) => `G12 ${g12}, líder ${leader}`,
} as const;

/** Totais por extenso (P42, RN-05, RN-06). */
export const TOTALS_TEXTS = {
  disciple: "discípulo",
  disciples: "discípulos",
  cell: "célula",
  cells: "células",
  separator: "·",
  /** Leitor de tela: "2 discípulos, 3 células". */
  spokenSeparator: ", ",
} as const;

/** Lista de Membros (T1). */
export const MEMBERS_LIST_TEXTS = {
  columnName: "Nome",
  columnMobile: "Celular",
  columnLevel: "Nível",
  columnLeadership: "Liderança",
  columnMinistry: "Ministério",
  columnStatus: "Situação",
  columnActions: "Ações",
} as const;

/** Lista de Células (T2, RN-11). */
export const CELLS_LIST_TEXTS = {
  columnStatus: "Situação",
  g12Label: "G12:",
  /** G12 da célula de um pastor. */
  g12Pastors: "Pastores",
  /** G12 da célula de quem está sem liderança. */
  g12None: "—",
  /** Leitor de tela, no lugar do "—": "G12: nenhum". */
  g12NoneSpoken: "nenhum",
} as const;

/** Árvore de Ministérios (T3, T4). */
export const MINISTRIES_TEXTS = {
  help: "Toque ou clique num nome para ver os discípulos diretos. Os totais somam todos os níveis abaixo de cada nome, inclusive os discípulos de pessoas inativas, que não aparecem aqui.",
  /** Nome do nó para o leitor de tela: "Diego Reis e Olga Reis". */
  coupleNames: (member: string, spouse: string) => `${member} e ${spouse}`,
  spouseAbove: (spouse: string) => `Aparece com o cônjuge, ${spouse}, mais acima.`,
  goToCouple: "Ir para o casal",
  goToCoupleLabel: (member: string, spouse: string) => `Ir para ${member} e ${spouse}, mais acima na árvore`,
} as const;

/** Gravação de membro e de célula (T5, P44, RN-08). */
export const SAVE_TEXTS = {
  stillSaving: "Ainda salvando. Isso pode levar alguns segundos.",
  recalcFailed: "Não foi possível salvar as alterações. Tente de novo.",
} as const;
