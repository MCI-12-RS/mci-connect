import type { ReactNode } from "react";
import { describe, it, expect, beforeAll, afterEach, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeQueries, resetFakeSupabase, respondToRpc, respondWith } from "@/test/fake-supabase";
import type { MemberRow } from "@/lib/members/fields";
import MemberForm from "./MemberForm";

// Gravação do formulário de membro que recalcula a hierarquia (E2.06, PR 2, T14, RN-08, P44):
// UX-14 (falha do recálculo), UX-15 (envio lento: "Ainda salvando…", o formulário não fecha) e
// UX-19 (nenhuma mensagem técnica). O Supabase é o `fake-supabase`; o relógio é simulado.

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: { ...fakeSupabase, functions: { invoke: vi.fn() } } };
});
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    access: { member_id: "rita", role_id: "role-admin", role_name: "Administrador", permissions: [], sees_whole_church: true, can_assign_roles: true },
    member: null,
    hasPermission: (...permissions: string[]) => permissions.some((p) => ["edit_member", "assign_role", "view_all_church"].includes(p)),
  }),
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const FABIO_RECUSADO = "Fábio Lima";
const fabio: MemberRow = {
  id: "fabio",
  name: FABIO_RECUSADO,
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
  leader_id: "andre",
  leader_name: "André Souza",
  spouse_id: null,
  spouse_name: null,
  is_baptized: false,
  baptism_date: null,
  is_active: true,
  g12_level: 3,
  g12_name: "Pedro Alves",
  total_disciples: 1,
  total_cells: 2,
  auth_user_id: null,
  sensitive_visible: true,
  email: "fabio@exemplo.com",
  cpf: null,
  mobile_whatsapp: "51988887777",
  phone: null,
  street: null,
  number: null,
  complement: null,
  zip_code: null,
};

const roleOptions = {
  current: { id: "role-membro", name: "Membro" },
  editable: true,
  reason: null,
  options: [
    { id: "role-admin", name: "Administrador", is_default: false },
    { id: "role-membro", name: "Membro", is_default: true },
  ],
  default_role: { id: "role-membro", name: "Membro" },
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

async function renderEdit() {
  respondToRpc("role_options", { data: roleOptions });
  const onClose = vi.fn();
  render(<MemberForm member={fabio} onClose={onClose} />, { wrapper });
  await screen.findByRole("button", { name: "Salvar alterações" });
  await screen.findByRole("combobox", { name: "Função *" }).catch(() => null);
  fireEvent.change(screen.getByLabelText("Observações"), { target: { value: "nota nova" } });
  return onClose;
}
const save = () => fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
const FAILURE = "Não foi possível salvar as alterações. Tente de novo.";
const STILL_SAVING = "Ainda salvando. Isso pode levar alguns segundos.";
const TECHNICAL = /statement timeout|57014|canceling statement|hierarchy|member_hierarchy|deadlock|40P01|XX000|private\./i;

beforeAll(() => {
  class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
});
beforeEach(() => {
  resetFakeSupabase();
  toast.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("RN-08, UX-14 e UX-19: a gravação que falha no recálculo", () => {
  const failures: Array<[string, object]> = [
    ["tempo-limite do banco (57014)", { code: "57014", message: "canceling statement due to statement timeout" }],
    ["impasse (40P01)", { code: "40P01", message: "deadlock detected" }],
    ["erro interno do recálculo (XX000)", { code: "XX000", message: "private.hierarchy_apply failed on member_hierarchy" }],
    [
      "código de aplicação hierarchy_update_failed",
      { code: "22023", message: "hierarchy_update_failed in public.hierarchy_recompute_subtree", hint: "app_error", details: JSON.stringify({ code: "hierarchy_update_failed" }) },
    ],
  ];

  it.each(failures)("Dada a falha por %s, então o rodapé diz o texto do Negócio, com role=alert, sem texto técnico e sem toast", async (_name, error) => {
    const onClose = await renderEdit();
    respondWith({ error: error as never });
    save();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(FAILURE);
    expect(document.body.textContent).not.toMatch(TECHNICAL);
    expect(toast).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Dada a falha, então o formulário continua aberto com os dados e o foco volta ao botão primário, já habilitado", async () => {
    const onClose = await renderEdit();
    respondWith({ error: { code: "57014", message: "canceling statement due to statement timeout" } as never });
    save();

    await screen.findByRole("alert");
    const primary = screen.getByRole("button", { name: "Salvar alterações" });
    await waitFor(() => expect(primary).toHaveFocus());
    expect(primary).toBeEnabled();
    expect(screen.getByLabelText("Observações")).toHaveValue("nota nova");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Dada uma nova tentativa que dá certo, então o aviso some, o toast de sucesso aparece e o formulário fecha", async () => {
    const onClose = await renderEdit();
    respondWith({ error: { code: "57014", message: "canceling statement due to statement timeout" } as never });
    save();
    await screen.findByRole("alert");

    respondWith({ data: [{ id: "fabio" }] });
    save();

    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Membro atualizado com sucesso" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(FAILURE)).toBeNull();
  });
});

describe("E2.05, T5 (UX-08 e UX-09): sem mudança no servidor e falha da Auditoria", () => {
  const CONNECTION = "Não foi possível salvar o cadastro. Verifique a conexão e tente de novo.";

  it("Dado o updated_at devolvido igual ao carregado, então 'Nenhuma alteração para salvar.', sem o toast de sucesso (AQ-7)", async () => {
    const loaded = "2026-11-26T13:00:00.123456+00:00";
    respondToRpc("role_options", { data: roleOptions });
    const onClose = vi.fn();
    render(<MemberForm member={{ ...fabio, updated_at: loaded }} onClose={onClose} />, { wrapper });
    await screen.findByRole("combobox", { name: "Função *" }).catch(() => null);
    fireEvent.change(screen.getByLabelText("Observações"), { target: { value: "nota nova" } });
    respondWith({ data: [{ id: "fabio", updated_at: loaded }] });

    save();

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({ title: "Nenhuma alteração para salvar." });
  });

  it("Dada a falha da Auditoria (CHECK em events), então a mensagem de conexão no rodapé, sem texto técnico e sem toast; a nova tentativa grava uma vez", async () => {
    const onClose = await renderEdit();
    respondWith({ error: { code: "23514", message: 'new row for relation "events" violates check constraint "e205_qa_broken"' } });
    save();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(CONNECTION);
    expect(document.body.textContent).not.toMatch(/events|constraint|e205/);
    expect(screen.getByLabelText("Observações")).toHaveValue("nota nova");
    expect(toast).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    respondWith({ data: [{ id: "fabio", updated_at: "2026-11-26T13:05:00+00:00" }] });
    save();

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toast).toHaveBeenCalledWith({ title: "Membro atualizado com sucesso" });
    expect(fakeQueries().filter((query) => query.table === "members")).toHaveLength(2);
  });
});

describe("RN-08, UX-15: o envio lento", () => {
  /** Uma resposta que só chega quando a promessa for resolvida (a gravação de 5 s). */
  function slowSave() {
    let finish: () => void = () => {};
    const until = new Promise<void>((resolve) => {
      finish = resolve;
    });
    respondWith({ data: [{ id: "fabio" }], until });
    return finish;
  }

  it("Dada a resposta de 5 s, então 'Ainda salvando…' aparece aos 3 s (não antes), com role=status, e some com a resposta", async () => {
    const onClose = await renderEdit();
    vi.useFakeTimers();
    const finish = slowSave();
    save();
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByRole("button", { name: "Salvando…" })).toBeDisabled();
    await act(() => vi.advanceTimersByTimeAsync(2_999));
    expect(screen.queryByText(STILL_SAVING)).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByText(STILL_SAVING)).toHaveAttribute("role", "status");

    await act(async () => {
      finish();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(toast).toHaveBeenCalledWith({ title: "Membro atualizado com sucesso" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(STILL_SAVING)).toBeNull();
  });

  it("Dado o envio em andamento, então 'Cancelar', '✕', Esc e o toque fora não fecham o formulário", async () => {
    const onClose = await renderEdit();
    vi.useFakeTimers();
    const finish = slowSave();
    save();
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
    const closeX = screen.queryByRole("button", { name: /^(Fechar|Close)$/ });
    if (closeX) fireEvent.click(closeX);
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    fireEvent.click(document.body);
    await act(() => vi.advanceTimersByTimeAsync(4_000));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText("Descartar as alterações?")).toBeNull();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await act(async () => {
      finish();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
