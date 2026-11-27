import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "@/test/query-wrapper";
import { fakeRpcs, resetFakeSupabase, respondToRpc } from "@/test/fake-supabase";
import { CELL_LIST_SELECT } from "@/lib/cells/fields";
import { EMPTY_CELL_FILTERS, type CellFilters } from "@/lib/cells/filters";
import { useCellsList } from "./use-cells-list";

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

function renderList(params: { page: number; pageSize: number; search: string }, filters: CellFilters = EMPTY_CELL_FILTERS) {
  return renderHook(() => useCellsList(params, filters), { wrapper: createQueryWrapper() });
}

describe("useCellsList (E2.10: RN-01 a RN-03, RN-13)", () => {
  beforeEach(() => resetFakeSupabase());

  it("pede a página pela cells_list e o total pela cells_list_count, em paralelo, sem .order() (a ordem é da RPC)", async () => {
    respondToRpc("cells_list", { data: [{ id: "c1" }] });
    respondToRpc("cells_list_count", { data: 1200 });

    const { result } = renderList({ page: 12, pageSize: 100, search: "" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [page, count] = fakeRpcs();
    expect(page.fn).toBe("cells_list");
    expect(page.args).toEqual({ _limit: 100, _offset: 1100 });
    expect(page.calls).toEqual([["select", CELL_LIST_SELECT]]);
    expect(count.fn).toBe("cells_list_count");
    expect(count.args).toEqual({});
    expect(result.current.data).toEqual({ rows: [{ id: "c1" }], total: 1200 });
  });

  it("a busca e os filtros vão como argumentos das duas RPCs, os mesmos", async () => {
    respondToRpc("cells_list", { data: [] });
    respondToRpc("cells_list_count", { data: 0 });

    const filters: CellFilters = { ...EMPTY_CELL_FILTERS, types: ["evangelistic"], status: "active", reportStatuses: ["sent", "missed_1"] };
    const { result } = renderList({ page: 1, pageSize: 25, search: "  João   SILVA " }, filters);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const expected = {
      _search: ["%joao%", "%silva%"],
      _types: ["Evangelística"],
      _is_active: true,
      _report_statuses: ["sent_held", "sent_not_held"],
      _missing_weeks: [1],
    };
    const [page, count] = fakeRpcs();
    expect(page.args).toEqual({ ...expected, _limit: 25, _offset: 0 });
    expect(count.args).toEqual(expected);
  });

  it("página além do fim: a RPC devolve vazia, com o total atual (sem 416)", async () => {
    respondToRpc("cells_list", { data: [] });
    respondToRpc("cells_list_count", { data: 30 });

    const { result } = renderList({ page: 5, pageSize: 25, search: "" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ rows: [], total: 30 });
  });

  it("falha de qualquer das duas vira erro da lista", async () => {
    respondToRpc("cells_list", { data: [] });
    respondToRpc("cells_list_count", { error: { code: "57014", message: "canceling statement due to statement timeout" } });

    const { result } = renderList({ page: 1, pageSize: 25, search: "" });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
