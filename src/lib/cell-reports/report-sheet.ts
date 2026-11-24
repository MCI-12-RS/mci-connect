// Consulta do relatório ("Ver relatório", E2.01 T7 e UXD-7): quando o painel
// abre e o que ele mostra.
import { getDay, isValid, parseISO } from "date-fns";
import { formatMeetingTime } from "@/lib/cells/labels";
import { WEEKDAYS } from "@/lib/cells/weekdays";
import { leaderLabel } from "@/lib/deletion/targets";
import { CELL_REPORT_SHEET_TEXTS } from "@/lib/deletion/texts";
import { formatCurrency } from "@/lib/format";
import { UNNAMED_MEMBER_LABEL } from "@/lib/members/fields";
import { withSearchParam } from "@/lib/navigation";
import type { CellReportDetail, CellReportDetailRow } from "./fields";
import { formatReportDate } from "./labels";

const TEXTS = CELL_REPORT_SHEET_TEXTS;

/** O parâmetro da URL que abre o painel: `/cell-reports?report=<id>`. */
export const REPORT_PARAM = "report";

/** A lista de células excluídas, para onde o "Ver células excluídas" leva. */
const DELETED_CELLS_PATH = "/cells/deleted";

/**
 * - `closed`: sem parâmetro, ou esperando as permissões (o parâmetro fica na URL);
 * - `open`: o painel abre (carregando, com erro, sem o relatório ou com ele);
 * - `dismiss`: o parâmetro é ignorado e sai da URL.
 */
export type ReportSheetState = "closed" | "open" | "dismiss";

export interface ReportSheetInput {
  /** O `report` da URL. */
  reportId: string | null;
  /** As permissões do usuário já chegaram (`AuthContext`). */
  permissionsLoaded: boolean;
  /** Quem consulta o relatório: `edit_cell_report` (P-DEL-19). */
  canView: boolean;
  /** O relatório lido: `undefined` enquanto carrega (ou se falhou); `null` se ele não veio. */
  detail: CellReportDetail | null | undefined;
  /**
   * A linha desse relatório, na lista da tela, já diz que a célula foi
   * excluída (o "Ver relatório" foi tocado): o painel abre na hora, com o
   * `Skeleton`, sem esperar a leitura.
   */
  knownCellDeleted: boolean;
  /** A leitura do relatório falhou. */
  failed: boolean;
  /**
   * O painel já está aberto para este relatório. Ele continua aberto enquanto
   * lê de novo: no "Tentar de novo", a leitura volta a carregar, sem o erro.
   */
  alreadyOpen: boolean;
}

/**
 * O que fazer com o `report` da URL (Navegação e rotas, PO-UX-3). Ele só abre
 * o painel para quem tem `edit_cell_report` e para relatório de célula
 * excluída; nos demais casos, é ignorado e sai da URL. Enquanto as permissões
 * não chegam, nada é decidido.
 *
 * Quando a tela ainda não sabe se a célula foi excluída (link direto ou
 * recarregar, antes da leitura), o painel espera fechado: abrir e fechar em
 * seguida faria o painel piscar e levaria o foco para a busca. Se a leitura
 * falhar, ele abre com "Tentar de novo".
 *
 * Uma vez aberto para um relatório, o painel só fecha pela pessoa ou quando
 * o parâmetro sai da URL (QA-E201-PR4-1): ler de novo não o fecha.
 *
 * O relatório que não vem (excluído no meio tempo, fora do escopo ou um id
 * que não existe) abre o painel com "Este relatório não existe ou já foi
 * excluído.": a tela não sabe dizer de qual caso se trata.
 */
export function reportSheetState({
  reportId,
  permissionsLoaded,
  canView,
  detail,
  knownCellDeleted,
  failed,
  alreadyOpen,
}: ReportSheetInput): ReportSheetState {
  if (!reportId || !permissionsLoaded) return "closed";
  if (!canView) return "dismiss";
  if (detail) return detail.report.cell_deleted === true ? "open" : "dismiss";
  if (detail === null || knownCellDeleted || failed || alreadyOpen) return "open";
  return "closed";
}

/** O que o painel mostra nos dois casos. */
interface ReportSheetCommon {
  /** "Relatório de 19/11/2026". */
  title: string;
  /** "Célula de Carlos Lima". */
  cellLine: string;
  cellDeleted: boolean;
  /** "/cells/deleted?q=Carlos+Lima": a lista de células excluídas, já buscando o líder. */
  deletedCellsPath: string;
  /** "Quarta, 19/11/2026 às 20:00". */
  dateTime: string;
  observations: string;
}

/** Relatório de célula realizada. */
export interface HeldReportSheetView extends ReportSheetCommon {
  // Um texto, e não `held: boolean`: sem o modo estrito do TypeScript, só o
  // texto separa os dois casos.
  status: "held";
  theme: string;
  /** Todos os participantes, pelo nome, inclusive os excluídos (RN-13), na ordem da consulta (alfabética). */
  participants: string[];
  /** Quantos visitantes têm nome. */
  visitorsCount: number;
  /** "João, Maria", ou "Não informado". */
  visitors: string;
  /** "R$ 50,00", ou "Não informado". */
  offering: string;
}

/** "Não houve célula": a situação e o motivo, sem tema, participantes, visitantes e oferta (T7). */
export interface NotHeldReportSheetView extends ReportSheetCommon {
  status: "notHeld";
  reason: string;
}

export type ReportSheetView = HeldReportSheetView | NotHeldReportSheetView;

/** O texto, ou "Não informado" quando vazio. */
function orNotInformed(value: string | null | undefined): string {
  return value?.trim() || TEXTS.notInformed;
}

/**
 * "Quarta, 19/11/2026 às 20:00". A data e a hora do relatório já são as de
 * Brasília (colunas `date` e `time`, sem fuso): nada é convertido, e o dia
 * não muda com o fuso do navegador.
 */
export function reportDateTime(report: Pick<CellReportDetailRow, "date" | "time">): string {
  const day = report.date ? parseISO(report.date) : null;
  if (!day || !isValid(day)) return TEXTS.notInformed;
  return TEXTS.dateTime(WEEKDAYS[getDay(day)], formatReportDate(report.date), formatMeetingTime(report.time));
}

/** O que o painel mostra de um relatório (T7). */
export function toReportSheetView({ report, participants }: CellReportDetail): ReportSheetView {
  const leader = leaderLabel(report.cell_leader_name);
  const common: ReportSheetCommon = {
    title: report.date ? TEXTS.reportOf(formatReportDate(report.date)) : TEXTS.title,
    cellLine: TEXTS.cellOf(leader),
    cellDeleted: report.cell_deleted === true,
    deletedCellsPath: report.cell_leader_name ? withSearchParam(DELETED_CELLS_PATH, report.cell_leader_name) : DELETED_CELLS_PATH,
    dateTime: reportDateTime(report),
    observations: orNotInformed(report.observations),
  };
  if (report.was_held !== true) return { ...common, status: "notHeld", reason: orNotInformed(report.reason_not_held) };

  const visitors = (report.visitors ?? []).map((name) => name.trim()).filter(Boolean);
  return {
    ...common,
    status: "held",
    theme: orNotInformed(report.theme),
    participants: participants.map((p) => p.member_name?.trim() || UNNAMED_MEMBER_LABEL),
    visitorsCount: visitors.length,
    visitors: visitors.length > 0 ? visitors.join(", ") : TEXTS.notInformed,
    offering: report.offering === null || report.offering === undefined ? TEXTS.notInformed : formatCurrency(report.offering),
  };
}
