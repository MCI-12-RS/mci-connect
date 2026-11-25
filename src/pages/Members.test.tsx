import type { ReactNode } from "react";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeQueries, fakeRpcs, resetFakeSupabase, respondToRpc, respondWith } from "@/test/fake-supabase";
import type { MemberRow } from "@/lib/members/fields";
import Members from "./Members";

// Ação "Excluir" na lista de Membros (E2.01, T1, UX-01 a UX-03): no desktop,
// o ícone com o nome do membro; no celular, o menu "⋯". Nenhuma exclusão
// física: a tela só abre o fluxo, que usa as RPCs.

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
    hasPermission: (...permissions: string[]) => permissions.some((p) => auth.permissions.has(p)),
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

const rows = [
  row({ id: "b1", name: "Bruno Almeida", auth_user_id: "u-bruno" }),
  row({ id: "s1", name: "Sara Self", auth_user_id: "u-self" }),
];

function renderMembers() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  respondWith({ data: rows, count: rows.length });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Members />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const originalWidth = window.innerWidth;
const setWidth = (width: number) => Object.defineProperty(window, "innerWidth", { configurable: true, value: width });

describe("Membros: ação Excluir", () => {
  beforeEach(() => {
    resetFakeSupabase();
    auth.permissions = new Set(["delete_member"]);
    setWidth(1280);
  });

  afterEach(() => setWidth(originalWidth));

  it("Desktop: o ícone Excluir tem o nome do membro e não aparece na linha do próprio usuário (UX-02, UX-03)", async () => {
    renderMembers();
    const button = await screen.findByRole("button", { name: "Excluir Bruno Almeida" });
    expect(button.querySelector("svg")).toHaveClass("text-muted-foreground");
    expect(button.querySelector("svg")).not.toHaveClass("text-destructive");
    expect(screen.queryByRole("button", { name: "Excluir Sara Self" })).not.toBeInTheDocument();
  });

  it("Sem delete_member, nenhuma ação de excluir aparece (UX-03)", async () => {
    auth.permissions = new Set(["edit_member"]);
    renderMembers();
    await screen.findByText("Bruno Almeida");
    expect(screen.queryByRole("button", { name: /^Excluir/ })).not.toBeInTheDocument();
  });

  it("Celular: 'Excluir cadastro' fica no '⋯', que some na linha do próprio usuário e sem a permissão (UX-01, UX-03)", async () => {
    setWidth(360);
    renderMembers();
    const menu = await screen.findByRole("button", { name: "Ações de Bruno Almeida" });
    expect(menu).toHaveClass("h-11", "w-11");
    expect(screen.queryByRole("button", { name: "Ações de Sara Self" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Excluir/ })).not.toBeInTheDocument();

    respondToRpc("check_member_deletion", { data: { can_delete: true } });
    fireEvent.keyDown(menu, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Excluir cadastro" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("heading", { name: "Excluir Bruno Almeida?" })).toBeInTheDocument();
    expect(fakeRpcs().map((call) => call.fn)).toEqual(["check_member_deletion"]);
    // A tela não apaga direto na tabela.
    expect(fakeQueries().some((query) => query.methods().includes("delete"))).toBe(false);
  });

  it("Celular: sem delete_member, o card não tem o '⋯' (UX-03)", async () => {
    setWidth(360);
    auth.permissions = new Set(["edit_member"]);
    renderMembers();
    await screen.findByText("Bruno Almeida");
    expect(screen.queryByRole("button", { name: /^Ações de/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar Bruno Almeida" })).toHaveClass("h-11", "w-11");
  });
});

// O Switch do MemberForm mede o tamanho com ResizeObserver (o jsdom não tem).
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** Deixa rodar os `setTimeout` do Radix, que devolve o foco depois de desmontar o diálogo. */
const flushFocusReturn = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));

describe("Membros: o foco volta a quem abriu o diálogo (Acessibilidade, WCAG 2.4.3)", () => {
  beforeAll(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
  afterAll(() => vi.unstubAllGlobals());
  beforeEach(() => {
    resetFakeSupabase();
    auth.permissions = new Set(["delete_member", "edit_member"]);
    setWidth(1280);
  });

  afterEach(() => setWidth(originalWidth));

  it("Desktop: o cadastro aberto pelo bloqueio fica com o foco e, ao fechar, devolve o foco ao ícone 'Excluir' da linha (T3)", async () => {
    renderMembers();
    const trash = await screen.findByRole("button", { name: "Excluir Bruno Almeida" });
    respondToRpc("check_member_deletion", {
      data: {
        can_delete: false,
        code: "member_has_links",
        message: "Não é possível excluir Bruno Almeida.",
        member_id: "b1",
        member_name: "Bruno Almeida",
        disciples_total: 1,
        disciples: [{ id: "d1", name: "Ana", is_active: true }],
        cells_total: 0,
        cells: [],
      },
    });
    act(() => trash.focus());
    fireEvent.click(trash);
    const blocked = await screen.findByRole("alertdialog");

    // O cadastro de Ana, da members_view, e as funções do formulário.
    respondWith({ data: { id: "d1", name: "Ana", is_active: true, sensitive_visible: false } }, { data: [] });
    fireEvent.click(await within(blocked).findByRole("button", { name: "Abrir o cadastro de Ana" }));
    // O diálogo do carregando dá lugar ao do formulário (E2.04, T1).
    await screen.findByLabelText("Nome *");
    const form = screen.getByRole("dialog", { name: "Editar membro" });
    await flushFocusReturn();
    // O bloqueio fechou, mas o foco não volta para a lista: fica no formulário.
    expect(form).toContainElement(document.activeElement as HTMLElement);

    fireEvent.click(within(form).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(trash).toHaveFocus());
  });

  it("Desktop: 'Cancelar' no formulário aberto pelo 'Editar' devolve o foco a esse ícone, que traz o nome", async () => {
    renderMembers();
    const edit = await screen.findByRole("button", { name: "Editar Bruno Almeida" });
    respondWith({ data: [] });
    act(() => edit.focus());
    fireEvent.click(edit);
    const form = await screen.findByRole("dialog", { name: "Editar membro" });

    fireEvent.click(within(form).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(edit).toHaveFocus());
  });
});
