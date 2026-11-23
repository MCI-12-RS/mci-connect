import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "@/test/query-wrapper";
import { fakeQueries, resetFakeSupabase, respondWith } from "@/test/fake-supabase";
import { CELL_ROW_SELECT } from "@/lib/cells/fields";
import { RANGE_NOT_SATISFIABLE } from "@/lib/list-query";
import { useCellsList } from "./use-cells-list";

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

function renderList(params: { page: number; pageSize: number; search: string }) {
  return renderHook(() => useCellsList(params), { wrapper: createQueryWrapper() });
}

describe("useCellsList (RN-01, RN-03, RN-04)", () => {
  beforeEach(() => resetFakeSupabase());

  it("Dada a última página de 100, quando carrega, então pede a faixa certa da cells_view com total exato, da célula mais recente para a mais antiga e desempate por id", async () => {
    respondWith({ data: [{ id: "c1" }], count: 1200 });

    const { result } = renderList({ page: 12, pageSize: 100, search: "" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const queries = fakeQueries();
    expect(queries).toHaveLength(1);
    expect(queries[0].table).toBe("cells_view");
    expect(queries[0].calls).toEqual([
      ["select", CELL_ROW_SELECT, { count: "exact" }],
      ["order", "created_at", { ascending: false }],
      ["order", "id"],
      ["range", 1100, 1199],
    ]);
    expect(result.current.data).toEqual({ rows: [{ id: "c1" }], total: 1200 });
  });

  it("Dada a busca \"joao silva\", quando carrega, então cada palavra vira um ilike em search_text", async () => {
    respondWith({ data: [], count: 0 });

    const { result } = renderList({ page: 1, pageSize: 25, search: "  João   SILVA " });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fakeQueries()[0].calls.filter(([method]) => method === "ilike")).toEqual([
      ["ilike", "search_text", "%joao%"],
      ["ilike", "search_text", "%silva%"],
    ]);
  });

  it("Dada uma busca com vírgula, parênteses e %, quando carrega, então os caracteres viram texto, sem quebrar o filtro", async () => {
    respondWith({ data: [], count: 0 });

    const { result } = renderList({ page: 1, pageSize: 25, search: "a,b) 100%" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fakeQueries()[0].calls.filter(([method]) => method === "ilike")).toEqual([
      ["ilike", "search_text", "%a,b%"],
      ["ilike", "search_text", "%100\\%%"],
    ]);
  });

  it("Dada uma página além do fim (416), quando carrega, então devolve a página vazia com o total atual", async () => {
    respondWith({ error: { code: RANGE_NOT_SATISFIABLE, message: "" } }, { count: 30 });

    const { result } = renderList({ page: 5, pageSize: 25, search: "" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fakeQueries()[1].calls).toEqual([["select", "id", { count: "exact", head: true }]]);
    expect(result.current.data).toEqual({ rows: [], total: 30 });
  });
});
