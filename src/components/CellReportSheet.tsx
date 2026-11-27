import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Info } from "lucide-react";
import { CellDeletedBadge, HeldStatusBadge } from "@/components/StatusBadges";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useCellReport } from "@/hooks/use-cell-report";
import { toReportSheetView, type ReportSheetView } from "@/lib/cell-reports/report-sheet";
import type { CellReportDetailRow } from "@/lib/cell-reports/fields";
import { formatIsoDateBr } from "@/lib/dates/sao-paulo";
import { RecordAuthorship } from "@/components/RecordAuthorship";
import { SheetCloseButton } from "@/components/SheetCloseButton";
import { CELL_REPORT_DELETION_TEXTS, CELL_REPORT_SHEET_TEXTS } from "@/lib/deletion/texts";

// Painel de consulta de um relatório ("Ver relatório", E2.01 T7 e UXD-7). Só
// de leitura: neste passo, abre só para o relatório de célula excluída, que
// não é editado (RN-11). O "Editar relatório" do rodapé fica para o E2.12.

const TEXTS = CELL_REPORT_SHEET_TEXTS;

/** Linhas do carregamento ("Estados": `Skeleton` do cabeçalho e de 6 linhas). */
const SKELETON_LINES = 6;

const SKELETON = "motion-reduce:animate-none";

/** O "✕" do painel (44×44 px; no celular, o painel ocupa a tela, e só ele fecha). */
const CloseButton = () => <SheetCloseButton label={TEXTS.close} />;

/** Um campo do relatório: o nome e o valor. */
const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="space-y-1">
    <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
    <dd className="whitespace-pre-line break-words">{children}</dd>
  </div>
);

const Loading = () => (
  <div aria-busy="true">
    <SheetHeader className="space-y-2 pr-12 text-left">
      <SheetTitle className="sr-only">{TEXTS.title}</SheetTitle>
      <Skeleton className={`h-6 w-48 ${SKELETON}`} />
      <Skeleton className={`h-4 w-40 ${SKELETON}`} />
      <Skeleton className={`h-5 w-32 ${SKELETON}`} />
    </SheetHeader>
    <div className="mt-6 space-y-4">
      {Array.from({ length: SKELETON_LINES }, (_, i) => (
        <Skeleton key={i} className={`h-10 w-full ${SKELETON}`} />
      ))}
    </div>
    <span className="sr-only">{TEXTS.loading}</span>
  </div>
);

const LoadError = ({ onRetry }: { onRetry: () => void }) => (
  <>
    <SheetHeader className="pr-12 text-left">
      <SheetTitle>{TEXTS.title}</SheetTitle>
    </SheetHeader>
    <Alert variant="destructive" className="mt-4">
      <AlertCircle className="h-4 w-4" aria-hidden="true" />
      <AlertDescription className="space-y-3 text-foreground">
        <p>{TEXTS.loadFailed}</p>
        <Button type="button" variant="outline" className="h-11 md:h-9" onClick={onRetry}>
          {TEXTS.tryAgain}
        </Button>
      </AlertDescription>
    </Alert>
  </>
);

/** O relatório não veio: excluído no meio tempo, fora do escopo ou inexistente ("Estados"). */
const NotFound = () => (
  <>
    <SheetHeader className="pr-12 text-left">
      <SheetTitle>{TEXTS.title}</SheetTitle>
      <SheetDescription className="text-foreground">{CELL_REPORT_DELETION_TEXTS.notFoundOrDeleted}</SheetDescription>
    </SheetHeader>
    <SheetClose asChild>
      <Button type="button" variant="outline" className="mt-6 h-11 md:h-9">
        {TEXTS.close}
      </Button>
    </SheetClose>
  </>
);

interface ReportDetailsProps {
  view: ReportSheetView;
  report: CellReportDetailRow;
  canSeeDeletedCells: boolean;
}

const ReportDetails = ({ view, report, canSeeDeletedCells }: ReportDetailsProps) => (
  <>
    <SheetHeader className="space-y-1 pr-12 text-left">
      <SheetTitle>{view.title}</SheetTitle>
      <SheetDescription>{view.cellLine}</SheetDescription>
      {view.cellDeleted && <CellDeletedBadge className="!mt-2" />}
    </SheetHeader>

    {/* Por que não há "Editar" (RN-11). Uma nota, e não um alerta: não é um erro. */}
    {view.cellDeleted && (
      <Alert role="note" className="mt-4">
        <Info className="h-4 w-4" aria-hidden="true" />
        <AlertDescription className="space-y-3">
          <p>{CELL_REPORT_DELETION_TEXTS.editCellDeleted}</p>
          {canSeeDeletedCells && (
            <Button asChild variant="outline" className="h-auto min-h-11 whitespace-normal md:min-h-9">
              <Link to={view.deletedCellsPath}>{TEXTS.seeDeletedCells}</Link>
            </Button>
          )}
        </AlertDescription>
      </Alert>
    )}

    {/* A autoria depois do cabeçalho e do aviso, antes de "Data e hora" (E2.05, T4 e P30). */}
    {report.id && (
      <div className="mt-4">
        <RecordAuthorship
          entity="cell_report"
          recordId={report.id}
          recordName={report.date ? formatIsoDateBr(report.date) : ""}
          authorship={{
            created_at: report.created_at,
            created_by_kind: report.created_by_kind,
            created_by_name: report.created_by_name,
            updated_at: report.updated_at,
            updated_by_kind: report.updated_by_kind,
            updated_by_name: report.updated_by_name,
          }}
        />
      </div>
    )}

    <dl className="mt-4 space-y-4 text-sm">
      <Field label={TEXTS.fields.dateTime}>{view.dateTime}</Field>
      <Field label={TEXTS.fields.status}>
        <HeldStatusBadge held={view.status === "held"} />
      </Field>
      {view.status === "held" ? (
        <>
          <Field label={TEXTS.fields.theme}>{view.theme}</Field>
          <Field label={TEXTS.participants(view.participants.length)}>
            {view.participants.length > 0 ? (
              <ul className="space-y-2">
                {view.participants.map((name, index) => (
                  // A lista não muda enquanto o painel está aberto; nomes podem se repetir.
                  <li key={index}>{name}</li>
                ))}
              </ul>
            ) : (
              TEXTS.noMembers
            )}
          </Field>
          <Field label={TEXTS.visitors(view.visitorsCount)}>{view.visitors}</Field>
          <Field label={TEXTS.fields.offering}>{view.offering}</Field>
        </>
      ) : (
        <Field label={TEXTS.fields.reason}>{view.reason}</Field>
      )}
      <Field label={TEXTS.fields.observations}>{view.observations}</Field>
    </dl>
  </>
);

export interface CellReportSheetProps {
  /** O relatório a ler e mostrar; `null` fecha o painel. */
  reportId: string | null;
  /**
   * Se o painel aparece; por padrão, sempre que há `reportId`. Com `false`, o
   * painel lê o relatório sem aparecer: a tela que decide pela leitura se ele
   * abre (Relatórios, com o `?report=` da URL) lê junto com ele, uma vez só.
   */
  open?: boolean;
  onClose: () => void;
  /**
   * Ao fechar, a tela devolve o foco (`useReturnFocus`). Recebe o relatório
   * que o painel mostrava, para achar o "Ver relatório" da linha dele.
   */
  onCloseAutoFocus?: (event: Event, reportId: string | null) => void;
  /** "Ver células excluídas": só para o administrador (`manage_roles`). */
  canSeeDeletedCells: boolean;
}

/**
 * O `Sheet` "Relatório" (T7): à direita, com a largura toda abaixo de 640 px
 * (UX-27). Mostra a data e a hora, a situação, o tema (ou o motivo), os
 * participantes pelo nome, inclusive os excluídos, os visitantes, a oferta e
 * as observações, com os estados de carregando, erro e relatório que sumiu.
 */
const CellReportSheet = ({ reportId, open = reportId !== null, onClose, onCloseAutoFocus, canSeeDeletedCells }: CellReportSheetProps) => {
  // Ao fechar, o painel continua com o último relatório durante a animação de
  // saída. Fechado, não consulta mais (nem quando a lista recarrega).
  const [shownId, setShownId] = useState(reportId);
  if (reportId !== null && reportId !== shownId) setShownId(reportId);
  const query = useCellReport(shownId, { enabled: reportId !== null });
  const contentRef = useRef<HTMLDivElement>(null);
  // O erro em que a pessoa tocou "Tentar de novo". O carregando aparece no
  // toque: a consulta só avisa depois que voltou a carregar, e até lá o erro
  // antigo e o botão continuariam na tela. Uma nova falha é outro erro.
  const [retriedError, setRetriedError] = useState<unknown>(null);

  let body: ReactNode;
  // Só o relatório carregado e o "não existe" têm descrição (o Radix avisa se ela faltar).
  let hasDescription = true;
  if (query.data) {
    body = <ReportDetails view={toReportSheetView(query.data)} report={query.data.report} canSeeDeletedCells={canSeeDeletedCells} />;
  } else if (query.data === null) {
    body = <NotFound />;
  } else if (query.isError && query.error !== retriedError) {
    // O "Tentar de novo" sai da tela: o foco passa para o painel antes, para não cair no `body`.
    const retry = () => {
      setRetriedError(query.error);
      contentRef.current?.focus();
      void query.refetch();
    };
    body = <LoadError onRetry={retry} />;
    hasDescription = false;
  } else {
    body = <Loading />;
    hasDescription = false;
  }

  return (
    <Sheet open={open && reportId !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        ref={contentRef}
        side="right"
        // `[&>button:last-child]:hidden` esconde o "✕" do `SheetContent`, que é o último filho (ver `CloseButton`).
        className="w-full overflow-y-auto p-4 outline-none motion-reduce:!animate-none sm:max-w-lg sm:p-6 [&>button:last-child]:hidden"
        // O foco vai para o painel, que o leitor de tela anuncia pelo título, e
        // não para o primeiro link ("Ver células excluídas").
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => onCloseAutoFocus?.(event, shownId)}
        {...(hasDescription ? {} : { "aria-describedby": undefined })}
      >
        <CloseButton />
        {body}
      </SheetContent>
    </Sheet>
  );
};

export default CellReportSheet;
