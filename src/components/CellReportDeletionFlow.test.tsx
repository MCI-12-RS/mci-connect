import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeRpcs, resetFakeSupabase, respondToRpc } from "@/test/fake-supabase";
import type { CellReportDeletionTarget } from "@/lib/deletion/targets";
import CellReportDeletionFlow from "./CellReportDeletionFlow";

// Exclusão de relatório (E2.01, T2): os estados do envio que a tela de
// Relatórios não cobre (UX-04, UX-06, UX-24 e UX-39). Os payloads de erro são
// os que o banco devolve (ver src/lib/deletion/server-contract.test.ts).

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const report: CellReportDeletionTarget = { id: "r1", date: "19/11/2026", leaderName: "Carlos Lima" };

const REPORT_GONE = {
  error: {
    code: "22023",
    message: "Este relatório não existe ou já foi excluído.",
    details: '{"code": "not_found_or_deleted", "entity": "cell_report"}',
    hint: "app_error",
  },
};

function renderFlow() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const onClose = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<CellReportDeletionFlow report={report} onClose={onClose} />, { wrapper });
  const invalidatedKeys = () => invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  return { onClose, invalidatedKeys };
}

const deleteCalls = () => fakeRpcs().filter((call) => call.fn === "delete_cell_report");

describe("CellReportDeletionFlow: envio da exclusão", () => {
  beforeEach(() => {
    resetFakeSupabase();
    toast.mockClear();
  });

  it("UX-04: a confirmação traz as três consequências em tópicos, na ordem, sem 'não pode ser desfeita' e sem o aviso de inativar", () => {
    renderFlow();
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Ele sai das listas e das somas.",
      "A célula poderá enviar outro relatório para a semana dele, se ainda for a semana atual.",
      "Um administrador pode restaurá-lo depois.",
    ]);
    expect(dialog).not.toHaveTextContent(/não pode ser desfeita/i);
    expect(within(dialog).queryByRole("button", { name: /Marcar como inativ/ })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Excluir relatório" })).not.toHaveAttribute("aria-disabled");
  });

  it("UX-06: durante a exclusão, 'Excluindo…', os dois botões indisponíveis, um duplo toque faz uma chamada só e Esc não fecha", async () => {
    const { onClose } = renderFlow();
    let release: () => void = () => {};
    const arrived = new Promise<void>((resolve) => (release = resolve));
    respondToRpc("delete_cell_report", { data: null, until: arrived });

    const confirm = screen.getByRole("button", { name: "Excluir relatório" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    const deleting = await screen.findByRole("button", { name: "Excluindo…" });
    expect(deleting).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    // Indisponível, o toque não chama de novo.
    fireEvent.click(deleting);
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(deleteCalls()).toHaveLength(1);
    expect(deleteCalls()[0].args).toEqual({ _report_id: "r1" });

    await act(async () => {
      release();
      await arrived;
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toast).toHaveBeenCalledWith({ title: "Relatório excluído." });
  });

  it("RN-12 e UX-07 (E2.09, AQ-3): no sucesso, recarrega os relatórios, as células (situação do relatório), os membros (vínculo celular) e o Dashboard", async () => {
    const { onClose, invalidatedKeys } = renderFlow();
    respondToRpc("delete_cell_report", { data: null });
    fireEvent.click(screen.getByRole("button", { name: "Excluir relatório" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(invalidatedKeys()).toEqual([["members"], ["cells"], ["cell_reports"], ["dashboard"]]);
  });

  it("UX-24: 'Este relatório não existe ou já foi excluído.' vira toast informativo (não destrutivo), o diálogo fecha e a lista recarrega", async () => {
    const { onClose, invalidatedKeys } = renderFlow();
    respondToRpc("delete_cell_report", REPORT_GONE);

    fireEvent.click(screen.getByRole("button", { name: "Excluir relatório" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({ title: "Este relatório não existe ou já foi excluído." });
    expect(invalidatedKeys()).toContainEqual(["cell_reports"]);
  });

  it("RN-02 e UX-39: sem delete_cell_report, o 42501 vira o toast de permissão e fecha, sem mensagem técnica", async () => {
    const { onClose } = renderFlow();
    respondToRpc("delete_cell_report", { error: { code: "42501", message: "permission denied for function delete_cell_report" } });

    fireEvent.click(screen.getByRole("button", { name: "Excluir relatório" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith({ variant: "destructive", title: "Você não tem permissão para esta ação." });
  });

  it("UX-39: na queda de conexão, o diálogo continua aberto com o aviso, e o botão volta a 'Excluir relatório'", async () => {
    const { onClose } = renderFlow();
    respondToRpc("delete_cell_report", { error: { code: "", message: "TypeError: Failed to fetch" } });

    fireEvent.click(screen.getByRole("button", { name: "Excluir relatório" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível excluir. Verifique a conexão e tente de novo.");
    expect(screen.getByRole("button", { name: "Excluir relatório" })).not.toHaveAttribute("aria-disabled");
    expect(onClose).not.toHaveBeenCalled();
  });
});
