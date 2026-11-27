import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createQueryWrapper } from "@/test/query-wrapper";
import { fakeQueries, fakeRpcs, resetFakeSupabase, respondToRpc, respondWith } from "@/test/fake-supabase";
import MemberDeletionFlow, { type MemberDeletionTarget } from "./MemberDeletionFlow";

// Exclusão de membro (E2.01, T2 e T3): pré-checagem, bloqueio, confirmação e
// os estados do envio (UX-04, 06, 08, 09, 10, 11, 24 e 39).

vi.mock("@/components/RecordAuthorship", async () => {
  const { RecordAuthorshipStub } = await import("@/test/record-authorship-stub");
  return { RecordAuthorship: RecordAuthorshipStub };
});

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

// O formulário de membro aberto pelo bloqueio usa o Switch do Radix, que mede
// o tamanho com ResizeObserver (o jsdom não tem).
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const bruno: MemberDeletionTarget = { id: "b1", name: "Bruno Almeida", isActive: true };

const appError = (code: string, message: string, extra: object = {}) => ({
  error: { code: "22023", message, details: JSON.stringify({ code, ...extra }), hint: "app_error" },
});

const gilLinks = {
  member_id: "b1",
  member_name: "Bruno Almeida",
  disciples_total: 7,
  disciples: [
    { id: "d1", name: "Ana", is_active: true },
    { id: "d2", name: "Bia", is_active: true },
    { id: "d3", name: "Caio", is_active: true },
    { id: "d4", name: "Dani", is_active: true },
    { id: "d5", name: "Léo Martins", is_active: false },
  ],
  cells_total: 1,
  cells: [
    {
      id: "c1",
      roles: ["timothy"],
      leader_name: "Carlos Lima",
      meeting_day: "Quarta",
      meeting_time: "20:00",
      is_active: false,
    },
  ],
};

function renderFlow(member: MemberDeletionTarget = bruno) {
  const onClose = vi.fn();
  render(<MemberDeletionFlow member={member} onClose={onClose} />, { wrapper: createQueryWrapper() });
  return onClose;
}

const deleteCalls = () => fakeRpcs().filter((call) => call.fn === "delete_member");

async function openConfirmation(member: MemberDeletionTarget = bruno) {
  respondToRpc("check_member_deletion", { data: { can_delete: true } });
  const onClose = renderFlow(member);
  await screen.findByRole("button", { name: "Excluir cadastro" });
  return onClose;
}

describe("MemberDeletionFlow", () => {
  beforeEach(() => {
    resetFakeSupabase();
    toast.mockClear();
    auth.permissions = new Set(["delete_member"]);
  });

  it("Enquanto verifica, mostra 'Verificando…' com o botão desabilitado e, sem ligações, abre a confirmação (UX-08, UX-04)", async () => {
    let release: () => void = () => {};
    const arrived = new Promise<void>((resolve) => (release = resolve));
    respondToRpc("check_member_deletion", { data: { can_delete: true }, until: arrived });
    renderFlow();

    expect(screen.getByRole("heading", { name: "Excluir Bruno Almeida?" })).toBeInTheDocument();
    expect(screen.getByText("Verificando se o cadastro pode ser excluído…")).toBeInTheDocument();
    // Indisponível sem largar o foco: aria-disabled, e não disabled (UX-06).
    expect(screen.getByRole("button", { name: "Verificando…" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
    expect(fakeRpcs()[0]).toMatchObject({ fn: "check_member_deletion", args: { _member_id: "b1" } });

    await act(async () => {
      release();
      await arrived;
    });

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: "Excluir cadastro" })).not.toHaveAttribute("aria-disabled");
    expect(within(dialog).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "O cadastro sai das listas, dos totais e do dashboard.",
      "A pessoa perde o acesso ao sistema.",
      "Os relatórios em que ela aparece continuam no histórico.",
      "Um administrador pode restaurar o cadastro depois.",
    ]);
    expect(dialog).not.toHaveTextContent(/não pode ser desfeita/);
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
  });

  it("Se a verificação falhar, a confirmação abre normalmente (UX-08)", async () => {
    respondToRpc("check_member_deletion", { error: { code: "", message: "TypeError: Failed to fetch" } });
    renderFlow();
    expect(await screen.findByRole("button", { name: "Excluir cadastro" })).not.toHaveAttribute("aria-disabled");
  });

  it("Com ligações, abre o bloqueio sem passar pela confirmação, com 5 por grupo, 'e mais N' e as marcações (UX-08, UX-09)", async () => {
    respondToRpc("check_member_deletion", {
      data: { can_delete: false, code: "member_has_links", message: "Não é possível excluir Bruno Almeida.", ...gilLinks },
    });
    renderFlow();

    const title = await screen.findByRole("heading", { name: "Não é possível excluir Bruno Almeida" });
    expect(title).toHaveFocus();
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).queryByRole("button", { name: /Excluir/ })).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent("Antes, reatribua:");
    expect(within(dialog).getByRole("heading", { name: "7 discípulos" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Léo Martins (inativo)");
    expect(dialog).toHaveTextContent("e mais 2");
    expect(within(dialog).getByRole("heading", { name: "1 célula" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Timóteo na célula de Carlos Lima, quarta, 20:00 (inativa)");
    expect(dialog).toHaveTextContent("Discípulos e células inativos também contam.");
    expect(within(dialog).getByRole("button", { name: "Fechar" })).toBeInTheDocument();
    expect(deleteCalls()).toHaveLength(0);
  });

  it("No bloqueio, os discípulos abrem o cadastro só com edit_member, e as células, só com edit_cell (UX-10)", async () => {
    auth.permissions = new Set(["delete_member", "edit_member"]);
    respondToRpc("check_member_deletion", {
      data: { can_delete: false, code: "member_has_links", message: "x", ...gilLinks },
    });
    renderFlow();

    await screen.findByRole("heading", { name: "Não é possível excluir Bruno Almeida" });
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: "Abrir o cadastro de Léo Martins (inativo)" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Timóteo na célula/ })).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent("Timóteo na célula de Carlos Lima");

    // O cadastro de Ana, da members_view, e as funções do formulário.
    respondWith({ data: { id: "d1", name: "Ana", is_active: true, sensitive_visible: false } }, { data: [] });
    fireEvent.click(within(dialog).getByRole("button", { name: "Abrir o cadastro de Ana" }));

    // O diálogo do carregando dá lugar ao do formulário (E2.04, T1).
    const name = await screen.findByLabelText("Nome *");
    expect(screen.getByRole("dialog", { name: "Editar membro" })).toContainElement(name);
    expect(name).toHaveValue("Ana");
    const read = fakeQueries().find((query) => query.table === "members_view");
    expect(read?.calls).toContainEqual(["eq", "id", "d1"]);
  });

  it("Ao confirmar, mostra 'Excluindo…', desabilita os dois botões, não chama duas vezes e, no sucesso, avisa sem 'Desfazer' (UX-06, UX-07)", async () => {
    const onClose = await openConfirmation();
    let release: () => void = () => {};
    const arrived = new Promise<void>((resolve) => (release = resolve));
    respondToRpc("delete_member", { data: null, until: arrived });

    const confirm = screen.getByRole("button", { name: "Excluir cadastro" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    const deleting = await screen.findByRole("button", { name: "Excluindo…" });
    expect(deleting).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    // Indisponível, o toque no botão não chama de novo.
    fireEvent.click(deleting);
    expect(deleteCalls()).toHaveLength(1);
    expect(deleteCalls()[0].args).toEqual({ _member_id: "b1" });

    await act(async () => {
      release();
      await arrived;
    });

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith({ title: "Cadastro excluído." });
    expect(deleteCalls()).toHaveLength(1);
  });

  it("Uma recusa de regra no envio troca o conteúdo para o bloqueio, com a mensagem do servidor (UX-11)", async () => {
    const onClose = await openConfirmation();
    respondToRpc("delete_member", appError("role_above", "Você não tem permissão para excluir este membro."));

    fireEvent.click(screen.getByRole("button", { name: "Excluir cadastro" }));

    const title = await screen.findByRole("heading", { name: "Não é possível excluir Bruno Almeida" });
    expect(title).toHaveFocus();
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Você não tem permissão para excluir este membro.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("'Não existe ou já foi excluído' vira toast informativo e fecha (UX-24)", async () => {
    const onClose = await openConfirmation();
    respondToRpc("delete_member", appError("not_found_or_deleted", "Este cadastro não existe ou já foi excluído.", { entity: "member" }));

    fireEvent.click(screen.getByRole("button", { name: "Excluir cadastro" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith({ title: "Este cadastro não existe ou já foi excluído." });
  });

  it("Na pré-checagem, 'não existe ou já foi excluído' também vira toast informativo e fecha", async () => {
    respondToRpc("check_member_deletion", {
      data: { can_delete: false, code: "not_found_or_deleted", message: "Este cadastro não existe ou já foi excluído." },
    });
    const onClose = renderFlow();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith({ title: "Este cadastro não existe ou já foi excluído." });
  });

  it("42501 vira o toast de permissão, sem mensagem técnica (UX-39)", async () => {
    const onClose = await openConfirmation();
    respondToRpc("delete_member", { error: { code: "42501", message: "permission denied for function delete_member" } });

    fireEvent.click(screen.getByRole("button", { name: "Excluir cadastro" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith({ variant: "destructive", title: "Você não tem permissão para esta ação." });
  });

  it("Na queda de conexão, o diálogo continua aberto com o aviso, e o botão volta (UX-39)", async () => {
    const onClose = await openConfirmation();
    respondToRpc("delete_member", { error: { code: "", message: "TypeError: Failed to fetch" } });

    fireEvent.click(screen.getByRole("button", { name: "Excluir cadastro" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível excluir. Verifique a conexão e tente de novo.");
    expect(screen.getByRole("button", { name: "Excluir cadastro" })).not.toHaveAttribute("aria-disabled");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).not.toHaveTextContent("Failed to fetch");
  });

  it("UX-06: 'Excluir cadastro' tocado fica com o foco durante 'Excluindo…' e continua com ele na queda de conexão", async () => {
    await openConfirmation();
    let release: () => void = () => {};
    const arrived = new Promise<void>((resolve) => (release = resolve));
    respondToRpc("delete_member", { error: { code: "", message: "TypeError: Failed to fetch" }, until: arrived });

    const confirm = screen.getByRole("button", { name: "Excluir cadastro" });
    act(() => confirm.focus());
    fireEvent.click(confirm);

    const deleting = await screen.findByRole("button", { name: "Excluindo…" });
    expect(deleting).toHaveAttribute("aria-disabled", "true");
    expect(deleting).toHaveFocus();

    await act(async () => {
      release();
      await arrived;
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível excluir. Verifique a conexão e tente de novo.");
    expect(confirm).toHaveTextContent("Excluir cadastro");
    expect(confirm).toHaveFocus();
  });

  it("UX-06: 'Marcar como inativo' tocado fica com o foco enquanto grava e continua com ele na queda de conexão", async () => {
    auth.permissions = new Set(["delete_member", "edit_member"]);
    const onClose = await openConfirmation();
    let release: () => void = () => {};
    const arrived = new Promise<void>((resolve) => (release = resolve));
    respondWith({ error: { code: "", message: "TypeError: Failed to fetch" }, until: arrived });

    const inactivate = screen.getByRole("button", { name: "Marcar como inativo" });
    act(() => inactivate.focus());
    fireEvent.click(inactivate);

    await waitFor(() => expect(inactivate).toHaveAttribute("aria-disabled", "true"));
    expect(inactivate).toHaveFocus();
    expect(screen.getByRole("button", { name: "Excluir cadastro" })).toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      release();
      await arrived;
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível marcar como inativo. Verifique a conexão e tente de novo.",
    );
    expect(inactivate).not.toHaveAttribute("aria-disabled");
    expect(inactivate).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("O aviso de inativar só aparece para membro ativo, e o botão só com edit_member (UX-05)", async () => {
    await openConfirmation();
    expect(screen.getByText("Se a pessoa só deixou de frequentar, prefira marcá-la como inativa.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marcar como inativo" })).not.toBeInTheDocument();
  });

  it("Membro inativo: sem o aviso de inativar", async () => {
    auth.permissions = new Set(["delete_member", "edit_member"]);
    await openConfirmation({ ...bruno, isActive: false });
    expect(screen.queryByText(/prefira marcá-la como inativa/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marcar como inativo" })).not.toBeInTheDocument();
  });

  it("'Marcar como inativo' grava só is_active = false, pede o id de volta, avisa e fecha, sem excluir (UX-05)", async () => {
    auth.permissions = new Set(["delete_member", "edit_member"]);
    const onClose = await openConfirmation();
    respondWith({ data: [{ id: "b1" }] });

    fireEvent.click(screen.getByRole("button", { name: "Marcar como inativo" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith({ title: "Cadastro marcado como inativo." });
    const update = fakeQueries().find((query) => query.table === "members");
    expect(update?.calls).toEqual([
      ["update", { is_active: false }],
      ["eq", "id", "b1"],
      ["select", "id"],
    ]);
    expect(deleteCalls()).toHaveLength(0);
  });

  it("'Marcar como inativo' sem linha de volta: o cadastro sumiu, toast informativo e fecha", async () => {
    auth.permissions = new Set(["delete_member", "edit_member"]);
    const onClose = await openConfirmation();
    respondWith({ data: [] });

    fireEvent.click(screen.getByRole("button", { name: "Marcar como inativo" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith({ title: "Este cadastro não existe ou já foi excluído." });
  });
});
