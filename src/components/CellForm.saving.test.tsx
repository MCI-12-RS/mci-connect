import type { ReactNode } from "react";
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { resetFakeSupabase, respondToRpc, respondWith } from "@/test/fake-supabase";
import type { CellRow } from "@/lib/cells/fields";
import { EditCellDialog } from "./EditRecordDialogs";

// Gravação do formulário de célula que recalcula os totais (E2.06, PR 2, T14, RN-08, P44):
// UX-14 (a falha vai num Alert acima dos botões), UX-15 (envio lento, nada fecha) e UX-19
// (nenhuma mensagem técnica). Roda no diálogo de verdade (`EditCellDialog`), onde o Esc e o
// toque fora são decididos.

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ access: null }) }));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const carlos: CellRow = {
  id: "c1",
  leader_id: "l1",
  // E2.08 (RN-02, RN-03): toda célula tem as três pessoas; aqui, Carlos nos três papéis.
  timothy_id: "l1",
  host_id: "l1",
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
  timothy_name: "Carlos Lima",
  host_name: "Carlos Lima",
  g12_leader_name: "Vera",
  can_submit_report: true,
};

const FAILURE = "Não foi possível salvar as alterações. Tente de novo.";
const STILL_SAVING = "Ainda salvando. Isso pode levar alguns segundos.";
const TECHNICAL = /statement timeout|57014|canceling statement|hierarchy|member_hierarchy|deadlock|40P01|XX000|private\./i;

async function renderEdit() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  respondWith({ data: carlos });
  respondToRpc("member_names", { data: [{ id: "l1", name: "Carlos Lima" }] });
  render(
    <QueryClientProvider client={client}>
      <EditCellDialog cellId="c1" onClose={onClose} />
    </QueryClientProvider>,
    { wrapper: ({ children }: { children: ReactNode }) => <>{children}</> },
  );
  await screen.findByRole("button", { name: "Salvar alterações" });
  fireEvent.change(screen.getByLabelText("Bairro"), { target: { value: "Bairro Novo" } });
  return onClose;
}
const save = () => fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("CellForm: gravação que recalcula (E2.06, RN-08)", () => {
  beforeAll(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
  afterAll(() => vi.unstubAllGlobals());
  beforeEach(() => {
    resetFakeSupabase();
    toast.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it.each([
    ["tempo-limite (57014)", { code: "57014", message: "canceling statement due to statement timeout" }],
    ["impasse (40P01)", { code: "40P01", message: "deadlock detected" }],
    ["erro interno (XX000)", { code: "XX000", message: "private.hierarchy_apply failed" }],
  ])("UX-14 e UX-19: a falha por %s fica num Alert acima dos botões, sem texto técnico, com os dados e o foco no 'Salvar'", async (_n, error) => {
    const onClose = await renderEdit();
    respondWith({ error: error as never });
    save();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(FAILURE);
    // O Alert vem antes da linha dos botões "Cancelar" e "Salvar".
    const cancel = screen.getByRole("button", { name: "Cancelar" });
    expect(alert.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.body.textContent).not.toMatch(TECHNICAL);
    expect(toast).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Salvar alterações" })).toHaveFocus());
    expect(screen.getByRole("button", { name: "Salvar alterações" })).toBeEnabled();
    expect(screen.getByLabelText("Bairro")).toHaveValue("Bairro Novo");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("UX-15: 'Ainda salvando…' aos 3 s, nada fecha o formulário durante o envio e, com a resposta, ele fecha com o toast", async () => {
    const onClose = await renderEdit();
    vi.useFakeTimers();
    let finish: () => void = () => {};
    const until = new Promise<void>((resolve) => {
      finish = resolve;
    });
    respondWith({ data: [{ id: "c1" }], until });
    save();
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByRole("button", { name: "Salvando…" })).toBeDisabled();
    await act(() => vi.advanceTimersByTimeAsync(2_999));
    expect(screen.queryByText(STILL_SAVING)).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByText(STILL_SAVING)).toHaveAttribute("role", "status");

    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" });
    const closeX = within(screen.getByRole("dialog")).queryByRole("button", { name: /^(Fechar|Close)$/ });
    if (closeX) fireEvent.click(closeX);
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    fireEvent.click(document.body);
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await act(async () => {
      finish();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(toast).toHaveBeenCalledWith({ title: "Célula atualizada." });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
