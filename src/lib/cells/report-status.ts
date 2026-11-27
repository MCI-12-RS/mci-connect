// Situação do relatório de cada célula (E2.09: RN-04, RN-05, RN-07; P70 a
// P73; AQ-1 e AQ-5). O servidor calcula a situação (`cells_view.report_status`
// e `report_missing_weeks`); aqui só se traduz o código em texto, tom e ícone.
// Nada de `Date`, `meeting_day` ou `last_report_date`: o front não calcula a
// situação (UX-12). Todos os textos da situação ficam aqui, menos o título do
// card do Dashboard, que fica com os outros títulos dele. Sem React e sem
// Supabase.
import { Constants, type Database } from "@/integrations/supabase/types";

export type CellReportStatus = Database["public"]["Enums"]["cell_report_status"];

/** Os códigos que viram badge: todos menos "sem dia da reunião", que é texto (RN-07). */
export type ReportBadgeStatus = Exclude<CellReportStatus, "no_meeting_day">;

/** O tom do `StatusBadge` (P6): verde de sucesso, amarelo de aviso ou neutro (UXD-2). */
export type ReportStatusTone = "success" | "warning" | "muted";

/** A chave do ícone; o componente escolhe o ícone do `lucide-react`. */
export type ReportStatusIcon = "check" | "clock" | "alert" | "calendar-clock";

const KNOWN_STATUSES: ReadonlySet<string> = new Set<string>(Constants.public.Enums.cell_report_status);

/** O código veio do servidor e o front o conhece? Um código novo vira "Situação indisponível" (UX-08). */
export function isCellReportStatus(value: unknown): value is CellReportStatus {
  return typeof value === "string" && KNOWN_STATUSES.has(value);
}

interface BadgeSpec {
  /** As partes do texto: "Enviado" e o detalhe. Na tela, com "·" entre elas; no leitor de tela, com ", ". */
  parts: readonly string[];
  tone: ReportStatusTone;
  icon: ReportStatusIcon;
}

/** P70: texto, tom e ícone de cada valor da semana (RN-04). */
const BADGES: Readonly<Record<ReportBadgeStatus, BadgeSpec>> = {
  sent_held: { parts: ["Enviado", "Célula realizada"], tone: "success", icon: "check" },
  sent_not_held: { parts: ["Enviado", "Não houve célula"], tone: "success", icon: "check" },
  not_yet: { parts: ["Ainda não ocorreu"], tone: "muted", icon: "clock" },
  pending: { parts: ["Pendente"], tone: "warning", icon: "alert" },
  next_week: { parts: ["Conta a partir da próxima semana"], tone: "muted", icon: "calendar-clock" },
};

/** Os textos da situação fora do badge (Textos da UX). */
export const REPORT_STATUS_TEXTS = {
  /** O rótulo da linha no cartão (P71). */
  cardLabel: "Relatório:",
  /** O título da coluna da tabela (T2). */
  column: "Relatório",
  /** RN-07: a célula sem dia válido, em texto, sem badge. */
  noMeetingDay: "Sem dia da reunião",
  /** O que se vê quando não há situação: a célula inativa na tabela ou o código desconhecido. */
  none: "—",
  /** O que o leitor de tela ouve no "—" da célula inativa, na tabela. */
  inactiveSpoken: "Não se aplica, célula inativa",
  /** O que o leitor de tela ouve no "—" do código ausente ou desconhecido numa célula ativa. */
  unknownSpoken: "Situação indisponível",
  /** O separador do "Enviado · …" na tela e no leitor de tela. */
  separator: " · ",
  separatorSpoken: ", ",
} as const;

export type ReportStatusDisplay =
  | {
      kind: "badge";
      status: ReportBadgeStatus;
      /** O texto que se vê: "Enviado · Célula realizada". */
      label: string;
      /** O que o leitor de tela ouve: "Enviado, Célula realizada". */
      srLabel: string;
      parts: readonly string[];
      tone: ReportStatusTone;
      icon: ReportStatusIcon;
    }
  | { kind: "text"; label: string }
  | { kind: "inactive" }
  | { kind: "unknown" };

/**
 * Como mostrar a situação de uma célula (P70, P71). O código do servidor
 * manda; `isActive` só separa os dois casos sem código: a célula inativa
 * (RN-01, nada no cartão e "—" na tabela) e o código ausente numa célula
 * ativa ("—", "Situação indisponível").
 */
export function reportStatusDisplay(status: unknown, isActive: boolean | null | undefined): ReportStatusDisplay {
  if (status === null || status === undefined) return isActive === false ? { kind: "inactive" } : { kind: "unknown" };
  if (!isCellReportStatus(status)) return { kind: "unknown" };
  if (status === "no_meeting_day") return { kind: "text", label: REPORT_STATUS_TEXTS.noMeetingDay };
  const { parts, tone, icon } = BADGES[status];
  return {
    kind: "badge",
    status,
    label: parts.join(REPORT_STATUS_TEXTS.separator),
    srLabel: parts.join(REPORT_STATUS_TEXTS.separatorSpoken),
    parts,
    tone,
    icon,
  };
}

/** "Enviado", com ou sem a célula realizada (RN-04 a). */
export function isSent(status: CellReportStatus): boolean {
  return status === "sent_held" || status === "sent_not_held";
}

/** O valor que o servidor usa para "4 ou mais" (RN-05). */
const MISSING_WEEKS_CAP = 4;

/**
 * P72: as semanas seguidas, antes desta, sem relatório (RN-05). Nada para 0
 * ou sem contagem; "4 ou mais" a partir de 4.
 */
export function missingWeeksText(weeks: number | null | undefined): string | null {
  if (weeks === null || weeks === undefined || !Number.isInteger(weeks) || weeks < 1) return null;
  if (weeks === 1) return "Sem relatório na semana passada";
  if (weeks >= MISSING_WEEKS_CAP) return "Sem relatório nas 4 ou mais semanas anteriores";
  return `Sem relatório nas ${weeks} semanas anteriores`;
}

/**
 * A linha das semanas de uma célula: só junto de um badge que não seja
 * "Enviado" (P72: com "Enviado", nunca aparece; sem dia da reunião e na
 * célula inativa, também não).
 */
export function missingWeeksLine(display: ReportStatusDisplay, weeks: number | null | undefined): string | null {
  if (display.kind !== "badge" || isSent(display.status)) return null;
  return missingWeeksText(weeks);
}

export interface ReportStatusLegendEntry {
  status: ReportBadgeStatus;
  explanation: string;
}

/** P73: a legenda "Entenda a situação do relatório" (T3, Textos de tela do Negócio, P-SIT-15). */
export const REPORT_STATUS_LEGEND = {
  toggle: "Entenda a situação do relatório",
  statuses: [
    { status: "sent_held", explanation: "O relatório desta semana foi enviado, e a célula se reuniu." },
    { status: "sent_not_held", explanation: "O relatório desta semana foi enviado com \"Não houve célula\"." },
    {
      status: "not_yet",
      explanation: "A reunião desta semana ainda não aconteceu. O relatório fica pendente 1 hora depois do horário da célula.",
    },
    { status: "pending", explanation: "A reunião desta semana já passou e o relatório não foi enviado." },
    {
      status: "next_week",
      explanation:
        "A célula foi cadastrada ou reativada depois da reunião desta semana. O relatório só fica pendente a partir da próxima semana.",
    },
  ] satisfies readonly ReportStatusLegendEntry[],
  weeks: {
    term: "Sem relatório nas semanas anteriores",
    explanation: "Quantas semanas seguidas, antes desta, ficaram sem relatório. Vai até \"4 ou mais\".",
  },
  footer: "A semana vai de domingo a sábado. A situação é a do momento em que a lista foi carregada.",
} as const;

/** Os valores do filtro Situação do relatório na URL (E2.10, PO-UX-1, AQ-1). */
export const REPORT_STATUS_FILTER_OPTIONS = [
  "sent",
  "not_yet",
  "pending",
  "next_week",
  "missed_1",
  "missed_2",
  "missed_3",
  "missed_4plus",
] as const;
export type ReportStatusFilterOption = (typeof REPORT_STATUS_FILTER_OPTIONS)[number];

/** As semanas sem relatório de cada opção do segundo subgrupo (RN-10; 4 = "4 ou mais"). */
export const REPORT_STATUS_FILTER_WEEKS = {
  missed_1: 1,
  missed_2: 2,
  missed_3: 3,
  missed_4plus: 4,
} as const satisfies Partial<Record<ReportStatusFilterOption, number>>;

/**
 * Os códigos do servidor de cada opção da semana. "Enviado" junta os dois (PO-UX-1); "sem dia da
 * reunião" não tem opção (RN-10). Um código novo no enum quebra a compilação até ganhar o mapa.
 */
export const REPORT_STATUS_FILTER_CODES = {
  sent_held: "sent",
  sent_not_held: "sent",
  not_yet: "not_yet",
  pending: "pending",
  next_week: "next_week",
  no_meeting_day: null,
} as const satisfies Record<CellReportStatus, ReportStatusFilterOption | null>;

/** O texto inteiro de cada opção, no chip e no botão do `Popover` (P85, UXD-3): o mesmo da lista. */
export function reportStatusFilterLabel(option: ReportStatusFilterOption): string {
  switch (option) {
    case "sent":
      return BADGES.sent_held.parts[0];
    case "not_yet":
    case "pending":
    case "next_week":
      return BADGES[option].parts[0];
    default:
      return missingWeeksText(REPORT_STATUS_FILTER_WEEKS[option]) ?? option;
  }
}

/** O filtro Situação do relatório (E2.10, T5, P85): rótulo, dica e os dois subgrupos com as opções curtas. */
export const REPORT_STATUS_FILTER = {
  legend: "Situação do relatório",
  hint: "Células inativas não têm situação do relatório.",
  all: "Todas",
  groups: [
    {
      legend: "Nesta semana",
      options: [
        { value: "sent", label: reportStatusFilterLabel("sent") },
        { value: "not_yet", label: reportStatusFilterLabel("not_yet") },
        { value: "pending", label: reportStatusFilterLabel("pending") },
        { value: "next_week", label: reportStatusFilterLabel("next_week") },
      ],
    },
    {
      legend: "Sem relatório nas semanas anteriores",
      options: [
        { value: "missed_1", label: "Na semana passada" },
        { value: "missed_2", label: "Nas 2 semanas anteriores" },
        { value: "missed_3", label: "Nas 3 semanas anteriores" },
        { value: "missed_4plus", label: "Nas 4 ou mais semanas anteriores" },
      ],
    },
  ],
} as const satisfies {
  legend: string;
  hint: string;
  all: string;
  groups: readonly { legend: string; options: readonly { value: ReportStatusFilterOption; label: string }[] }[];
};

/** No detalhe (E2.10, RN-15 f, T10): a frase da célula inativa, no lugar do badge. */
export const REPORT_STATUS_DETAIL_TEXTS = {
  inactive: "Célula inativa: sem situação do relatório.",
} as const;

/** Os valores que têm explicação embaixo do badge no detalhe (T10): "Enviado" não tem. */
const EXPLAINED_IN_DETAIL: ReadonlySet<ReportBadgeStatus> = new Set<ReportBadgeStatus>(["not_yet", "pending", "next_week"]);

/**
 * A explicação embaixo do badge no detalhe (RN-15 f, T10): os textos da
 * legenda do E2.09 para "Ainda não ocorreu", "Pendente" e "Conta a partir da
 * próxima semana". Nulo para os demais.
 */
export function reportStatusExplanation(display: ReportStatusDisplay): string | null {
  if (display.kind !== "badge" || !EXPLAINED_IN_DETAIL.has(display.status)) return null;
  const entry: ReportStatusLegendEntry | undefined = REPORT_STATUS_LEGEND.statuses.find((s) => s.status === display.status);
  return entry?.explanation ?? null;
}
