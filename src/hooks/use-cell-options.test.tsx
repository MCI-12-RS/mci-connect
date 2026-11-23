import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "@/test/query-wrapper";
import { fakeQueries, resetFakeSupabase, respondWith } from "@/test/fake-supabase";
import { CELL_SUMMARY_SELECT } from "@/lib/cells/fields";
import { toCellOption, useCellOptions, type CellOptionsParams } from "./use-cell-options";

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

const cells = (count: number, start = 0) =>
  Array.from({ length: count }, (_, i) => ({
    id: `c${start + i}`,
    leader_name: `Líder ${start + i}`,
    meeting_day: "Quarta",
    meeting_time: "20:00:00",
    street: "Rua A",
    number: "10",
    neighborhood: "Centro",
  }));

function renderOptions(params: CellOptionsParams) {
  return renderHook((props: CellOptionsParams) => useCellOptions(props), {
    initialProps: params,
    wrapper: createQueryWrapper(),
  });
}

describe("useCellOptions (RN-05, RN-07)", () => {
  beforeEach(() => resetFakeSupabase());

  it("Dado o seletor de célula aberto sem texto, então lê só as células ativas da cells_view, pelo nome do líder (sem líder no fim) e desempate por id, pedindo 21 linhas", async () => {
    respondWith({ data: cells(2) });

    const { result } = renderOptions({ search: "" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [query] = fakeQueries();
    expect(query.table).toBe("cells_view");
    expect(query.calls).toEqual([
      ["select", CELL_SUMMARY_SELECT],
      ["eq", "is_active", true],
      ["order", "leader_name", { nullsFirst: false }],
      ["order", "id"],
      ["range", 0, 20],
    ]);
  });

  it("Dada uma busca, então cada palavra vira um ilike em search_text", async () => {
    respondWith({ data: [] });

    const { result } = renderOptions({ search: "Ana centro" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fakeQueries()[0].calls.filter(([method]) => method === "ilike")).toEqual([
      ["ilike", "search_text", "%ana%"],
      ["ilike", "search_text", "%centro%"],
    ]);
  });

  it("Dadas 21 linhas, então mostra 20, há mais, e a próxima página pede as linhas 20 a 40", async () => {
    respondWith({ data: cells(21) }, { data: cells(3, 20) });

    const { result } = renderOptions({ search: "" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages[0].items).toHaveLength(20);
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));

    expect(fakeQueries()[1].calls).toContainEqual(["range", 20, 40]);
    expect(result.current.data?.pages.flatMap((page) => page.items)).toEqual(cells(23));
    expect(result.current.hasNextPage).toBe(false);
  });

  it("Dada uma nova busca, então recomeça da primeira página", async () => {
    respondWith({ data: cells(21) }, { data: cells(1, 50) });

    const { result, rerender } = renderOptions({ search: "" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ search: "bairro" });
    await waitFor(() => expect(result.current.data?.pages[0].items).toEqual(cells(1, 50)));

    expect(fakeQueries()[1].calls).toContainEqual(["range", 0, 20]);
  });

  it("Dado o seletor fechado ou travado (enabled false), então não consulta nada", () => {
    renderOptions({ search: "", enabled: false });
    expect(fakeQueries()).toHaveLength(0);
  });

  it("A opção usa o id da célula e o rótulo de célula das telas", () => {
    expect(toCellOption(cells(1)[0])).toEqual({ value: "c0", label: "Célula de Líder 0, em Rua A 10, Centro" });
  });
});
