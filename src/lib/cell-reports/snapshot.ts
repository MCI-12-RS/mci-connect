// O bloco da célula do relatório (E2.11, P105, T2, T10; RN-14, RN-17): as
// linhas a partir da opção do seletor (a célula de hoje) ou da linha da
// `cell_reports_view` (as pessoas e o tipo registrados; o dia, o horário e o
// endereço atuais). Sem React e sem Supabase.
import { formatG12Label, cellG12 } from "@/lib/cells/labels";
import { personLabel } from "@/lib/members/labels";
import { UNNAMED_MEMBER_LABEL } from "@/lib/members/fields";
import { toHhmm } from "@/lib/time/hhmm";
import { CELL_BLOCK_TEXTS, REPORT_CELL_TEXTS } from "./texts";

/** A situação de uma pessoa que quem consulta vê (`use-member-statuses`); sem ela, só o nome (P11). */
export interface PersonStatus {
  is_active?: boolean | null;
  gender?: string | null;
}

export type StatusOf = (id: string | null | undefined) => PersonStatus | null | undefined;

export interface CellBlockLine {
  label: string;
  value: string;
  /** "—" lido como "nenhum" (`sr-only`), ou "Sem endereço" em `text-muted-foreground`. */
  empty?: "none" | "address";
}

export interface CellBlock {
  lines: CellBlockLine[];
  /** O bloco mostra o retrato: a frase da UXD-11. */
  snapshot: boolean;
}

/** A célula como o seletor e as listas a conhecem (a `cells_view`). */
export interface ReportCellSource {
  id: string;
  leader_id?: string | null;
  leader_name?: string | null;
  timothy_id?: string | null;
  timothy_name?: string | null;
  host_id?: string | null;
  host_name?: string | null;
  type?: string | null;
  meeting_day?: string | null;
  meeting_time?: string | null;
  street?: string | null;
  number?: string | null;
  neighborhood?: string | null;
  g12_leader_name?: string | null;
  leader_g12_level?: number | null;
  leader_is_pastor?: boolean | null;
}

/** O relatório como a edição e o "Ver relatório" o leem (a `cell_reports_view`, com o retrato). */
export interface ReportSnapshotSource {
  snapshot_leader_id?: string | null;
  snapshot_leader_name?: string | null;
  snapshot_timothy_id?: string | null;
  snapshot_timothy_name?: string | null;
  snapshot_host_id?: string | null;
  snapshot_host_name?: string | null;
  snapshot_cell_type?: string | null;
  snapshot_g12_leader_name?: string | null;
  snapshot_leader_g12_level?: number | null;
  snapshot_leader_is_pastor?: boolean | null;
  cell_meeting_day?: string | null;
  cell_meeting_time?: string | null;
  cell_street?: string | null;
  cell_number?: string | null;
  cell_neighborhood?: string | null;
}

/** "Quarta, 20:00" (RN-17). */
export function cellDayTime(day: string | null | undefined, time: string | null | undefined): string {
  return [day, toHhmm(time)].filter(Boolean).join(", ");
}

/** "Rua das Flores, 100 · Centro"; "s/n" sem número; vazio sem nenhuma parte. */
export function cellAddress(street?: string | null, number?: string | null, neighborhood?: string | null): string {
  const streetPart = street ? `${street}, ${number || CELL_BLOCK_TEXTS.noNumber}` : number || "";
  return [streetPart, neighborhood].filter(Boolean).join(" · ");
}

function person(
  label: string,
  id: string | null | undefined,
  name: string | null | undefined,
  statusOf: StatusOf,
): CellBlockLine {
  const status = statusOf(id);
  return { label, value: status ? personLabel({ name, ...status }) : name || UNNAMED_MEMBER_LABEL };
}

function g12Line(parts: Parameters<typeof cellG12>[0]): CellBlockLine {
  const g12 = cellG12(parts);
  return {
    label: CELL_BLOCK_TEXTS.labels.g12,
    value: formatG12Label(parts),
    ...(g12.kind === "none" ? { empty: "none" as const } : {}),
  };
}

function addressLine(street?: string | null, number?: string | null, neighborhood?: string | null): CellBlockLine {
  const address = cellAddress(street, number, neighborhood);
  return address
    ? { label: CELL_BLOCK_TEXTS.labels.address, value: address }
    : { label: CELL_BLOCK_TEXTS.labels.address, value: CELL_BLOCK_TEXTS.noAddress, empty: "address" };
}

const L = CELL_BLOCK_TEXTS.labels;

/** O bloco da célula de hoje (lançamento). */
export function cellBlockFromCell(cell: ReportCellSource, statusOf: StatusOf = () => null): CellBlock {
  return {
    snapshot: false,
    lines: [
      person(L.leader, cell.leader_id, cell.leader_name, statusOf),
      person(L.timothy, cell.timothy_id, cell.timothy_name, statusOf),
      person(L.host, cell.host_id, cell.host_name, statusOf),
      g12Line(cell),
      { label: L.type, value: cell.type ?? "" },
      { label: L.dayTime, value: cellDayTime(cell.meeting_day, cell.meeting_time) },
      addressLine(cell.street, cell.number, cell.neighborhood),
    ],
  };
}

/** O bloco do relatório (edição e "Ver relatório"): o retrato, com o G12 atual do líder registrado (RN-14 c). */
export function cellBlockFromReport(report: ReportSnapshotSource, statusOf: StatusOf = () => null): CellBlock {
  return {
    snapshot: true,
    lines: [
      person(L.leader, report.snapshot_leader_id, report.snapshot_leader_name, statusOf),
      person(L.timothy, report.snapshot_timothy_id, report.snapshot_timothy_name, statusOf),
      person(L.host, report.snapshot_host_id, report.snapshot_host_name, statusOf),
      g12Line({
        g12_leader_name: report.snapshot_g12_leader_name,
        leader_g12_level: report.snapshot_leader_g12_level,
        leader_is_pastor: report.snapshot_leader_is_pastor,
        leader_name: report.snapshot_leader_name,
      }),
      { label: L.type, value: report.snapshot_cell_type ?? "" },
      { label: L.dayTime, value: cellDayTime(report.cell_meeting_day, report.cell_meeting_time) },
      addressLine(report.cell_street, report.cell_number, report.cell_neighborhood),
    ],
  };
}

/** A opção do seletor de célula (RN-17, T2): "{Líder} · {Dia}, {HH:mm}" e "G12: {G12} · {Rua}, {Número} · {Bairro}". */
export function cellOptionLines(cell: ReportCellSource): { title: string; description: string } {
  const title = REPORT_CELL_TEXTS.optionTitle(
    cell.leader_name || REPORT_CELL_TEXTS.noLeader,
    cellDayTime(cell.meeting_day, cell.meeting_time),
  );
  const g12 = `${REPORT_CELL_TEXTS.g12Prefix} ${formatG12Label(cell)}`;
  const description = [g12, cellAddress(cell.street, cell.number, cell.neighborhood)].filter(Boolean).join(" · ");
  return { title, description };
}

/** O líder registrado e o G12 dele na linha da lista de Relatórios (T10, RN-14 d). */
export function reportLeaderLines(report: ReportSnapshotSource): { leader: string | null; g12: string; g12None: boolean } {
  const parts = {
    g12_leader_name: report.snapshot_g12_leader_name,
    leader_g12_level: report.snapshot_leader_g12_level,
    leader_is_pastor: report.snapshot_leader_is_pastor,
    leader_name: report.snapshot_leader_name,
  };
  return { leader: report.snapshot_leader_name ?? null, g12: formatG12Label(parts), g12None: cellG12(parts).kind === "none" };
}
