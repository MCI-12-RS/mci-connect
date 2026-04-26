import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Navigate } from "react-router-dom";

type EventRow = {
  id: string;
  occurred_at: string;
  actor_user_id: string | null;
  actor_label: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  entity_label: string | null;
  description: string;
  changed_fields: string[] | null;
  metadata: any;
  success: boolean;
  error_reason: string | null;
};

const ACTION_LABELS: Record<string, string> = {
  create: "Criação",
  update: "Atualização",
  delete: "Exclusão",
  login: "Login",
  login_failed: "Login (falha)",
  logout: "Logout",
  password_changed: "Senha alterada",
};

const ENTITY_LABELS: Record<string, string> = {
  member: "Membro",
  cell: "Célula",
  cell_report: "Relatório",
  cell_report_participant: "Participante",
  auth: "Autenticação",
};

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

const Events = () => {
  const { hasPermission, loading } = useAuth();

  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selected, setSelected] = useState<EventRow | null>(null);

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["events", actionFilter, entityFilter, statusFilter],
    queryFn: async () => {
      let q = supabase
        .from("events" as any)
        .select("*")
        .order("occurred_at", { ascending: false })
        .limit(500);

      if (actionFilter !== "all") q = q.eq("action", actionFilter);
      if (entityFilter !== "all") q = q.eq("entity", entityFilter);
      if (statusFilter !== "all") q = q.eq("success", statusFilter === "success");

      const { data, error } = await q;
      if (error) throw error;
      return (data as unknown as EventRow[]) ?? [];
    },
    enabled: hasPermission("view_audit_log"),
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return events;
    const s = search.toLowerCase();
    return events.filter((e) =>
      [e.actor_label, e.entity_label, e.description]
        .filter(Boolean)
        .some((f) => f!.toLowerCase().includes(s))
    );
  }, [events, search]);

  if (loading) return null;
  if (!hasPermission("view_audit_log")) return <Navigate to="/" replace />;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Auditoria</h1>
          <p className="text-muted-foreground text-sm">
            Histórico de ações do sistema
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Filtros</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Buscar</Label>
                <Input
                  placeholder="Autor, entidade, descrição..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Ação</Label>
                <Select value={actionFilter} onValueChange={setActionFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    {Object.entries(ACTION_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Entidade</Label>
                <Select value={entityFilter} onValueChange={setEntityFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    {Object.entries(ENTITY_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="success">Sucesso</SelectItem>
                    <SelectItem value="error">Erro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data/Hora</TableHead>
                    <TableHead>Autor</TableHead>
                    <TableHead>Ação</TableHead>
                    <TableHead>Entidade</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                        Carregando...
                      </TableCell>
                    </TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                        Nenhum evento encontrado
                      </TableCell>
                    </TableRow>
                  ) : filtered.map((e) => (
                    <TableRow
                      key={e.id}
                      className="cursor-pointer"
                      onClick={() => setSelected(e)}
                    >
                      <TableCell className="whitespace-nowrap text-sm">
                        {formatDateTime(e.occurred_at)}
                      </TableCell>
                      <TableCell className="text-sm">{e.actor_label || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{ACTION_LABELS[e.action] || e.action}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{ENTITY_LABELS[e.entity] || e.entity}</TableCell>
                      <TableCell className="text-sm">{e.description}</TableCell>
                      <TableCell>
                        {e.success ? (
                          <Badge variant="secondary">OK</Badge>
                        ) : (
                          <Badge variant="destructive">Erro</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
          <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
            {selected && (
              <>
                <SheetHeader>
                  <SheetTitle>Detalhes do evento</SheetTitle>
                  <SheetDescription>{formatDateTime(selected.occurred_at)}</SheetDescription>
                </SheetHeader>
                <div className="mt-6 space-y-4 text-sm">
                  <div>
                    <Label className="text-xs text-muted-foreground">Autor</Label>
                    <p>{selected.actor_label || "—"}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">Ação</Label>
                      <p>{ACTION_LABELS[selected.action] || selected.action}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Entidade</Label>
                      <p>{ENTITY_LABELS[selected.entity] || selected.entity}</p>
                    </div>
                  </div>
                  {selected.entity_label && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Identificação</Label>
                      <p>{selected.entity_label}</p>
                    </div>
                  )}
                  <div>
                    <Label className="text-xs text-muted-foreground">Descrição</Label>
                    <p>{selected.description}</p>
                  </div>
                  {selected.changed_fields && selected.changed_fields.length > 0 && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Campos alterados</Label>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {selected.changed_fields.map((f) => (
                          <Badge key={f} variant="outline" className="text-xs">{f}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {selected.metadata && Object.keys(selected.metadata).length > 0 && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Metadados</Label>
                      <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-x-auto">
                        {JSON.stringify(selected.metadata, null, 2)}
                      </pre>
                    </div>
                  )}
                  {selected.error_reason && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Erro</Label>
                      <p className="text-destructive">{selected.error_reason}</p>
                    </div>
                  )}
                </div>
              </>
            )}
          </SheetContent>
        </Sheet>
      </div>
    </AppLayout>
  );
};

export default Events;
