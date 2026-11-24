import type { ReactNode } from "react";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeQueries, fakeRpcs, resetFakeSupabase, respondToRpc, respondWith } from "@/test/fake-supabase";
import type { CellReportPageRow } from "@/lib/cell-reports/fields";
import CellReports from "./CellReports";

// Ação "Excluir" e relatório de célula excluída na lista de Relatórios
// (E2.01, T1, T2, T7, UX-01 a UX-04, UX-25 e a parte do UX-26 deste PR).

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

vi.mock("@/components/AppLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

const auth = vi.hoisted(() => ({ permissions: new Set<string>(), permissionsLoaded: true }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u-self" },
    isSystem: false,
    permissionsLoaded: auth.permissionsLoaded,
    hasPermission: (...permissions: string[]) => permissions.some((p) => auth.permissions.has(p)),
  }),
}));

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const row = (overrides: Partial<CellReportPageRow>): CellReportPageRow => ({
  id: "r1",
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
  cell_leader_name: "Carlos Lima",
  cell_street: "Rua das Flores",
  cell_number: "120",
  cell_complement: null,
  cell_neighborhood: "Centro",
  cell_deleted: false,
  ...overrides,
});

const rows = [row({}), row({ id: "r2", date: "2026-11-12", cell_leader_name: "Rui Prado", cell_deleted: true })];

function renderReports() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  respondWith({ data: rows, count: rows.length }, { data: rows.map((r) => ({ id: r.id, participants_count: 3 })) });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CellReports />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const originalWidth = window.innerWidth;
const setWidth = (width: number) => Object.defineProperty(window, "innerWidth", { configurable: true, value: width });

describe("Relatórios: ação Excluir e célula excluída", () => {
  beforeEach(() => {
    resetFakeSupabase();
    toast.mockClear();
    auth.permissions = new Set(["delete_cell_report", "edit_cell_report"]);
    setWidth(1280);
  });

  afterEach(() => setWidth(originalWidth));

  it("Relatório de célula excluída: badge 'Célula excluída', sem 'Editar' e com 'Excluir' (UX-25, RN-11)", async () => {
    renderReports();
    await screen.findByText("Rui Prado");
    expect(screen.getAllByText("Célula excluída")).toHaveLength(1);
    // Os rótulos trazem a data e o líder: muitas células se reúnem no mesmo dia.
    expect(screen.getAllByRole("button", { name: /^Editar o relatório/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Editar o relatório de 19/11/2026 da célula de Carlos Lima" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Excluir o relatório de 12/11/2026 da célula de Rui Prado" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Excluir o relatório de 19/11/2026 da célula de Carlos Lima" })).toBeInTheDocument();
  });

  it("Desktop: a confirmação traz a data e o líder, sem o aviso de inativar, e exclui pela RPC (UX-02, UX-04, UX-07)", async () => {
    renderReports();
    const button = await screen.findByRole("button", { name: "Excluir o relatório de 19/11/2026 da célula de Carlos Lima" });
    expect(button.querySelector("svg")).toHaveClass("text-muted-foreground");
    fireEvent.click(button);

    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("heading", { name: "Excluir o relatório de 19/11/2026 da célula de Carlos Lima?" }),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/inativ/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toHaveFocus();

    respondToRpc("delete_cell_report", {});
    fireEvent.click(within(dialog).getByRole("button", { name: "Excluir relatório" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Relatório excluído." }));
    expect(fakeRpcs().map((call) => [call.fn, call.args])).toEqual([["delete_cell_report", { _report_id: "r1" }]]);
    expect(fakeQueries().some((query) => query.methods().includes("delete"))).toBe(false);
  });

  it("Sem delete_cell_report, nenhuma ação de excluir aparece (UX-03)", async () => {
    auth.permissions = new Set(["edit_cell_report"]);
    renderReports();
    await screen.findByText("Rui Prado");
    expect(screen.queryByRole("button", { name: /^Excluir/ })).not.toBeInTheDocument();
  });

  it("Celular: 'Excluir relatório' fica no '⋯'; o relatório de célula excluída mostra o badge e não tem 'Editar' (UX-01, UX-25)", async () => {
    setWidth(360);
    renderReports();
    const menu = await screen.findByRole("button", { name: "Ações do relatório de 12/11/2026 da célula de Rui Prado" });
    expect(menu).toHaveClass("h-11", "w-11");
    expect(screen.getByText("Célula excluída")).toBeInTheDocument();
    const edits = screen.getAllByRole("button", { name: /^Editar o relatório/ });
    expect(edits).toHaveLength(1);
    expect(edits[0]).toHaveClass("h-11", "w-11");
    expect(screen.queryByRole("button", { name: /^Excluir/ })).not.toBeInTheDocument();

    fireEvent.keyDown(menu, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Excluir relatório" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("heading", { name: "Excluir o relatório de 12/11/2026 da célula de Rui Prado?" }),
    ).toBeInTheDocument();
  });
});

// O Select e o Checkbox do CellReportForm medem o tamanho com ResizeObserver (o jsdom não tem).
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("Relatórios: o foco volta a quem abriu o diálogo (Acessibilidade, WCAG 2.4.3)", () => {
  beforeAll(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
  afterAll(() => vi.unstubAllGlobals());
  beforeEach(() => {
    resetFakeSupabase();
    toast.mockClear();
    auth.permissions = new Set(["delete_cell_report", "edit_cell_report"]);
    setWidth(1280);
  });

  afterEach(() => setWidth(originalWidth));

  it("Celular: 'Cancelar' na confirmação devolve o foco ao '⋯' do card, que abriu o menu", async () => {
    setWidth(360);
    renderReports();
    const menu = await screen.findByRole("button", { name: "Ações do relatório de 19/11/2026 da célula de Carlos Lima" });
    fireEvent.keyDown(menu, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Excluir relatório" }));
    const dialog = await screen.findByRole("alertdialog");

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(menu).toHaveFocus());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("Desktop: depois de excluir, o relatório sai da lista e o foco vai para a busca", async () => {
    renderReports();
    const trash = await screen.findByRole("button", { name: "Excluir o relatório de 19/11/2026 da célula de Carlos Lima" });
    act(() => trash.focus());
    fireEvent.click(trash);
    const dialog = await screen.findByRole("alertdialog");
    respondToRpc("delete_cell_report", {});
    // A lista recarregada, só com o relatório de Rui.
    respondWith({ data: [rows[1]], count: 1 }, { data: [{ id: "r2", participants_count: 3 }] });

    fireEvent.click(within(dialog).getByRole("button", { name: "Excluir relatório" }));

    await waitFor(() => expect(screen.getByRole("textbox", { name: "Buscar relatórios" })).toHaveFocus());
    expect(trash).not.toBeInTheDocument();
    expect(screen.getByText("Rui Prado")).toBeInTheDocument();
  });

  it("Desktop: 'Cancelar' no formulário aberto pelo 'Editar' devolve o foco a esse ícone, que traz a data e o líder", async () => {
    renderReports();
    const edit = await screen.findByRole("button", { name: "Editar o relatório de 19/11/2026 da célula de Carlos Lima" });
    // Os participantes salvos do relatório.
    respondWith({ data: [] });
    act(() => edit.focus());
    fireEvent.click(edit);
    const form = await screen.findByRole("dialog", { name: "Editar Relatório" });

    fireEvent.click(within(form).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(edit).toHaveFocus());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
