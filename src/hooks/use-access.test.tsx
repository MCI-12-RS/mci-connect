import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRpcs, resetFakeSupabase, respondToRpc } from "@/test/fake-supabase";
import { NO_ACCESS, type Access } from "@/lib/access/access";
import { ACCESS_QUERY_KEY, isAccessQueryKey, refreshAccess, useAccessQuery } from "./use-access";

// Releitura do acesso (E2.02, RN-08, UXD-11, P13, T12): na navegação, na volta
// da aba e por pedido (42501); o aviso "Seu acesso foi atualizado." uma vez
// quando muda; a falha mantém o último acesso.

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ toast }));

const MEMBER: Access = {
  ...NO_ACCESS,
  member_id: "m-caio",
  role_id: "r-membro",
  role_name: "Membro",
  permissions: ["view_dashboard", "view_own_ministry", "edit_own_data", "submit_own_cell_report"],
  sees_ministry: true,
  sees_ministry_reports: true,
};
const LEADER: Access = {
  ...MEMBER,
  role_id: "r-lider",
  role_name: "Líder",
  permissions: [...MEMBER.permissions, "create_member", "edit_member"],
};

const accessReads = () => fakeRpcs().filter((rpc) => rpc.fn === "my_access").length;

function setup(userId: string | null = "u-caio") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  const hook = renderHook(
    () => {
      const navigate = useNavigate();
      return { ...useAccessQuery(userId), navigate };
    },
    { wrapper },
  );
  return { ...hook, client };
}

function returnToTab() {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("useAccessQuery", () => {
  beforeEach(() => {
    resetFakeSupabase();
    toast.mockClear();
  });

  it("lê o acesso pela my_access, sem aviso na primeira leitura", async () => {
    respondToRpc("my_access", { data: [MEMBER] });
    const { result } = setup();

    await waitFor(() => expect(result.current.access).toEqual(MEMBER));
    expect(accessReads()).toBe(1);
    expect(toast).not.toHaveBeenCalled();
  });

  it("sem sessão, não consulta nada", () => {
    const { result } = setup(null);
    expect(result.current.access).toBeNull();
    expect(accessReads()).toBe(0);
  });

  it("sem linha (sem cadastro): nada liberado", async () => {
    respondToRpc("my_access", { data: [] });
    const { result } = setup();
    await waitFor(() => expect(result.current.access).toEqual(NO_ACCESS));
  });

  it("relê a cada navegação, e não a cada troca de busca", async () => {
    respondToRpc("my_access", { data: [MEMBER] }, { data: [MEMBER] }, { data: [MEMBER] });
    const { result } = setup();
    await waitFor(() => expect(result.current.access).not.toBeNull());

    act(() => result.current.navigate("/members"));
    await waitFor(() => expect(accessReads()).toBe(2));

    act(() => result.current.navigate("/members?q=ana"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(accessReads()).toBe(2);
  });

  it("quando o acesso muda, avisa uma vez e recarrega as outras consultas", async () => {
    respondToRpc("my_access", { data: [MEMBER] }, { data: [LEADER] }, { data: [LEADER] });
    const { result, client } = setup();
    await waitFor(() => expect(result.current.access).toEqual(MEMBER));
    const invalidate = vi.spyOn(client, "invalidateQueries");

    returnToTab();
    await waitFor(() => expect(result.current.access).toEqual(LEADER));
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({ title: "Seu acesso foi atualizado." });
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ predicate: expect.any(Function) }));

    // A mesma impressão digital de novo: sem outro aviso.
    returnToTab();
    await waitFor(() => expect(accessReads()).toBe(3));
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("pedido de releitura (42501 em outra consulta) relê o acesso", async () => {
    respondToRpc("my_access", { data: [MEMBER] }, { data: [MEMBER] });
    const { result, client } = setup();
    await waitFor(() => expect(result.current.access).not.toBeNull());

    await act(() => refreshAccess(client));
    expect(accessReads()).toBe(2);
  });

  it("falha na primeira leitura: sem acesso e com o aviso; 'Tentar de novo' relê", async () => {
    respondToRpc("my_access", { error: { code: "42501", message: "permission denied" } }, { data: [MEMBER] });
    const { result } = setup();
    await waitFor(() => expect(result.current.loadFailed).toBe(true));
    expect(result.current.access).toBeNull();

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.access).toEqual(MEMBER));
    expect(result.current.loadFailed).toBe(false);
  });

  it("falha numa releitura: mantém o último acesso, sem aviso de falha", async () => {
    respondToRpc("my_access", { data: [MEMBER] }, { error: { code: "42501", message: "permission denied" } });
    const { result } = setup();
    await waitFor(() => expect(result.current.access).toEqual(MEMBER));

    returnToTab();
    await waitFor(() => expect(accessReads()).toBe(2));
    expect(result.current.access).toEqual(MEMBER);
    expect(result.current.loadFailed).toBe(false);
  });
});

describe("isAccessQueryKey", () => {
  it("reconhece a chave do acesso", () => {
    expect(isAccessQueryKey([...ACCESS_QUERY_KEY, "u-1"])).toBe(true);
    expect(isAccessQueryKey(["members", {}])).toBe(false);
    expect(isAccessQueryKey(undefined)).toBe(false);
  });
});
