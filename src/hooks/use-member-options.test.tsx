import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "@/test/query-wrapper";
import { fakeQueries, fakeRpcs, resetFakeSupabase, respondWith } from "@/test/fake-supabase";
import { useMemberName, useMemberOptions, type MemberOptionsParams } from "./use-member-options";

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

const members = (count: number, start = 0) =>
  Array.from({ length: count }, (_, i) => ({ id: `m${start + i}`, name: `Membro ${start + i}` }));

function renderOptions(params: MemberOptionsParams) {
  return renderHook((props: MemberOptionsParams) => useMemberOptions(props), {
    initialProps: params,
    wrapper: createQueryWrapper(),
  });
}

describe("useMemberOptions (RN-05, RN-07)", () => {
  beforeEach(() => resetFakeSupabase());

  it("Dado o seletor de líder aberto sem texto, então lê id e nome da members_view, sem o próprio membro, em ordem alfabética com desempate por id, pedindo 21 linhas", async () => {
    respondWith({ data: members(3) });

    const { result } = renderOptions({ search: "", excludeId: "eu" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [query] = fakeQueries();
    expect(query.table).toBe("members_view");
    expect(query.calls).toEqual([
      ["select", "id, name"],
      ["neq", "id", "eu"],
      ["order", "name"],
      ["order", "id"],
      ["range", 0, 20],
    ]);
  });

  it("Dado o seletor de líder ou cônjuge, então traz ativos e inativos (sem filtro de is_active)", async () => {
    respondWith({ data: [] });

    const { result } = renderOptions({ search: "" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fakeQueries()[0].methods()).not.toContain("eq");
    expect(fakeQueries()[0].methods()).not.toContain("neq");
  });

  it("Dado o seletor de participantes (activeOnly), então só membros ativos", async () => {
    respondWith({ data: [] });

    const { result } = renderOptions({ search: "", activeOnly: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fakeQueries()[0].calls).toContainEqual(["eq", "is_active", true]);
  });

  it("Dada a busca \"João  SILVA\", então cada palavra vira um ilike em search_text", async () => {
    respondWith({ data: [] });

    const { result } = renderOptions({ search: "João  SILVA" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fakeQueries()[0].calls.filter(([method]) => method === "ilike")).toEqual([
      ["ilike", "search_text", "%joao%"],
      ["ilike", "search_text", "%silva%"],
    ]);
  });

  it("Dadas 21 linhas, então mostra 20 e há mais; a próxima página pede as linhas 20 a 40 e acaba com 5", async () => {
    respondWith({ data: members(21) }, { data: members(5, 20) });

    const { result } = renderOptions({ search: "ma", activeOnly: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.pages[0].items).toEqual(members(20));
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));

    expect(fakeQueries()).toHaveLength(2);
    expect(fakeQueries()[1].calls).toContainEqual(["range", 20, 40]);
    expect(result.current.data?.pages.flatMap((page) => page.items)).toEqual(members(25));
    expect(result.current.hasNextPage).toBe(false);
  });

  it("Dada uma nova busca, então a chave muda e recomeça da primeira página", async () => {
    respondWith({ data: members(21) }, { data: members(21, 20) }, { data: members(2, 100) });

    const { result, rerender } = renderOptions({ search: "ma" });
    // Lê `data` antes de carregar mais: o TanStack só renderiza de novo por
    // mudanças nas propriedades já lidas do resultado.
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));

    rerender({ search: "mar" });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));

    const last = fakeQueries()[2];
    expect(last.calls).toContainEqual(["ilike", "search_text", "%mar%"]);
    expect(last.calls).toContainEqual(["range", 0, 20]);
    expect(result.current.data?.pages[0].items).toEqual(members(2, 100));
    expect(result.current.hasNextPage).toBe(false);
  });

  it("Dado o seletor fechado (enabled false), então não consulta nada", () => {
    const { result } = renderOptions({ search: "", enabled: false });

    expect(result.current.fetchStatus).toBe("idle");
    expect(fakeQueries()).toHaveLength(0);
  });
});

describe("useMemberName (RN-06)", () => {
  beforeEach(() => resetFakeSupabase());

  it("Dado um líder já gravado, então busca o nome pela RPC member_names (que resolve quem está fora do escopo)", async () => {
    respondWith({ data: [{ id: "p1", name: "Pastor Fora do Escopo" }] });

    const { result } = renderHook(() => useMemberName("p1"), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fakeRpcs().map((call) => [call.fn, call.args])).toEqual([["member_names", { _ids: ["p1"] }]]);
    expect(fakeQueries()).toHaveLength(0);
    expect(result.current.data).toBe("Pastor Fora do Escopo");
  });

  it("Dado um id que não existe, então devolve null", async () => {
    respondWith({ data: [] });

    const { result } = renderHook(() => useMemberName("x"), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBeNull();
  });

  it("Sem valor, ou com o nome já conhecido, não consulta nada", () => {
    renderHook(() => useMemberName(null), { wrapper: createQueryWrapper() });
    renderHook(() => useMemberName("m1", { enabled: false }), { wrapper: createQueryWrapper() });

    expect(fakeRpcs()).toHaveLength(0);
  });
});
