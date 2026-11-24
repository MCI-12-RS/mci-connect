import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u-self" },
    member: { id: "me" },
    isSystem: false,
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
  timothy_name: null,
  host_name: null,
  g12_leader_name: "Vera",
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
    expect(screen.getByRole("button", { name: "Novo relatório" })).toHaveClass("h-11", "w-11");
    expect(screen.getByRole("button", { name: "Editar célula" })).toHaveClass("h-11", "w-11");
    expect(screen.queryByRole("button", { name: /^Excluir/ })).not.toBeInTheDocument();

    fireEvent.keyDown(menu, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Excluir célula" }));
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
