import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "@/test/query-wrapper";
import { fakeQueries, resetFakeSupabase, respondWith } from "@/test/fake-supabase";
import { toMemberOption, useMemberOptions } from "./use-member-options";
import { useOptionsPagination } from "./use-paginated-select";

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

const members = (count: number, start = 0) =>
  Array.from({ length: count }, (_, i) => ({ id: `m${start + i}`, name: `Membro ${start + i}` }));
const failure = { error: { code: "08006", message: "connection failure" } };

function renderPagination() {
  return renderHook(() => useOptionsPagination(useMemberOptions({ search: "" }), toMemberOption), {
    wrapper: createQueryWrapper(),
  });
}

describe("useOptionsPagination (RN-07)", () => {
  beforeEach(() => resetFakeSupabase());

  it("Dada a primeira página carregando, então indica carregamento e nenhuma opção", () => {
    respondWith({ data: members(3) });

    const { result } = renderPagination();

    expect(result.current.isLoading).toBe(true);
    expect(result.current.options).toEqual([]);
  });

  it("Dadas 21 linhas e depois 5, então as opções crescem de 20 para 25, sem repetir, e acabam", async () => {
    respondWith({ data: members(21) }, { data: members(5, 20) });

    const { result } = renderPagination();
    await waitFor(() => expect(result.current.options).toHaveLength(20));
    expect(result.current.options[0]).toEqual({ value: "m0", label: "Membro 0" });
    expect(result.current.hasNextPage).toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.options).toHaveLength(25));

    expect(new Set(result.current.options.map((o) => o.value)).size).toBe(25);
    expect(result.current.hasNextPage).toBe(false);
  });

  it("Dados dois pedidos de carregar mais antes da resposta (rolagem e clique), então a próxima página é consultada uma vez só", async () => {
    respondWith({ data: members(21) }, { data: members(21, 20) }, { data: members(21, 40) });

    const { result } = renderPagination();
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));

    act(() => {
      result.current.loadMore();
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.options).toHaveLength(40));

    expect(fakeQueries()).toHaveLength(2);
  });

  it("Dada uma falha na primeira página, então mostra o erro; tentar de novo refaz a primeira página", async () => {
    respondWith(failure, { data: members(2) });

    const { result } = renderPagination();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.options).toEqual([]);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.options).toHaveLength(2));

    expect(result.current.isError).toBe(false);
    expect(fakeQueries()[1].calls).toContainEqual(["range", 0, 20]);
  });

  it("Dada uma falha na página seguinte, então mantém as opções, não carrega mais sozinho e tentar de novo pede a mesma página", async () => {
    respondWith({ data: members(21) }, failure, { data: members(3, 20) });

    const { result } = renderPagination();
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.options).toHaveLength(20);

    act(() => result.current.loadMore());
    expect(fakeQueries()).toHaveLength(2);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.options).toHaveLength(23));

    expect(fakeQueries()[2].calls).toContainEqual(["range", 20, 40]);
    expect(result.current.isError).toBe(false);
  });
});
