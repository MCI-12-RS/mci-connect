import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeQueries, fakeRpcs, resetFakeSupabase, respondToRpc, respondWith } from "@/test/fake-supabase";
import type { DeletedCellRow } from "@/lib/deletion/deleted-lists";
import CellsDeleted from "./CellsDeleted";

// Células excluídas (E2.01, T4 e T6): restauração com um toque (UX-21), o
// bloqueio antecipado sem chamar o servidor e o do servidor (UX-23), e o
// aviso de quem já não está excluída (UX-24).

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

vi.mock("@/components/AppLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

const auth = vi.hoisted(() => ({ permissions: new Set<string>(["manage_roles"]) }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isSystem: false,
    permissionsLoaded: true,
    hasPermission: (...permissions: string[]) => permissions.some((p) => auth.permissions.has(p)),
  }),
}));

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const rui: DeletedCellRow = {
  id: "c1",
  type: "Evangelística",
  meeting_day: "Quarta",
  meeting_time: "20:00:00",
  neighborhood: "Centro",
  leader_id: "m-rui",
  leader_name: "Rui Prado",
  leader_deleted: false,
  timothy_id: "m-tito",
  timothy_name: "Tito Lima",
  timothy_deleted: false,
  host_id: "m-quintino",
  host_name: "Quintino Reis",
  host_deleted: true,
  deleted_at: "2026-11-12T13:05:00Z",
  deleted_by_name: "Elisa Martins",
};

const carlos: DeletedCellRow = {
  ...rui,
  id: "c2",
  leader_id: "m-carlos",
  leader_name: "Carlos Lima",
  timothy_id: "m-ana",
  timothy_name: "Ana Souza",
  host_id: "m-bia",
  host_name: "Bia Dias",
  host_deleted: false,
};

const appError = (code: string, message: string, extra: object = {}) => ({
  error: { code: "22023", message, details: JSON.stringify({ code, ...extra }), hint: "app_error" },
});

/** Mostra o endereço atual, para conferir para onde a ação do bloqueio leva. */
const Where = () => {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
};

const originalWidth = window.innerWidth;
const setWidth = (width: number) => Object.defineProperty(window, "innerWidth", { configurable: true, value: width });

function renderPage(rows: DeletedCellRow[] = [rui, carlos]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  respondWith({ data: rows, count: rows.length });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/cells/deleted"]}>
        <Routes>
          <Route path="/cells/deleted" element={<CellsDeleted />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Células excluídas", () => {
  beforeEach(() => {
    resetFakeSupabase();
    toast.mockClear();
    setWidth(360);
  });

  afterEach(() => setWidth(originalWidth));

  it("Card: 'Célula de {Líder}', dia, horário e tipo, 'Excluída em', e o anfitrião excluído marcado (T4)", async () => {
    renderPage();
    const card = (await screen.findByText("Célula de Rui Prado")).closest("li");
    expect(card).toHaveTextContent("Quarta · 20:00 · Evangelística");
    expect(card).toHaveTextContent("Excluída em 12/11/2026 às 10:05");
    expect(card).toHaveTextContent("por Elisa Martins");
    expect(card).toHaveTextContent("Anfitrião: Quintino Reis (cadastro excluído)");
    expect(card).not.toHaveTextContent("Tito Lima");
    expect(screen.getByText("2 células excluídas")).toBeInTheDocument();
  });

  // O líder excluído que também é o anfitrião já aparece no título, com a marca.
  const gil: DeletedCellRow = {
    ...carlos,
    id: "c3",
    leader_id: "m-gil",
    leader_name: "Gil Souza",
    leader_deleted: true,
    host_id: "m-gil",
    host_name: "Gil Souza",
    host_deleted: true,
  };

  it("Card: o líder excluído que também é o anfitrião não se repete como 'Anfitrião' (T4)", async () => {
    renderPage([gil]);
    const card = (await screen.findByText("Célula de Gil Souza (cadastro excluído)")).closest("li");
    expect(card).not.toHaveTextContent("Anfitrião");
    expect(within(card).getAllByText(/Gil Souza/)).toHaveLength(1);
  });

  it("Tabela: o líder excluído que também é o anfitrião não se repete como 'Anfitrião' (T4)", async () => {
    setWidth(1280);
    renderPage([gil]);
    const row = (await screen.findByText("Gil Souza (cadastro excluído)")).closest("tr");
    expect(row).not.toHaveTextContent("Anfitrião");
    expect(within(row).getAllByText(/Gil Souza/)).toHaveLength(1);
  });

  it("Com o motivo no card, o bloqueio abre sem chamar o servidor, com 'Ver membros excluídos' no foco (UX-23)", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Restaurar a célula de Rui Prado" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Não é possível restaurar a célula de Rui Prado" });
    expect(dialog).toHaveTextContent(
      "Não é possível restaurar a célula: o anfitrião Quintino Reis foi excluído. Restaure o cadastro dele antes ou crie uma célula nova.",
    );
    const action = within(dialog).getByRole("button", { name: "Ver membros excluídos" });
    await waitFor(() => expect(action).toHaveFocus());
    expect(fakeRpcs()).toHaveLength(0);

    fireEvent.click(action);
    expect(await screen.findByTestId("where")).toHaveTextContent("/members/deleted?q=Quintino+Reis");
  });

  it("Um toque: só aquele botão fica 'Restaurando…'; no sucesso, o toast e o item sai da lista (UX-21)", async () => {
    renderPage();
    let finish: () => void = () => {};
    respondToRpc("restore_cell", { until: new Promise<void>((resolve) => (finish = resolve)) });
    respondWith({ data: [rui], count: 1 });

    const button = await screen.findByRole("button", { name: "Restaurar a célula de Carlos Lima" });
    act(() => button.focus());
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(button).toHaveTextContent("Restaurando…"));
    // O nome acessível acompanha o texto visível (WCAG 2.5.3).
    expect(button).toHaveAccessibleName("Restaurando a célula de Carlos Lima…");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Restaurar a célula de Rui Prado" })).toHaveTextContent("Restaurar");
    expect(fakeRpcs().map((call) => [call.fn, call.args])).toEqual([["restore_cell", { _cell_id: "c2" }]]);

    await act(async () => finish());
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Célula restaurada." }));
    await waitFor(() => expect(screen.queryByText("Célula de Carlos Lima")).not.toBeInTheDocument());
    // O botão saiu com o foco: ele vai para a busca.
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Buscar células excluídas" })).toHaveFocus());
  });

  it("Recusa do servidor: o bloqueio com a mensagem e 'Ver membros excluídos' com o nome dos detalhes (UX-23)", async () => {
    renderPage();
    const message =
      "Não é possível restaurar a célula: o timóteo Ana Souza foi excluído. Restaure o cadastro dele antes ou crie uma célula nova.";
    respondToRpc(
      "restore_cell",
      appError("restore_person_deleted", message, { people: [{ role: "timothy", member_id: "m9", member_name: "Ana Souza" }] }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Restaurar a célula de Carlos Lima" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Não é possível restaurar a célula de Carlos Lima" });
    expect(dialog).toHaveTextContent(message);
    fireEvent.click(within(dialog).getByRole("button", { name: "Ver membros excluídos" }));
    expect(await screen.findByTestId("where")).toHaveTextContent("/members/deleted?q=Ana+Souza");
  });

  it("'Não está excluída': toast informativo, sem diálogo, e a lista recarrega (UX-24)", async () => {
    renderPage();
    respondToRpc("restore_cell", appError("not_deleted", "Esta célula não está excluída.", { entity: "cell" }));
    respondWith({ data: [rui], count: 1 });
    fireEvent.click(await screen.findByRole("button", { name: "Restaurar a célula de Carlos Lima" }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Esta célula não está excluída." }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() => expect(fakeQueries().filter((query) => query.table === "cells_deleted_view")).toHaveLength(2));
  });

  it("Sem permissão no servidor (42501): o toast de permissão", async () => {
    renderPage();
    respondToRpc("restore_cell", { error: { code: "42501", message: "Você não tem permissão para esta ação." } });
    fireEvent.click(await screen.findByRole("button", { name: "Restaurar a célula de Carlos Lima" }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({ variant: "destructive", title: "Você não tem permissão para esta ação." }),
    );
  });
});
