import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeQueries, resetFakeSupabase, respondWith } from "@/test/fake-supabase";
import MembersDeleted from "./MembersDeleted";
import CellsDeleted from "./CellsDeleted";
import CellReportsDeleted from "./CellReportsDeleted";

// Listas de excluídos, estado "Erro ao carregar" (E2.01, Estados, T4): o
// `Alert` com o texto de cada entidade e "Tentar de novo", que consulta de
// novo e mostra a lista.

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

vi.mock("@/components/AppLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isSystem: false,
    permissionsLoaded: true,
    hasPermission: (...permissions: string[]) => permissions.includes("manage_roles"),
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const FAILURE = { error: { code: "", message: "TypeError: Failed to fetch" } };
const deleted = { deleted_at: "2026-11-10T17:32:00Z", deleted_by_name: "Elisa Martins" };

const originalWidth = window.innerWidth;
const setWidth = (width: number) => Object.defineProperty(window, "innerWidth", { configurable: true, value: width });

function renderAt(path: string, element: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={path} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Listas de excluídos: erro ao carregar (Estados)", () => {
  beforeEach(() => {
    resetFakeSupabase();
    setWidth(360);
  });

  afterEach(() => setWidth(originalWidth));

  it.each([
    [
      "/members/deleted",
      <MembersDeleted key="m" />,
      "members_deleted_view",
      "Não foi possível carregar os cadastros excluídos.",
      { id: "b1", name: "Bruno Almeida", is_active: true, leader_name: null, leader_deleted: false, restore_role_name: null, has_account: false, ...deleted },
      "Bruno Almeida",
    ],
    [
      "/cells/deleted",
      <CellsDeleted key="c" />,
      "cells_deleted_view",
      "Não foi possível carregar as células excluídas.",
      {
        id: "c1",
        type: "Evangelística",
        meeting_day: "Quarta",
        meeting_time: "20:00:00",
        neighborhood: null,
        leader_name: "Rui Prado",
        leader_deleted: false,
        timothy_name: null,
        timothy_deleted: false,
        host_name: null,
        host_deleted: false,
        ...deleted,
      },
      "Célula de Rui Prado",
    ],
    [
      "/cell-reports/deleted",
      <CellReportsDeleted key="r" />,
      "cell_reports_deleted_view",
      "Não foi possível carregar os relatórios excluídos.",
      { id: "r1", date: "2026-11-19", time: "20:00:00", was_held: true, theme: null, cell_leader_name: "Carlos Lima", cell_deleted: false, week_taken: false, ...deleted },
      "Célula de Carlos Lima",
    ],
  ])("Dada uma falha ao carregar %s, então o aviso e 'Tentar de novo', que recarrega a lista", async (path, element, view, message, row, item) => {
    respondWith(FAILURE);
    renderAt(path, element);

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText(item)).not.toBeInTheDocument();
    expect(screen.queryByText(/por página/)).not.toBeInTheDocument();

    respondWith({ data: [row], count: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));

    expect(await screen.findByText(item)).toBeInTheDocument();
    expect(screen.queryByText(message)).not.toBeInTheDocument();
    await waitFor(() => expect(fakeQueries().filter((query) => query.table === view)).toHaveLength(2));
  });
});
