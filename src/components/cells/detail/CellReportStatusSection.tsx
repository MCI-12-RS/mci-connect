import ReportStatus from "@/components/cells/ReportStatus";
import type { CellListRow } from "@/lib/cells/fields";
import { CELL_DETAIL_TEXTS as TEXTS } from "@/lib/cells/detail-texts";
import { DetailSection } from "./DetailSection";

/**
 * Situação do relatório (RN-15 f, T10): o mesmo componente da lista (P70 a
 * P72), com a explicação embaixo do badge e a frase da célula inativa. Só
 * traduz o código do servidor: nada é calculado aqui.
 */
export const CellReportStatusSection = ({
  cell,
  className,
}: {
  cell: Pick<CellListRow, "report_status" | "report_missing_weeks" | "is_active">;
  className?: string;
}) => (
  <DetailSection title={TEXTS.sections.reportStatus} className={className}>
    <ReportStatus variant="detail" status={cell.report_status} missingWeeks={cell.report_missing_weeks} isActive={cell.is_active} />
  </DetailSection>
);
