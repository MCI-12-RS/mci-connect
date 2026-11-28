import type { ReactNode } from "react";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup as cleanupRender, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeQueries, fakeRpcs, resetFakeSupabase, respondToRpc, respondWith } from "@/test/fake-supabase";
import type { CellReportListRow } from "@/lib/cell-reports/fields";
import CellReports from "./CellReports";
import { reportListRow, reportSnapshotColumns } from "@/test/report-snapshot-fixture";

// A lista de Relatórios (E2.12, T1 a T13): as ações da linha (E2.01), os atalhos, os estados, a
// consulta e quem lança (E2.02).

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

vi.mock("@/components/AppLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

const auth = vi.hoisted(() => ({
  permissions: new Set<string>(),
  permissionsLoaded: true,
  access: null as import("@/lib/access/access").Access | null,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u-self" },
    access: auth.access,
    permissionsLoaded: auth.permissionsLoaded,
    hasPermission: (...permissions: string[]) => permissions.some((p) => auth.permissions.has(p)),
  }),
}));

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const R1 = "11111111-1111-4111-8111-111111111111";
const R2 = "22222222-2222-4222-8222-222222222222";
const row = (overrides: Partial<CellReportListRow>): CellReportListRow =>
  reportListRow({
    id: R1,
    date: "2026-11-19",
    theme: "Fé",
    offering: 0,
    visitors: [],
    visitors_count: 0,
    participants_count: 3,
    snapshot_leader_name: "Carlos Lima",
    cell_leader_name: "Carlos Lima",
    cell_number: "120",
    ...overrides,
  });

const rows = [row({}), row({ id: R2, date: "2026-11-12", snapshot_leader_name: "Rui Prado", cell_leader_name: "Rui Prado", cell_deleted: true })];

const WEEKS = {
  today: "2026-11-24",
  this_week_start: "2026-11-22",
  this_week_end: "2026-11-28",
  last_week_start: "2026-11-15",
  last_week_end: "2026-11-21",
  week_before_last_start: "2026-11-08",
  week_before_last_end: "2026-11-14",
};

function respondList(list: CellReportListRow[]) {
  respondToRpc("cell_reports_list", { data: list });
  respondToRpc("cell_reports_list_count", { data: list.length });
}

function renderReports({ list = rows, weeks = true, path = "/cell-reports" }: { list?: CellReportListRow[]; weeks?: boolean; path?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  respondList(list);
  if (weeks) respondToRpc("server_weeks", { data: [WEEKS] });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <CellReports />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
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
    expect(fakeRpcs().filter((call) => call.fn === "delete_cell_report").map((call) => call.args)).toEqual([{ _report_id: R1 }]);
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
    respondList([rows[1]]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Excluir relatório" }));

    await waitFor(() => expect(screen.getByRole("searchbox", { name: "Buscar" })).toHaveFocus());
    expect(trash).not.toBeInTheDocument();
    expect(screen.getByText("Rui Prado")).toBeInTheDocument();
  });

  it("Desktop: 'Cancelar' no formulário aberto pelo 'Editar' devolve o foco a esse ícone, que traz a data e o líder", async () => {
    renderReports();
    const edit = await screen.findByRole("button", { name: "Editar o relatório de 19/11/2026 da célula de Carlos Lima" });
    // A linha do relatório, as datas da semana dele e os participantes salvos (E2.11, AQ-10).
    respondToRpc("cell_report_edit_context", {
      data: [{ server_now: "2026-11-20T13:00:00Z", today: "2026-11-20", week_start: "2026-11-15", week_end: "2026-11-21", allowed_dates: ["2026-11-19", "2026-11-20"] }],
    });
    respondWith({ data: { ...row({}), ...reportSnapshotColumns("Carlos Lima") } }, { data: [] });
    act(() => edit.focus());
    fireEvent.click(edit);
    await screen.findByRole("dialog", { name: "Editar relatório" });

    // Os campos aparecem depois da leitura do relatório (AQ-10).
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(edit).toHaveFocus());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

// Botão "Novo relatório" e subtítulo (E2.02, T8, UX-25, UX-15). Os demais critérios ficam com o QA.
describe("Relatórios: quem lança e o alcance (E2.02)", () => {
  const base = {
    member_id: "m-1",
    role_id: "r-1",
    role_name: "Membro",
    role_is_protected: false,
    permissions: [],
    sees_whole_church: false,
    sees_ministry: false,
    sees_whole_church_reports: false,
    sees_ministry_reports: true,
    can_create_member: false,
    can_assign_roles: false,
    can_submit_some_report: false,
  };

  beforeEach(() => {
    resetFakeSupabase();
    auth.permissions = new Set(["edit_own_data", "view_own_ministry"]);
    auth.permissionsLoaded = true;
    setWidth(1280);
  });
  afterEach(() => {
    setWidth(originalWidth);
    auth.access = null;
  });

  it("Sem relatório para lançar (mesmo com 'Editar Próprio Cadastro'), então não há 'Novo Relatório'; com algum, há", async () => {
    auth.access = base;
    renderReports();
    expect(await screen.findByText("Relatórios das células do seu ministério")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Novo relatório" })).not.toBeInTheDocument();
  });

  it("Com algum relatório para lançar, então o botão aparece; com os relatórios da igreja toda, o subtítulo diz isso", async () => {
    auth.access = { ...base, can_submit_some_report: true, sees_whole_church_reports: true };
    renderReports();
    expect(await screen.findByRole("button", { name: "Novo relatório" })).toBeInTheDocument();
    expect(screen.getByText("Relatórios das células de toda a igreja")).toBeInTheDocument();
  });

  it("Enquanto o acesso carrega, o lugar do botão fica reservado, sem o botão", () => {
    auth.access = null;
    auth.permissionsLoaded = false;
    renderReports();
    expect(screen.queryByRole("button", { name: "Novo relatório" })).not.toBeInTheDocument();
    expect(document.querySelector('[aria-hidden="true"].h-11')).not.toBeNull();
  });
});

// E2.12: atalhos, estados, textos e a consulta (UX-02, UX-03, UX-05, UX-25, UX-26, UX-31).
describe("Relatórios: atalhos, estados e consulta (E2.12)", () => {
  beforeAll(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
  afterAll(() => vi.unstubAllGlobals());
  beforeEach(() => {
    resetFakeSupabase();
    auth.permissions = new Set(["delete_cell_report", "edit_cell_report"]);
    auth.permissionsLoaded = true;
    auth.access = null;
    setWidth(360);
  });
  afterEach(() => setWidth(originalWidth));

  it("UX-05: sem a data do servidor, os atalhos ficam desabilitados no lugar; com ela, o toque grava as datas e chama a lista com o Período (UX-03)", async () => {
    renderReports({ weeks: false });
    await screen.findByText("Carlos Lima");
    const group = screen.getByRole("group", { name: "Atalhos de semana" });
    expect(group).toHaveAttribute("aria-busy", "true");
    expect(within(group).getAllByRole("radio")).toHaveLength(3);
    for (const radio of within(group).getAllByRole("radio")) expect(radio).toBeDisabled();
    expect(fakeRpcs().some((call) => call.fn === "server_weeks")).toBe(true);
  });

  it("UX-03: o atalho marca, aplica o Período e não desmarca no segundo toque", async () => {
    renderReports();
    const thisWeek = await screen.findByRole("radio", { name: "Esta semana, de 22/11/2026 a 28/11/2026" });
    await waitFor(() => expect(thisWeek).toBeEnabled());
    respondList([rows[0]]);
    fireEvent.click(thisWeek);
    await waitFor(() => expect(thisWeek).toHaveAttribute("aria-checked", "true"));
    await screen.findByRole("button", { name: "Remover filtro De: 22/11/2026" });
    const listCalls = () => fakeRpcs().filter((call) => call.fn === "cell_reports_list");
    expect(listCalls().at(-1)?.args).toMatchObject({ _date_from: "2026-11-22", _date_to: "2026-11-28", _offset: 0 });
    const before = listCalls().length;
    fireEvent.click(thisWeek);
    expect(thisWeek).toHaveAttribute("aria-checked", "true");
    expect(listCalls()).toHaveLength(before);
  });

  it("UX-26, UX-31: na falha, o Alert do Negócio com Tentar de novo, sem texto técnico; a busca e os atalhos continuam", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    respondToRpc("cell_reports_list", { error: { code: "57014", message: "canceling statement due to statement timeout" } });
    respondToRpc("cell_reports_list_count", { data: 0 });
    respondToRpc("server_weeks", { data: [WEEKS] });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/cell-reports"]}>
          <CellReports />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Não foi possível carregar os relatórios. Verifique a conexão e tente de novo.")).toBeInTheDocument();
    expect(screen.queryByText(/statement timeout|57014/)).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Buscar" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Atalhos de semana" })).toBeInTheDocument();
    respondList(rows);
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("Carlos Lima")).toBeInTheDocument();
  });

  it("UX-26: vazio sem filtros e vazio com filtros, com Limpar filtros", async () => {
    renderReports({ list: [] });
    expect(await screen.findByText("Nenhum relatório encontrado.")).toBeInTheDocument();
    cleanupRender();
    resetFakeSupabase();
    renderReports({ list: [], path: "/cell-reports?held=no" });
    expect(await screen.findByText("Nenhum relatório encontrado com estes filtros.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Limpar filtros" })).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent("0 relatórios");
  });

  it("UX-02: nenhum dos textos evitados na lista", async () => {
    renderReports({ list: [...rows, row({ id: "33333333-3333-4333-8333-333333333333", was_held: false, reason_not_held: "Chuva" })] });
    await screen.findAllByText("Carlos Lima");
    const text = document.body.textContent ?? "";
    for (const forbidden of ["presenças", "Presenças", "Não Realizada", "Não realizada", "Cancelada", "Status", "Relatórios de Células", "Célula sem líder", "Close", "Desde"])
      expect(text).not.toContain(forbidden);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Relatórios");
  });

  it("UX-25: a falha só dos participantes mostra a mensagem da seção, e o resto da consulta funciona", async () => {
    renderReports();
    const open = await screen.findByRole("button", { name: "Ver o relatório de 19/11/2026, Carlos Lima" });
    respondWith(
      { data: { ...row({}), ...reportSnapshotColumns("Carlos Lima"), cell_city: null, cell_state: null, cell_zip_code: null, cell_visible: true, created_at: null, created_by_kind: "unknown", created_by_name: null, updated_at: null, updated_by_kind: null, updated_by_name: null } },
      { error: { code: "XX000", message: "falhou" } },
    );
    fireEvent.click(open);
    const dialog = await screen.findByRole("dialog", { name: "Relatório de 19/11/2026" });
    expect(await within(dialog).findByText("Não foi possível carregar os participantes. Verifique a conexão e tente de novo.")).toBeInTheDocument();
    expect(within(dialog).getByText("Fé")).toBeInTheDocument();
    // Um para cada tamanho (P80): o CSS esconde o do outro, e o jsdom não aplica o CSS.
    expect(within(dialog).getAllByRole("button", { name: "Editar relatório" })).toHaveLength(2);
    expect(within(dialog).queryByText(/XX000|falhou/)).not.toBeInTheDocument();
  });
});
