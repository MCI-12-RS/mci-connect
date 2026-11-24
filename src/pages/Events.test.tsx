import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeQueries, resetFakeSupabase, respondWith } from "@/test/fake-supabase";
import Events from "./Events";

// Auditoria (E2.01, T11, RN-19, UX-37): a restauração aparece com a ação
// "Restauração", e o filtro de ação tem essa opção, que consulta o banco pela
// ação "restore". As linhas usam o formato que os triggers gravam de verdade.

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

vi.mock("@/components/AppLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    permissionsLoaded: true,
    hasPermission: (...permissions: string[]) => permissions.includes("view_audit_log"),
  }),
}));

const event = (id: string, action: string, entity: string, label: string, description: string) => ({
  id,
  occurred_at: "2026-11-24T13:05:00Z",
  actor_user_id: "u-ad",
  actor_label: "Elisa Martins",
  action,
  entity,
  entity_id: `${entity}-1`,
  entity_label: label,
  description,
  changed_fields: null,
  metadata: {},
  success: true,
  error_reason: null,
});

const restoreCell = event("e2", "restore", "cell", "célula de Rui Prado", "Restaurou a célula de Rui Prado");
const deleteCell = event("e1", "delete", "cell", "célula de Rui Prado", "Excluiu a célula de Rui Prado");

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Events />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** O seletor do filtro "Ação" (o rótulo não está ligado ao campo: acha pelo bloco do rótulo). */
const actionFilter = () => {
  const block = screen.getByText("Ação", { selector: "label" }).parentElement;
  if (!block) throw new Error("sem o bloco do filtro Ação");
  return within(block).getByRole("combobox");
};

describe("UX-37 e RN-19: Auditoria da restauração", () => {
  beforeEach(() => {
    resetFakeSupabase();
  });

  it("Dado um evento de restauração, então a linha mostra a ação 'Restauração', ao lado da 'Exclusão'", async () => {
    respondWith({ data: [restoreCell, deleteCell] });
    renderPage();

    const restoreRow = (await screen.findByText("Restaurou a célula de Rui Prado")).closest("tr");
    expect(restoreRow).not.toBeNull();
    expect(within(restoreRow).getByText("Restauração")).toBeInTheDocument();
    expect(within(restoreRow).queryByText("restore")).not.toBeInTheDocument();

    const deleteRow = screen.getByText("Excluiu a célula de Rui Prado").closest("tr");
    expect(within(deleteRow).getByText("Exclusão")).toBeInTheDocument();
  });

  it("Dado o filtro de ação, então ele tem a opção 'Restauração', que consulta só as restaurações", async () => {
    respondWith({ data: [restoreCell, deleteCell] }, { data: [restoreCell] });
    renderPage();
    await screen.findByText("Restaurou a célula de Rui Prado");

    fireEvent.keyDown(actionFilter(), { key: "Enter" });
    const option = await screen.findByRole("option", { name: "Restauração" });
    expect(screen.getByRole("option", { name: "Exclusão" })).toBeInTheDocument();
    fireEvent.click(option);

    await waitFor(() => expect(fakeQueries()).toHaveLength(2));
    const filtered = fakeQueries()[1];
    expect(filtered.table).toBe("events");
    expect(filtered.calls).toContainEqual(["eq", "action", "restore"]);
    expect(fakeQueries()[0].calls).not.toContainEqual(["eq", "action", expect.anything()]);
    await waitFor(() => expect(screen.queryByText("Excluiu a célula de Rui Prado")).not.toBeInTheDocument());
    expect(actionFilter()).toHaveTextContent("Restauração");
  });
});
