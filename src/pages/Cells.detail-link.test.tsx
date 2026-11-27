import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { resetFakeSupabase, respondToRpc } from "@/test/fake-supabase";
import type { CellListRow } from "@/lib/cells/fields";
import { rememberOpenedCell } from "@/hooks/use-list-return-focus";
import Cells from "./Cells";

// O link de cada célula para o detalhe (E2.10, PR 5, P81, UX-15) e a volta com
// o foco na célula aberta (UXD-10, AQ-8, UX-17). O cálculo do nome acessível do
// jsdom põe um espaço entre o nome e o `sr-only` (", nível 144"); o navegador, não.

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});
vi.mock("@/components/AppLayout", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u" }, access: null, hasPermission: () => true }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

function cell(id: string, leader: string, overrides: Partial<CellListRow> = {}): CellListRow {
  return {
    id,
    leader_id: `l-${id}`,
    timothy_id: null,
    host_id: null,
    type: "Evangelística",
    meeting_day: "Quarta",
    meeting_time: "20:00:00",
    street: "Rua das Flores",
    number: "100",
    complement: null,
    neighborhood: "Centro",
    city: null,
    state: null,
    zip_code: null,
    is_active: true,
    leader_name: leader,
    leader_g12_level: 2,
    leader_is_pastor: false,
    leader_gender: "M",
    timothy_name: "Caio Lima",
    host_name: "Carla Dias",
    g12_leader_name: "Pedro Alves",
    can_submit_report: true,
    report_status: "pending",
    report_missing_weeks: 0,
    ...overrides,
  };
}

const C1 = cell("c1", "André Souza");
const C2 = cell("c2", "Diego Reis");

const originalWidth = window.innerWidth;
const setWidth = (width: number) => Object.defineProperty(window, "innerWidth", { configurable: true, value: width });

function DetailProbe() {
  const location = useLocation();
  return <p data-testid="detail">{`${location.pathname} ${JSON.stringify(location.state)}`}</p>;
}

function renderCells(rows: CellListRow[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  respondToRpc("cells_list", { data: rows });
  respondToRpc("cells_list_count", { data: rows.length });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/cells"]}>
        <Routes>
          <Route path="/cells" element={<Cells />} />
          <Route path="/cells/:id" element={<DetailProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetFakeSupabase();
  window.sessionStorage.clear();
});
afterEach(() => setWidth(originalWidth));

describe("UX-15: o cartão abre o detalhe (360 px)", () => {
  it("o link tem o nome 'Célula de André Souza, nível 144' e leva fromList", async () => {
    setWidth(360);
    renderCells([C1, C2]);
    const link = await screen.findByRole("link", { name: /^Célula de André Souza ?, nível 144$/ });
    expect(link).toHaveAttribute("href", "/cells/c1");
    expect(link.className).toContain("after:absolute");
    expect(link.className).toContain("after:inset-0");
    fireEvent.click(link);
    expect(await screen.findByTestId("detail")).toHaveTextContent('/cells/c1 {"fromList":true}');
  });

  it("as ações ficam fora do link, por cima dele", async () => {
    setWidth(360);
    renderCells([C1]);
    const link = await screen.findByRole("link", { name: /^Célula de André Souza ?, nível 144$/ });
    const card = link.closest("li") as HTMLElement;
    const newReport = within(card).getByRole("button", { name: "Novo relatório da célula de André Souza" });
    expect(link.contains(newReport)).toBe(false);
    expect(newReport.closest(".relative.z-10")).not.toBeNull();
  });
});

describe("UX-15: na tabela (1280 px), o nome do líder é o link e a linha é um atalho do mouse", () => {
  it("o clique na linha abre o detalhe", async () => {
    setWidth(1280);
    renderCells([C1, C2]);
    await screen.findByRole("link", { name: /^Célula de Diego Reis ?, nível 144$/ });
    const row = screen.getByRole("link", { name: /^Célula de Diego Reis ?, nível 144$/ }).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getAllByRole("cell")[2]);
    expect(await screen.findByTestId("detail")).toHaveTextContent("/cells/c2");
  });

  it("o clique num ícone de ação não navega", async () => {
    setWidth(1280);
    renderCells([C1]);
    await screen.findByRole("link", { name: /^Célula de André Souza ?, nível 144$/ });
    fireEvent.click(screen.getByRole("button", { name: "Editar a célula de André Souza" }));
    expect(screen.queryByTestId("detail")).not.toBeInTheDocument();
  });
});

describe("UX-17: a volta do detalhe põe o foco na célula aberta", () => {
  it("a célula está na página: o foco vai para o link dela", async () => {
    setWidth(360);
    rememberOpenedCell("c2");
    renderCells([C1, C2]);
    const link = await screen.findByRole("link", { name: /^Célula de Diego Reis ?, nível 144$/ });
    await waitFor(() => expect(link).toHaveFocus());
    expect(window.sessionStorage.length).toBe(0);
  });

  it("a célula não está na página (ou foi excluída): o foco vai para o título", async () => {
    setWidth(360);
    rememberOpenedCell("c9");
    renderCells([C1]);
    await screen.findByRole("link", { name: /^Célula de André Souza ?, nível 144$/ });
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Células" })).toHaveFocus());
  });
});
