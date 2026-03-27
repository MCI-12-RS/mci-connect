import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
} from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { startOfWeek, endOfWeek, format } from "date-fns";
import { ptBR } from "date-fns/locale";

const WEEK_DAYS_MAP: Record<string, number> = {
  "Domingo": 0,
  "Segunda-feira": 1,
  "Terça-feira": 2,
  "Quarta-feira": 3,
  "Quinta-feira": 4,
  "Sexta-feira": 5,
  "Sábado": 6,
};

const Dashboard = () => {
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 0 });
  const weekStartStr = format(weekStart, "yyyy-MM-dd");
  const weekEndStr = format(weekEnd, "yyyy-MM-dd");

  // ---- GENERAL STATS ----
  const { data: generalStats } = useQuery({
    queryKey: ["dashboard-general-stats"],
    queryFn: async () => {
      const [
        totalRes,
        activeRes,
        baptizedRes,
        inactiveRes,
        notBaptizedRes,
        noLeaderRes,
        cellsRes,
      ] = await Promise.all([
        supabase.from("members").select("id", { count: "exact", head: true }),
        supabase.from("members").select("id", { count: "exact", head: true }).eq("is_active", true),
        supabase.from("members").select("id", { count: "exact", head: true }).eq("is_baptized", true),
        supabase.from("members").select("id", { count: "exact", head: true }).eq("is_active", false),
        supabase.from("members").select("id", { count: "exact", head: true }).eq("is_baptized", false),
        supabase
          .from("members")
          .select("id", { count: "exact", head: true })
          .is("leader_id", null)
          .eq("is_pastor", false)
          .eq("is_active", true),
        supabase.from("cells").select("id, type"),
      ]);

      // Group cells by type
      const cellsByType: Record<string, number> = {};
      (cellsRes.data || []).forEach((c) => {
        cellsByType[c.type] = (cellsByType[c.type] || 0) + 1;
      });

      return {
        total: totalRes.count || 0,
        active: activeRes.count || 0,
        baptized: baptizedRes.count || 0,
        inactive: inactiveRes.count || 0,
        notBaptized: notBaptizedRes.count || 0,
        noLeader: noLeaderRes.count || 0,
        cellsByType,
      };
    },
  });

  // ---- G12 CELLS ----
  const { data: g12CellsData } = useQuery({
    queryKey: ["dashboard-g12-cells"],
    queryFn: async () => {
      // Fetch only members at G12 Level 1
      const { data, error } = await supabase
        .from("members")
        .select("id, name, gender, spouse_id, male_cells, female_cells")
        .eq("g12_level", 1)
        .eq("is_active", true);

      if (error) throw error;

      // Type cast to handle new columns before types are regenerated
      const members = (data as any[]) || [];
      const memberMap = new Map(members.map((m) => [m.id, m]));

      type CoupleStats = {
        id: string;
        name: string;
        spouseName?: string;
        maleCells: number;
        femaleCells: number;
      };

      const coupleMap = new Map<string, CoupleStats>();

      const getCanonicalKey = (memberId: string, spouseId: string | null | undefined): string => {
        if (!spouseId) return memberId;
        return [memberId, spouseId].sort().join("|");
      };

      members.forEach((member) => {
        const key = getCanonicalKey(member.id, member.spouse_id);

        if (!coupleMap.has(key)) {
          const spouse = member.spouse_id ? memberMap.get(member.spouse_id) : undefined;

          let name = member.name;
          let spouseName: string | undefined;

          if (spouse) {
            // Sort couple by gender (Male first for name display)
            const isMale = member.gender === "Masculino" || member.gender === "M";
            if (isMale) {
              name = member.name;
              spouseName = spouse.name;
            } else {
              name = spouse.name;
              spouseName = member.name;
            }
          }

          coupleMap.set(key, {
            id: key,
            name,
            spouseName,
            maleCells: 0,
            femaleCells: 0
          });
        }

        const stats = coupleMap.get(key)!;
        // Sum recursive stats into the couple unit
        stats.maleCells += (member.male_cells || 0);
        stats.femaleCells += (member.female_cells || 0);
      });

      // Sort by total cells descending
      return Array.from(coupleMap.values()).sort(
        (a, b) => (b.maleCells + b.femaleCells) - (a.maleCells + a.femaleCells)
      );
    },
  });

  // Members without cell link (not pastor, not leader/host/timothy of any cell,
  // and not in cell report participants in last 4 weeks)
  const { data: noCellLinkCount } = useQuery({
    queryKey: ["dashboard-no-cell-link"],
    queryFn: async () => {
      const fourWeeksAgo = new Date();
      fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
      const fourWeeksAgoStr = format(fourWeeksAgo, "yyyy-MM-dd");

      // Get all member IDs that ARE linked to cells
      const [cellsRes, recentParticipantsRes, allMembersRes] = await Promise.all([
        supabase.from("cells").select("leader_id, timothy_id, host_id"),
        supabase
          .from("cell_report_participants")
          .select("member_id, report_id"),
        supabase
          .from("members")
          .select("id, is_pastor")
          .eq("is_active", true),
      ]);

      // Get report IDs from last 4 weeks
      const reportsRes = await supabase
        .from("cell_reports")
        .select("id")
        .gte("date", fourWeeksAgoStr);

      const recentReportIds = new Set((reportsRes.data || []).map((r) => r.id));

      // Collect linked member IDs
      const linkedIds = new Set<string>();
      (cellsRes.data || []).forEach((c) => {
        if (c.leader_id) linkedIds.add(c.leader_id);
        if (c.timothy_id) linkedIds.add(c.timothy_id);
        if (c.host_id) linkedIds.add(c.host_id);
      });
      (recentParticipantsRes.data || []).forEach((p) => {
        if (recentReportIds.has(p.report_id)) {
          linkedIds.add(p.member_id);
        }
      });

      // Count active non-pastor members NOT in linkedIds
      const unlinked = (allMembersRes.data || []).filter(
        (m) => !m.is_pastor && !linkedIds.has(m.id)
      );

      return unlinked.length;
    },
  });

  // ---- WEEKLY STATS ----
  const { data: weeklyStats } = useQuery({
    queryKey: ["dashboard-weekly-stats", weekStartStr, weekEndStr],
    queryFn: async () => {
      const [reportsRes, allCellsRes] = await Promise.all([
        supabase
          .from("cell_reports")
          .select("id, cell_id, was_held, visitors, date")
          .gte("date", weekStartStr)
          .lte("date", weekEndStr),
        supabase.from("cells").select("id, meeting_day, meeting_time, is_active").eq("is_active", true),
      ]);

      const reports = reportsRes.data || [];
      const allCells = allCellsRes.data || [];

      const reportsSent = reports.length;
      const cellsWithReport = new Set(reports.map((r) => r.cell_id));

      // Cells that should have already met this week (meeting_day <= today's day)
      const todayDow = now.getDay();
      const currentTime = format(now, "HH:mm:ss");

      const cellsShouldHaveMet = allCells.filter((c) => {
        const cellDow = WEEK_DAYS_MAP[c.meeting_day || ""] ?? -1;
        if (cellDow < 0) return false;
        if (cellDow < todayDow) return true;
        if (cellDow === todayDow) {
          return (c.meeting_time || "23:59:59") <= currentTime;
        }
        return false;
      });

      const cellsMissingReport = cellsShouldHaveMet.filter(
        (c) => !cellsWithReport.has(c.id)
      ).length;

      // Total visitors
      let totalVisitors = 0;
      reports.forEach((r) => {
        if (r.visitors && Array.isArray(r.visitors)) {
          totalVisitors += r.visitors.length;
        }
      });

      // Cells not held
      const cellsNotHeld = reports.filter((r) => !r.was_held);

      return {
        reportsSent,
        cellsMissingReport,
        totalVisitors,
        cellsNotHeld,
      };
    },
  });

  const generalCards = [
    { title: "Total de Membros", value: generalStats?.total || 0, icon: Users, color: "text-secondary" },
    { title: "Membros Ativos", value: generalStats?.active || 0, icon: UserCheck, color: "text-success" },
    { title: "Membros Inativos", value: generalStats?.inactive || 0, icon: UserX, color: "text-destructive" },
    { title: "Batizados", value: generalStats?.baptized || 0, icon: Church, color: "text-accent" },
    { title: "Não Batizados", value: generalStats?.notBaptized || 0, icon: Droplets, color: "text-warning" },
    { title: "Sem Liderança", value: generalStats?.noLeader || 0, icon: Shield, color: "text-orange-500" },
    { title: "Sem Vínculo Celular", value: noCellLinkCount || 0, icon: Link2Off, color: "text-orange-500" },
  ];

  const cellTypeCards = Object.entries(generalStats?.cellsByType || {}).map(
    ([type, count]) => ({
      title: `Células ${type}`,
      value: count,
    })
  );

  const g12Rows = g12CellsData || [];

  return (
    <AppLayout>
      <div className="space-y-8 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">Visão geral da igreja</p>
        </div>


        {/* SEMANAL */}
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">
            Esta Semana{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({format(weekStart, "dd/MM")} - {format(weekEnd, "dd/MM")})
            </span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Relatórios Enviados
                </CardTitle>
                <FileText className="w-5 h-5 text-success" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {weeklyStats?.reportsSent || 0}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Células sem Relatório
                </CardTitle>
                <Clock className="w-5 h-5 text-warning" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {weeklyStats?.cellsMissingReport || 0}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Visitantes em Células
                </CardTitle>
                <UserPlus className="w-5 h-5 text-accent" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {weeklyStats?.totalVisitors || 0}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Células Não Realizadas
                </CardTitle>
                <XCircle className="w-5 h-5 text-destructive" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {weeklyStats?.cellsNotHeld?.length || 0}
                </div>
              </CardContent>
            </Card>
          </div>
        </section>



        {/* GERAL */}
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Geral</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {generalCards.map((card) => (
              <Card key={card.title}>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {card.title}
                  </CardTitle>
                  <card.icon className={`w-5 h-5 ${card.color}`} />
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{card.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Cells by type */}
          {cellTypeCards.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {cellTypeCards.map((card) => (
                <Card key={card.title}>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {card.title}
                    </CardTitle>
                    <Church className="w-5 h-5 text-secondary" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{card.value}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>




        {/* G12 CELLS */}
        {g12Rows.length > 0 && (
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Células por G12</h2>
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">G12 (Casal)</th>
                        <th className="px-4 py-3 font-medium text-muted-foreground">
                          <span className="flex items-center gap-1 justify-center">
                            <User className="w-4 h-4 text-blue-500" /> Homens
                          </span>
                        </th>
                        <th className="px-4 py-3 font-medium text-muted-foreground">
                          <span className="flex items-center gap-1 justify-center">
                            <User className="w-4 h-4 text-pink-500" /> Mulheres
                          </span>
                        </th>
                        <th className="px-4 py-3 font-medium text-muted-foreground text-center">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g12Rows.map((row, idx) => (
                        <tr key={row.id} className={idx % 2 === 0 ? "bg-muted/30" : ""}>
                          <td className="px-4 py-3 font-medium">
                            {row.name}
                            {row.spouseName && (" & " + row.spouseName)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-bold text-sm">
                              {row.maleCells}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300 font-bold text-sm">
                              {row.femaleCells}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center font-semibold">
                            {row.maleCells + row.femaleCells}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </section>
        )}



      </div>
    </AppLayout>
  );
};

export default Dashboard;
