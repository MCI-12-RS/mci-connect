import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeQueries, resetFakeSupabase, respondWith, type FakeResponse } from "@/test/fake-supabase";
import type { CellReportDetailRow, CellReportPageRow } from "@/lib/cell-reports/fields";
import CellReports from "./CellReports";
import { reportRowLeaderColumns, reportSnapshotColumns } from "@/test/report-snapshot-fixture";

// QA do E2.01 PR 4 ("Ver relatório", T7): o que os testes do desenvolvedor
// (CellReports.sheet.test.tsx) não cobrem. A persona MB sem nenhuma permissão
// de relatório (UX-26), o foco ao fechar no celular (Acessibilidade) e o
// "Tentar de novo" num link direto ("Estados", defeito QA-E201-PR4-1).

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

vi.mock("@/components/AppLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u-self" },
    isSystem: false,
    permissionsLoaded: true,
    hasPermission: (...permissions: string[]) => permissions.some((p) => auth.permissions.has(p)),
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

// Os ids de relatório são UUIDs, como os do banco: um id malformado sai da URL sem ser lido.
const R1 = "00000000-0000-4000-8000-000000000001";
const R2 = "00000000-0000-4000-8000-000000000002";

const row = (overrides: Partial<CellReportPageRow>): CellReportPageRow => ({
  id: R1,
  cell_id: "c1",
  date: "2026-11-19",
  time: "20:00:00",
  theme: "Fé",
  observations: null,
  visitors: [],
  offering: 0,
  was_held: true,
  reason_not_held: null,
  visitors_count: 0,
  ...reportRowLeaderColumns,
  snapshot_leader_name: "Carlos Lima",
  cell_street: "Rua das Flores",
  cell_number: "120",
  cell_complement: null,
  cell_neighborhood: "Centro",
  cell_deleted: false,
  ...overrides,
});

// R1: célula de Carlos (não excluída); R2: célula de Rui (excluída).
const CARLOS_ROW = row({});
const RUI_ROW = row({ id: R2, date: "2026-11-12", snapshot_leader_name: "Rui Prado", cell_deleted: true });
const list = (...rows: CellReportPageRow[]): FakeResponse[] => [
  { data: rows, count: rows.length },
  { data: rows.map((r) => ({ id: r.id, participants_count: 3 })) },
];

const detail = (): CellReportDetailRow => ({
  id: R2,
  date: "2026-11-12",
  time: "20:00:00",
  theme: "Fé",
  observations: null,
  visitors: [],
  offering: 0,
  was_held: true,
  reason_not_held: null,
  cell_leader_name: "Rui Prado",
  cell_deleted: true,
  created_at: "2026-11-19T23:30:00Z",
  created_by_kind: "member",
  created_by_name: "Carla Dias",
  updated_at: null,
  updated_by_kind: null,
  updated_by_name: null,
  ...reportSnapshotColumns("Rui Prado"),
});
const SARA = { member_id: "m9", member_name: "Sara Reis", member_deleted: true };

const VIEW_RUI = "Ver o relatório de 12/11/2026 da célula de Rui Prado";

let currentSearch = "";
const LocationProbe = () => {
  currentSearch = useLocation().search;
  return null;
};
const urlParams = () => Object.fromEntries(new URLSearchParams(currentSearch));

function renderReports(url = "/cell-reports") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <CellReports />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const detailQueries = () =>
  fakeQueries().filter((q) => q.table === "cell_report_participants_view" || q.calls.some(([m]) => m === "maybeSingle"));

const originalWidth = window.innerWidth;
const setWidth = (width: number) => Object.defineProperty(window, "innerWidth", { configurable: true, value: width });

beforeEach(() => {
  resetFakeSupabase();
  setWidth(1280);
});
afterEach(() => setWidth(originalWidth));

describe("UX-26 (MB, só vê relatórios: sem edit_cell_report e sem delete_cell_report)", () => {
  beforeEach(() => {
    auth.permissions = new Set(["view_all_reports"]);
  });

  it("Desktop: a linha de célula excluída mostra o badge, sem coluna Ações e sem 'Ver relatório'", async () => {
    respondWith(...list(CARLOS_ROW, RUI_ROW));
    renderReports();

    await screen.findByText("Rui Prado");
    expect(screen.getByText("Célula excluída")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Ações" })).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /o relatório de/ })).toHaveLength(0);
  });

  it("Celular: o card de célula excluída não vira botão e não tem '⋯'; o ?report= sai da URL sem consultar o relatório", async () => {
    setWidth(360);
    respondWith(...list(CARLOS_ROW, RUI_ROW));
    renderReports(`/cell-reports?q=r&report=${R2}`);

    await screen.findByText("Rui Prado");
    expect(screen.getByText("Célula excluída")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: VIEW_RUI })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Ações do relatório/ })).not.toBeInTheDocument();
    await waitFor(() => expect(urlParams()).toEqual({ q: "r" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(detailQueries()).toHaveLength(0);
  });
});

describe("Acessibilidade (WCAG 2.4.3): o foco ao fechar o painel no celular", () => {
  beforeEach(() => {
    auth.permissions = new Set(["edit_cell_report", "delete_cell_report"]);
  });

  it("Celular: fechar o painel devolve o foco ao card que o abriu e tira o ?report=, mantendo a busca", async () => {
    setWidth(360);
    respondWith(...list(CARLOS_ROW, RUI_ROW));
    renderReports("/cell-reports?q=r");
    const card = await screen.findByRole("button", { name: VIEW_RUI });

    respondWith({ data: detail() }, { data: [SARA] });
    act(() => card.focus());
    fireEvent.click(card);
    const dialog = await screen.findByRole("dialog", { name: "Relatório de 12/11/2026" });
    expect(urlParams()).toEqual({ q: "r", report: R2 });

    fireEvent.click(within(dialog).getAllByRole("button", { name: "Fechar" })[0]);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(urlParams()).toEqual({ q: "r" });
    await waitFor(() => expect(card).toHaveFocus());
  });
});

describe("'Estados' (erro ao carregar) num link direto: QA-E201-PR4-1", () => {
  beforeEach(() => {
    auth.permissions = new Set(["edit_cell_report", "delete_cell_report"]);
  });

  // Defeito aberto: com o relatório fora da página da lista (um link
  // compartilhado para um relatório antigo, ou outra busca), "Tentar de novo"
  // fecha o painel enquanto consulta de novo e só o reabre com o resultado.
  // No navegador, com as 3 tentativas padrão do React Query, o painel some por
  // cerca de 7 s quando a falha continua (e2e/relatorio-celula-excluida.spec.ts).
  it("'Tentar de novo' mantém o painel aberto (carregando) até o resultado", async () => {
    // O painel consulta o relatório antes da lista (ver CellReports.sheet.test.tsx); a lista não traz R2.
    respondWith({ error: { code: "XX000", message: "falhou" } }, { data: [] }, ...list(CARLOS_ROW));
    renderReports(`/cell-reports?report=${R2}`);
    const failed = await screen.findByRole("dialog", { name: "Relatório" });
    const retry = within(failed).getByRole("button", { name: "Tentar de novo" });

    let release: () => void = () => {};
    const until = new Promise<void>((resolve) => {
      release = resolve;
    });
    respondWith({ data: detail(), until }, { data: [SARA], until });
    fireEvent.click(retry);

    // Enquanto consulta de novo (as duas leituras já saíram), o painel continua aberto.
    await waitFor(() => expect(detailQueries()).toHaveLength(4));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(document.querySelector('[role="dialog"]')?.getAttribute("data-state"), "o painel fechou durante a nova tentativa").toBe("open");

    release();
    const dialog = await screen.findByRole("dialog", { name: "Relatório de 12/11/2026" });
    expect(within(dialog).getByText("Sara Reis")).toBeInTheDocument();
    expect(urlParams()).toEqual({ report: R2 });
  });
});
