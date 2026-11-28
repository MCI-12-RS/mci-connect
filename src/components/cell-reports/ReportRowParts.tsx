import { CellDeletedBadge, ReportMeetingBadge } from "@/components/StatusBadges";
import type { ReportRowView } from "@/lib/cell-reports/report-row";
import { REPORT_ROW_TEXTS as TEXTS } from "@/lib/cell-reports/filter-texts";

/** "G12: Pedro Alves", "G12: Pastores" ou "G12: —", com o "—" lido como "nenhum". */
export const ReportG12 = ({ row }: { row: ReportRowView }) =>
  row.g12.none ? (
    <>
      {TEXTS.g12Label} <span aria-hidden="true">{TEXTS.none}</span>
      <span className="sr-only">{TEXTS.noneSpoken}</span>
    </>
  ) : (
    <>{TEXTS.g12(row.g12.text)}</>
  );

/** "Qua, 18/11/2026", com o dia inteiro para o leitor de tela (UXD-15). */
export const ReportDay = ({ row }: { row: ReportRowView }) => (
  <>
    {row.date.dayShort && (
      <>
        <span aria-hidden="true">{row.date.dayShort}, </span>
        <span className="sr-only">{row.date.dayFull}, </span>
      </>
    )}
    {row.date.date}
  </>
);

/** O endereço atual, ou "Sem endereço". */
export const ReportAddress = ({ row }: { row: ReportRowView }) => <>{row.address ?? TEXTS.noAddress}</>;

/** "Célula excluída" (E2.01) e o badge da reunião. */
export const ReportBadges = ({ row }: { row: ReportRowView }) => (
  <div className="flex flex-wrap gap-2">
    {row.cellDeleted && <CellDeletedBadge />}
    <ReportMeetingBadge held={row.held} />
  </div>
);

/** "Tema: …" ou "Motivo: …", até 3 linhas na lista; o texto inteiro fica no DOM (UXD-6). */
export const ReportText = ({ row }: { row: ReportRowView }) =>
  row.text && (
    <p className="line-clamp-3 break-words text-sm">
      <span className="text-muted-foreground">{row.text.label}</span> {row.text.value}
    </p>
  );
