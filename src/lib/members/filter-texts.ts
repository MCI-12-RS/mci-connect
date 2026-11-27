// Os textos dos filtros de Membros (E2.07, "Textos de tela" e "Experiência (UX) > Textos"). Cada
// opção de enum tem rótulo: a compilação falha se surgir uma opção nova sem texto (`satisfies`).

import type { Database } from "@/integrations/supabase/types";
import { LEVEL_TEXTS } from "@/lib/hierarchy/texts";
import { levelLabel } from "@/lib/hierarchy/level";

type Enums = Database["public"]["Enums"];

export const MEMBER_FILTER_LABELS = {
  leaders: "Liderança",
  neighborhood: "Bairro",
  city: "Cidade",
  status: "Situação",
  leadership: "Situação de liderança",
  baptized: "Batizado",
  level: "Nível",
  cellLink: "Vínculo celular",
  dates: "Data de cadastro",
  from: "Cadastrado a partir de",
  to: "Cadastrado até",
} as const;

export const MEMBER_STATUS_LABELS = { active: "Ativo", inactive: "Inativo" } as const;

export const MEMBER_BAPTIZED_LABELS = { yes: "Sim", no: "Não" } as const;

export const MEMBER_LEADERSHIP_LABELS = {
  with_leader: "Com líder",
  no_leadership: "Sem liderança",
  pastor: "Pastor(a)",
} as const satisfies Record<Enums["member_leadership_status"], string>;

export const MEMBER_CELL_LINK_LABELS = {
  leader: "Líder",
  timothy: "Timóteo",
  host: "Anfitrião",
  attendee: "Participante",
  none: "Sem vínculo",
} as const satisfies Record<Enums["member_cell_link"], string>;

/** As dicas das opções de Vínculo celular que têm uma (P51). */
export const MEMBER_CELL_LINK_HINTS: Partial<Record<Enums["member_cell_link"], string>> = {
  attendee: "Esteve em pelo menos uma célula realizada nos últimos 30 dias.",
  none: "Não é líder, timóteo nem anfitrião de célula ativa, não esteve em célula nos últimos 30 dias e não tem célula ativa abaixo dele.",
};

/** Os rótulos dos níveis do filtro (RN-09), os do P40, com "Pastores" e "Nível 5 ou mais". */
export const MEMBER_LEVEL_LABELS = {
  "0": LEVEL_TEXTS.pastors,
  "1": levelLabel({ level: 1 }),
  "2": levelLabel({ level: 2 }),
  "3": levelLabel({ level: 3 }),
  "4": levelLabel({ level: 4 }),
  "5plus": "Nível 5 ou mais",
} as const;

export const MEMBER_FILTER_TEXTS = {
  search: { label: "Buscar", placeholder: "Nome, e-mail ou CPF" },
  leaders: {
    label: MEMBER_FILTER_LABELS.leaders,
    placeholder: "Escolha uma ou mais pessoas",
    hint: "Mostra quem está abaixo das pessoas escolhidas, em todos os níveis. Para ver o ministério de um casal, escolha os dois.",
    limit: "Escolha até 10 pessoas.",
    unavailableName: "Pessoa indisponível",
    unavailable: (count: number) =>
      count > 1 ? "Estas pessoas não estão disponíveis para você." : "Esta pessoa não está disponível para você.",
    loadingName: "Carregando…",
    nameNotLoaded: "nome não carregado",
  },
  levelHint: "Quem está sem liderança não tem nível. Use a Situação de liderança.",
  cellLinkHint: "Líder, timóteo e anfitrião contam só em células ativas.",
  datesHint: "Cadastros antigos sem data de cadastro não aparecem quando há filtro de data.",
  invalidDate: "Data inválida. Use o formato dd/mm/aaaa.",
  invertedDates: "A data inicial precisa ser igual ou anterior à data final.",
  chips: {
    labeled: (label: string, value: string) => `${label}: ${value}`,
    from: (date: string) => `${MEMBER_FILTER_LABELS.from} ${date}`,
    to: (date: string) => `${MEMBER_FILTER_LABELS.to} ${date}`,
  },
  count: ["membro", "membros"] as [string, string],
  emptyFiltered: "Nenhum membro encontrado com estes filtros.",
  empty: "Nenhum membro encontrado.",
  loadFailed: "Não foi possível carregar os membros. Verifique a conexão e tente de novo.",
  tryAgain: "Tentar de novo",
} as const;
