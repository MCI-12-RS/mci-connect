import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeQueries, fakeRpcs, resetFakeSupabase, respondToRpc, respondWith } from "@/test/fake-supabase";
import type { CellDeletionTarget } from "@/lib/deletion/targets";
import CellDeletionFlow from "./CellDeletionFlow";

// Exclusão de célula (E2.01, T2): os estados do envio que a tela de Células
// não cobre (UX-04, UX-05, UX-06, UX-24 e UX-39). Os payloads de erro são os
// que o banco devolve (ver src/lib/deletion/server-contract.test.ts).

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isSystem: false,
    hasPermission: (...permissions: string[]) => permissions.some((p) => auth.permissions.has(p)),
  }),
}));

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const carlos: CellDeletionTarget = {
  id: "c1",
  leaderName: "Carlos Lima",
  summary: "Quarta, 20:00 · Rua das Flores, 120",
  isActive: true,
};

const CELL_GONE = {
  error: {
    code: "22023",
    message: "Esta célula não existe ou já foi excluída.",
    details: '{"code": "not_found_or_deleted", "entity": "cell"}',
    hint: "app_error",
  },
};

/** Recusa de regra no atalho de inativar: aparece no aviso do diálogo. */
const CELL_REFUSED = {
  error: {
    code: "22023",
    message: "Esta célula foi excluída e não recebe relatórios.",
    details: '{"code": "cell_deleted", "cell_id": "c1"}',
    hint: "app_error",
  },
};

function renderFlow(cell: CellDeletionTarget = carlos) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const onClose = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<CellDeletionFlow cell={cell} onClose={onClose} />, { wrapper });
  const invalidatedKeys = () => invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  return { onClose, invalidatedKeys };
}

/** Uma resposta que só chega quando o teste mandar. */
function deferred() {
  let release: () => void = () => {};
  const arrived = new Promise<void>((resolve) => (release = resolve));
  return { arrived, release };
}

const deleteCalls = () => fakeRpcs().filter((call) => call.fn === "delete_cell");

describe("CellDeletionFlow: envio da exclusão", () => {
  beforeEach(() => {
    resetFakeSupabase();
    toast.mockClear();
    auth.permissions = new Set(["delete_cell", "edit_cell"]);
  });

  it("UX-04: a confirmação traz as três consequências em tópicos, na ordem, e o botão destrutivo 'Excluir célula'", () => {
    renderFlow();
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "A célula sai das listas e dos totais.",
      "Os relatórios dela continuam no histórico.",
      "Um administrador pode restaurá-la depois.",
    ]);
    expect(within(dialog).getByRole("button", { name: "Excluir célula" })).not.toHaveAttribute("aria-disabled");
  });

  it("Fora do envio, Esc fecha a confirmação sem chamar a exclusão (referência para o UX-06)", () => {
    const { onClose } = renderFlow();
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(deleteCalls()).toHaveLength(0);
  });

  it("UX-06: durante a exclusão, o diálogo fica aberto com 'Excluindo…', os botões indisponíveis, um duplo toque faz uma chamada só e Esc não fecha", async () => {
    const { onClose } = renderFlow();
    const { arrived, release } = deferred();
    respondToRpc("delete_cell", { data: null, until: arrived });

    const confirm = screen.getByRole("button", { name: "Excluir célula" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    const deleting = await screen.findByRole("button", { name: "Excluindo…" });
    expect(deleting).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    const inactivate = screen.getByRole("button", { name: "Marcar como inativa" });
    expect(inactivate).toHaveAttribute("aria-disabled", "true");
    // Indisponíveis, os toques não gravam nada.
    fireEvent.click(deleting);
    fireEvent.click(inactivate);
    expect(fakeQueries()).toHaveLength(0);
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(deleteCalls()).toHaveLength(1);

    await act(async () => {
      release();
      await arrived;
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toast).toHaveBeenCalledWith({ title: "Célula excluída." });
    expect(deleteCalls()).toHaveLength(1);
  });

  it("UX-07: no sucesso, recarrega a lista de Células, os relatórios, os membros e o Dashboard", async () => {
    const { onClose, invalidatedKeys } = renderFlow();
    respondToRpc("delete_cell", { data: null });
    fireEvent.click(screen.getByRole("button", { name: "Excluir célula" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(invalidatedKeys()).toEqual([["cells"], ["cell_reports"], ["members"], ["dashboard"]]);
  });

  it("UX-24: 'Esta célula não existe ou já foi excluída.' vira toast informativo (não destrutivo), o diálogo fecha e a lista recarrega", async () => {
    const { onClose, invalidatedKeys } = renderFlow();
    respondToRpc("delete_cell", CELL_GONE);

    fireEvent.click(screen.getByRole("button", { name: "Excluir célula" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({ title: "Esta célula não existe ou já foi excluída." });
    expect(invalidatedKeys()).toContainEqual(["cells"]);
  });

  it("UX-39: 42501 vira o toast 'Você não tem permissão para esta ação.' e fecha, sem recarregar a lista", async () => {
    const { onClose, invalidatedKeys } = renderFlow();
    respondToRpc("delete_cell", { error: { code: "42501", message: "Você não tem permissão para esta ação." } });

    fireEvent.click(screen.getByRole("button", { name: "Excluir célula" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith({ variant: "destructive", title: "Você não tem permissão para esta ação." });
    expect(invalidatedKeys()).toEqual([]);
  });

  it("UX-39: na queda de conexão, o diálogo continua aberto com o aviso de conexão, e o botão volta a 'Excluir célula'", async () => {
    const { onClose } = renderFlow();
    respondToRpc("delete_cell", { error: { code: "", message: "TypeError: Failed to fetch" } });

    fireEvent.click(screen.getByRole("button", { name: "Excluir célula" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Não foi possível excluir. Verifique a conexão e tente de novo.");
    // O texto fica na cor do texto (contraste, UX-38); o vermelho fica na borda e no ícone.
    expect(within(alert).getByText(/Não foi possível excluir/)).toHaveClass("text-foreground");
    expect(screen.getByRole("button", { name: "Excluir célula" })).not.toHaveAttribute("aria-disabled");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).not.toHaveTextContent("Failed to fetch");
  });

  it("UX-06: o botão tocado fica com o foco durante 'Excluindo…' e continua com ele depois da queda de conexão", async () => {
    renderFlow();
    const { arrived, release } = deferred();
    respondToRpc("delete_cell", { error: { code: "", message: "TypeError: Failed to fetch" }, until: arrived });

    const confirm = screen.getByRole("button", { name: "Excluir célula" });
    act(() => confirm.focus());
    fireEvent.click(confirm);

    expect(await screen.findByRole("button", { name: "Excluindo…" })).toHaveFocus();

    await act(async () => {
      release();
      await arrived;
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível excluir. Verifique a conexão e tente de novo.");
    expect(screen.getByRole("button", { name: "Excluir célula" })).toHaveFocus();
  });

  it("RN-20 e UX-39: uma falha técnica (40P01) pede para tentar de novo, sem a mensagem técnica, e a nova tentativa chama de novo", async () => {
    const { onClose } = renderFlow();
    respondToRpc("delete_cell", { error: { code: "40P01", message: "deadlock detected" } }, { data: null });

    fireEvent.click(screen.getByRole("button", { name: "Excluir célula" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível excluir. Tente de novo.");
    expect(screen.getByRole("alertdialog")).not.toHaveTextContent("deadlock");

    fireEvent.click(screen.getByRole("button", { name: "Excluir célula" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(deleteCalls()).toHaveLength(2);
    expect(toast).toHaveBeenCalledWith({ title: "Célula excluída." });
  });
});

describe("CellDeletionFlow: atalho 'Marcar como inativa' (UX-05)", () => {
  beforeEach(() => {
    resetFakeSupabase();
    toast.mockClear();
    auth.permissions = new Set(["delete_cell", "edit_cell"]);
  });

  it("Dada a célula ativa e edit_cell, quando marca como inativa, então grava só is_active = false com o id de volta, avisa, fecha e não exclui", async () => {
    const { onClose } = renderFlow();
    respondWith({ data: [{ id: "c1" }] });

    fireEvent.click(screen.getByRole("button", { name: "Marcar como inativa" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith({ title: "Célula marcada como inativa." });
    const update = fakeQueries().find((query) => query.table === "cells");
    expect(update?.calls).toEqual([
      ["update", { is_active: false }],
      ["eq", "id", "c1"],
      ["select", "id"],
    ]);
    expect(deleteCalls()).toHaveLength(0);
  });

  it("Dada a célula excluída no meio tempo (PATCH sem linha de volta), então o aviso informativo de célula inexistente e fecha (DT-19)", async () => {
    const { onClose } = renderFlow();
    respondWith({ data: [] });

    fireEvent.click(screen.getByRole("button", { name: "Marcar como inativa" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith({ title: "Esta célula não existe ou já foi excluída." });
  });

  it("UX-06: 'Marcar como inativa' tocado fica com o foco enquanto grava e continua com ele na recusa, que aparece no diálogo", async () => {
    const { onClose } = renderFlow();
    const { arrived, release } = deferred();
    respondWith({ ...CELL_REFUSED, until: arrived });

    const inactivate = screen.getByRole("button", { name: "Marcar como inativa" });
    act(() => inactivate.focus());
    fireEvent.click(inactivate);

    await waitFor(() => expect(inactivate).toHaveAttribute("aria-disabled", "true"));
    expect(inactivate).toHaveFocus();

    await act(async () => {
      release();
      await arrived;
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("Esta célula foi excluída e não recebe relatórios.");
    expect(inactivate).not.toHaveAttribute("aria-disabled");
    expect(inactivate).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
  });
});
