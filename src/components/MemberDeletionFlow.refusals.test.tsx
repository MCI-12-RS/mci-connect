import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeQueries, fakeRpcs, resetFakeSupabase, respondToRpc } from "@/test/fake-supabase";
import MemberDeletionFlow, { type MemberDeletionTarget } from "./MemberDeletionFlow";

// Exclusão de membro (E2.01, T2 e T3): as recusas do servidor que o
// MemberDeletionFlow.test.tsx não cobre (UX-11, RN-03 e RN-04 na corrida),
// a trava do diálogo durante o envio (UX-06) e a recarga da lista (UX-24).
// Os payloads são os que o banco devolve (ver src/lib/deletion/server-contract.test.ts).

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

const gil: MemberDeletionTarget = { id: "m-10", name: "Gil Souza", isActive: true };

const appError = (details: string | null, message: string) => ({
  error: { code: "22023", message, details, hint: "app_error" },
});

/** delete_member(Gil), como o banco devolve (critério da RN-04). */
const GIL_LINKS = appError(
  '{"code": "member_has_links", "cells": [{"id": "c-01", "roles": ["timothy"], "is_active": true, "leader_name": "Carlos Lima", "meeting_day": "Quarta", "meeting_time": "20:00"}, {"id": "c-02", "roles": ["host"], "is_active": false, "leader_name": "Marcos Dias", "meeting_day": "Sexta", "meeting_time": "19:30"}], "disciples": [{"id": "m-13", "name": "Hugo Lima", "is_active": true}, {"id": "m-14", "name": "Ivo Reis", "is_active": true}, {"id": "m-15", "name": "João Alves", "is_active": true}, {"id": "m-16", "name": "Léo Martins", "is_active": false}], "member_id": "m-10", "cells_total": 2, "member_name": "Gil Souza", "disciples_total": 4}',
  "Não é possível excluir Gil Souza. Antes, reatribua 4 discípulos e 2 células.",
);

function renderFlow(member: MemberDeletionTarget = gil) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const onClose = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<MemberDeletionFlow member={member} onClose={onClose} />, { wrapper });
  const invalidatedKeys = () => invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  return { onClose, invalidatedKeys };
}

async function openConfirmation() {
  respondToRpc("check_member_deletion", { data: { can_delete: true } });
  const rendered = renderFlow();
  await screen.findByRole("button", { name: "Excluir cadastro" });
  return rendered;
}

const deleteCalls = () => fakeRpcs().filter((call) => call.fn === "delete_member");

/** O bloqueio aberto: sem botão destrutivo, só "Fechar". */
function expectBlockedOnlyClose(dialog: HTMLElement) {
  expect(within(dialog).queryByRole("button", { name: /Excluir|Excluindo|Marcar como inativo/ })).not.toBeInTheDocument();
  expect(within(dialog).getAllByRole("button").map((button) => button.textContent)).toEqual(["Fechar"]);
}

describe("MemberDeletionFlow: recusas do servidor (UX-11)", () => {
  beforeEach(() => {
    resetFakeSupabase();
    toast.mockClear();
    auth.permissions = new Set(["delete_member"]);
  });

  it("RN-03: 'Você não pode excluir o seu próprio cadastro.' no envio abre o bloqueio 'Não é possível excluir {Nome}', só com 'Fechar'", async () => {
    const { onClose } = await openConfirmation();
    respondToRpc("delete_member", appError('{"code": "self_delete"}', "Você não pode excluir o seu próprio cadastro."));

    fireEvent.click(screen.getByRole("button", { name: "Excluir cadastro" }));

    expect(await screen.findByRole("heading", { name: "Não é possível excluir Gil Souza" })).toHaveFocus();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Você não pode excluir o seu próprio cadastro.");
    expectBlockedOnlyClose(dialog);

    fireEvent.click(within(dialog).getByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).not.toHaveBeenCalled();
  });

  it("RN-03: a pré-checagem com 'função acima' abre o bloqueio direto, sem a confirmação e sem chamar a exclusão", async () => {
    respondToRpc("check_member_deletion", {
      data: { can_delete: false, code: "role_above", message: "Você não tem permissão para excluir este membro." },
    });
    renderFlow();

    expect(await screen.findByRole("heading", { name: "Não é possível excluir Gil Souza" })).toBeInTheDocument();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Você não tem permissão para excluir este membro.");
    expect(dialog).not.toHaveTextContent("O cadastro sai das listas");
    expectBlockedOnlyClose(dialog);
    expect(deleteCalls()).toHaveLength(0);
  });

  it("RN-04 na corrida: a pré-checagem liberou, mas o servidor recusa com ligações; o diálogo troca para o bloqueio com as listas do critério", async () => {
    const { onClose } = await openConfirmation();
    respondToRpc("delete_member", GIL_LINKS);

    fireEvent.click(screen.getByRole("button", { name: "Excluir cadastro" }));

    expect(await screen.findByRole("heading", { name: "Não é possível excluir Gil Souza" })).toHaveFocus();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Antes, reatribua:");
    expect(within(dialog).getByRole("heading", { name: "4 discípulos" })).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "2 células" })).toBeInTheDocument();
    expect(within(dialog).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Hugo Lima",
      "Ivo Reis",
      "João Alves",
      "Léo Martins (inativo)",
      "Timóteo na célula de Carlos Lima, quarta, 20:00",
      "Anfitrião na célula de Marcos Dias, sexta, 19:30 (inativa)",
    ]);
    expect(dialog).toHaveTextContent("Discípulos e células inativos também contam.");
    expectBlockedOnlyClose(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("AQ-2: uma recusa sem os detalhes estruturados aparece no bloqueio com o texto como veio", async () => {
    await openConfirmation();
    respondToRpc("delete_member", appError(null, "Não é possível excluir Gil Souza. Antes, reatribua 4 discípulos e 2 células."));

    fireEvent.click(screen.getByRole("button", { name: "Excluir cadastro" }));

    await screen.findByRole("heading", { name: "Não é possível excluir Gil Souza" });
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Não é possível excluir Gil Souza. Antes, reatribua 4 discípulos e 2 células.");
    expect(within(dialog).queryByRole("heading", { name: /discípulos/ })).not.toBeInTheDocument();
    expectBlockedOnlyClose(dialog);
  });
});

describe("MemberDeletionFlow: envio e lista (UX-06, UX-07, UX-24)", () => {
  beforeEach(() => {
    resetFakeSupabase();
    toast.mockClear();
    auth.permissions = new Set(["delete_member", "edit_member"]);
  });

  it("UX-06: enquanto exclui, Esc não fecha o diálogo e 'Marcar como inativo' fica indisponível", async () => {
    const { onClose } = await openConfirmation();
    let release: () => void = () => {};
    const arrived = new Promise<void>((resolve) => (release = resolve));
    respondToRpc("delete_member", { data: null, until: arrived });

    fireEvent.click(screen.getByRole("button", { name: "Excluir cadastro" }));
    expect(await screen.findByRole("button", { name: "Excluindo…" })).toHaveAttribute("aria-disabled", "true");
    const inactivate = screen.getByRole("button", { name: "Marcar como inativo" });
    expect(inactivate).toHaveAttribute("aria-disabled", "true");
    // Indisponível, o toque não grava a situação.
    fireEvent.click(inactivate);
    expect(fakeQueries().some((query) => query.table === "members")).toBe(false);
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      release();
      await arrived;
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("UX-07: no sucesso, recarrega os membros (lista, seletores, árvore) e o Dashboard", async () => {
    const { onClose, invalidatedKeys } = await openConfirmation();
    respondToRpc("delete_member", { data: null });
    fireEvent.click(screen.getByRole("button", { name: "Excluir cadastro" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(invalidatedKeys()).toEqual([["members"], ["dashboard"]]);
  });

  it("UX-24: 'não existe ou já foi excluído' no envio é toast informativo, e a lista recarrega", async () => {
    const { onClose, invalidatedKeys } = await openConfirmation();
    respondToRpc(
      "delete_member",
      appError('{"code": "not_found_or_deleted", "entity": "member"}', "Este cadastro não existe ou já foi excluído."),
    );

    fireEvent.click(screen.getByRole("button", { name: "Excluir cadastro" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith({ title: "Este cadastro não existe ou já foi excluído." });
    expect(invalidatedKeys()).toContainEqual(["members"]);
  });

  it("UX-24: 'não existe ou já foi excluído' na pré-checagem também recarrega a lista", async () => {
    respondToRpc("check_member_deletion", {
      data: { can_delete: false, code: "not_found_or_deleted", message: "Este cadastro não existe ou já foi excluído." },
    });
    const { onClose, invalidatedKeys } = renderFlow();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(invalidatedKeys()).toContainEqual(["members"]);
    expect(deleteCalls()).toHaveLength(0);
  });
});
