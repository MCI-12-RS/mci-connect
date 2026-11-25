import type { ReactNode } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeRpcs, resetFakeSupabase, respondToRpc } from "@/test/fake-supabase";
import { ROLE_TEXTS, RULE_TEXTS } from "@/lib/access/texts";
import type { Role } from "@/lib/roles/roles";
import RoleForm from "./RoleForm";
import RoleDeleteFlow from "./RoleDeleteFlow";

// Formulário e exclusão de função (E2.02, T3 e T4): a gravação numa chamada
// só, o bloqueio antecipado e as recusas do servidor. Os critérios de UX
// (UX-01 a UX-07) ficam nos testes do QA.

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

function makeRole(overrides: Partial<Role>): Role {
  return {
    id: "r",
    name: "Função",
    description: null,
    isProtected: false,
    isDefault: false,
    permissions: [],
    membersCount: 0,
    updatedAt: "2026-11-25T12:00:00+00:00",
    ...overrides,
  };
}

const admin = makeRole({ id: "adm", name: "Administrador", isProtected: true, membersCount: 1 });
const leader = makeRole({ id: "lid", name: "Líder", membersCount: 6, permissions: ["view_dashboard"] });
const member = makeRole({ id: "mem", name: "Membro", isDefault: true, membersCount: 5 });
const support = makeRole({ id: "apo", name: "Apoio", membersCount: 0 });
const roles = [admin, leader, member, support];

const appError = (code: string, message: string) => ({
  error: { code: "22023", message, details: JSON.stringify({ code }), hint: "app_error" },
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const saveCalls = () => fakeRpcs().filter((call) => call.fn === "save_role");
const deleteCalls = () => fakeRpcs().filter((call) => call.fn === "delete_role");

// O Checkbox e o Switch do Radix medem o tamanho com ResizeObserver (o jsdom não tem).
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  resetFakeSupabase();
  toast.mockClear();
});

describe("RoleForm (T3)", () => {
  function renderForm(role: Role | null) {
    const onClose = vi.fn();
    render(<RoleForm role={role} roles={roles} onClose={onClose} />, { wrapper });
    return { onClose };
  }

  it("sem nome, mostra o erro embaixo do campo, com o foco nele, e não chama o servidor", () => {
    renderForm(null);
    fireEvent.click(screen.getByRole("button", { name: ROLE_TEXTS.create }));
    const name = screen.getByLabelText(ROLE_TEXTS.nameLabel);
    expect(screen.getByText(ROLE_TEXTS.nameRequired)).toBeInTheDocument();
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(saveCalls()).toHaveLength(0);
  });

  it("grava nome, permissões e a troca da padrão numa chamada só da save_role", async () => {
    respondToRpc("save_role", { data: "lid" });
    const { onClose } = renderForm(leader);
    fireEvent.click(screen.getByLabelText("Visualizar Auditoria"));
    fireEvent.click(screen.getByRole("switch", { name: ROLE_TEXTS.defaultLabel }));
    expect(screen.getByText(ROLE_TEXTS.defaultSwitchWarning("Membro"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ROLE_TEXTS.save }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(saveCalls()).toHaveLength(1);
    expect(saveCalls()[0].args).toEqual({
      _role_id: "lid",
      _name: "Líder",
      _description: null,
      _permissions: ["view_dashboard", "view_audit_log"],
      _is_default: true,
      _expected_updated_at: leader.updatedAt,
    });
    expect(fakeRpcs().filter((call) => call.fn !== "save_role")).toHaveLength(0);
    expect(toast).toHaveBeenCalledWith({ title: ROLE_TEXTS.updatedAsDefault("Líder") });
  });

  it("na função padrão, o interruptor fica travado, com o motivo escrito", () => {
    renderForm(member);
    const toggle = screen.getByRole("switch", { name: ROLE_TEXTS.defaultLabel });
    expect(toggle).toBeDisabled();
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAccessibleDescription(ROLE_TEXTS.defaultLocked);
  });

  it("a dica da permissão é lida junto com o checkbox e cada grupo é um fieldset", () => {
    renderForm(null);
    expect(screen.getByRole("checkbox", { name: "Visualizar Auditoria" })).toHaveAccessibleDescription(
      "As alterações feitas em toda a igreja, sem limite de ministério.",
    );
    expect(screen.getAllByRole("group").map((group) => group.querySelector("legend")?.textContent)).toEqual([
      "O que a pessoa vê",
      "Membros",
      "Células",
      "Relatórios",
      "Funções e auditoria",
    ]);
  });

  it("nome repetido aparece embaixo do campo e mantém o formulário", async () => {
    respondToRpc("save_role", appError("role_name_taken", RULE_TEXTS.roleNameTaken));
    const { onClose } = renderForm(null);
    fireEvent.change(screen.getByLabelText(ROLE_TEXTS.nameLabel), { target: { value: "Líder" } });
    fireEvent.click(screen.getByRole("button", { name: ROLE_TEXTS.create }));
    expect(await screen.findByText(RULE_TEXTS.roleNameTaken)).toBeInTheDocument();
    expect(screen.getByLabelText(ROLE_TEXTS.nameLabel)).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("outra recusa de regra aparece no Alert do topo, com o foco", async () => {
    respondToRpc("save_role", appError("permission_not_covered", RULE_TEXTS.permissionNotCovered));
    renderForm(leader);
    fireEvent.click(screen.getByRole("button", { name: ROLE_TEXTS.save }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(RULE_TEXTS.permissionNotCovered);
    expect(alert).toHaveFocus();
  });

  it("função alterada em outra tela: toast informativo e fecha", async () => {
    respondToRpc("save_role", appError("role_changed", RULE_TEXTS.roleChanged));
    const { onClose } = renderForm(leader);
    fireEvent.click(screen.getByRole("button", { name: ROLE_TEXTS.save }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith({ title: RULE_TEXTS.roleChanged });
  });

  it("queda de conexão: o formulário continua aberto, com o aviso", async () => {
    respondToRpc("save_role", { error: { code: "", message: "TypeError: Failed to fetch" } });
    const { onClose } = renderForm(leader);
    fireEvent.click(screen.getByRole("button", { name: ROLE_TEXTS.save }));
    expect(await screen.findByRole("alert")).toHaveTextContent(ROLE_TEXTS.saveNetworkError);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("fechar com alterações pede para descartar; sem alterações, fecha direto", () => {
    const { onClose } = renderForm(leader);
    fireEvent.click(screen.getByRole("button", { name: ROLE_TEXTS.cancel }));
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    fireEvent.change(screen.getByLabelText(ROLE_TEXTS.nameLabel), { target: { value: "Líderes" } });
    fireEvent.click(screen.getByRole("button", { name: ROLE_TEXTS.cancel }));
    expect(screen.getByText(ROLE_TEXTS.discardTitle)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: ROLE_TEXTS.discard }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("RoleDeleteFlow (T4)", () => {
  function renderFlow(role: Role) {
    const onClose = vi.fn();
    render(<RoleDeleteFlow role={role} onClose={onClose} />, { wrapper });
    return { onClose };
  }

  it("função em uso: abre o bloqueio direto, com quantos, sem chamar o servidor", () => {
    renderFlow(leader);
    expect(screen.getByText(ROLE_TEXTS.deleteBlockedTitle("Líder"))).toBeInTheDocument();
    expect(screen.getByText(RULE_TEXTS.roleInUse(6))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ROLE_TEXTS.deleteAction })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: ROLE_TEXTS.close })).toHaveFocus();
    expect(deleteCalls()).toHaveLength(0);
  });

  it("função padrão: abre o bloqueio direto", () => {
    renderFlow(member);
    expect(screen.getByText(RULE_TEXTS.roleIsDefault)).toBeInTheDocument();
    expect(deleteCalls()).toHaveLength(0);
  });

  it("sem uso: confirma, exclui pela delete_role e avisa", async () => {
    respondToRpc("delete_role", { data: null });
    const { onClose } = renderFlow(support);
    expect(screen.getByText(ROLE_TEXTS.deleteTitle("Apoio"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ROLE_TEXTS.cancel })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: ROLE_TEXTS.deleteAction }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(deleteCalls().map((call) => call.args)).toEqual([{ _role_id: "apo" }]);
    expect(toast).toHaveBeenCalledWith({ title: ROLE_TEXTS.deleted });
  });

  it("a recusa do servidor troca a confirmação pelo bloqueio, com a mensagem dele", async () => {
    respondToRpc("delete_role", appError("role_in_use", RULE_TEXTS.roleInUse(1)));
    const { onClose } = renderFlow(support);
    fireEvent.click(screen.getByRole("button", { name: ROLE_TEXTS.deleteAction }));
    expect(await screen.findByText(RULE_TEXTS.roleInUse(1))).toBeInTheDocument();
    expect(screen.getByText(ROLE_TEXTS.deleteBlockedTitle("Apoio"))).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a recusa da Administrador vira toast de erro", async () => {
    respondToRpc("delete_role", appError("admin_role_protected", RULE_TEXTS.adminRoleProtected.delete));
    const { onClose } = renderFlow({ ...admin, membersCount: 0, isProtected: false });
    fireEvent.click(screen.getByRole("button", { name: ROLE_TEXTS.deleteAction }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith({ variant: "destructive", title: RULE_TEXTS.adminRoleProtected.delete });
  });

  it("queda de conexão: o diálogo continua aberto, com o aviso", async () => {
    respondToRpc("delete_role", { error: { code: "", message: "TypeError: Failed to fetch" } });
    const { onClose } = renderFlow(support);
    fireEvent.click(screen.getByRole("button", { name: ROLE_TEXTS.deleteAction }));
    expect(await screen.findByText(ROLE_TEXTS.deleteNetworkError)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
