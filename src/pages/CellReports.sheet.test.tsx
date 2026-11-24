import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeQueries, resetFakeSupabase, respondWith, type FakeResponse } from "@/test/fake-supabase";
import type { CellReportDetailRow, CellReportPageRow } from "@/lib/cell-reports/fields";
import CellReports from "./CellReports";

// "Ver relatório" na lista de Relatórios (E2.01, T7, UXD-7, PO-UX-3): só nas
// linhas de célula excluída e só com edit_cell_report; o ?report=<id> da URL
// (Navegação e rotas, UX-27); o foco ao fechar (Acessibilidade).

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

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

// Os ids de relatório são UUIDs, como os do banco: um id malformado sai da URL sem ser lido.
const R1 = "00000000-0000-4000-8000-000000000001";
const R2 = "00000000-0000-4000-8000-000000000002";
const R9 = "00000000-0000-4000-8000-000000000009";

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
  cell_leader_name: "Carlos Lima",
  cell_street: "Rua das Flores",
  cell_number: "120",
  cell_complement: null,
  cell_neighborhood: "Centro",
  cell_deleted: false,
  ...overrides,
});

// R1: célula de Carlos (não excluída); R2: célula de Rui (excluída).
const rows = [row({}), row({ id: R2, date: "2026-11-12", cell_leader_name: "Rui Prado", cell_deleted: true })];
const listResponses: FakeResponse[] = [
  { data: rows, count: rows.length },
  { data: rows.map((r) => ({ id: r.id, participants_count: 3 })) },
];

const detail = (overrides: Partial<CellReportDetailRow> = {}): CellReportDetailRow => ({
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
  ...overrides,
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
  // Um elemento novo a cada chamada, para a página renderizar de novo (com as
  // permissões que chegaram). O MemoryRouter guarda o endereço entre elas.
  const tree = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <CellReports />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const result = render(tree());
  return { rerender: () => result.rerender(tree()) };
}

const detailQueries = () =>
  fakeQueries().filter((q) => q.table === "cell_report_participants_view" || q.calls.some(([m]) => m === "maybeSingle"));

const originalWidth = window.innerWidth;
const setWidth = (width: number) => Object.defineProperty(window, "innerWidth", { configurable: true, value: width });

describe("Relatórios: 'Ver relatório' na linha (UX-26)", () => {
  beforeEach(() => {
    resetFakeSupabase();
    auth.permissions = new Set(["edit_cell_report", "delete_cell_report"]);
    auth.permissionsLoaded = true;
    setWidth(1280);
  });
  afterEach(() => setWidth(originalWidth));

  it("Desktop: o ícone 'Ver' aparece só na linha de célula excluída, antes da lixeira, e abre o painel com ?report=", async () => {
    respondWith(...listResponses);
    renderReports("/cell-reports?q=r&size=10");

    const view = await screen.findByRole("button", { name: VIEW_RUI });
    expect(screen.getAllByRole("button", { name: /^Ver o relatório/ })).toHaveLength(1);
    // Na mesma coluna Ações, antes da lixeira; a linha de Carlos continua com "Editar".
    const actions = view.parentElement;
    expect(actions?.lastElementChild).toHaveAccessibleName("Excluir o relatório de 12/11/2026 da célula de Rui Prado");
    expect(actions?.firstElementChild).toBe(view);
    expect(screen.getByRole("button", { name: "Editar o relatório de 19/11/2026 da célula de Carlos Lima" })).toBeInTheDocument();

    respondWith({ data: detail() }, { data: [SARA] });
    fireEvent.click(view);
    const dialog = await screen.findByRole("dialog", { name: "Relatório de 12/11/2026" });
    expect(within(dialog).getByText("Sara Reis")).toBeInTheDocument();
    expect(urlParams()).toEqual({ q: "r", size: "10", report: R2 });
  });

  it("Desktop: fechar tira o parâmetro, mantém a busca e o tamanho, e devolve o foco ao ícone", async () => {
    respondWith(...listResponses);
    renderReports("/cell-reports?q=r&size=10");
    const view = await screen.findByRole("button", { name: VIEW_RUI });
    respondWith({ data: detail() }, { data: [] });
    act(() => view.focus());
    fireEvent.click(view);
    const dialog = await screen.findByRole("dialog", { name: "Relatório de 12/11/2026" });

    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(urlParams()).toEqual({ q: "r", size: "10" });
    await waitFor(() => expect(view).toHaveFocus());
  });

  it("Sem edit_cell_report: a linha mostra o badge e a lixeira, sem 'Ver relatório'", async () => {
    auth.permissions = new Set(["delete_cell_report"]);
    respondWith(...listResponses);
    renderReports();

    await screen.findByText("Rui Prado");
    expect(screen.getByText("Célula excluída")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Ver o relatório/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Excluir o relatório de 12/11/2026 da célula de Rui Prado" })).toBeInTheDocument();
  });

  it("Celular: o corpo do card de célula excluída é o botão 'Ver relatório', e o '⋯' fica ao lado, fora dele", async () => {
    setWidth(360);
    respondWith(...listResponses);
    renderReports();

    const card = await screen.findByRole("button", { name: VIEW_RUI });
    expect(screen.getAllByRole("button", { name: /^Ver o relatório/ })).toHaveLength(1);
    // O card traz o líder, o badge, a data e a situação.
    expect(card).toHaveTextContent("Rui Prado");
    expect(card).toHaveTextContent("Célula excluída");
    expect(card).toHaveTextContent("12/11/2026 · 20:00");
    // O nome do botão é o rótulo; o conteúdo do card chega ao leitor de tela como descrição (UX-25).
    expect(card).toHaveAccessibleDescription(/Célula excluída/);
    expect(card).toHaveAccessibleDescription(/12\/11\/2026 · 20:00/);
    expect(card).toHaveAccessibleDescription(/3 presenças/);
    // As presenças não quebram no meio: descem inteiras para a linha de baixo.
    const presences = within(card).getByText("presenças").parentElement;
    expect(presences).toHaveClass("whitespace-nowrap");
    expect(presences?.parentElement).toHaveClass("flex-wrap");
    // Controles irmãos, nunca aninhados.
    expect(within(card).queryByRole("button")).not.toBeInTheDocument();
    const menu = screen.getByRole("button", { name: "Ações do relatório de 12/11/2026 da célula de Rui Prado" });
    expect(card.contains(menu)).toBe(false);
    expect(card.parentElement?.contains(menu)).toBe(true);
    // O card da célula não excluída não vira botão.
    expect(screen.getByRole("button", { name: "Editar o relatório de 19/11/2026 da célula de Carlos Lima" })).toBeInTheDocument();

    respondWith({ data: detail() }, { data: [] });
    fireEvent.click(card);
    expect(await screen.findByRole("dialog", { name: "Relatório de 12/11/2026" })).toBeInTheDocument();
  });

  it("Celular, sem edit_cell_report: o card de célula excluída não vira botão", async () => {
    setWidth(360);
    auth.permissions = new Set(["delete_cell_report"]);
    respondWith(...listResponses);
    renderReports();

    await screen.findByText("Rui Prado");
    expect(screen.queryByRole("button", { name: /^Ver o relatório/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ações do relatório de 12/11/2026 da célula de Rui Prado" })).toBeInTheDocument();
  });
});

describe("Relatórios: o ?report=<id> da URL (Navegação e rotas, UX-27)", () => {
  beforeEach(() => {
    resetFakeSupabase();
    auth.permissions = new Set(["edit_cell_report", "delete_cell_report"]);
    auth.permissionsLoaded = true;
    setWidth(1280);
  });
  afterEach(() => {
    auth.permissionsLoaded = true;
    setWidth(originalWidth);
  });

  // Com o parâmetro na chegada, o painel (filho da página) consulta o relatório
  // e os participantes antes de a página consultar a lista: as respostas vêm
  // nessa ordem. A página e o painel leem o relatório juntos, uma vez só.
  const withDetail = (...detailResponses: FakeResponse[]) => [...detailResponses, ...listResponses];

  it("Recarregar com ?report= de relatório de célula excluída reabre o painel, com a busca e o tamanho na URL", async () => {
    respondWith(...withDetail({ data: detail() }, { data: [SARA] }));
    renderReports(`/cell-reports?q=r&size=10&report=${R2}`);

    const dialog = await screen.findByRole("dialog", { name: "Relatório de 12/11/2026" });
    expect(within(dialog).getByText("Sara Reis")).toBeInTheDocument();
    expect(urlParams()).toEqual({ q: "r", size: "10", report: R2 });
    // Uma consulta só ao relatório, embora a página e o painel leiam o mesmo.
    expect(detailQueries()).toHaveLength(2);
  });

  it("Sem edit_cell_report: o parâmetro é ignorado e sai da URL, sem consultar o relatório", async () => {
    auth.permissions = new Set(["delete_cell_report"]);
    respondWith(...listResponses);
    renderReports(`/cell-reports?q=r&report=${R2}`);

    await screen.findByText("Rui Prado");
    await waitFor(() => expect(urlParams()).toEqual({ q: "r" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(detailQueries()).toHaveLength(0);
  });

  it("Relatório de célula não excluída: o parâmetro é ignorado e sai da URL, sem o painel piscar", async () => {
    let release: () => void = () => {};
    const until = new Promise<void>((resolve) => {
      release = resolve;
    });
    const carlos = detail({ id: R1, date: "2026-11-19", cell_leader_name: "Carlos Lima", cell_deleted: false });
    respondWith(...withDetail({ data: carlos, until }, { data: [], until }));
    renderReports(`/cell-reports?report=${R1}&size=10`);

    // Enquanto lê o relatório, o painel espera fechado: a linha não diz "Célula excluída".
    await screen.findByText("Carlos Lima");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(urlParams()).toEqual({ report: R1, size: "10" });

    release();
    await waitFor(() => expect(urlParams()).toEqual({ size: "10" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // O painel não abriu e fechou: o foco não foi levado para a busca.
    expect(screen.getByRole("textbox", { name: "Buscar relatórios" })).not.toHaveFocus();
  });

  it("Id malformado: o parâmetro sai da URL sem consultar o relatório e sem abrir o painel", async () => {
    respondWith(...listResponses);
    renderReports("/cell-reports?q=r&size=10&report=abc");

    await screen.findByText("Rui Prado");
    await waitFor(() => expect(urlParams()).toEqual({ q: "r", size: "10" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(detailQueries()).toHaveLength(0);
  });

  it("Recarregar com ?report= e fechar: o foco vai para o 'Ver relatório' da linha, que está na página", async () => {
    respondWith(...withDetail({ data: detail() }, { data: [] }));
    renderReports(`/cell-reports?q=r&report=${R2}`);
    const dialog = await screen.findByRole("dialog", { name: "Relatório de 12/11/2026" });

    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(urlParams()).toEqual({ q: "r" });
    await waitFor(() => expect(screen.getByRole("button", { name: VIEW_RUI })).toHaveFocus());
  });

  it("Celular, recarregar com ?report= e fechar: o foco vai para o card 'Ver relatório' da linha", async () => {
    setWidth(360);
    respondWith(...withDetail({ data: detail() }, { data: [] }));
    renderReports(`/cell-reports?report=${R2}`);
    const dialog = await screen.findByRole("dialog", { name: "Relatório de 12/11/2026" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Fechar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const card = screen.getByRole("button", { name: VIEW_RUI });
    expect(card).toHaveAttribute("data-report-id", R2);
    await waitFor(() => expect(card).toHaveFocus());
  });

  it("Link direto com a linha fora da página: ao fechar, o foco vai para a busca", async () => {
    // A página da lista só traz o relatório de Carlos.
    respondWith({ data: detail() }, { data: [] }, { data: [rows[0]], count: 1 }, { data: [{ id: R1, participants_count: 3 }] });
    renderReports(`/cell-reports?report=${R2}`);
    await screen.findByText("Carlos Lima");
    const dialog = await screen.findByRole("dialog", { name: "Relatório de 12/11/2026" });

    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Buscar relatórios" })).toHaveFocus());
  });

  it("Leitura que falha no link direto: o painel abre com 'Tentar de novo'", async () => {
    respondWith(...withDetail({ error: { code: "XX000", message: "falhou" } }, { data: [] }));
    renderReports(`/cell-reports?report=${R9}`);

    const dialog = await screen.findByRole("dialog", { name: "Relatório" });
    expect(within(dialog).getByText("Não foi possível carregar o relatório.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
    expect(urlParams()).toEqual({ report: R9 });
  });

  it("Enquanto as permissões não chegam, o parâmetro fica e nada é consultado; depois, o painel abre", async () => {
    auth.permissionsLoaded = false;
    respondWith(...listResponses);
    const { rerender } = renderReports(`/cell-reports?report=${R2}`);

    await screen.findByText("Rui Prado");
    expect(urlParams()).toEqual({ report: R2 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(detailQueries()).toHaveLength(0);

    auth.permissionsLoaded = true;
    respondWith({ data: detail() }, { data: [] });
    rerender();
    expect(await screen.findByRole("dialog", { name: "Relatório de 12/11/2026" })).toBeInTheDocument();
  });

  it("Relatório que sumiu: o painel mostra 'não existe ou já foi excluído', e a lista recarrega", async () => {
    let release: () => void = () => {};
    const until = new Promise<void>((resolve) => {
      release = resolve;
    });
    respondWith(...withDetail({ data: null, until }, { data: [], until }));
    renderReports(`/cell-reports?report=${R2}`);
    await screen.findByText("Rui Prado");
    // A linha diz "Célula excluída": o painel abre já carregando.
    const loading = await screen.findByRole("dialog", { name: "Relatório" });
    expect(within(loading).getByText("Carregando o relatório…")).toBeInTheDocument();
    const listQueriesBefore = fakeQueries().length;

    // A lista recarregada, já sem o relatório de Rui.
    respondWith({ data: [rows[0]], count: 1 }, { data: [{ id: R1, participants_count: 3 }] });
    release();

    const dialog = await screen.findByRole("dialog", { name: "Relatório" });
    await waitFor(() => expect(dialog).toHaveTextContent("Este relatório não existe ou já foi excluído."));
    await waitFor(() => expect(screen.queryByText("Rui Prado")).not.toBeInTheDocument());
    expect(fakeQueries().length).toBeGreaterThan(listQueriesBefore);

    fireEvent.click(within(dialog).getByText("Fechar", { selector: "button" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(urlParams()).toEqual({});
    // O item sumiu da lista: o foco vai para a busca.
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Buscar relatórios" })).toHaveFocus());
  });
});
