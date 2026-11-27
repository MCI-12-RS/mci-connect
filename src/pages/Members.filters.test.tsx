import type { ReactNode } from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeRpcs, resetFakeSupabase, respondToRpc, type FakeResponse } from "@/test/fake-supabase";
import type { MemberRow } from "@/lib/members/fields";
import Members from "./Members";

// A lista de Membros com filtros (E2.07, PR 3; T1, T2 e T6): os estados da lista, o total em texto,
// os chips, "Limpar filtros", os argumentos das duas RPCs e nenhum texto técnico.

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
    access: { sees_whole_church: true, member_id: "rita", can_create_member: false },
    hasPermission: () => false,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

function row(overrides: Partial<MemberRow>): MemberRow {
  return {
    id: "x",
    name: "Sem Nome",
    gender: "M",
    birth_date: null,
    instagram: null,
    avatar_url: null,
    notes: null,
    neighborhood: null,
    city: null,
    state: null,
    is_pastor: false,
    has_leadership: true,
    leader_id: "l1",
    leader_name: "Gil Souza",
    spouse_id: null,
    spouse_name: null,
    is_baptized: false,
    baptism_date: null,
    is_active: true,
    g12_level: 2,
    g12_name: null,
    total_disciples: 0,
    total_cells: 0,
    auth_user_id: null,
    sensitive_visible: false,
    email: null,
    cpf: null,
    mobile_whatsapp: null,
    phone: null,
    street: null,
    number: null,
    complement: null,
    zip_code: null,
    ...overrides,
  };
}


function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

function renderMembers(url: string, list: FakeResponse, count: FakeResponse) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  respondToRpc("members_list", list);
  respondToRpc("members_list_count", count);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Members />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const originalWidth = window.innerWidth;
const setWidth = (width: number) => Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
const location = () => screen.getByTestId("location").textContent;
const caio = row({ id: "caio", name: "Caio Lima" });

beforeEach(() => {
  resetFakeSupabase();
  setWidth(360);
});
afterEach(() => setWidth(originalWidth));

describe("T1: busca, botão, total e chips", () => {
  it("UX-13 (busca), UX-14: rótulo 'Buscar', placeholder e o total em texto com role=status, sem o badge", async () => {
    renderMembers("/members", { data: [caio] }, { data: 1 });
    const search = screen.getByLabelText("Buscar");
    expect(search).toHaveAttribute("placeholder", "Nome, e-mail ou CPF");
    expect(search).toHaveAttribute("type", "search");
    expect(await screen.findByText("1 membro", { selector: "[role='status']" })).toBeInTheDocument();
    expect(screen.queryByText("1", { selector: ".rounded-full" })).not.toBeInTheDocument();
  });

  it("UX-14: o total com separador de milhar", async () => {
    renderMembers("/members", { data: [caio] }, { data: 1234 });
    expect(await screen.findByText("1.234 membros", { selector: "[role='status']" })).toBeInTheDocument();
  });

  it("os filtros da URL vão como parâmetros das duas RPCs, sem ordem no cliente (DT-01, DT-05)", async () => {
    renderMembers("/members?status=active&level=5plus,2&q=ana&size=50&page=2", { data: [caio] }, { data: 60 });
    await screen.findByText("Caio Lima");
    const [list, count] = fakeRpcs().filter((call) => call.fn.startsWith("members_list"));
    expect(list!.args).toEqual({ _search: ["%ana%"], _is_active: true, _levels: [2, 5], _limit: 50, _offset: 50 });
    expect(count!.args).toEqual({ _search: ["%ana%"], _is_active: true, _levels: [2, 5] });
    expect(list!.methods()).not.toContain("order");
  });

  it("UX-05, UX-06, UX-07: 'Filtros (2)', um chip por valor e 'Limpar filtros', que deixa só o tamanho", async () => {
    renderMembers("/members?status=active&level=2,3&q=ana&size=50", { data: [caio] }, { data: 1 });
    await screen.findByText("Caio Lima");
    expect(screen.getByRole("button", { name: "Filtros (2 ativos)" })).toBeInTheDocument();
    const chips = within(screen.getByTestId("filter-chips")).getAllByRole("button");
    expect(chips.map((chip) => chip.getAttribute("aria-label"))).toEqual([
      "Remover filtro Situação: Ativo",
      "Remover filtro Nível: 144",
      "Remover filtro Nível: 1.728",
    ]);
    respondToRpc("members_list", { data: [caio] });
    respondToRpc("members_list_count", { data: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    await waitFor(() => expect(location()).toBe("?size=50"));
    expect(screen.getByLabelText("Buscar")).toHaveValue("");
  });

  it("UX-11: valor inválido sai da URL na primeira leitura e não conta", async () => {
    renderMembers("/members?level=abc&baptized=yes", { data: [caio] }, { data: 1 });
    await waitFor(() => expect(location()).toBe("?baptized=yes"));
    expect(screen.getByRole("button", { name: "Filtros (1 ativos)" })).toBeInTheDocument();
  });

  it("UX-02: nenhum termo do legado na tela nem no painel; Situação e Batizado começam em 'Todos'", async () => {
    renderMembers("/members", { data: [caio] }, { data: 1 });
    await screen.findByText("Caio Lima");
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    const dialog = await screen.findByRole("dialog", { name: "Filtros" });
    for (const text of ["Indiferente", "Possui Liderança", "Nível Ministerial", "Status", "Data de criação", "Formato: dd/mm/aaaa"]) {
      expect(document.body.textContent).not.toContain(text);
    }
    for (const legend of ["Situação", "Batizado"]) {
      expect(within(within(dialog).getByRole("group", { name: legend })).getByRole("radio", { name: "Todos" })).toBeChecked();
    }
    expect(within(dialog).getByRole("checkbox", { name: "Pastores" })).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: "Nível 5 ou mais" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox", { name: "12" })).toBeNull();
  });
});

describe("T6: estados da lista", () => {
  it("UX-15: vazio com filtros: a mensagem e 'Limpar filtros' (outline, 44 px)", async () => {
    renderMembers("/members?level=3&q=Carla", { data: [] }, { data: 0 });
    expect(await screen.findByText("Nenhum membro encontrado com estes filtros.")).toBeInTheDocument();
    expect(screen.getByText("0 membros", { selector: "[role='status']" })).toBeInTheDocument();
    const clear = screen.getAllByRole("button", { name: "Limpar filtros" });
    expect(clear).toHaveLength(2);
    expect(clear[1]).toHaveClass("h-11");
  });

  it("UX-15: vazio sem filtros nem busca: 'Nenhum membro encontrado.'", async () => {
    renderMembers("/members", { data: [] }, { data: 0 });
    expect(await screen.findByText("Nenhum membro encontrado.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Limpar filtros" })).toBeNull();
  });

  it("UX-16: na primeira carga, 5 Skeleton, sem 'Carregando...'", () => {
    renderMembers("/members", { data: [caio] }, { data: 1 });
    expect(screen.getByTestId("members-loading").children).toHaveLength(5);
    expect(screen.queryByText("Carregando...")).toBeNull();
  });

  it("UX-16, UX-25: na falha (inclusive o tempo-limite), o Alert com 'Tentar de novo', sem texto técnico", async () => {
    renderMembers(
      "/members?status=active",
      { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } },
      { data: 0 },
    );
    expect(await screen.findByText("Não foi possível carregar os membros. Verifique a conexão e tente de novo.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/57014|statement|timeout|ancestor_ids|members_list/);
    // A busca, o botão e os chips continuam.
    expect(screen.getByLabelText("Buscar")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Remover filtro Situação: Ativo" })).toBeInTheDocument();
    respondToRpc("members_list", { data: [caio] });
    respondToRpc("members_list_count", { data: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("Caio Lima")).toBeInTheDocument();
  });
});

describe("T2: o Sheet aplica tudo de uma vez", () => {
  it("UX-03: marcar não consulta; 'Aplicar filtros' consulta uma vez, fecha e volta para a página 1", async () => {
    renderMembers("/members?page=2", { data: [caio] }, { data: 60 });
    await screen.findByText("Caio Lima");
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    const dialog = await screen.findByRole("dialog", { name: "Filtros" });
    const before = fakeRpcs().length;
    fireEvent.click(within(within(dialog).getByRole("group", { name: "Situação" })).getByRole("radio", { name: "Inativo" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Sem vínculo" }));
    expect(fakeRpcs().length).toBe(before);
    respondToRpc("members_list", { data: [caio] });
    respondToRpc("members_list_count", { data: 1 });
    fireEvent.click(within(dialog).getByRole("button", { name: "Aplicar filtros" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(location()).toBe("?status=inactive&cell_link=none");
    await waitFor(() => expect(fakeRpcs().filter((call) => call.fn === "members_list")).toHaveLength(2));
  });
});
