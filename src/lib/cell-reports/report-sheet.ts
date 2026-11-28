// A consulta "Ver relatório" (E2.12, T10 a T13; P92; RN-16 e RN-17): o parâmetro da URL, como fechar,
// o que o painel mostra (com a prévia da linha da lista, T12) e as ações. Sem React e sem Supabase.

import { addressLines, weekdayOfDate } from "@/lib/cells/detail";
import { formatG12Label, cellG12, formatMeetingTime } from "@/lib/cells/labels";
import { formatIsoDateBr } from "@/lib/dates/sao-paulo";
import { leaderLabel } from "@/lib/deletion/targets";
import { isUuid } from "@/lib/ids";
import { UNNAMED_MEMBER_LABEL } from "@/lib/members/fields";
import { withSearchParam } from "@/lib/navigation";
import type { CellReportDetailRow, CellReportListRow } from "./fields";
import { cellIdentityChipText, REPORT_PARAM } from "./filters";
import { formatOffering } from "./labels";
import { REPORT_SHEET_TEXTS as TEXTS } from "./texts";

export { REPORT_PARAM };

/** A lista de células excluídas, para onde o "Ver células excluídas" leva. */
const DELETED_CELLS_PATH = "/cells/deleted";

/** O `report` da URL, só com o formato de id; o inválido sai na limpeza dos filtros (`parseCellReportFilters`). */
export function readReportParam(params: URLSearchParams): string | null {
  const raw = params.get(REPORT_PARAM);
  return raw !== null && isUuid(raw) ? raw : null;
}

/** O estado da navegação que a lista põe ao abrir a consulta pela linha (AQ-8) e a edição por cima dela (DA-11). */
export interface ReportSheetLocationState {
  reportFromList?: boolean;
  reportEdit?: boolean;
}

/** Aberta pela linha? (o estado da navegação traz `reportFromList`). */
export function openedFromList(state: unknown): boolean {
  return typeof state === "object" && state !== null && "reportFromList" in state && state.reportFromList === true;
}

/** A entrada do histórico de "Editar relatório" aberto pela consulta (DA-11): o estado traz `reportEdit`. */
export function onReportEditEntry(state: unknown): boolean {
  return typeof state === "object" && state !== null && "reportEdit" in state && state.reportEdit === true;
}

/**
 * Como fechar (AQ-8): `back` quando a consulta foi aberta pela linha (volta a entrada que ela criou);
 * `replace` quando veio por link (tira o `report` sem mexer no histórico).
 */
export function closeMode(state: unknown): "back" | "replace" {
  return openedFromList(state) ? "back" : "replace";
}

/** "Quarta, 18/11/2026 às 20:00": a data e a hora do relatório já são as de Brasília. */
export function reportSheetDateTime(date: string | null, time: string | null): string {
  if (!date) return "";
  return TEXTS.dateTime(weekdayOfDate(date), formatIsoDateBr(date), formatMeetingTime(time));
}

export interface SheetLine {
  label: string;
  value: string;
  /** "—" lido como "nenhum" (`sr-only`). */
  none?: boolean;
}

/** O que a consulta mostra (T10). Os campos `null` ainda não chegaram (`Skeleton`, T12). */
export interface ReportSheetView {
  /** "Relatório de 18/11/2026". */
  title: string;
  /** "18/11/2026", para os nomes acessíveis. */
  dateBr: string;
  /** "Célula de André Souza · Quarta · 20:00", com os dados atuais da célula (P-LRE-22). */
  cellLine: string;
  held: boolean;
  cellDeleted: boolean;
  /** O líder atual, nos nomes acessíveis dos links ("Ver a célula de …"). */
  cellLeader: string;
  deletedCellsPath: string;
  meeting: {
    /** "Data e horário" ou, em "Não houve célula", "Reunião prevista". */
    dateLabel: string;
    dateTime: string;
    theme: string | null;
    reason: string | null;
    offering: string | null;
    observations: string | null;
    /** O número que a linha já tem, para reservar a altura dos nomes (AQ-6). */
    participantsCount: number;
    /** Na ordem registrada, só os com nome. */
    visitors: string[];
  };
  /** Pessoas da célula (o retrato) e o tipo registrado; `null` até a leitura chegar. */
  people: SheetLine[] | null;
  /** O endereço atual em até quatro linhas (vazio: "Sem endereço"); `null` até a leitura chegar. */
  address: string[] | null;
}

const trimmed = (value: string | null | undefined): string | null => value?.trim() || null;

/**
 * O que a consulta mostra (T10, T12): com a leitura por id, tudo; só com a linha da lista, o topo e o
 * conteúdo do relatório, e as pessoas e o endereço completo ficam para a leitura. Em "Não houve
 * célula", só o motivo e as observações (P-LRE-34), mesmo que o legado traga mais.
 */
export function toReportSheetView(
  detail: CellReportDetailRow | null | undefined,
  preview: CellReportListRow | null | undefined,
): ReportSheetView | null {
  const source: CellReportListRow | null = detail ?? preview ?? null;
  if (!source) return null;
  const held = source.was_held === true;
  const dateBr = source.date ? formatIsoDateBr(source.date) : "";
  const cellLeader = leaderLabel(source.cell_leader_name);
  const visitors = held ? (source.visitors ?? []).map((name) => name.trim()).filter(Boolean) : [];
  return {
    title: dateBr ? TEXTS.reportOf(dateBr) : TEXTS.title,
    dateBr,
    cellLine: cellIdentityChipText({
      leader_name: source.cell_leader_name,
      meeting_day: source.cell_meeting_day,
      meeting_time: source.cell_meeting_time,
    }),
    held,
    cellDeleted: source.cell_deleted === true,
    cellLeader,
    deletedCellsPath: source.cell_leader_name ? withSearchParam(DELETED_CELLS_PATH, source.cell_leader_name) : DELETED_CELLS_PATH,
    meeting: {
      dateLabel: held ? TEXTS.fields.dateTime : TEXTS.fields.plannedMeeting,
      dateTime: reportSheetDateTime(source.date, source.time),
      theme: held ? trimmed(source.theme) : null,
      reason: held ? null : trimmed(source.reason_not_held),
      offering: held ? formatOffering(source.offering) : null,
      observations: trimmed(source.observations),
      participantsCount: held ? (source.participants_count ?? 0) : 0,
      visitors,
    },
    people: detail ? peopleLines(detail) : null,
    address: detail
      ? addressLines({
          street: detail.cell_street,
          number: detail.cell_number,
          complement: detail.cell_complement,
          neighborhood: detail.cell_neighborhood,
          city: detail.cell_city,
          state: detail.cell_state,
          zip_code: detail.cell_zip_code,
        })
      : null,
  };
}

/** Líder, Timóteo e Anfitrião do retrato, o G12 atual do líder registrado e o tipo registrado (UXD-12). */
function peopleLines(detail: CellReportDetailRow): SheetLine[] {
  const L = TEXTS.peopleLabels;
  const g12Parts = {
    g12_leader_name: detail.snapshot_g12_leader_name,
    leader_g12_level: detail.snapshot_leader_g12_level,
    leader_is_pastor: detail.snapshot_leader_is_pastor,
    leader_name: detail.snapshot_leader_name,
  };
  const name = (value: string | null) => value?.trim() || UNNAMED_MEMBER_LABEL;
  return [
    { label: L.leader, value: name(detail.snapshot_leader_name) },
    { label: L.timothy, value: name(detail.snapshot_timothy_name) },
    { label: L.host, value: name(detail.snapshot_host_name) },
    { label: L.g12, value: formatG12Label(g12Parts), none: cellG12(g12Parts).kind === "none" },
    { label: L.type, value: detail.snapshot_cell_type ?? "" },
  ];
}

const PT_BR_BASE = new Intl.Collator("pt-BR", { sensitivity: "base" });

/** Um participante como a consulta o mostra: o nome e o id (desempate da ordem). */
export interface SheetParticipant {
  member_id: string | null;
  member_name: string | null;
}

/** Os nomes dos participantes, sem diferenciar acentos, e o id no empate (DA-8). O excluído aparece igual. */
export function sortParticipantNames(participants: readonly SheetParticipant[]): string[] {
  return [...participants]
    .map((p) => ({ id: p.member_id ?? "", name: p.member_name?.trim() || UNNAMED_MEMBER_LABEL }))
    .sort((a, b) => PT_BR_BASE.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((p) => p.name);
}

/** As permissões de quem consulta que decidem as ações. */
export type HasPermission = (permission: "edit_cell_report" | "delete_cell_report" | "manage_roles") => boolean;

export interface ReportSheetActions {
  /** "Editar relatório": "Editar Relatórios de Células" e a célula não excluída (RN-16 c). */
  edit: boolean;
  /** "Excluir relatório": "Excluir Relatórios de Células". */
  delete: boolean;
  /** "Ver célula": quem consulta vê a célula, e ela não foi excluída (DA-9). */
  viewCell: boolean;
  /** "Ver células excluídas", no aviso da célula excluída: só para quem restaura. */
  seeDeletedCells: boolean;
  /** "Ver todos os relatórios desta célula": sempre, com a célula. */
  cellId: string | null;
}

/** Onde a consulta abre: na lista de Relatórios ou no detalhe da própria célula (T14, sem "Ver célula"). */
export type ReportSheetContext = "list" | "cell";

/** As ações da consulta, só com a leitura por id (antes dela, nenhuma: T12). */
export function reportSheetActions(
  has: HasPermission,
  detail: CellReportDetailRow,
  context: ReportSheetContext = "list",
): ReportSheetActions {
  const cellDeleted = detail.cell_deleted === true;
  return {
    edit: has("edit_cell_report") && !cellDeleted,
    delete: has("delete_cell_report"),
    viewCell: context === "list" && detail.cell_visible === true && !cellDeleted,
    seeDeletedCells: has("manage_roles"),
    cellId: detail.cell_id,
  };
}
