import { useCallback, useRef, useState, type MouseEvent } from "react";
import { useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { CellReportDialog } from "@/components/cell-reports/CellReportDialog";
import G12Ranking from "@/components/dashboard/G12Ranking";
import SectionError from "@/components/dashboard/SectionError";
import StatCard from "@/components/dashboard/StatCard";
import StatGrid from "@/components/dashboard/StatGrid";
import WeekChart from "@/components/dashboard/WeekChart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import {
  DASHBOARD_G12_RANKING_KEY,
  DASHBOARD_SUMMARY_KEY,
  useDashboardG12Ranking,
  useDashboardSummary,
  useInvalidatedByWrite,
} from "@/hooks/use-dashboard";
import { useReturnPosition } from "@/hooks/use-return-position";
import { dashboardDeniedLines, dashboardHeader, type Access } from "@/lib/access/access";
import { DASHBOARD_TEXTS } from "@/lib/access/texts";
import {
  GENERAL_CARDS,
  WEEK_CARDS,
  cardIcon,
  cardTone,
  chartRows,
  showChart,
  visibleCards,
  type DashboardCard,
  type DashboardG12Couple,
  type DashboardSection,
  type DashboardSummary,
} from "@/lib/dashboard/cards";
import {
  DASHBOARD_RETURN_SCOPE,
  cardReturnKey,
  chartPartHref,
  chartReturnKey,
  numberHref,
  rankingReturnKey,
  rankingRowHref,
  returnKeySection,
} from "@/lib/dashboard/links";
import { sectionView, type SectionView } from "@/lib/dashboard/section-state";
import { DASHBOARD_CARD_TITLES, DASHBOARD_PAGE_TEXTS } from "@/lib/dashboard/texts";
import { formatWeekRange, formatWeekRangeSpoken } from "@/lib/dashboard/week";
import { isPermissionDenied } from "@/lib/errors";
import { cn } from "@/lib/utils";

// Todos os números vêm prontos das duas RPCs do Dashboard (E1.08; E2.14,
// DT-02); a tela só escolhe o que mostrar (o catálogo de `lib/dashboard`) e
// compõe. Sem "Visualizar Dashboard" (pelo acesso, ou pela recusa do banco),
// mostra o acesso negado sem nenhum card (E2.02, RN-07, T9).

/** O `id` do `h2` de cada seção: o `aria-labelledby` e o foco da volta quando o item sumiu (DA-4). */
const SECTION_HEADINGS: Readonly<Record<DashboardSection, string>> = {
  week: "dashboard-week",
  general: "dashboard-general",
  ranking: "dashboard-ranking",
};

const H2 = "text-xl font-semibold focus:outline-none";

/** Guarda o item aberto e a rolagem (PR 3): `remember(key, event)`. */
type Remember = (key: string, event?: MouseEvent) => void;

/** O estado da seção a partir da consulta (T7, RN-17), e a nova tentativa que anuncia a falha. */
function useSectionView(query: UseQueryResult<unknown, unknown>, queryKey: readonly string[]) {
  const invalidatedByWrite = useInvalidatedByWrite(queryKey);
  // O `errorUpdateCount` no toque em "Tentar de novo": uma falha depois dele é anunciada.
  const [retryMark, setRetryMark] = useState<number | null>(null);
  const retried =
    retryMark !== null && query.errorUpdateCount > retryMark && query.errorUpdatedAt >= query.dataUpdatedAt;
  const view = sectionView({
    hasData: query.data !== undefined,
    isError: query.isError,
    isFetching: query.isFetching,
    invalidatedByWrite,
    retried,
  });
  const { refetch, errorUpdateCount } = query;
  const retry = useCallback(() => {
    setRetryMark(errorUpdateCount);
    void refetch();
  }, [refetch, errorUpdateCount]);
  return { view, retry };
}

/** "Carregando…" para o leitor de tela, dentro da área com `aria-busy` (E1.08). */
const LoadingStatus = () => (
  <span role="status" className="sr-only">
    {DASHBOARD_PAGE_TEXTS.loading}
  </span>
);

interface CardsProps {
  cards: readonly DashboardCard[];
  summary: DashboardSummary | undefined;
  access: Access | null;
  remember: Remember;
}

/** Os cards de uma seção (RN-14, RN-15, P110 a P112, P114). Sem os números, só os sempre à vista, com o `Skeleton`. */
const Cards = ({ cards, summary, access, remember }: CardsProps) => (
  <StatGrid>
    {visibleCards(cards, summary).map((card) => {
      const value = summary?.[card.number];
      const returnKey = cardReturnKey(card);
      return (
        <StatCard
          key={card.number}
          title={DASHBOARD_CARD_TITLES[card.number]}
          value={value}
          icon={cardIcon(card, value)}
          tone={cardTone(card.number, value)}
          list={card.list}
          href={summary ? numberHref(card, summary, access) : null}
          returnKey={returnKey}
          onOpen={(event) => remember(returnKey, event)}
        />
      );
    })}
  </StatGrid>
);

interface SummarySectionProps {
  section: "week" | "general";
  view: SectionView;
  summary: DashboardSummary | undefined;
  access: Access | null;
  remember: Remember;
  onRetry: () => void;
}

/** "Esta semana" (os cards e o gráfico) ou "Geral": as duas do mesmo resumo (AQ-9). */
const SummarySection = ({ section, view, summary, access, remember, onRetry }: SummarySectionProps) => {
  const isWeek = section === "week";
  const busy = view.kind === "loading" || (view.kind === "ready" && view.updating);
  const shown = view.kind === "ready" ? summary : undefined;
  return (
    <section aria-labelledby={SECTION_HEADINGS[section]} aria-busy={busy} className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-2">
        <h2 id={SECTION_HEADINGS[section]} tabIndex={-1} className={H2}>
          {isWeek ? DASHBOARD_PAGE_TEXTS.weekSection : DASHBOARD_PAGE_TEXTS.generalSection}
          {isWeek && summary && (
            <>
              <span aria-hidden="true" className="text-sm font-normal text-muted-foreground">
                {` (${formatWeekRange(summary.week_start, summary.week_end)})`}
              </span>
              <span className="sr-only">{`, ${formatWeekRangeSpoken(summary.week_start, summary.week_end)}`}</span>
            </>
          )}
        </h2>
        {isWeek && view.kind === "loading" && <Skeleton className="h-4 w-24" aria-hidden="true" />}
      </div>
      {view.kind === "error" ? (
        <SectionError
          message={isWeek ? DASHBOARD_PAGE_TEXTS.errors.week : DASHBOARD_PAGE_TEXTS.errors.general}
          onRetry={onRetry}
          retrying={view.retrying}
          announce={view.announce}
        />
      ) : (
        <div className={cn("space-y-4 transition-opacity motion-reduce:transition-none", busy && shown && "opacity-60")}>
          <Cards cards={isWeek ? WEEK_CARDS : GENERAL_CARDS} summary={shown} access={access} remember={remember} />
          {isWeek && shown && showChart(shown) && (
            <WeekChart
              rows={chartRows(shown)}
              hrefFor={(row) => chartPartHref(row, shown, access)}
              returnKeyFor={chartReturnKey}
              onOpen={(row, event) => remember(chartReturnKey(row), event)}
            />
          )}
        </div>
      )}
      {view.kind === "loading" && <LoadingStatus />}
    </section>
  );
};

interface RankingSectionProps {
  view: SectionView;
  rows: readonly DashboardG12Couple[] | undefined;
  access: Access | null;
  remember: Remember;
  onRetry: () => void;
}

/** "Células por G12" (T5): não aparece enquanto carrega nem sem casais (P112, RN-11). */
const RankingSection = ({ view, rows, access, remember, onRetry }: RankingSectionProps) => {
  if (view.kind === "loading") return null;
  if (view.kind === "ready" && (!rows || rows.length === 0)) return null;
  const updating = view.kind === "ready" && view.updating;
  return (
    <section aria-labelledby={SECTION_HEADINGS.ranking} aria-busy={updating} className="space-y-4">
      <h2 id={SECTION_HEADINGS.ranking} tabIndex={-1} className={H2}>
        {DASHBOARD_PAGE_TEXTS.rankingSection}
      </h2>
      {view.kind === "error" ? (
        <SectionError
          message={DASHBOARD_PAGE_TEXTS.errors.ranking}
          onRetry={onRetry}
          retrying={view.retrying}
          announce={view.announce}
        />
      ) : (
        <div className={cn("transition-opacity motion-reduce:transition-none", updating && "opacity-60")}>
          <G12Ranking
            rows={rows ?? []}
            hrefFor={(row) => rankingRowHref(row, access)}
            returnKeyFor={rankingReturnKey}
            onOpen={(row, event) => remember(rankingReturnKey(row), event)}
          />
        </div>
      )}
    </section>
  );
};

/** Sem acesso (RN-07, T9): a linha do Negócio e, sem cadastro ou sem função, a orientação. */
const DeniedDashboard = ({ lines }: { lines: readonly string[] }) => (
  <AppLayout>
    <div className="space-y-8 animate-fade-in motion-reduce:animate-none">
      <h1 className="text-2xl md:text-3xl font-bold">Dashboard</h1>
      <div className="space-y-1">
        {lines.map((line) => (
          <p key={line} className="text-muted-foreground">
            {line}
          </p>
        ))}
      </div>
    </div>
  </AppLayout>
);

const Dashboard = () => {
  const { access, permissionsLoaded } = useAuth();
  const queryClient = useQueryClient();
  const [reportFormOpen, setReportFormOpen] = useState(false);
  const reportOpener = useRef<HTMLButtonElement | null>(null);

  // O acesso já diz que não há Dashboard: nenhuma consulta e nenhum card (UX-13 do E2.02).
  const deniedByAccess = permissionsLoaded ? dashboardDeniedLines(access) : null;
  const enabled = permissionsLoaded && deniedByAccess === null;

  const summary = useDashboardSummary({ enabled });
  const ranking = useDashboardG12Ranking({ enabled });
  const summarySection = useSectionView(summary, DASHBOARD_SUMMARY_KEY);
  const rankingSection = useSectionView(ranking, DASHBOARD_G12_RANKING_KEY);

  // A volta de uma lista (DA-4): só com o resumo no cache já no primeiro render.
  const [restorable] = useState(() => queryClient.getQueryData(DASHBOARD_SUMMARY_KEY) !== undefined);
  const remember = useReturnPosition(DASHBOARD_RETURN_SCOPE, {
    restorable,
    fallback: (key) => document.getElementById(SECTION_HEADINGS[returnKeySection(key)]),
  });

  // As duas RPCs checam a mesma permissão; basta uma recusar. A recusa faz a
  // tela reler o acesso (P13), e as linhas seguem o acesso relido.
  const deniedByServer = [summary, ranking].some((query) => isPermissionDenied(query.error));

  if (deniedByAccess) return <DeniedDashboard lines={deniedByAccess} />;
  if (deniedByServer) return <DeniedDashboard lines={[DASHBOARD_TEXTS.noAccess]} />;

  const { subtitle, badge } = dashboardHeader(access);
  // Atalho "Novo relatório" (RN-22, UXD-10 do E2.02): para quem pode lançar o relatório de pelo menos uma célula.
  const canSubmitReport = access?.can_submit_some_report === true;

  return (
    <AppLayout>
      <div className="space-y-8 animate-fade-in motion-reduce:animate-none">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl md:text-3xl font-bold">Dashboard</h1>
              {badge && (
                <Badge variant="outline" className="text-xs">{badge}</Badge>
              )}
            </div>
            {subtitle && <p className="text-muted-foreground text-sm">{subtitle}</p>}
          </div>
          {/* Enquanto o acesso carrega, o lugar do atalho fica reservado (Estados). */}
          {!permissionsLoaded && <Skeleton className="h-11 w-full sm:w-40" aria-hidden="true" />}
          {canSubmitReport && (
            <Button
              className="h-11 w-full sm:w-auto shrink-0"
              onClick={(event) => {
                reportOpener.current = event.currentTarget;
                setReportFormOpen(true);
              }}
            >
              <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
              {DASHBOARD_TEXTS.newReport}
            </Button>
          )}
        </div>
        <SummarySection
          section="week"
          view={summarySection.view}
          summary={summary.data}
          access={access}
          remember={remember}
          onRetry={summarySection.retry}
        />
        <SummarySection
          section="general"
          view={summarySection.view}
          summary={summary.data}
          access={access}
          remember={remember}
          onRetry={summarySection.retry}
        />
        <RankingSection
          view={rankingSection.view}
          rows={ranking.data}
          access={access}
          remember={remember}
          onRetry={rankingSection.retry}
        />

        {/* No sucesso, o formulário fecha com o toast, e a gravação recarrega os cards da semana (UX-14). */}
        {reportFormOpen && (
          <CellReportDialog
            mode="launch"
            onClose={() => setReportFormOpen(false)}
            onCloseAutoFocus={(event) => {
              // O foco volta ao "Novo relatório" que abriu o diálogo (Navegação e rotas).
              event.preventDefault();
              reportOpener.current?.focus();
            }}
          />
        )}
      </div>
    </AppLayout>
  );
};

export default Dashboard;
