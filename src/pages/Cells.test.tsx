import type { ReactNode } from "react";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeQueries, fakeRpcs, resetFakeSupabase, respondToRpc, respondWith } from "@/test/fake-supabase";
import type { CellRow } from "@/lib/cells/fields";
import Cells from "./Cells";

// Ação "Excluir" na lista de Células (E2.01, T1, T2, UX-01 a UX-04): no
// desktop, o ícone com o líder; no celular, o menu "⋯", com "Novo relatório"
// e "Editar" fora dele. A exclusão é pela RPC, nunca direto na tabela.

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

vi.mock("@/components/AppLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

const auth = vi.hoisted(() => ({
  permissions: new Set<string>(),
  access: null as import("@/lib/access/access").Access | null,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u-self" },
    access: auth.access,
    hasPermission: (...permissions: string[]) => permissions.some((p) => auth.permissions.has(p)),
  }),
}));

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const carlos: CellRow = {
  id: "c1",
  leader_id: "l1",
  timothy_id: null,
  host_id: null,
  type: "Evangelística",
  meeting_day: "Quarta",
  meeting_time: "20:00:00",
  street: "Rua das Flores",
  number: "120",
  complement: null,
  neighborhood: "Centro",
  city: null,
  state: null,
  zip_code: null,
  is_active: true,
  leader_name: "Carlos Lima",
  leader_g12_level: 2,
  leader_is_pastor: false,
  leader_gender: "M",
  timothy_name: null,
  host_name: null,
  g12_leader_name: "Vera",
  can_submit_report: true,
};

function renderCells(rows: CellRow[] = [carlos]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  respondWith({ data: rows, count: rows.length });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Cells />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const originalWidth = window.innerWidth;
const setWidth = (width: number) => Object.defineProperty(window, "innerWidth", { configurable: true, value: width });

describe("Células: ação Excluir", () => {
  beforeEach(() => {
    resetFakeSupabase();
    toast.mockClear();
    auth.permissions = new Set(["delete_cell", "edit_cell"]);
    setWidth(1280);
  });

  afterEach(() => setWidth(originalWidth));

  it("Desktop: o ícone Excluir tem o líder, sem o vermelho, e abre a confirmação com dia, hora e endereço (UX-02, UX-04)", async () => {
    renderCells();
    const button = await screen.findByRole("button", { name: "Excluir a célula de Carlos Lima" });
    expect(button.querySelector("svg")).toHaveClass("text-muted-foreground");
    expect(button.querySelector("svg")).not.toHaveClass("text-destructive");

    fireEvent.click(button);

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("heading", { name: "Excluir a célula de Carlos Lima?" })).toBeInTheDocument();
    expect(within(dialog).getByText("Quarta, 20:00 · Rua das Flores, 120")).toBeInTheDocument();
    expect(within(dialog).getByText("A célula sai das listas e dos totais.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Marcar como inativa" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toHaveFocus();
    expect(dialog).not.toHaveTextContent(/não pode ser desfeita/i);
  });

  it("Ao confirmar, exclui pela RPC, mostra 'Célula excluída.' e não apaga na tabela (RN-01, UX-07)", async () => {
    renderCells();
    fireEvent.click(await screen.findByRole("button", { name: "Excluir a célula de Carlos Lima" }));
    respondToRpc("delete_cell", {});
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Excluir célula" }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Célula excluída." }));
    expect(fakeRpcs().map((call) => [call.fn, call.args])).toEqual([["delete_cell", { _cell_id: "c1" }]]);
    expect(fakeQueries().some((query) => query.methods().includes("delete"))).toBe(false);
  });

  it("Célula inativa: sem o aviso de inativar; sem edit_cell, o aviso fica sem o botão (UX-05)", async () => {
    auth.permissions = new Set(["delete_cell"]);
    renderCells([carlos, { ...carlos, id: "c2", leader_name: "Marcos", is_active: false }]);

    fireEvent.click(await screen.findByRole("button", { name: "Excluir a célula de Carlos Lima" }));
    let dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Se a célula só parou de se reunir, prefira marcá-la como inativa.")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Marcar como inativa" })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Excluir a célula de Marcos" }));
    dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).queryByText(/prefira marcá-la como inativa/)).not.toBeInTheDocument();
  });

  it("Sem delete_cell, nenhuma ação de excluir aparece (UX-03)", async () => {
    auth.permissions = new Set(["edit_cell"]);
    renderCells();
    await screen.findByText("Carlos Lima");
    expect(screen.queryByRole("button", { name: /^Excluir/ })).not.toBeInTheDocument();
  });

  it("Celular: 'Excluir célula' fica no '⋯'; 'Novo relatório' e 'Editar' ficam fora, com 44×44 px (UX-01)", async () => {
    setWidth(360);
    auth.permissions = new Set(["delete_cell", "edit_cell", "submit_any_visible_report"]);
    renderCells();
    const menu = await screen.findByRole("button", { name: "Ações da célula de Carlos Lima" });
    expect(menu).toHaveClass("h-11", "w-11");
    // Os rótulos trazem a célula: cada card repete os mesmos ícones.
    expect(screen.getByRole("button", { name: "Novo relatório da célula de Carlos Lima" })).toHaveClass("h-11", "w-11");
    expect(screen.getByRole("button", { name: "Editar a célula de Carlos Lima" })).toHaveClass("h-11", "w-11");
    expect(screen.queryByRole("button", { name: /^Excluir/ })).not.toBeInTheDocument();

    fireEvent.keyDown(menu, { key: "Enter" });
    const item = await screen.findByRole("menuitem", { name: "Excluir célula" });
    // Na cor do texto também em destaque (UX-38): o vermelho fica só no botão que confirma.
    expect(item).toHaveClass("text-foreground", "focus:text-foreground");
    fireEvent.click(item);
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  });

  it("Celular: sem delete_cell, o card não tem o '⋯' (UX-03)", async () => {
    setWidth(360);
    auth.permissions = new Set(["edit_cell"]);
    renderCells();
    await screen.findByText("Carlos Lima");
    expect(screen.queryByRole("button", { name: /^Ações da célula/ })).not.toBeInTheDocument();
  });
});

// O Switch e o Select do CellForm medem o tamanho com ResizeObserver (o jsdom não tem).
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("Células: o foco volta a quem abriu o diálogo (Acessibilidade, WCAG 2.4.3)", () => {
  beforeAll(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
  afterAll(() => vi.unstubAllGlobals());
  beforeEach(() => {
    resetFakeSupabase();
    toast.mockClear();
    auth.permissions = new Set(["delete_cell", "edit_cell"]);
    setWidth(1280);
  });

  afterEach(() => setWidth(originalWidth));

  it("Desktop: 'Cancelar' na confirmação devolve o foco ao ícone 'Excluir' da linha", async () => {
    renderCells();
    const trash = await screen.findByRole("button", { name: "Excluir a célula de Carlos Lima" });
    act(() => trash.focus());
    fireEvent.click(trash);
    const dialog = await screen.findByRole("alertdialog");

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(trash).toHaveFocus());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("Celular: Esc na confirmação devolve o foco ao '⋯' do card, que abriu o menu", async () => {
    setWidth(360);
    renderCells();
    const menu = await screen.findByRole("button", { name: "Ações da célula de Carlos Lima" });
    fireEvent.keyDown(menu, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Excluir célula" }));
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancelar" })).toHaveFocus());

    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(menu).toHaveFocus());
  });

  it("Desktop: depois de excluir, a célula sai da lista e o foco vai para a busca", async () => {
    renderCells();
    const trash = await screen.findByRole("button", { name: "Excluir a célula de Carlos Lima" });
    act(() => trash.focus());
    fireEvent.click(trash);
    const dialog = await screen.findByRole("alertdialog");
    respondToRpc("delete_cell", {});
    // A lista recarregada, já sem a célula.
    respondWith({ data: [], count: 0 });

    fireEvent.click(within(dialog).getByRole("button", { name: "Excluir célula" }));

    await waitFor(() => expect(screen.getByRole("textbox", { name: "Buscar células" })).toHaveFocus());
    expect(trash).not.toBeInTheDocument();
    expect(screen.getByText("Nenhuma célula encontrada")).toBeInTheDocument();
  });

  it("Desktop: 'Cancelar' no formulário aberto pelo 'Editar' devolve o foco a esse ícone", async () => {
    renderCells();
    const edit = await screen.findByRole("button", { name: "Editar a célula de Carlos Lima" });
    respondToRpc("member_names", { data: [{ id: "l1", name: "Carlos Lima" }] });
    act(() => edit.focus());
    fireEvent.click(edit);
    const form = await screen.findByRole("dialog", { name: "Editar Célula" });

    fireEvent.click(within(form).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(edit).toHaveFocus());
  });
});

// "Novo relatório" pela cells_view e subtítulo (E2.02, T7, UX-23, UX-15). Os demais critérios ficam com o QA.
describe("Células: quem lança e o alcance (E2.02)", () => {
  beforeEach(() => {
    resetFakeSupabase();
    auth.permissions = new Set(["submit_own_cell_report"]);
    setWidth(1280);
  });
  afterEach(() => {
    setWidth(originalWidth);
    auth.access = null;
  });

  it("'Novo relatório' segue can_submit_report de cada célula, e sem 'Editar Célula' não há 'Editar'", async () => {
    renderCells([carlos, { ...carlos, id: "c2", leader_name: "Diego Reis", can_submit_report: false }]);

    expect(await screen.findByRole("button", { name: "Novo relatório da célula de Carlos Lima" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Novo relatório da célula de Diego Reis" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Editar/ })).not.toBeInTheDocument();
  });

  it("O subtítulo diz o alcance de quem vê só o ministério", async () => {
    auth.access = {
      member_id: "m-pedro",
      role_id: "r-lider",
      role_name: "Líder",
      role_is_protected: false,
      permissions: ["view_own_ministry"],
      sees_whole_church: false,
      sees_ministry: true,
      sees_whole_church_reports: false,
      sees_ministry_reports: true,
      can_create_member: false,
      can_assign_roles: false,
      can_submit_some_report: true,
    };
    renderCells();

    expect(await screen.findByText("Células do seu ministério")).toBeInTheDocument();
  });

  it("O subtítulo de quem vê a igreja toda diz 'Células de toda a igreja' (UX-15)", async () => {
    auth.access = {
      member_id: "m-rita",
      role_id: "r-admin",
      role_name: "Administrador",
      role_is_protected: true,
      permissions: ["view_all_church"],
      sees_whole_church: true,
      sees_ministry: true,
      sees_whole_church_reports: true,
      sees_ministry_reports: true,
      can_create_member: true,
      can_assign_roles: true,
      can_submit_some_report: true,
    };
    renderCells();

    expect(await screen.findByText("Células de toda a igreja")).toBeInTheDocument();
    expect(screen.queryByText("Células do seu ministério")).not.toBeInTheDocument();
  });
});
