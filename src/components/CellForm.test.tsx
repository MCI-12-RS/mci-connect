import type { ReactNode } from "react";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeQueries, resetFakeSupabase, respondToRpc, respondWith } from "@/test/fake-supabase";
import type { CellRow } from "@/lib/cells/fields";
import CellForm from "./CellForm";

// Edição de uma célula excluída no meio tempo (E2.01, DT-19): o PATCH volta
// sem linha, o formulário avisa e não fecha, e a lista de Células recarrega
// já, para "Fechar", "Cancelar", o X e o Esc voltarem a ela atualizada.

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

// O Switch e o Select do Radix medem o tamanho com ResizeObserver (o jsdom não tem).
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

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

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const onClose = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  respondToRpc("member_names", { data: [{ id: "l1", name: "Carlos Lima" }] });
  render(<CellForm cell={carlos} onClose={onClose} />, { wrapper });
  const invalidatedKeys = () => invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  return { onClose, invalidatedKeys };
}

async function saveWithoutRowBack() {
  respondWith({ data: [] });
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  return screen.findByRole("alert");
}

describe("CellForm: célula excluída durante a edição (DT-19)", () => {
  beforeAll(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
  afterAll(() => vi.unstubAllGlobals());
  beforeEach(() => {
    resetFakeSupabase();
    toast.mockClear();
  });

  it("Dado um PATCH sem linha de volta, então o aviso com 'Fechar', Salvar desabilitado e a lista de Células recarregada já", async () => {
    const { onClose, invalidatedKeys } = renderForm();

    const alert = await saveWithoutRowBack();

    expect(alert).toHaveTextContent("Esta célula não existe ou já foi excluída. As alterações não foram salvas.");
    expect(alert).toHaveFocus();
    // O texto fica na cor do texto (contraste, UX-38); o vermelho fica na borda e no ícone.
    expect(within(alert).getByText(/As alterações não foram salvas/).parentElement).toHaveClass("text-foreground");
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
    expect(invalidatedKeys()).toEqual([["cells", "list"]]);
    expect(onClose).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    const update = fakeQueries().find((query) => query.table === "cells");
    expect(update?.calls).toContainEqual(["select", "id"]);

    fireEvent.click(within(alert).getByRole("button", { name: "Fechar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Depois do aviso, 'Cancelar' também volta para a lista já recarregada", async () => {
    const { onClose, invalidatedKeys } = renderForm();
    await saveWithoutRowBack();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(invalidatedKeys()).toContainEqual(["cells", "list"]);
  });
});
