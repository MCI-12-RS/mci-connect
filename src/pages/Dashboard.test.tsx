import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeQueries, fakeRpcs, resetFakeSupabase, respondToRpc } from "@/test/fake-supabase";
import { refreshAfterReportWrite } from "@/lib/query-refresh";
import { PERMISSION_DENIED } from "@/lib/errors";
import { NO_ACCESS, type Access } from "@/lib/access/access";
import Dashboard from "./Dashboard";

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

// O menu lateral e a sessão não fazem parte do que se testa aqui.
vi.mock("@/components/AppLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
// O acesso do usuário logado (E2.02, `my_access`); `null` = o de quem vê a igreja toda (o padrão dos testes).
const auth = vi.hoisted(() => {
  const state: { access: Access | null } = { access: null };
  return state;
});
const CHURCH_ACCESS: Access = {
  ...NO_ACCESS,
  member_id: "m-rita",
  role_id: "r-admin",
  role_name: "Administrador",
  permissions: ["view_dashboard", "view_all_church"],
  sees_whole_church: true,
  sees_ministry: true,
  sees_whole_church_reports: true,
  sees_ministry_reports: true,
};
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ access: auth.access ?? CHURCH_ACCESS, permissionsLoaded: true }),
}));


/** A variação "Painel" de Carla (T6): vê o Dashboard e os relatórios, mas não Membros nem Células. */
const PANEL_ACCESS: Access = {
  ...NO_ACCESS,
  member_id: "m-carla",
  role_id: "r-painel",
  role_name: "Painel",
  permissions: ["view_dashboard", "view_own_reports"],
};

const summaryRow = {
  week_start: "2026-11-22",
  week_end: "2026-11-28",
  reports_sent: 2,
  reports_held: 2,
  cells_pending: 1,
  visitors: 8,
  cells_not_held: 0,
  members_new: 1,
  cells_new: 1,
  members_total: 1530,
  members_active: 1402,
  members_inactive: 128,
  members_baptized: 1011,
  members_not_baptized: 519,
  members_without_leader: 5,
  members_without_cell_link: 0,
  cells_evangelistic: 3,
  cells_discipleship: 2,
  cells_macrocell: 0,
};

const zeroWeek = { ...summaryRow, reports_sent: 0, reports_held: 0, cells_pending: 0, visitors: 0, members_new: 0, cells_new: 0 };

const ranking = [
  {
    couple_key: "p|q",
    name: "Pedro",
    spouse_name: "Paula",
    male_cells: 1,
    female_cells: 1,
    total_cells: 2,
    g12_ids: ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"],
  },
  { couple_key: "t", name: "Tiago", spouse_name: null, male_cells: 0, female_cells: 0, total_cells: 0, g12_ids: ["33333333-3333-4333-8333-333333333333"] },
];

const denied = { error: { code: PERMISSION_DENIED, message: "Você não tem permissão para ver o dashboard." } };
const failure = { error: { code: "08006", message: "connection failure" } };

function renderDashboard(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

/** Deixa as respostas acontecerem. */
async function settle() {
  await act(() => vi.advanceTimersByTimeAsync(60_000));
}

function respondAll(summary: object = summaryRow, rows: object[] = ranking) {
  respondToRpc("dashboard_summary", { data: [summary] });
  respondToRpc("dashboard_g12_ranking", { data: rows });
}

/** A seção pelo `h2` (o `aria-labelledby`). */
function section(name: RegExp | string) {
  return screen.getByRole("region", { name });
}

describe("Dashboard (E2.14, T1 a T7)", () => {
  beforeEach(() => {
    resetFakeSupabase();
    auth.access = null;
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("Dadas as duas RPCs, quando carrega, então faz só as duas chamadas, sem consulta a tabelas e sem a dos tipos", async () => {
    respondAll();
    renderDashboard();
    await settle();

    expect(fakeQueries()).toHaveLength(0);
    expect(fakeRpcs().map((call) => call.fn).sort()).toEqual(["dashboard_g12_ranking", "dashboard_summary"]);
  });

  it("Dado o carregamento, então só os cinco cards sempre à vista aparecem, com dois anúncios de carregando (P112)", async () => {
    respondAll();
    renderDashboard();

    const statuses = screen.getAllByRole("status");
    expect(statuses.map((status) => status.textContent)).toEqual(["Carregando…", "Carregando…"]);
    expect(within(section(/Esta semana/)).getAllByRole("listitem")).toHaveLength(3);
    expect(within(section("Geral")).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText("Relatórios de células")).not.toBeInTheDocument();
    expect(screen.queryByText("Células por G12")).not.toBeInTheDocument();

    await settle();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("Dados os números, então mostra os títulos da RN-16, a semana e esconde os zeros (RN-14)", async () => {
    respondAll();
    renderDashboard();
    await settle();

    const week = section(/Esta semana/);
    expect(screen.getByRole("heading", { level: 2, name: "Esta semana, de 22/11 a 28/11" })).toBeInTheDocument();
    expect(within(week).getByText("Relatórios enviados")).toBeInTheDocument();
    expect(within(week).getByText("Novos membros")).toBeInTheDocument();
    expect(within(week).queryByText("Células não realizadas")).not.toBeInTheDocument();
    const general = section("Geral");
    expect(within(general).getByText("Células evangelísticas")).toBeInTheDocument();
    expect(within(general).queryByText("Macrocélulas")).not.toBeInTheDocument();
    expect(within(general).queryByText("Sem vínculo celular")).not.toBeInTheDocument();
    expect(within(general).getByText("1.530")).toBeInTheDocument();
  });

  it("Dado quem vê a igreja toda, então cada número maior que zero abre a lista, com o nome acessível do P110", async () => {
    respondAll();
    renderDashboard();
    await settle();

    const pending = screen.getByRole("link", { name: "Células com relatório pendente: 1, ver na lista de Células" });
    expect(pending).toHaveAttribute("href", "/cells?report_status=pending");
    expect(screen.getByRole("link", { name: "Total de membros: 1.530, ver na lista de Membros" })).toHaveAttribute("href", "/members");
    expect(screen.getByRole("link", { name: "Célula realizada: 2, ver na lista de Relatórios" })).toHaveAttribute(
      "href",
      "/cell-reports?from=2026-11-22&to=2026-11-28&held=yes",
    );
    // A parte com zero fica sem link.
    expect(screen.queryByRole("link", { name: /^Não houve célula/ })).not.toBeInTheDocument();
  });

  it("Dado o Painel de Carla, então os números de Membros e Células ficam sem link, e os de Relatórios abrem (T6)", async () => {
    auth.access = PANEL_ACCESS;
    respondAll();
    renderDashboard();
    await settle();

    expect(screen.queryByRole("link", { name: /Total de membros/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Células com relatório pendente/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Relatórios enviados: 2/ })).toBeInTheDocument();
  });

  it("Dado o card de pendentes, então tem o tom de aviso acima de zero e o de sucesso com zero (RN-15)", async () => {
    respondAll(zeroWeek);
    renderDashboard();
    await settle();

    const card = within(section(/Esta semana/)).getByText("Células com relatório pendente").closest("li");
    expect(card?.firstElementChild?.className).toContain("bg-success/10");
    expect(card?.querySelector("a")).toBeNull();
    // Tudo zero na semana: o gráfico não aparece.
    expect(screen.queryByText("Relatórios de células")).not.toBeInTheDocument();
  });

  it("Dado o ranking, então o casal com células abre a lista do casal, e o de Total 0 fica sem link (T5)", async () => {
    respondAll();
    renderDashboard();
    await settle();

    const link = screen.getByRole("link", { name: "Pedro e Paula: 2 células, ver na lista de Células" });
    expect(link.getAttribute("href")).toContain("status=active");
    expect(screen.queryByRole("link", { name: /^Tiago/ })).not.toBeInTheDocument();
    expect(document.querySelector(".bg-blue-100, .bg-pink-100")).toBeNull();
  });

  it("Dado o resumo falhando, então as duas seções mostram a mensagem com 'Tentar de novo', que refaz só o resumo", async () => {
    respondToRpc("dashboard_summary", failure, { data: [summaryRow] });
    respondToRpc("dashboard_g12_ranking", { data: ranking });
    renderDashboard();
    await settle();

    expect(screen.getByText(/Não foi possível carregar os números desta semana/)).toBeInTheDocument();
    expect(screen.getByText(/Não foi possível carregar os números gerais/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Pedro e Paula/ })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Tentar de novo" })[0]);
    await settle();

    expect(fakeRpcs().filter((call) => call.fn === "dashboard_g12_ranking")).toHaveLength(1);
    expect(screen.getByText("Relatórios enviados")).toBeInTheDocument();
    expect(screen.queryByText(/Não foi possível/)).not.toBeInTheDocument();
  });

  it("Dado 'Tentar de novo' que falha de novo, então o erro passa a ser anunciado (role=alert)", async () => {
    respondToRpc("dashboard_summary", failure, failure);
    respondToRpc("dashboard_g12_ranking", { data: ranking });
    renderDashboard();
    await settle();

    fireEvent.click(screen.getAllByRole("button", { name: "Tentar de novo" })[0]);
    await settle();
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  });

  it("Dado o ranking falhando, então a seção aparece com o h2 e a mensagem dela", async () => {
    respondToRpc("dashboard_summary", { data: [summaryRow] });
    respondToRpc("dashboard_g12_ranking", failure);
    renderDashboard();
    await settle();

    expect(within(section("Células por G12")).getByText(/Não foi possível carregar as células por G12/)).toBeInTheDocument();
  });

  it("Dada uma gravação com o Dashboard aberto, quando a busca seguinte falha, então a seção mostra o erro, e não o número de antes (RN-17)", async () => {
    respondToRpc("dashboard_summary", { data: [summaryRow] }, failure);
    respondToRpc("dashboard_g12_ranking", { data: ranking }, { data: ranking });
    const { client } = renderDashboard();
    await settle();
    expect(screen.getByText("1.530")).toBeInTheDocument();

    await act(() => refreshAfterReportWrite(client));
    await settle();

    expect(screen.queryByText("1.530")).not.toBeInTheDocument();
    expect(screen.getByText(/Não foi possível carregar os números desta semana/)).toBeInTheDocument();
  });

  it("Dada uma busca sem gravação que falha (voltar para a aba), então os números ficam", async () => {
    respondToRpc("dashboard_summary", { data: [summaryRow] }, failure);
    respondToRpc("dashboard_g12_ranking", { data: ranking });
    const { client } = renderDashboard();
    await settle();

    await act(() => client.refetchQueries({ queryKey: ["dashboard", "summary"] }));
    await settle();

    expect(screen.getByText("1.530")).toBeInTheDocument();
    expect(screen.queryByText(/Não foi possível/)).not.toBeInTheDocument();
  });

  it("Dado um usuário sem a permissão, quando o banco recusa, então mostra o acesso negado sem nenhum card", async () => {
    respondToRpc("dashboard_summary", denied);
    respondToRpc("dashboard_g12_ranking", denied);
    renderDashboard();
    await settle();

    expect(screen.getByText("Você não tem acesso ao dashboard.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
