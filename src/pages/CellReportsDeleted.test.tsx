import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeRpcs, resetFakeSupabase, respondToRpc, respondWith } from "@/test/fake-supabase";
import type { DeletedCellReportRow } from "@/lib/deletion/deleted-lists";
import CellReportsDeleted from "./CellReportsDeleted";

// Relatórios excluídos (E2.01, T4 e T6): a semana ocupada antecipada pela
// lista abre o bloqueio sem chamar o servidor (UX-23), e o relatório de
// célula excluída mostra o badge (UX-25).

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

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const taken: DeletedCellReportRow = {
  id: "r1",
  date: "2026-11-19",
  time: "20:00:00",
  was_held: true,
  theme: "Fé que move",
  cell_leader_name: "Carlos Lima",
  cell_deleted: true,
  week_taken: true,
  deleted_at: "2026-11-20T11:00:00Z",
  deleted_by_name: "Gil Souza",
};

const free: DeletedCellReportRow = {
  ...taken,
  id: "r2",
  date: "2026-11-12",
  was_held: false,
  theme: null,
  cell_leader_name: "Yara Melo",
  cell_deleted: false,
  week_taken: false,
};

const appError = (code: string, message: string, extra: object = {}) => ({
  error: { code: "22023", message, details: JSON.stringify({ code, ...extra }), hint: "app_error" },
});

const Where = () => {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
};

const originalWidth = window.innerWidth;
const setWidth = (width: number) => Object.defineProperty(window, "innerWidth", { configurable: true, value: width });

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  respondWith({ data: [taken, free], count: 2 });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/cell-reports/deleted"]}>
        <Routes>
          <Route path="/cell-reports/deleted" element={<CellReportsDeleted />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Relatórios excluídos", () => {
  beforeEach(() => {
    resetFakeSupabase();
    toast.mockClear();
    setWidth(360);
  });

  afterEach(() => setWidth(originalWidth));

  it("Card: a célula, o badge 'Célula excluída', a data, a situação, o tema e o aviso da semana (T4, UX-25)", async () => {
    renderPage();
    const card = (await screen.findByText("Célula de Carlos Lima")).closest("li");
    expect(within(card).getByText("Célula excluída")).toBeInTheDocument();
    expect(card).toHaveTextContent("Relatório de 19/11/2026 · 20:00");
    expect(within(card).getByText("Realizada")).toBeInTheDocument();
    expect(card).toHaveTextContent("Tema: Fé que move");
    expect(card).toHaveTextContent("Excluído em 20/11/2026 às 08:00");
    expect(card).toHaveTextContent("Já há outro relatório desta célula na mesma semana.");

    const other = screen.getByText("Célula de Yara Melo").closest("li");
    expect(within(other).getByText("Não realizada")).toBeInTheDocument();
    expect(other).not.toHaveTextContent("Célula excluída");
    expect(other).not.toHaveTextContent("Já há outro relatório");
  });

  it("Semana ocupada: o bloqueio abre sem chamar o servidor, e 'Ver relatórios da célula' busca pelo líder (UX-23)", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Restaurar o relatório de 19/11/2026 da célula de Carlos Lima" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Não é possível restaurar o relatório de 19/11/2026 da célula de Carlos Lima" });
    expect(dialog).toHaveTextContent("Esta célula já tem outro relatório na mesma semana. Exclua-o antes de restaurar este.");
    expect(fakeRpcs()).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole("button", { name: "Ver relatórios da célula" }));
    expect(await screen.findByTestId("where")).toHaveTextContent("/cell-reports?q=Carlos+Lima");
  });

  it("Recusa do servidor pela semana: a mesma ação, com o líder da linha", async () => {
    renderPage();
    respondToRpc(
      "restore_cell_report",
      appError("restore_week_taken", "Esta célula já tem outro relatório na mesma semana. Exclua-o antes de restaurar este.", {
        report_id: "r9",
        week_start: "2026-11-09",
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Restaurar o relatório de 12/11/2026 da célula de Yara Melo" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Não é possível restaurar o relatório de 12/11/2026 da célula de Yara Melo" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ver relatórios da célula" }));
    expect(await screen.findByTestId("where")).toHaveTextContent("/cell-reports?q=Yara+Melo");
  });

  it("Restaurando: o nome do botão traz a data e o líder e acompanha o texto visível (Acessibilidade, WCAG 2.5.3)", async () => {
    renderPage();
    let finish: () => void = () => {};
    respondToRpc("restore_cell_report", { until: new Promise<void>((resolve) => (finish = resolve)) });
    respondWith({ data: [taken], count: 1 });

    const button = await screen.findByRole("button", { name: "Restaurar o relatório de 12/11/2026 da célula de Yara Melo" });
    fireEvent.click(button);

    await waitFor(() => expect(button).toHaveTextContent("Restaurando…"));
    expect(button).toHaveAccessibleName("Restaurando o relatório de 12/11/2026 da célula de Yara Melo…");
    expect(screen.getByRole("button", { name: "Restaurar o relatório de 19/11/2026 da célula de Carlos Lima" })).toHaveTextContent(
      "Restaurar",
    );
    await act(async () => finish());
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Relatório restaurado." }));
  });

  it("Sucesso: o toast do Negócio", async () => {
    renderPage();
    respondToRpc("restore_cell_report", {});
    respondWith({ data: [taken], count: 1 });
    fireEvent.click(await screen.findByRole("button", { name: "Restaurar o relatório de 12/11/2026 da célula de Yara Melo" }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Relatório restaurado." }));
    expect(fakeRpcs().map((call) => [call.fn, call.args])).toEqual([["restore_cell_report", { _report_id: "r2" }]]);
  });
});
