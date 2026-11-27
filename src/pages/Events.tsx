import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, ArrowLeft, SlidersHorizontal } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import ListPagination from "@/components/ListPagination";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AuditEventList } from "@/components/audit/AuditEventList";
import { AuditEventSheet } from "@/components/audit/AuditEventSheet";
import { AuditEventTable } from "@/components/audit/AuditEventTable";
import { AuditFilters } from "@/components/audit/AuditFilters";
import { AuditFiltersSheet } from "@/components/audit/AuditFiltersSheet";
import { RecordDeletedBadge } from "@/components/audit/EventBadges";
import { FilterChips } from "@/components/filters/FilterChips";
import { RetentionNote } from "@/components/audit/RetentionNote";
import { SearchField } from "@/components/audit/SearchField";
import { useAuditRecordLabel, type AuditRecordLabel } from "@/hooks/use-audit-record-label";
import { useEventsList } from "@/hooks/use-events-list";
import { useClampPage, useListSearchParams } from "@/hooks/use-list-search-params";
import { useMinWidth } from "@/hooks/use-min-width";
import { formatCount } from "@/lib/format";
import { formatIsoDateBr, spToday } from "@/lib/dates/sao-paulo";
import type { AuditEvent } from "@/lib/audit/events";
import {
  EMPTY_AUDIT_FILTERS,
  activeFilterCount,
  filterChips,
  readAuditUrl,
  withoutKeys,
  writeAuditFilters,
  type AuditFilters as Filters,
  type AuditRecordRef,
} from "@/lib/audit/url-params";
import { AUDIT_TEXTS as TEXTS } from "@/lib/audit/texts";
import { cn } from "@/lib/utils";

/**
 * A partir daqui, os filtros ficam acima da lista e a lista vira tabela (T7). Abaixo de 1024 px a
 * tabela de seis colunas quebra a descrição e esconde o Status: cartões e a folha de filtros.
 */
const DESKTOP_MIN_WIDTH = 1024;

/** O título do histórico de um registro (T9): "Histórico de {Nome}", com o badge de excluído. */
function historyTitle(record: AuditRecordRef, label: AuditRecordLabel | null): string {
  const H = TEXTS.history;
  if (!label) return H.unknownTitle;
  const leader = label.leader_name || H.leaderNotInformed;
  if (record.type === "member") return label.name ? H.title.member(label.name) : H.unknownTitle;
  if (record.type === "cell") return H.title.cell(leader);
  return label.report_date ? H.title.cell_report(formatIsoDateBr(label.report_date), leader) : H.unknownTitle;
}

function PageHeader({ record }: { record: AuditRecordRef | null }) {
  const label = useAuditRecordLabel(record);
  if (!record) {
    return (
      <div className="space-y-1">
        <h1 className="text-2xl font-bold md:text-3xl">{TEXTS.title}</h1>
        <p className="text-sm text-muted-foreground">{TEXTS.subtitle}</p>
        <RetentionNote />
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Button asChild variant="ghost" className="-ml-3 h-11 lg:h-9">
        <Link to="/events">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {TEXTS.history.back}
        </Link>
      </Button>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="break-words text-2xl font-bold md:text-3xl">
            {label.isPending ? TEXTS.history.loadingTitle : historyTitle(record, label.data ?? null)}
          </h1>
          {label.isPending && <Skeleton className="h-7 w-48" aria-hidden="true" />}
          {label.data?.deleted && <RecordDeletedBadge text={TEXTS.history.deleted[record.type]} />}
        </div>
        <p className="text-sm text-muted-foreground">{TEXTS.history.subtitle[record.type]}</p>
        <RetentionNote />
      </div>
    </div>
  );
}

function LoadingRows({ asTable }: { asTable: boolean }) {
  return (
    <div className="space-y-3 p-4" aria-busy="true" data-testid="audit-loading">
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} className={asTable ? "h-10 w-full" : "h-24 w-full"} />
      ))}
    </div>
  );
}

/**
 * Auditoria (E2.05, T7 a T10; RN-15, RN-17 a RN-20): paginada no servidor com o total, busca e filtros
 * no servidor com o estado na URL, cards no celular e tabela no computador, o histórico de um registro
 * e o painel legível. A rota só monta com "Visualizar Auditoria" (`RouteAccess`, P13).
 */
const Events = () => {
  const list = useListSearchParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { filters, record, invalidKeys } = useMemo(() => readAuditUrl(searchParams), [searchParams]);
  const desktop = useMinWidth(DESKTOP_MIN_WIDTH);
  const today = spToday();

  // Um valor inválido sai da URL (UX-12).
  useEffect(() => {
    if (invalidKeys.length > 0) setSearchParams((prev) => withoutKeys(prev, invalidKeys), { replace: true });
  }, [invalidKeys, setSearchParams]);

  const query = useEventsList({ ...list.params, filters, record });
  useClampPage(list, query);

  const setFilters = useCallback(
    (next: Filters) => setSearchParams((prev) => writeAuditFilters(prev, next), { replace: true }),
    [setSearchParams],
  );
  const changeFilters = (changes: Partial<Filters>) => setFilters({ ...filters, ...changes });
  const clearFilters = () => setFilters(EMPTY_AUDIT_FILTERS);

  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const filtersButtonRef = useRef<HTMLButtonElement>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const openEvent = (event: AuditEvent, element: HTMLElement) => {
    opener.current = element;
    setSelected(event);
  };
  const returnFocus = (event: Event) => {
    event.preventDefault();
    const target = opener.current;
    opener.current = null;
    (target?.isConnected ? target : searchRef.current)?.focus();
  };

  const filterCount = activeFilterCount(filters);
  const hasSearchOrFilters = filterCount > 0 || list.params.search !== "";
  const data = query.data;
  const total = data?.total ?? 0;
  const countText = `${formatCount(total)} ${total === 1 ? TEXTS.count[0] : TEXTS.count[1]}`;

  const searchField = (
    <SearchField ref={searchRef} value={list.searchInput} onChange={list.setSearchInput} historyMode={!!record} />
  );

  let content;
  if (query.isPending) {
    content = <LoadingRows asTable={desktop} />;
  } else if (query.isError && !data) {
    content = (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertDescription className="space-y-3 text-foreground">
            <p>{TEXTS.loadFailed}</p>
            <Button type="button" variant="outline" className="h-11 lg:h-9" onClick={() => void query.refetch()}>
              {TEXTS.tryAgain}
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  } else if (data && data.rows.length === 0) {
    content = (
      <div className="space-y-3 p-6 text-center text-sm">
        {record ? (
          <>
            <p className="font-medium">{TEXTS.history.empty[record.type]}</p>
            <p className="text-muted-foreground">{TEXTS.history.emptyExplanation}</p>
            <Button asChild variant="outline" className="h-11 lg:h-9">
              <Link to="/events">{TEXTS.history.back}</Link>
            </Button>
          </>
        ) : hasSearchOrFilters ? (
          <>
            <p>{TEXTS.emptyFiltered}</p>
            {filterCount > 0 && (
              <Button type="button" variant="outline" className="h-11 lg:h-9" onClick={clearFilters}>
                {TEXTS.filters.clearAll}
              </Button>
            )}
          </>
        ) : (
          <p>{TEXTS.empty}</p>
        )}
      </div>
    );
  } else if (data) {
    content = (
      <>
        {query.isError && (
          <div className="px-4 pb-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription className="space-y-3 text-foreground">
                <p>{TEXTS.refreshFailed}</p>
                <Button type="button" variant="outline" className="h-11 lg:h-9" onClick={() => void query.refetch()}>
                  {TEXTS.tryAgain}
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        )}
        <div
          className={cn("transition-opacity motion-reduce:transition-none", query.isPlaceholderData && "opacity-60")}
          aria-busy={query.isPlaceholderData || undefined}
        >
          {desktop ? (
            <AuditEventTable events={data.rows} showEntity={!record} onOpen={openEvent} />
          ) : (
            <AuditEventList events={data.rows} showEntity={!record} onOpen={openEvent} />
          )}
        </div>
      </>
    );
  }

  return (
    <AppLayout>
      <div className="min-w-0 space-y-6">
        <PageHeader record={record} />

        <Card className="min-w-0">
          <CardHeader className="space-y-3">
            {desktop ? (
              <AuditFilters
                search={searchField}
                filters={filters}
                historyMode={!!record}
                today={today}
                onChange={changeFilters}
                onClearAll={clearFilters}
              />
            ) : (
              <>
                {searchField}
                <Button
                  ref={filtersButtonRef}
                  type="button"
                  variant="outline"
                  className="h-11 w-fit"
                  onClick={() => setFiltersOpen(true)}
                >
                  <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                  {filterCount > 0 ? TEXTS.filters.buttonCount(filterCount) : TEXTS.filters.button}
                </Button>
                <FilterChips
                  chips={filterChips(filters)}
                  onRemove={(key) => changeFilters({ [key]: null })}
                  onClearAll={clearFilters}
                  filtersButtonRef={filtersButtonRef}
                  removeLabel={TEXTS.chips.remove}
                />
              </>
            )}
            <p role="status" className="text-sm text-muted-foreground">
              {data ? countText : ""}
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {content}
            {data && data.total > 0 && (
              <ListPagination
                page={list.params.page}
                pageSize={list.params.pageSize}
                total={data.total}
                itemLabel={TEXTS.count}
                onPageChange={list.setPage}
                onPageSizeChange={list.setPageSize}
              />
            )}
          </CardContent>
        </Card>

        <AuditEventSheet event={selected} historyRecord={record} onClose={() => setSelected(null)} onCloseAutoFocus={returnFocus} />

        {!desktop && (
          <AuditFiltersSheet
            open={filtersOpen}
            filters={filters}
            historyMode={!!record}
            today={today}
            onApply={(next) => {
              setFilters(next);
              setFiltersOpen(false);
            }}
            onClose={() => setFiltersOpen(false)}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              filtersButtonRef.current?.focus();
            }}
          />
        )}
      </div>
    </AppLayout>
  );
};

export default Events;
