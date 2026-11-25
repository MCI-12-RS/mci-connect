import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "@/test/query-wrapper";
import { fakeQueries, fakeRpcs, resetFakeSupabase, respondToRpc } from "@/test/fake-supabase";
import { PERMISSION_DENIED } from "@/lib/errors";
import { useMinistryTree } from "./use-ministry-tree";

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

const couple = {
  member_id: "h1",
  member_name: "Bruno",
  member_gender: "M",
  g12_level: 1,
  is_pastor: false,
  spouse_id: "m1",
  spouse_name: "Ana",
  direct_disciples: 12,
  total_disciples: 40,
  total_cells: 7,
  kind: "node",
  level_member_id: "h1",
  level_gender: "M",
  level_is_pastor: false,
  spouse_is_pastor: false,
};

const reference = {
  ...couple,
  kind: "spouse_above",
  member_id: "m2",
  member_name: "Carla",
  spouse_id: "h0",
  spouse_name: "Davi",
  g12_level: 4,
  level_member_id: "m2",
  level_gender: "F",
  direct_disciples: 0,
  total_disciples: null,
  total_cells: null,
};

const coupleItem = {
  kind: "node",
  member_id: "h1",
  member_name: "Bruno",
  spouse_id: "m1",
  spouse_name: "Ana",
  level: { level: 1, isPastor: false, gender: "M", bothPastors: false },
  direct_disciples: 12,
  total_disciples: 40,
  total_cells: 7,
};

describe("useMinistryTree (RN-10)", () => {
  beforeEach(() => resetFakeSupabase());

  it("Dada a tela aberta, então as raízes vêm de uma chamada só à RPC, sem argumentos e sem ler tabelas", async () => {
    respondToRpc("ministry_tree_nodes", { data: [couple] });

    const { result } = renderHook(() => useMinistryTree(null), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fakeRpcs().map((call) => [call.fn, call.args])).toEqual([["ministry_tree_nodes", undefined]]);
    expect(fakeQueries()).toHaveLength(0);
    expect(result.current.data).toEqual([coupleItem]);
  });

  it("Dada uma referência (spouse_above), então ela vem como referência, sem totais, ao lado dos nós (T4)", async () => {
    respondToRpc("ministry_tree_nodes", { data: [couple, reference] });

    const { result } = renderHook(() => useMinistryTree(["h0"]), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([
      coupleItem,
      {
        kind: "spouse_above",
        member_id: "m2",
        member_name: "Carla",
        spouse_id: "h0",
        spouse_name: "Davi",
        level: { level: 4, isPastor: false, gender: "F" },
      },
    ]);
  });

  it("Dado um casal expandido, então os filhos vêm de uma chamada só, com os ids dos dois", async () => {
    respondToRpc("ministry_tree_nodes", { data: [couple] });

    const { result } = renderHook(() => useMinistryTree(["h1", "m1"]), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fakeRpcs().map((call) => [call.fn, call.args])).toEqual([
      ["ministry_tree_nodes", { _parent_ids: ["h1", "m1"] }],
    ]);
    expect(fakeQueries()).toHaveLength(0);
  });

  it("Dado quem não vê nenhum pastor, então a lista vem vazia, sem erro", async () => {
    respondToRpc("ministry_tree_nodes", { data: [] });

    const { result } = renderHook(() => useMinistryTree(null), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
  });

  it("Dado um nó recolhido (enabled false), então não chama nada", () => {
    renderHook(() => useMinistryTree(["h1"], { enabled: false }), { wrapper: createQueryWrapper() });

    expect(fakeRpcs()).toHaveLength(0);
  });

  it("Dado um nó recolhido e reaberto, então usa o cache, sem nova chamada", async () => {
    respondToRpc("ministry_tree_nodes", { data: [couple] });

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useMinistryTree(["h1", "m1"], { enabled }),
      { initialProps: { enabled: true }, wrapper: createQueryWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ enabled: false });
    rerender({ enabled: true });

    expect(result.current.data).toEqual([coupleItem]);
    expect(fakeRpcs()).toHaveLength(1);
  });

  it("Dado um erro de permissão (42501), então não tenta de novo", async () => {
    respondToRpc("ministry_tree_nodes", { error: { code: PERMISSION_DENIED, message: "sem permissão" } });

    const { result } = renderHook(() => useMinistryTree(null), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(fakeRpcs()).toHaveLength(1);
  });
});
