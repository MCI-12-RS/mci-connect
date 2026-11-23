import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { createQueryWrapper } from "@/test/query-wrapper";
import { fakeQueries, fakeRpcs, resetFakeSupabase, respondToRpc } from "@/test/fake-supabase";
import { PERMISSION_DENIED } from "@/lib/errors";
import Dashboard from "./Dashboard";

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

// O menu lateral e a sessão não fazem parte do que se testa aqui.
vi.mock("@/components/AppLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));

const summaryRow = {
  week_start: "2026-11-29",
  week_end: "2026-12-05",
  reports_sent: 41,
  cells_pending: 6,
  visitors: 17,
  cells_not_held: 2,
  members_total: 1530,
  members_active: 1402,
  members_inactive: 128,
  members_baptized: 1011,
  members_not_baptized: 519,
  members_without_leader: 5,
  members_without_cell_link: 213,
};

const cellsByType = [
  { cell_type: "Discipulado", total: 450 },
  { cell_type: "Evangelística", total: 750 },
];

const ranking = [
  { couple_key: "a|b", name: "Bruno", spouse_name: "Ana", male_cells: 3, female_cells: 4, total_cells: 7 },
  { couple_key: "c", name: "Carla", spouse_name: null, male_cells: 0, female_cells: 0, total_cells: 0 },
];

const denied = { error: { code: PERMISSION_DENIED, message: "Você não tem permissão para ver o dashboard." } };
const failure = { error: { code: "08006", message: "connection failure" } };

function renderDashboard() {
  return render(<Dashboard />, { wrapper: createQueryWrapper() });
}

/** Deixa as respostas (e as novas tentativas, com os atrasos do padrão) acontecerem. */
async function settle() {
  await act(() => vi.advanceTimersByTimeAsync(60_000));
}

/** O valor exibido no card (o `Card` do shadcn) com esse título. */
function cardValue(title: string) {
  const card = screen.getByRole("heading", { name: title }).closest<HTMLElement>("div.rounded-lg");
  if (!card) throw new Error(`Card "${title}" não encontrado`);
  return within(card).getByText(/^\d+$/).textContent;
}

describe("Dashboard (RN-02, RN-08, RN-09)", () => {
  beforeEach(() => {
    resetFakeSupabase();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("Dado o dashboard carregando, então os cards aparecem sem nenhum número (nada de 0)", () => {
    respondToRpc("dashboard_summary", { data: [summaryRow] });
    respondToRpc("dashboard_cells_by_type", { data: cellsByType });
    respondToRpc("dashboard_g12_ranking", { data: ranking });

    renderDashboard();

    expect(screen.getByRole("heading", { name: "Total de Membros" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Relatórios Enviados" })).toBeInTheDocument();
    expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument();
  });

  it("Dadas as três RPCs, quando carrega, então faz só as três chamadas e mostra os números e a semana delas, sem somar nada", async () => {
    respondToRpc("dashboard_summary", { data: [summaryRow] });
    respondToRpc("dashboard_cells_by_type", { data: cellsByType });
    respondToRpc("dashboard_g12_ranking", { data: ranking });

    renderDashboard();
    await settle();

    expect(fakeQueries()).toHaveLength(0);
    expect(fakeRpcs().map((call) => [call.fn, call.args])).toEqual([
      ["dashboard_summary", undefined],
      ["dashboard_cells_by_type", undefined],
      ["dashboard_g12_ranking", undefined],
    ]);

    expect(screen.getByRole("heading", { name: "Esta Semana (29/11 - 05/12)" })).toBeInTheDocument();
    expect(cardValue("Relatórios Enviados")).toBe("41");
    expect(cardValue("Células sem Relatório")).toBe("6");
    expect(cardValue("Visitantes em Células")).toBe("17");
    expect(cardValue("Células Não Realizadas")).toBe("2");
    expect(cardValue("Total de Membros")).toBe("1530");
    expect(cardValue("Membros Ativos")).toBe("1402");
    expect(cardValue("Membros Inativos")).toBe("128");
    expect(cardValue("Batizados")).toBe("1011");
    expect(cardValue("Não Batizados")).toBe("519");
    expect(cardValue("Sem Liderança")).toBe("5");
    expect(cardValue("Sem Vínculo Celular")).toBe("213");
    expect(cardValue("Células Discipulado")).toBe("450");
    expect(cardValue("Células Evangelística")).toBe("750");

    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent))).toEqual([
      ["Bruno & Ana", "3", "4", "7"],
      ["Carla", "0", "0", "0"],
    ]);
  });

  it.each(["dashboard_summary", "dashboard_cells_by_type", "dashboard_g12_ranking"])(
    "Dado um usuário sem permissão, quando %s responde 42501, então mostra só o cabeçalho e o acesso negado",
    async (fn) => {
      const ok = {
        dashboard_summary: { data: [summaryRow] },
        dashboard_cells_by_type: { data: cellsByType },
        dashboard_g12_ranking: { data: ranking },
      };
      for (const [rpc, response] of Object.entries(ok)) respondToRpc(rpc, rpc === fn ? denied : response);

      renderDashboard();
      await settle();

      expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
      expect(screen.getByText("Você não tem acesso ao dashboard.")).toBeInTheDocument();
      expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
      expect(screen.queryByText("Erro ao carregar o dashboard.")).not.toBeInTheDocument();
    },
  );

  it("Dada uma falha no resumo, quando as novas tentativas se esgotam, então as seções dele mostram o erro e o resto aparece", async () => {
    respondToRpc("dashboard_summary", failure, failure, failure, failure);
    respondToRpc("dashboard_cells_by_type", { data: cellsByType });
    respondToRpc("dashboard_g12_ranking", { data: ranking });

    renderDashboard();
    await settle();

    const errors = screen.getAllByText("Erro ao carregar o dashboard.");
    expect(errors).toHaveLength(2);
    expect(screen.queryByRole("heading", { name: "Total de Membros" })).not.toBeInTheDocument();
    expect(cardValue("Células Evangelística")).toBe("750");
    // Na seção Geral, a mensagem fica no lugar dos cards de membros, antes dos tipos.
    const typeCard = screen.getByRole("heading", { name: "Células Evangelística" });
    expect(errors[1].compareDocumentPosition(typeCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("Dada uma falha só nos tipos, então os cards de membros aparecem e a mensagem fica no lugar dos tipos", async () => {
    respondToRpc("dashboard_summary", { data: [summaryRow] });
    respondToRpc("dashboard_cells_by_type", failure, failure, failure, failure);
    respondToRpc("dashboard_g12_ranking", { data: ranking });

    renderDashboard();
    await settle();

    expect(screen.getAllByText("Erro ao carregar o dashboard.")).toHaveLength(1);
    expect(cardValue("Sem Vínculo Celular")).toBe("213");
    expect(screen.queryByText(/^Células (Discipulado|Evangelística)/)).not.toBeInTheDocument();
  });

  it("Dadas falhas no resumo e nos tipos, então a seção Geral mostra uma mensagem só", async () => {
    respondToRpc("dashboard_summary", failure, failure, failure, failure);
    respondToRpc("dashboard_cells_by_type", failure, failure, failure, failure);
    respondToRpc("dashboard_g12_ranking", failure, failure, failure, failure);

    renderDashboard();
    await settle();

    // Esta Semana, Geral e Células por G12: uma mensagem em cada.
    expect(screen.getAllByText("Erro ao carregar o dashboard.")).toHaveLength(3);
  });

  it("Dados sem células e sem casais G12, então os cards por tipo e o ranking ficam ocultos", async () => {
    respondToRpc("dashboard_summary", { data: [summaryRow] });
    respondToRpc("dashboard_cells_by_type", { data: [] });
    respondToRpc("dashboard_g12_ranking", { data: [] });

    renderDashboard();
    await settle();

    expect(cardValue("Total de Membros")).toBe("1530");
    expect(screen.queryByText(/^Células (Discipulado|Evangelística)/)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Células por G12" })).not.toBeInTheDocument();
  });
});
