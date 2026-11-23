import type { ReactNode } from "react";
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
  type LucideIcon,
} from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
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
import { formatWeekRange } from "@/lib/dashboard/week";
import { isPermissionDenied } from "@/lib/errors";

// Todos os números vêm prontos das RPCs do dashboard (E1.08, RN-02 e RN-08);
// a tela só exibe. Sem permissão no banco, mostra o acesso negado (RN-09).

const ACCESS_DENIED_MESSAGE = "Você não tem acesso ao dashboard.";
const LOAD_ERROR_MESSAGE = "Erro ao carregar o dashboard.";

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

const LoadError = () => <p className="text-center py-8 text-destructive">{LOAD_ERROR_MESSAGE}</p>;

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
      {value === undefined ? <Skeleton className="h-9 w-16" /> : <div className="text-3xl font-bold">{value}</div>}
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

const G12RankingTable = ({ rows }: { rows: DashboardG12Couple[] }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b">
          <th scope="col" className="text-left px-4 py-3 font-medium text-muted-foreground">
            G12 (Casal)
          </th>
          <th scope="col" className="px-4 py-3 font-medium text-muted-foreground">
            <span className="flex items-center gap-1 justify-center">
              <User className="w-4 h-4 text-blue-500" aria-hidden="true" /> Homens
            </span>
          </th>
          <th scope="col" className="px-4 py-3 font-medium text-muted-foreground">
            <span className="flex items-center gap-1 justify-center">
              <User className="w-4 h-4 text-pink-500" aria-hidden="true" /> Mulheres
            </span>
          </th>
          <th scope="col" className="px-4 py-3 font-medium text-muted-foreground text-center">
            Total
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr key={row.couple_key} className={idx % 2 === 0 ? "bg-muted/30" : ""}>
            <td className="px-4 py-3 font-medium">{row.spouse_name ? `${row.name} & ${row.spouse_name}` : row.name}</td>
            <td className="px-4 py-3 text-center">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-bold text-sm">
                {row.male_cells}
              </span>
            </td>
            <td className="px-4 py-3 text-center">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300 font-bold text-sm">
                {row.female_cells}
              </span>
            </td>
            <td className="px-4 py-3 text-center font-semibold">{row.total_cells}</td>
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

/** "Células por G12": tabela do ranking, que rola na horizontal no celular; sem casais, fica oculta. */
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

const Dashboard = () => {
  const { hasPermission } = useAuth();
  const isMinistryOnly = !hasPermission("view_dashboard") && hasPermission("view_own_ministry_dashboard");

  const summary = useDashboardSummary();
  const cellsByType = useDashboardCellsByType();
  const g12Ranking = useDashboardG12Ranking();

  // RN-09: as três RPCs checam a mesma permissão; basta uma recusar.
  const accessDenied = [summary, cellsByType, g12Ranking].some((query) => isPermissionDenied(query.error));

  if (accessDenied) {
    return (
      <AppLayout>
        <div className="space-y-8 animate-fade-in">
          <h1 className="text-2xl md:text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">{ACCESS_DENIED_MESSAGE}</p>
        </div>
      </AppLayout>
    );
  }

  const summaryRow = summary.data;
  const summaryFailed = hasFailed(summary);
  const cellsByTypeFailed = hasFailed(cellsByType);

  return (
    <AppLayout>
      <div className="space-y-8 animate-fade-in">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl md:text-3xl font-bold">Dashboard</h1>
            {isMinistryOnly && (
              <Badge variant="secondary" className="text-xs">Meu Ministério</Badge>
            )}
          </div>
          <p className="text-muted-foreground text-sm">
            {isMinistryOnly ? "Visão do seu ministério" : "Visão geral da igreja"}
          </p>
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
      </div>
    </AppLayout>
  );
};

export default Dashboard;
