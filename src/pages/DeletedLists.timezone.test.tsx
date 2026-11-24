import type { ReactNode } from "react";
import { describe, it, expect, afterAll, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { resetFakeSupabase, respondWith } from "@/test/fake-supabase";
import type { DeletedCellReportRow, DeletedCellRow, DeletedMemberRow } from "@/lib/deletion/deleted-lists";
import MembersDeleted from "./MembersDeleted";
import CellsDeleted from "./CellsDeleted";
import CellReportsDeleted from "./CellReportsDeleted";

// UX-15: "Excluído em dd/MM/aaaa às HH:mm" ("Excluída", na célula) no horário
// de Brasília mesmo com o navegador em outro fuso, e "por {Nome}" ou "Autor
// não registrado", nos cards (celular) e nas colunas da tabela (desktop) das
// três listas de excluídos. O fuso do processo vira o de Honolulu (UTC−10)
// antes de carregar os módulos (os formatadores de data são criados na
// carga): os instantes abaixo caem em outro dia e outra hora lá, em UTC e em
// Brasília. Esta máquina já está em Brasília, então sem isso o teste passaria
// mesmo sem o fuso fixo no código.
const originalTz = vi.hoisted(() => {
  const tz = process.env.TZ;
  process.env.TZ = "Pacific/Honolulu";
  return tz;
});

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

vi.mock("@/components/AppLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isSystem: false,
    permissionsLoaded: true,
    hasPermission: (...permissions: string[]) => permissions.includes("manage_roles"),
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

// 11/11/2026 09:30 UTC: 06:30 de 11/11 em Brasília, 23:30 de 10/11 em Honolulu.
const MORNING_UTC = "2026-11-11T09:30:00+00:00";
// 21/11/2026 01:15 UTC: 22:15 de 20/11 em Brasília, 15:15 de 20/11 em Honolulu.
const NIGHT_UTC = "2026-11-21T01:15:00Z";

const bruno: DeletedMemberRow = {
  id: "b1",
  name: "Bruno Almeida",
  is_active: true,
  leader_name: null,
  leader_deleted: false,
  restore_role_name: "Líder",
  has_account: false,
  deleted_at: MORNING_UTC,
  deleted_by_name: "Elisa Martins",
};

const paula: DeletedMemberRow = { ...bruno, id: "p1", name: "Paula Reis", deleted_at: NIGHT_UTC, deleted_by_name: null };

const rui: DeletedCellRow = {
  id: "c1",
  type: "Evangelística",
  meeting_day: "Quarta",
  meeting_time: "20:00:00",
  neighborhood: "Centro",
  leader_id: "m-rui",
  leader_name: "Rui Prado",
  leader_deleted: false,
  timothy_id: null,
  timothy_name: null,
  timothy_deleted: false,
  host_id: "m-quintino",
  host_name: "Quintino Reis",
  host_deleted: false,
  deleted_at: MORNING_UTC,
  deleted_by_name: "Elisa Martins",
};

const report: DeletedCellReportRow = {
  id: "r1",
  date: "2026-11-19",
  time: "20:00:00",
  was_held: true,
  theme: "Fé que move",
  cell_leader_name: "Carlos Lima",
  cell_deleted: false,
  week_taken: false,
  deleted_at: NIGHT_UTC,
  deleted_by_name: null,
};

const originalWidth = window.innerWidth;
const setWidth = (width: number) => Object.defineProperty(window, "innerWidth", { configurable: true, value: width });

function renderAt(path: string, element: ReactNode, rows: unknown[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  respondWith({ data: rows, count: rows.length });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={path} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("UX-15: data e hora da exclusão em Brasília, com o navegador em Honolulu", () => {
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  beforeEach(() => resetFakeSupabase());

  afterEach(() => setWidth(originalWidth));

  it("Dado o fuso de Honolulu no navegador, então o relógio e o Intl locais estão mesmo em outro dia (sanidade do teste)", () => {
    const local = new Date(MORNING_UTC);
    expect([local.getDate(), local.getHours(), local.getMinutes()]).toEqual([10, 23, 30]);
    expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("Pacific/Honolulu");
  });

  it("Membros, celular: 'Excluído em 11/11/2026 às 06:30', 'por Elisa Martins' e 'Autor não registrado'", async () => {
    setWidth(360);
    renderAt("/members/deleted", <MembersDeleted />, [bruno, paula]);

    const card = (await screen.findByText("Bruno Almeida")).closest("li");
    expect(within(card).getByText("Excluído em 11/11/2026 às 06:30")).toBeInTheDocument();
    expect(within(card).getByText("por Elisa Martins")).toBeInTheDocument();
    const other = screen.getByText("Paula Reis").closest("li");
    expect(within(other).getByText("Excluído em 20/11/2026 às 22:15")).toBeInTheDocument();
    expect(within(other).getByText("Autor não registrado")).toBeInTheDocument();
  });

  it("Membros, desktop: as colunas 'Excluído em' e 'Excluído por' no horário de Brasília", async () => {
    setWidth(1280);
    renderAt("/members/deleted", <MembersDeleted />, [bruno, paula]);

    const row = (await screen.findByText("Bruno Almeida")).closest("tr");
    expect(within(row).getByText("11/11/2026 06:30")).toBeInTheDocument();
    expect(within(row).getByText("Elisa Martins")).toBeInTheDocument();
    const other = screen.getByText("Paula Reis").closest("tr");
    expect(within(other).getByText("20/11/2026 22:15")).toBeInTheDocument();
    expect(within(other).getByText("Não registrado")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Excluído em" })).toBeInTheDocument();
  });

  it("Células, celular: 'Excluída em 11/11/2026 às 06:30' e 'por Elisa Martins' no card", async () => {
    setWidth(360);
    renderAt("/cells/deleted", <CellsDeleted />, [rui]);
    const card = (await screen.findByText("Célula de Rui Prado")).closest("li");
    expect(within(card).getByText("Excluída em 11/11/2026 às 06:30")).toBeInTheDocument();
    expect(within(card).getByText("por Elisa Martins")).toBeInTheDocument();
  });

  it("Células, desktop: a coluna 'Excluída em' no horário de Brasília", async () => {
    setWidth(1280);
    renderAt("/cells/deleted", <CellsDeleted />, [rui]);
    const row = (await screen.findByText("Rui Prado")).closest("tr");
    expect(within(row).getByText("11/11/2026 06:30")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Excluída em" })).toBeInTheDocument();
  });

  it("Relatórios, celular: 'Excluído em 20/11/2026 às 22:15', sem autor, e a data do relatório sem deslocar (19/11/2026)", async () => {
    setWidth(360);
    renderAt("/cell-reports/deleted", <CellReportsDeleted />, [report]);
    const card = (await screen.findByText("Célula de Carlos Lima")).closest("li");
    expect(within(card).getByText("Excluído em 20/11/2026 às 22:15")).toBeInTheDocument();
    expect(within(card).getByText("Autor não registrado")).toBeInTheDocument();
    expect(card).toHaveTextContent("Relatório de 19/11/2026 · 20:00");
  });

  it("Relatórios, desktop: a coluna 'Excluído em' no horário de Brasília e 'Não registrado'", async () => {
    setWidth(1280);
    renderAt("/cell-reports/deleted", <CellReportsDeleted />, [report]);
    const row = (await screen.findByText("Carlos Lima")).closest("tr");
    expect(within(row).getByText("20/11/2026 22:15")).toBeInTheDocument();
    expect(within(row).getByText("Não registrado")).toBeInTheDocument();
    expect(within(row).getByText("19/11/2026")).toBeInTheDocument();
  });
});
