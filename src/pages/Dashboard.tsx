import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, UserCheck, Church, TrendingUp } from "lucide-react";
import AppLayout from "@/components/AppLayout";

const Dashboard = () => {
  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const [totalRes, activeRes, baptizedRes, pastorsRes] = await Promise.all([
        supabase.from("members").select("id", { count: "exact", head: true }),
        supabase.from("members").select("id", { count: "exact", head: true }).eq("is_active", true),
        supabase.from("members").select("id", { count: "exact", head: true }).eq("is_baptized", true),
        supabase.from("members").select("id", { count: "exact", head: true }).eq("is_pastor", true),
      ]);
      return {
        total: totalRes.count || 0,
        active: activeRes.count || 0,
        baptized: baptizedRes.count || 0,
        pastors: pastorsRes.count || 0,
      };
    },
  });

  const cards = [
    { title: "Total de Membros", value: stats?.total || 0, icon: Users, color: "text-secondary" },
    { title: "Membros Ativos", value: stats?.active || 0, icon: UserCheck, color: "text-success" },
    { title: "Batizados", value: stats?.baptized || 0, icon: Church, color: "text-accent" },
    { title: "Pastores", value: stats?.pastors || 0, icon: TrendingUp, color: "text-warning" },
  ];

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold">Painel</h1>
          <p className="text-muted-foreground">Visão geral da igreja</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map((card) => (
            <Card key={card.title}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{card.title}</CardTitle>
                <card.icon className={`w-5 h-5 ${card.color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{card.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  );
};

export default Dashboard;
