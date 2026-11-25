import { useState, type ReactNode } from "react";
import {
  Users,
  UserCheck,
  Church,
  UserX,
  Droplets,
  Link2Off,
  Shield,
  FileText,
  Clock,
  UserPlus,
  XCircle,
  User,
  Plus,
  type LucideIcon,
} from "lucide-react";
import AppLayout from "@/components/AppLayout";
import CellReportForm from "@/components/CellReportForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import {
  useDashboardCellsByType,
  useDashboardG12Ranking,
  useDashboardSummary,
  type DashboardCellsByType,
  type DashboardG12Couple,
  type DashboardSummary,
} from "@/hooks/use-dashboard";
import { dashboardDeniedLines, dashboardHeader } from "@/lib/access/access";
import { DASHBOARD_TEXTS } from "@/lib/access/texts";
import { formatWeekRange } from "@/lib/dashboard/week";
import { isPermissionDenied } from "@/lib/errors";
import { formatCount } from "@/lib/format";

// Todos os números vêm prontos das RPCs do dashboard (E1.08, RN-02 e RN-08);
// a tela só exibe. Sem "Visualizar Dashboard" (pelo acesso, ou pela recusa do
// banco), mostra o acesso negado sem nenhum card (E2.02, RN-07, T9).

/** Título do diálogo do atalho: o mesmo das telas de Células e Relatórios. */
const NEW_REPORT_DIALOG_TITLE = "Novo Relatório de Célula";
const LOAD_ERROR_MESSAGE = "Erro ao carregar o dashboard.";
const LOADING_MESSAGE = "Carregando…";

const CARD_GRID = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4";

// Cards de tipo de célula exibidos enquanto os tipos carregam.
const CELL_TYPE_PLACEHOLDERS = 3;
// Linhas do ranking G12 exibidas enquanto ele carrega.
const G12_RANKING_PLACEHOLDERS = 4;

type SummaryCount = Exclude<keyof DashboardSummary, "week_start" | "week_end">;

interface SummaryCardSpec {
  title: string;
  field: SummaryCount;
  icon: LucideIcon;
  color: string;
}

const WEEK_CARDS: readonly SummaryCardSpec[] = [
  { title: "Relatórios Enviados", field: "reports_sent", icon: FileText, color: "text-success" },
  { title: "Células sem Relatório", field: "cells_pending", icon: Clock, color: "text-warning" },
  { title: "Visitantes em Células", field: "visitors", icon: UserPlus, color: "text-accent" },
  { title: "Células Não Realizadas", field: "cells_not_held", icon: XCircle, color: "text-destructive" },
];

const GENERAL_CARDS: readonly SummaryCardSpec[] = [
  { title: "Total de Membros", field: "members_total", icon: Users, color: "text-secondary" },
  { title: "Membros Ativos", field: "members_active", icon: UserCheck, color: "text-success" },
  { title: "Membros Inativos", field: "members_inactive", icon: UserX, color: "text-destructive" },
  { title: "Batizados", field: "members_baptized", icon: Church, color: "text-accent" },
  { title: "Não Batizados", field: "members_not_baptized", icon: Droplets, color: "text-warning" },
  { title: "Sem Liderança", field: "members_without_leader", icon: Shield, color: "text-orange-500" },
  { title: "Sem Vínculo Celular", field: "members_without_cell_link", icon: Link2Off, color: "text-orange-500" },
];

// No card (fundo branco), e não direto no fundo da página, para o vermelho ter contraste (WCAG 1.4.3).
const LoadError = () => (
  <Card>
    <CardContent className="p-6 text-center text-destructive">
      <p role="alert">{LOAD_ERROR_MESSAGE}</p>
    </CardContent>
  </Card>
);

/** Anuncia o carregamento ao leitor de tela; fica dentro da área com `aria-busy`. */
const LoadingStatus = () => (
  <span role="status" className="sr-only">
    {LOADING_MESSAGE}
  </span>
);

interface StatCardProps {
  /** Sem título ou sem valor (carregando), mostra um placeholder no lugar. */
  title?: string;
  value?: number;
  icon: LucideIcon;
  color: string;
}

const StatCard = ({ title, value, icon: Icon, color }: StatCardProps) => (
  <Card>
    <CardHeader className="flex flex-row items-center justify-between pb-2">
      {title === undefined ? (
        <Skeleton className="h-4 w-32" />
      ) : (
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      )}
      <Icon className={`w-5 h-5 ${color}`} aria-hidden="true" />
    </CardHeader>
    <CardContent>
      {value === undefined ? (
        <Skeleton className="h-9 w-16" />
      ) : (
        <div className="text-3xl font-bold">{formatCount(value)}</div>
      )}
    </CardContent>
  </Card>
);

interface SummaryCardsProps {
  cards: readonly SummaryCardSpec[];
  summary: DashboardSummary | undefined;
}

/** Os cards de `dashboard_summary`; enquanto carrega, cada número é um placeholder. */
const SummaryCards = ({ cards, summary }: SummaryCardsProps) => (
  <div className={CARD_GRID} aria-busy={!summary}>
    {cards.map((card) => (
      <StatCard key={card.field} title={card.title} value={summary?.[card.field]} icon={card.icon} color={card.color} />
    ))}
    {!summary && <LoadingStatus />}
  </div>
);

/** Um card por tipo de célula; sem nenhuma célula, fica oculto. */
const CellsByTypeCards = ({ rows }: { rows: DashboardCellsByType[] | undefined }) => {
  if (!rows) {
    return (
      <div className={CARD_GRID} aria-busy="true">
        {Array.from({ length: CELL_TYPE_PLACEHOLDERS }, (_, i) => (
          <StatCard key={i} icon={Church} color="text-secondary" />
        ))}
        <LoadingStatus />
      </div>
    );
  }
  if (rows.length === 0) return null;
  return (
    <div className={CARD_GRID}>
      {rows.map((row) => (
        <StatCard
          key={row.cell_type}
          title={`Células ${row.cell_type}`}
          value={row.total}
          icon={Church}
          color="text-secondary"
        />
      ))}
    </div>
  );
};

// Espaçamento menor no celular, para a coluna Total (a da ordenação) caber sem rolar.
const RANKING_CELL = "px-2 sm:px-4 py-3";
const RANKING_HEADER = `${RANKING_CELL} font-medium text-muted-foreground`;
// Ícone do cabeçalho só a partir do `sm`; no celular, fica só o texto.
const RANKING_HEADER_ICON = "hidden sm:inline-block w-4 h-4";
// `min-w-8 px-2`: um círculo para poucos dígitos, que alarga para "1.234".
const RANKING_BADGE = "inline-flex items-center justify-center min-w-8 h-8 px-2 rounded-full font-bold text-sm";

const G12RankingTable = ({ rows }: { rows: DashboardG12Couple[] }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b">
          <th scope="col" className={`${RANKING_HEADER} text-left`}>
            G12 (Casal)
          </th>
          <th scope="col" className={RANKING_HEADER}>
            <span className="flex items-center gap-1 justify-center">
              <User className={`${RANKING_HEADER_ICON} text-blue-500`} aria-hidden="true" /> Homens
            </span>
          </th>
          <th scope="col" className={RANKING_HEADER}>
            <span className="flex items-center gap-1 justify-center">
              <User className={`${RANKING_HEADER_ICON} text-pink-500`} aria-hidden="true" /> Mulheres
            </span>
          </th>
          <th scope="col" className={`${RANKING_HEADER} text-center`}>
            Total
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr key={row.couple_key} className={idx % 2 === 0 ? "bg-muted/30" : ""}>
            <th scope="row" className={`${RANKING_CELL} text-left font-medium`}>
              {row.spouse_name ? `${row.name} & ${row.spouse_name}` : row.name}
            </th>
            <td className={`${RANKING_CELL} text-center`}>
              <span className={`${RANKING_BADGE} bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300`}>
                {formatCount(row.male_cells)}
              </span>
            </td>
            <td className={`${RANKING_CELL} text-center`}>
              <span className={`${RANKING_BADGE} bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300`}>
                {formatCount(row.female_cells)}
              </span>
            </td>
            <td className={`${RANKING_CELL} text-center font-semibold`}>{formatCount(row.total_cells)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

interface G12RankingSectionProps {
  rows: DashboardG12Couple[] | undefined;
  failed: boolean;
}

/**
 * "Células por G12": tabela do ranking, que cabe no celular e só rola na
 * horizontal se não couber (nomes longos em 320 px); sem casais, fica oculta.
 */
const G12RankingSection = ({ rows, failed }: G12RankingSectionProps) => {
  if (rows?.length === 0) return null;

  let content: ReactNode;
  if (failed) {
    content = <LoadError />;
  } else if (rows) {
    content = (
      <Card>
        <CardContent className="p-0">
          <G12RankingTable rows={rows} />
        </CardContent>
      </Card>
    );
  } else {
    content = (
      <Card>
        <CardContent className="p-4 space-y-3">
          {Array.from({ length: G12_RANKING_PLACEHOLDERS }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
          <LoadingStatus />
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="space-y-4" aria-busy={!rows && !failed}>
      <h2 className="text-xl font-semibold">Células por G12</h2>
      {content}
    </section>
  );
};

/**
 * Falhou sem nada para mostrar. Se uma atualização em segundo plano falha, o
 * TanStack Query mantém os dados anteriores, e a tela continua com eles.
 */
const hasFailed = (query: { isError: boolean; data: unknown }) => query.isError && query.data === undefined;

/** Sem acesso (RN-07, T9): a linha do Negócio e, sem cadastro ou sem função, a orientação. */
const DeniedDashboard = ({ lines }: { lines: readonly string[] }) => (
  <AppLayout>
    <div className="space-y-8 animate-fade-in">
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
  const [reportFormOpen, setReportFormOpen] = useState(false);

  // O acesso já diz que não há Dashboard: nenhuma consulta e nenhum card (UX-13).
  const deniedByAccess = permissionsLoaded ? dashboardDeniedLines(access) : null;
  const enabled = permissionsLoaded && deniedByAccess === null;

  const summary = useDashboardSummary({ enabled });
  const cellsByType = useDashboardCellsByType({ enabled });
  const g12Ranking = useDashboardG12Ranking({ enabled });

  // RN-09: as três RPCs checam a mesma permissão; basta uma recusar. A recusa
  // faz a tela reler o acesso (P13), e as linhas seguem o acesso relido.
  const deniedByServer = [summary, cellsByType, g12Ranking].some((query) => isPermissionDenied(query.error));

  if (deniedByAccess) return <DeniedDashboard lines={deniedByAccess} />;
  if (deniedByServer) return <DeniedDashboard lines={[DASHBOARD_TEXTS.noAccess]} />;

  const { subtitle, badge } = dashboardHeader(access);
  // Atalho "Novo relatório" (RN-22, UXD-10): para quem pode lançar o relatório de pelo menos uma célula.
  const canSubmitReport = access?.can_submit_some_report === true;
  const summaryRow = summary.data;
  const summaryFailed = hasFailed(summary);
  const cellsByTypeFailed = hasFailed(cellsByType);

  return (
    <AppLayout>
      <div className="space-y-8 animate-fade-in">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl md:text-3xl font-bold">Dashboard</h1>
              {badge && (
                <Badge variant="secondary" className="text-xs">{badge}</Badge>
              )}
            </div>
            {subtitle && <p className="text-muted-foreground text-sm">{subtitle}</p>}
          </div>
          {/* Enquanto o acesso carrega, o lugar do atalho fica reservado (Estados). */}
          {!permissionsLoaded && <Skeleton className="h-11 w-full sm:w-40" aria-hidden="true" />}
          {canSubmitReport && (
            <Button className="h-11 w-full sm:w-auto shrink-0" onClick={() => setReportFormOpen(true)}>
              <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
              {DASHBOARD_TEXTS.newReport}
            </Button>
          )}
        </div>
        {/* SEMANAL */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-2">
            <h2 className="text-xl font-semibold">
              Esta Semana
              {summaryRow && (
                <span className="text-sm font-normal text-muted-foreground">
                  {" "}({formatWeekRange(summaryRow.week_start, summaryRow.week_end)})
                </span>
              )}
            </h2>
            {summary.isPending && <Skeleton className="h-4 w-24" />}
          </div>
          {summaryFailed ? <LoadError /> : <SummaryCards cards={WEEK_CARDS} summary={summaryRow} />}
        </section>

        {/* GERAL: o erro aparece no lugar do que falhou, uma vez só se as duas consultas falharem */}
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Geral</h2>
          {summaryFailed ? <LoadError /> : <SummaryCards cards={GENERAL_CARDS} summary={summaryRow} />}
          {!cellsByTypeFailed && <CellsByTypeCards rows={cellsByType.data} />}
          {cellsByTypeFailed && !summaryFailed && <LoadError />}
        </section>

        {/* G12 CELLS */}
        <G12RankingSection rows={g12Ranking.data} failed={hasFailed(g12Ranking)} />

        {/* No sucesso, o formulário fecha com o toast, e a gravação recarrega os cards da semana (UX-14). */}
        <Dialog open={reportFormOpen} onOpenChange={setReportFormOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto w-[95vw] sm:w-full">
            <DialogHeader>
              <DialogTitle>{NEW_REPORT_DIALOG_TITLE}</DialogTitle>
            </DialogHeader>
            {reportFormOpen && <CellReportForm onClose={() => setReportFormOpen(false)} />}
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
};

export default Dashboard;
