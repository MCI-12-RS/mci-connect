import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeQueries, fakeRpcs, resetFakeSupabase, respondToRpc, respondWith, type FakeResponse } from "@/test/fake-supabase";
import type { CellReportPageRow } from "@/lib/cell-reports/fields";
import CellReports from "./CellReports";
import { reportRowLeaderColumns } from "@/test/report-snapshot-fixture";

// O filtro Célula em Relatórios (E2.10, PR 3; T15, P84, RN-19): o chip pela `cell_identity`, o
// filtro por `cell_id`, "Limpar filtros", o vazio com filtros e nenhum texto técnico (UX-25, UX-30).

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

vi.mock("@/components/AppLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u-self" },
    access: null,
    permissionsLoaded: true,
    hasPermission: () => false,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const CELL = "e2e210c1-0000-0000-0000-000000000001";

const row = (overrides: Partial<CellReportPageRow>): CellReportPageRow => ({
  id: "r1",
  cell_id: CELL,
  date: "2026-11-18",
  time: "20:00:00",
  theme: "A fé que vence",
  observations: null,
  visitors: [],
  offering: 50,
  was_held: true,
  reason_not_held: null,
  visitors_count: 2,
  ...reportRowLeaderColumns,
  snapshot_leader_name: "André Souza",
  cell_street: "Rua das Flores",
  cell_number: "100",
  cell_complement: null,
  cell_neighborhood: "Centro",
  cell_deleted: false,
  ...overrides,
});

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

function renderReports(url: string, page: FakeResponse, identity?: FakeResponse) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (identity) respondToRpc("cell_identity", identity);
  const rows = Array.isArray(page.data) ? page.data : [];
  respondWith(page, ...(rows.length > 0 ? [{ data: rows.map((r: CellReportPageRow) => ({ id: r.id, participants_count: 8 })) }] : []));
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <CellReports />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const originalWidth = window.innerWidth;
const setWidth = (width: number) => Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
const location = () => screen.getByTestId("location").textContent;

beforeEach(() => {
  resetFakeSupabase();
  setWidth(360);
});
afterEach(() => setWidth(originalWidth));

describe("T15: filtro Célula (RN-19, UX-25)", () => {
  it("o chip 'Célula de {Líder} · {Dia} · {HH:mm}', a lista por cell_id e 'Limpar filtros'", async () => {
    renderReports(`/cell-reports?cell=${CELL}&size=50`, { data: [row({})], count: 4 }, {
      data: [{ cell_id: CELL, leader_name: "André Souza", meeting_day: "Quarta", meeting_time: "20:00:00", cell_deleted: false }],
    });
    const chip = await screen.findByRole("button", { name: "Remover filtro Célula de André Souza · Quarta · 20:00" });
    expect(chip).toHaveClass("min-h-9");
    expect(fakeQueries()[0].calls).toContainEqual(["eq", "cell_id", CELL]);
    expect(fakeRpcs().find((call) => call.fn === "cell_identity")?.args).toEqual({ _cell_id: CELL });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Relatórios de Células");

    respondWith({ data: [], count: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    await waitFor(() => expect(location()).toBe("?size=50"));
    await waitFor(() => expect(screen.getByLabelText("Buscar relatórios")).toHaveFocus());
  });

  it("tirar o chip tira só a célula; a busca fica", async () => {
    renderReports(`/cell-reports?cell=${CELL}&q=fe`, { data: [row({})], count: 1 }, {
      data: [{ cell_id: CELL, leader_name: "André Souza", meeting_day: "Quarta", meeting_time: "20:00:00", cell_deleted: false }],
    });
    const chip = await screen.findByRole("button", { name: /Remover filtro Célula de André Souza/ });
    respondWith({ data: [], count: 0 });
    fireEvent.click(chip);
    await waitFor(() => expect(location()).toBe("?q=fe"));
  });

  it("célula indisponível: o chip sem nome e sem id, a dica, e o vazio com filtros", async () => {
    renderReports(`/cell-reports?cell=${CELL}`, { data: [], count: 0 }, { data: [] });
    expect(await screen.findByRole("button", { name: "Remover filtro Célula indisponível" })).toBeInTheDocument();
    expect(screen.getByText("Esta célula não está disponível para você.")).toBeInTheDocument();
    expect(await screen.findByText("Nenhum relatório encontrado com estes filtros.")).toBeInTheDocument();
    expect(screen.getByRole("main").innerHTML).not.toContain(CELL);
  });

  it("carregando e falha da identificação: 'Célula: carregando…' e 'Célula: não carregada', sem texto técnico (UX-30)", async () => {
    renderReports(`/cell-reports?cell=${CELL}`, { data: [], count: 0 }, { data: [], until: new Promise(() => undefined) });
    expect(await screen.findByText("Célula: carregando…")).toBeInTheDocument();
  });

  it("falha da identificação: 'Célula: não carregada'", async () => {
    renderReports(`/cell-reports?cell=${CELL}`, { data: [], count: 0 }, { error: { code: "57014", message: "statement timeout" } });
    expect(await screen.findByText("Célula: não carregada")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/57014|statement|timeout|cell_identity/);
  });

  it("um cell sem formato de UUID sai da URL, sem consultar a identificação (P84)", async () => {
    renderReports("/cell-reports?cell=xyz&report=abc", { data: [], count: 0 });
    await waitFor(() => expect(location()).not.toContain("cell="));
    expect(fakeRpcs().some((call) => call.fn === "cell_identity")).toBe(false);
    expect(fakeQueries().every((query) => !query.calls.some(([method, column]) => method === "eq" && column === "cell_id"))).toBe(true);
  });

  it("sem filtro nem busca: o vazio de hoje, sem 'Limpar filtros'", async () => {
    renderReports("/cell-reports", { data: [], count: 0 });
    expect(await screen.findByText("Nenhum relatório encontrado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Limpar filtros" })).toBeNull();
  });
});
