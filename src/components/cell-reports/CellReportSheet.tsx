import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ArrowRight, Info, Pencil, Trash2 } from "lucide-react";
import { NameList } from "@/components/NameList";
import { RecordAuthorship } from "@/components/RecordAuthorship";
import { RecordSheet } from "@/components/RecordSheet";
import RowActionsMenu from "@/components/RowActionsMenu";
import { CellDeletedBadge, ReportMeetingBadge } from "@/components/StatusBadges";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useCellReport } from "@/hooks/use-cell-report";
import { useCellReportParticipants } from "@/hooks/use-cell-report-participants";
import type { CellReportDetailRow, CellReportListRow } from "@/lib/cell-reports/fields";
import { cellReportListHref } from "@/lib/cell-reports/filters";
import {
  reportSheetActions,
  sortParticipantNames,
  toReportSheetView,
  type ReportSheetActions,
  type ReportSheetContext,
  type ReportSheetView,
} from "@/lib/cell-reports/report-sheet";
import { REPORT_SHEET_TEXTS as TEXTS } from "@/lib/cell-reports/texts";
import { REPORT_ROW_TEXTS } from "@/lib/cell-reports/filter-texts";
import { cellDetailPath } from "@/lib/cells/detail";
import { toCellReportDeletionTarget, type CellReportDeletionTarget } from "@/lib/deletion/targets";

const SKELETON = "motion-reduce:animate-none";
const LINK_BUTTON = "h-auto min-h-11 w-full justify-between gap-2 whitespace-normal text-left sm:w-auto";

/** Um campo do relatório (`dt` e `dd`), que quebra linha sem cortar. */
const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="space-y-0.5">
    <dt className="text-sm text-muted-foreground">{label}</dt>
    <dd className="whitespace-pre-line break-words text-foreground">{children}</dd>
  </div>
);

/** "Célula de André Souza · Quarta · 20:00", com os "·" fora do leitor de tela. */
const CellLine = ({ text }: { text: string }) => (
  <p className="break-words text-sm text-muted-foreground">
    {text.split(" · ").map((part, index) => (
      <span key={index}>
        {index > 0 && <span aria-hidden="true"> · </span>}
        {index > 0 && <span className="sr-only">, </span>}
        {part}
      </span>
    ))}
  </p>
);

/** O relatório por link, ainda sem leitura: o corpo inteiro em `Skeleton` (T12). */
const LoadingBody = () => (
  <div aria-busy="true" className="space-y-4">
    <Skeleton className={`h-4 w-56 ${SKELETON}`} />
    <Skeleton className={`h-6 w-36 ${SKELETON}`} />
    {Array.from({ length: 6 }, (_, index) => (
      <Skeleton key={index} className={`h-10 w-full ${SKELETON}`} />
    ))}
    <span className="sr-only">{TEXTS.loading}</span>
  </div>
);

const LoadError = ({ onRetry }: { onRetry: () => void }) => (
  <Alert variant="destructive">
    <AlertCircle className="h-4 w-4" aria-hidden="true" />
    <AlertDescription className="space-y-3 text-foreground">
      <p>{TEXTS.loadFailed}</p>
      <Button type="button" variant="outline" className="h-11 md:h-9" onClick={onRetry}>
        {TEXTS.tryAgain}
      </Button>
    </AlertDescription>
  </Alert>
);

interface ParticipantsProps {
  count: number;
  names: string[] | undefined;
  failed: boolean;
  onRetry: () => void;
}

/** Os participantes pelo nome (P94), com a altura reservada pelo número da linha enquanto carregam (AQ-6). */
const Participants = ({ count, names, failed, onRetry }: ParticipantsProps) => {
  const heading = TEXTS.participants(names?.length ?? count);
  if (names) return <NameList heading={heading} names={names} emptyText={TEXTS.noMembers} />;
  return (
    <section className="space-y-1">
      <h3 className="text-sm font-medium">{heading}</h3>
      {failed ? (
        <div className="space-y-1 text-sm">
          <p>{TEXTS.participantsLoadFailed}</p>
          <Button type="button" variant="link" className="h-auto min-h-11 px-0" onClick={onRetry}>
            {TEXTS.tryAgain}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5" aria-busy="true">
          {Array.from({ length: Math.max(1, count) }, (_, index) => (
            <Skeleton key={index} className={`h-4 w-28 ${SKELETON}`} />
          ))}
        </div>
      )}
    </section>
  );
};

interface ReportContentProps {
  view: ReportSheetView;
  detail: CellReportDetailRow | null;
  actions: ReportSheetActions | null;
  canSeeDeletedCells: boolean;
  participants: ParticipantsProps;
}

/** O corpo da consulta (T10, UXD-8): o topo, o relatório, as pessoas da célula e o endereço. */
const ReportContent = ({ view, detail, actions, canSeeDeletedCells, participants }: ReportContentProps) => (
  <div className="space-y-4">
    <div className="flex flex-wrap gap-2">
      <ReportMeetingBadge held={view.held} />
      {view.cellDeleted && <CellDeletedBadge />}
    </div>

    {view.cellDeleted && (
      <Alert role="note">
        <Info className="h-4 w-4" aria-hidden="true" />
        <AlertDescription className="space-y-3">
          <p>{TEXTS.cellDeletedNote}</p>
          {canSeeDeletedCells && (
            <Button asChild variant="outline" className="h-auto min-h-11 whitespace-normal md:min-h-9">
              <Link to={view.deletedCellsPath}>{TEXTS.seeDeletedCells}</Link>
            </Button>
          )}
        </AlertDescription>
      </Alert>
    )}

    {detail?.id ? (
      <RecordAuthorship
        entity="cell_report"
        recordId={detail.id}
        recordName={view.dateBr}
        authorship={{
          created_at: detail.created_at,
          created_by_kind: detail.created_by_kind,
          created_by_name: detail.created_by_name,
          updated_at: detail.updated_at,
          updated_by_kind: detail.updated_by_kind,
          updated_by_name: detail.updated_by_name,
        }}
      />
    ) : (
      <>
        <Skeleton className={`h-5 w-64 ${SKELETON}`} aria-hidden="true" />
        <Separator />
      </>
    )}

    <section className="space-y-3">
      <h3 className="font-semibold">{TEXTS.sections.meeting}</h3>
      <dl className="space-y-3 text-sm">
        <Field label={view.meeting.dateLabel}>{view.meeting.dateTime}</Field>
        {view.held && view.meeting.theme && <Field label={TEXTS.fields.theme}>{view.meeting.theme}</Field>}
        {!view.held && view.meeting.reason && <Field label={TEXTS.fields.reason}>{view.meeting.reason}</Field>}
      </dl>
      {view.held && (
        <>
          <Participants {...participants} />
          <NameList heading={TEXTS.visitors(view.meeting.visitors.length)} names={view.meeting.visitors} emptyText={TEXTS.noVisitors} />
        </>
      )}
      <dl className="space-y-3 text-sm">
        {view.held && view.meeting.offering && <Field label={TEXTS.fields.offering}>{view.meeting.offering}</Field>}
        {view.meeting.observations && <Field label={TEXTS.fields.observations}>{view.meeting.observations}</Field>}
      </dl>
    </section>

    <Separator />

    <section className="space-y-2">
      <h3 className="font-semibold">{TEXTS.sections.people}</h3>
      <p className="text-sm text-muted-foreground">{TEXTS.peopleHint}</p>
      {view.people ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {view.people.map((line) => (
            <div key={line.label} className="contents">
              <dt className="text-muted-foreground">{line.label}</dt>
              <dd className="min-w-0 break-words">
                {line.none ? (
                  <>
                    <span aria-hidden="true">{line.value}</span>
                    <span className="sr-only">{REPORT_ROW_TEXTS.noneSpoken}</span>
                  </>
                ) : (
                  line.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="space-y-1.5" aria-busy="true">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className={`h-4 w-48 ${SKELETON}`} />
          ))}
        </div>
      )}
    </section>

    <Separator />

    <section className="space-y-2">
      <h3 className="font-semibold">{TEXTS.sections.address}</h3>
      {view.address ? (
        view.address.length > 0 ? (
          <address className="text-sm not-italic">
            {view.address.map((line) => (
              <p key={line} className="break-words">
                {line}
              </p>
            ))}
          </address>
        ) : (
          <p className="text-sm text-muted-foreground">{TEXTS.noAddress}</p>
        )
      ) : (
        <div className="space-y-1.5" aria-busy="true">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className={`h-4 w-52 ${SKELETON}`} />
          ))}
        </div>
      )}
      {actions && (
        <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap">
          {actions.viewCell && actions.cellId && (
            <Button asChild variant="outline" className={LINK_BUTTON}>
              <Link to={cellDetailPath(actions.cellId)} aria-label={TEXTS.viewCellLabel(view.cellLeader)}>
                {TEXTS.viewCell}
                <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
              </Link>
            </Button>
          )}
          {actions.cellId && (
            <Button asChild variant="outline" className={LINK_BUTTON}>
              <Link to={cellReportListHref({ cellId: actions.cellId })} aria-label={TEXTS.viewAllReportsLabel(view.cellLeader)}>
                {TEXTS.viewAllReports}
                <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
              </Link>
            </Button>
          )}
        </div>
      )}
    </section>
  </div>
);

interface FooterProps {
  actions: ReportSheetActions;
  dateBr: string;
  onEdit: (opener: HTMLElement) => void;
  onDelete: (opener: HTMLElement | null) => void;
}

/**
 * O rodapé fixo (UXD-9): abaixo de 768 px, "Editar relatório" e o "⋯" com "Excluir relatório" (ou só
 * "Excluir relatório" com texto, quando é a única ação); a partir daí, os dois com texto. Cada tamanho
 * esconde o do outro (`display: none`), para o leitor de tela não achar a mesma ação duas vezes (P80).
 */
const SheetFooter = ({ actions, dateBr, onEdit, onDelete }: FooterProps) => {
  const deleteButton = (className: string) => (
    <Button type="button" variant="outline" className={className} onClick={(event) => onDelete(event.currentTarget)}>
      <Trash2 className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
      {TEXTS.deleteReport}
    </Button>
  );
  const editButton = (className: string) => (
    <Button type="button" className={className} onClick={(event) => onEdit(event.currentTarget)}>
      <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
      {TEXTS.editReport}
    </Button>
  );
  return (
    <>
      <div className="flex items-center gap-2 md:hidden">
        {actions.edit ? (
          <>
            {editButton("h-auto min-h-11 min-w-0 flex-1 whitespace-normal")}
            {actions.delete && (
              <RowActionsMenu
                label={TEXTS.actionsLabel(dateBr)}
                actions={[{ label: TEXTS.deleteReport, icon: Trash2, onSelect: (trigger) => onDelete(trigger) }]}
              />
            )}
          </>
        ) : (
          actions.delete && deleteButton("h-11 w-full")
        )}
      </div>
      <div className="hidden items-center justify-between gap-2 md:flex">
        {actions.delete ? deleteButton("h-10") : <span />}
        {actions.edit && editButton("h-10")}
      </div>
    </>
  );
};

export interface CellReportSheetProps {
  /** O relatório da URL; `null` fecha a consulta. */
  reportId: string | null;
  /** A linha da lista, se a consulta foi aberta por ela: o topo aparece na hora (T12). */
  preview: CellReportListRow | null;
  onClose: () => void;
  /** Ao fechar, a tela devolve o foco: ao botão da linha ou ao `h1` (recebe o relatório mostrado). */
  onCloseAutoFocus: (event: Event, reportId: string | null) => void;
  /** "Editar relatório": o formulário abre por cima da consulta (UXD-10). */
  onEdit: (reportId: string, opener: HTMLElement) => void;
  /** "Excluir relatório": a confirmação do E2.01 por cima da consulta. */
  onDelete: (target: CellReportDeletionTarget, opener: HTMLElement | null) => void;
  /** No detalhe da célula (T14), sem "Ver célula": a pessoa já está nela. */
  context?: ReportSheetContext;
}

/**
 * A consulta "Ver relatório" (E2.12, T10 a T13; P92): para todos que veem o relatório, com a autoria,
 * os participantes e os visitantes pelo nome, as pessoas registradas, o endereço atual, os links da
 * célula e, no rodapé, editar e excluir. "Relatório não encontrado" único para o invisível, o
 * excluído e o inexistente, sem nenhum dado do relatório. A mesma consulta abre no detalhe da célula
 * (T14, `context="cell"`), sem "Ver célula".
 */
export function CellReportSheet({
  reportId,
  preview,
  onClose,
  onCloseAutoFocus,
  onEdit,
  onDelete,
  context = "list",
}: CellReportSheetProps) {
  const { hasPermission } = useAuth();
  const open = reportId !== null;
  // Ao fechar, o painel continua com o último relatório durante a animação de saída, sem ler de novo.
  const [shownId, setShownId] = useState(reportId);
  if (reportId !== null && reportId !== shownId) setShownId(reportId);
  const [shownPreview, setShownPreview] = useState(preview);
  if (open && preview !== null && preview !== shownPreview) setShownPreview(preview);

  const detailQuery = useCellReport(shownId, { enabled: open });
  const participantsQuery = useCellReportParticipants(shownId, { enabled: open });
  // Durante a saída, o corpo fica com o último relatório lido: excluir pela consulta tira o
  // relatório do cache, e o painel não pisca para o carregando enquanto fecha.
  const [shownDetail, setShownDetail] = useState(detailQuery.data);
  if (open && detailQuery.data !== shownDetail) setShownDetail(detailQuery.data);
  const [shownParticipants, setShownParticipants] = useState(participantsQuery.data);
  if (open && participantsQuery.data !== shownParticipants) setShownParticipants(participantsQuery.data);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // O erro em que a pessoa tocou "Tentar de novo": o carregando aparece no toque.
  const [retriedError, setRetriedError] = useState<unknown>(null);

  const detail = open ? detailQuery.data : shownDetail;
  const participantNames = open ? participantsQuery.data : shownParticipants;
  const notFound = detail === null;
  const failed = open && detailQuery.isError && detail === undefined && detailQuery.error !== retriedError;
  const previewRow = shownPreview && shownPreview.id === shownId ? shownPreview : null;
  const view = notFound ? null : toReportSheetView(detail, previewRow);
  const actions = detail ? reportSheetActions(hasPermission, detail, context) : null;
  const busy = open && !!detail && detailQuery.isFetching;

  const retry = () => {
    setRetriedError(detailQuery.error);
    titleRef.current?.focus();
    void detailQuery.refetch();
    // Na queda de conexão, os participantes falharam junto: "Tentar de novo" lê os dois.
    if (participantsQuery.isError) void participantsQuery.refetch();
  };

  let title: string = TEXTS.title;
  if (notFound) title = TEXTS.notFoundTitle;
  else if (view) title = view.title;

  let body: ReactNode;
  if (notFound) {
    body = (
      <div className="space-y-4">
        <p>{TEXTS.notFoundText}</p>
        <Button type="button" className="h-11 w-full sm:w-auto" onClick={onClose}>
          {TEXTS.close}
        </Button>
      </div>
    );
  } else if (failed) {
    body = <LoadError onRetry={retry} />;
  } else if (!view) {
    body = <LoadingBody />;
  } else {
    body = (
      <ReportContent
        view={view}
        detail={detail ?? null}
        actions={actions}
        canSeeDeletedCells={hasPermission("manage_roles")}
        participants={{
          count: view.meeting.participantsCount,
          names: participantNames ? sortParticipantNames(participantNames) : undefined,
          failed: open && participantsQuery.isError && !participantNames,
          onRetry: () => void participantsQuery.refetch(),
        }}
      />
    );
  }

  const showFooter = !!detail && !!actions && (actions.edit || actions.delete) && !failed;

  return (
    <RecordSheet
      ref={titleRef}
      open={open}
      onClose={onClose}
      onCloseAutoFocus={(event) => onCloseAutoFocus(event, shownId)}
      title={title}
      description={view && !failed ? <div><CellLine text={view.cellLine} /></div> : undefined}
      closeLabel={TEXTS.close}
      busy={busy}
      footer={
        showFooter && actions && detail ? (
          <SheetFooter
            actions={actions}
            dateBr={view?.dateBr ?? ""}
            onEdit={(opener) => detail.id && onEdit(detail.id, opener)}
            onDelete={(opener) => onDelete(toCellReportDeletionTarget({ id: detail.id ?? "", date: detail.date ?? "", snapshot_leader_name: detail.snapshot_leader_name }), opener)}
          />
        ) : undefined
      }
    >
      {body}
    </RecordSheet>
  );
}
