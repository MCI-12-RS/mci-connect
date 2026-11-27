import type { ReactNode } from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeQueries, fakeRpcs, resetFakeSupabase, respondToRpc, type FakeResponse } from "@/test/fake-supabase";
import type { CellListRow } from "@/lib/cells/fields";
import Cells from "./Cells";

// A lista de Células com filtros (E2.10, PR 4; T1 a T7): os argumentos das duas RPCs, o total em
// texto, os chips, "Limpar filtros", o `Sheet`, os nomes das pessoas só pela `cell_filter_names`,
// os estados da lista e nenhum texto técnico (UX-02, 03, 05, 06, 09, 10, 14, 30).

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
    access: { sees_whole_church: true, member_id: "rita" },
    hasPermission: () => false,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const PEDRO = "e2e210f1-0000-0000-0000-000000000001";
const TANIA = "e2e210f1-0000-0000-0000-000000000002";

const c1: CellListRow = {
  id: "c1",
  leader_id: "l1",
  timothy_id: "t1",
  host_id: "h1",
  type: "Evangelística",
  meeting_day: "Quarta",
  meeting_time: "20:00:00",
  street: "Rua das Flores",
  number: "100",
  complement: null,
  neighborhood: "Centro",
  city: "Porto Alegre",
  state: "RS",
  zip_code: null,
  is_active: true,
  leader_name: "André Souza",
  leader_g12_level: 2,
  leader_is_pastor: false,
  leader_gender: "M",
  timothy_name: "Carla Dias",
  host_name: "Caio Lima",
  g12_leader_name: "Pedro Alves",
  can_submit_report: false,
  report_status: "not_yet",
  report_missing_weeks: 0,
};

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

function renderCells(url: string, list: FakeResponse, count: FakeResponse) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  respondToRpc("cells_list", list);
  respondToRpc("cells_list_count", count);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Cells />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const originalWidth = window.innerWidth;
const setWidth = (width: number) => Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
const location = () => screen.getByTestId("location").textContent;
const listCalls = () => fakeRpcs().filter((call) => call.fn === "cells_list");

beforeEach(() => {
  resetFakeSupabase();
  setWidth(360);
});
afterEach(() => setWidth(originalWidth));

describe("T1: busca, botão, total e chips", () => {
  it("rótulo 'Buscar', placeholder do Negócio e o total em texto com role=status (UX-14)", async () => {
    renderCells("/cells", { data: [c1] }, { data: 1234 });
    const search = screen.getByLabelText("Buscar");
    expect(search).toHaveAttribute("placeholder", "Líder, timóteo, anfitrião, rua ou bairro");
    expect(search).toHaveAttribute("type", "search");
    expect(search).toHaveAttribute("maxLength", "100");
    expect(await screen.findByText("1.234 células", { selector: "[role='status']" })).toBeInTheDocument();
  });

  it("os filtros da URL vão como parâmetros das duas RPCs, sem ordem no cliente", async () => {
    renderCells("/cells?type=evangelistic&day=wed&report_status=sent,missed_2&q=flores&size=50&page=2", { data: [c1] }, { data: 60 });
    await screen.findByText("André Souza");
    const [list, count] = fakeRpcs().filter((call) => call.fn.startsWith("cells_list"));
    const expected = {
      _search: ["%flores%"],
      _types: ["Evangelística"],
      _weekdays: [3],
      _report_statuses: ["sent_held", "sent_not_held"],
      _missing_weeks: [2],
    };
    expect(list!.args).toEqual({ ...expected, _limit: 50, _offset: 50 });
    expect(count!.args).toEqual(expected);
    expect(list!.methods()).not.toContain("order");
    expect(fakeQueries().some((query) => query.table === "cells_view")).toBe(false);
  });

  it("UX-05, UX-06, UX-07: 'Filtros (3)', um chip por valor e 'Limpar filtros', que deixa só o tamanho", async () => {
    renderCells("/cells?type=evangelistic,discipleship&status=active&report_status=pending&q=flores&size=50", { data: [c1] }, { data: 1 });
    await screen.findByText("André Souza");
    expect(screen.getByRole("button", { name: "Filtros (3 ativos)" })).toBeInTheDocument();
    const chips = within(screen.getByTestId("filter-chips")).getAllByRole("button");
    expect(chips.map((chip) => chip.getAttribute("aria-label"))).toEqual([
      "Remover filtro Tipo: Evangelística",
      "Remover filtro Tipo: Discipulado",
      "Remover filtro Situação: Ativa",
      "Remover filtro Situação do relatório: Pendente",
    ]);
    respondToRpc("cells_list", { data: [c1] });
    respondToRpc("cells_list_count", { data: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    await waitFor(() => expect(location()).toBe("?size=50"));
    expect(screen.getByLabelText("Buscar")).toHaveValue("");
  });

  it("um valor inválido sai da URL e não conta (UX-12)", async () => {
    renderCells("/cells?type=abc&day=sat", { data: [c1] }, { data: 1 });
    await waitFor(() => expect(location()).toBe("?day=sat"));
    expect(screen.getByRole("button", { name: "Filtros (1 ativos)" })).toBeInTheDocument();
  });

  it("só a busca: 'Filtros' sem número, com 'Limpar filtros' (UX-05)", async () => {
    renderCells("/cells?q=flores", { data: [c1] }, { data: 1 });
    await screen.findByText("André Souza");
    expect(screen.getByRole("button", { name: "Filtros" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Limpar filtros" })).toBeInTheDocument();
  });
});

describe("RN-06, UX-09: pessoas da URL só pela cell_filter_names", () => {
  it("quem não volta é 'Pessoa indisponível', sem nome nem id, e nunca pela member_names", async () => {
    respondToRpc("cell_filter_names", { data: [{ id: PEDRO, name: "Pedro Alves", g12_level: null, is_pastor: null, gender: null }] });
    renderCells(`/cells?g12=${TANIA},${PEDRO}`, { data: [c1] }, { data: 1 });
    await screen.findByText("André Souza");
    const chips = within(screen.getByTestId("filter-chips"));
    expect(await chips.findByText("G12: Pessoa indisponível")).toBeInTheDocument();
    expect(chips.getByText("G12: Pedro Alves")).toBeInTheDocument();
    expect(screen.getByText("Esta pessoa não está disponível para você.")).toBeInTheDocument();
    expect(screen.getByRole("main").innerHTML).not.toContain(TANIA);
    expect(fakeRpcs().some((call) => call.fn === "member_names")).toBe(false);
    const names = fakeRpcs().find((call) => call.fn === "cell_filter_names");
    expect(names!.args).toEqual({ _person: "g12", _ids: [TANIA, PEDRO] });
  });

  it("enquanto a leitura carrega: 'G12: Carregando…'", async () => {
    respondToRpc("cell_filter_names", { data: [], until: new Promise(() => undefined) });
    renderCells(`/cells?g12=${PEDRO}`, { data: [c1] }, { data: 1 });
    expect(await screen.findByText("G12: Carregando…")).toBeInTheDocument();
  });
});

describe("T2: o Sheet no celular (UX-02, UX-03, UX-10)", () => {
  it("os 10 filtros na ordem da UXD-1, sem os termos proibidos; marcar não consulta; aplicar consulta uma vez", async () => {
    renderCells("/cells", { data: [c1] }, { data: 1 });
    await screen.findByText("André Souza");
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    const sheet = await screen.findByRole("dialog", { name: "Filtros" });
    expect(screen.getByRole("heading", { name: "Filtros" })).toHaveFocus();

    const labels = within(sheet)
      .getAllByText(/^(Líder|G12|Rua|Bairro|Cidade|Tipo|Dia da semana|Situação|Situação do relatório|Cadastrada a partir de|Cadastrada até)$/)
      .map((el) => el.textContent);
    expect(labels).toEqual([
      "Líder",
      "G12",
      "Rua",
      "Bairro",
      "Cidade",
      "Tipo",
      "Dia da semana",
      "Situação",
      "Situação do relatório",
      "Cadastrada a partir de",
      "Cadastrada até",
    ]);
    const days = within(within(sheet).getByRole("group", { name: "Dia da semana" })).getAllByRole("checkbox");
    expect(days.map((box) => box.closest("label")?.textContent)).toEqual([
      "Segunda-feira",
      "Terça-feira",
      "Quarta-feira",
      "Quinta-feira",
      "Sexta-feira",
      "Sábado",
      "Domingo",
    ]);
    expect(within(within(sheet).getByRole("radiogroup")).getAllByRole("radio")[0]).toHaveAccessibleName("Todas");
    expect(sheet.textContent).not.toMatch(
      /Modalidade|Logradouro|Indiferente|Discipuladora|Status|Dados da célula|Linha de evolução|Cadastrado a partir de|Cadastrado até|Formato: dd\/mm\/aaaa|Atrasado|Em dia/,
    );
    const outer = within(sheet).getByRole("group", { name: "Situação do relatório" });
    expect(within(outer).getByRole("group", { name: "Nesta semana" })).toBeInTheDocument();
    expect(within(outer).getByRole("group", { name: "Sem relatório nas semanas anteriores" })).toBeInTheDocument();

    const before = listCalls().length;
    fireEvent.click(within(sheet).getByRole("checkbox", { name: "Discipulado" }));
    fireEvent.click(within(sheet).getByRole("checkbox", { name: "Pendente" }));
    expect(listCalls()).toHaveLength(before);

    respondToRpc("cells_list", { data: [] });
    respondToRpc("cells_list_count", { data: 0 });
    fireEvent.click(within(sheet).getByRole("button", { name: "Aplicar filtros" }));
    await waitFor(() => expect(location()).toBe("?type=discipleship&report_status=pending"));
    await waitFor(() => expect(listCalls()).toHaveLength(before + 1));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Filtros" })).toBeNull());
  });

  it("Esc fecha sem mudar a URL nem a lista", async () => {
    renderCells("/cells", { data: [c1] }, { data: 1 });
    await screen.findByText("André Souza");
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    const sheet = await screen.findByRole("dialog", { name: "Filtros" });
    fireEvent.click(within(sheet).getByRole("checkbox", { name: "Macrocélula" }));
    const before = listCalls().length;
    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Filtros" })).toBeNull());
    expect(location()).toBe("");
    expect(listCalls()).toHaveLength(before);
  });
});

describe("T7: estados da lista (UX-14, UX-30)", () => {
  it("vazio com filtros: a mensagem e 'Limpar filtros' (44 px)", async () => {
    renderCells("/cells?status=inactive&report_status=pending", { data: [] }, { data: 0 });
    expect(await screen.findByText("Nenhuma célula encontrada com estes filtros.")).toBeInTheDocument();
    expect(screen.getByText("0 células", { selector: "[role='status']" })).toBeInTheDocument();
    const clear = screen.getAllByRole("button", { name: "Limpar filtros" }).at(-1);
    expect(clear).toHaveClass("h-11");
  });

  it("vazio sem filtros nem busca", async () => {
    renderCells("/cells", { data: [] }, { data: 0 });
    expect(await screen.findByText("Nenhuma célula encontrada.")).toBeInTheDocument();
  });

  it("primeira carga: 5 Skeleton, sem 'Carregando...' solto", () => {
    renderCells("/cells", { data: [], until: new Promise(() => undefined) }, { data: 0, until: new Promise(() => undefined) });
    expect(within(screen.getByTestId("cells-loading")).getAllByText("", { selector: ".animate-pulse" })).toHaveLength(5);
    expect(screen.queryByText(/Carregando\.\.\./)).toBeNull();
  });

  it("falha: o Alert do Negócio com 'Tentar de novo', sem texto técnico; a busca e 'Filtros' continuam", async () => {
    renderCells("/cells?type=evangelistic", { error: { code: "57014", message: "canceling statement due to statement timeout" } }, { data: 0 });
    expect(await screen.findByText("Não foi possível carregar as células. Verifique a conexão e tente de novo.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/57014|statement|timeout|cells_list|report_status/);
    expect(screen.getByLabelText("Buscar")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Filtros (1 ativos)" })).toBeEnabled();
    respondToRpc("cells_list", { data: [c1] });
    respondToRpc("cells_list_count", { data: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("André Souza")).toBeInTheDocument();
  });
});

describe("T3: o painel no computador (UX-01, UX-04)", () => {
  it("a partir de 1024 px, 'Filtros' abre o painel (aria-expanded) e não há Sheet; com ele aberto, sem chips", async () => {
    setWidth(1024);
    window.localStorage.removeItem("filters-panel-open:cells");
    renderCells("/cells?type=evangelistic", { data: [c1] }, { data: 1 });
    await screen.findByText("André Souza");
    const button = screen.getByRole("button", { name: "Filtros (1 ativos)" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("filter-chips")).toBeInTheDocument();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("filter-chips")).toBeNull();
    expect(window.localStorage.getItem("filters-panel-open:cells")).toBe("1");
    expect(window.localStorage.getItem("filters-panel-open:members")).toBeNull();
    window.localStorage.removeItem("filters-panel-open:cells");
  });
});
