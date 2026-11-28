import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "@/test/query-wrapper";
import { fakeQueries, fakeRpcs, resetFakeSupabase, respondToRpc } from "@/test/fake-supabase";
import { CELL_REPORT_LIST_SELECT } from "@/lib/cell-reports/fields";
import { EMPTY_CELL_REPORT_FILTERS, type CellReportFilters } from "@/lib/cell-reports/filters";
import { useCellReportsList } from "./use-cell-reports-list";

// A lista de Relatórios pelas duas RPCs (E2.12, RN-01 a RN-03, RN-13; DT-01, DT-04).

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

const C1 = "c0000000-0000-4000-8000-000000000001";

function renderList(params: { page: number; pageSize: number; search: string }, filters: CellReportFilters = EMPTY_CELL_REPORT_FILTERS) {
  return renderHook(() => useCellReportsList(params, filters), { wrapper: createQueryWrapper() });
}

describe("useCellReportsList", () => {
  beforeEach(() => resetFakeSupabase());

  it("pede a página pela cell_reports_list e o total pela cell_reports_list_count, sem .order() (a ordem é da RPC) e sem ler a view à parte", async () => {
    respondToRpc("cell_reports_list", { data: [{ id: "r1", participants_count: 8 }] });
    respondToRpc("cell_reports_list_count", { data: 1530 });

    const { result } = renderList({ page: 2, pageSize: 25, search: "" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [page, count] = fakeRpcs();
    expect(page.fn).toBe("cell_reports_list");
    expect(page.args).toEqual({ _limit: 25, _offset: 25 });
    expect(page.calls).toEqual([["select", CELL_REPORT_LIST_SELECT]]);
    expect(count.fn).toBe("cell_reports_list_count");
    expect(count.args).toEqual({});
    expect(fakeQueries()).toHaveLength(0);
    expect(result.current.data).toEqual({ rows: [{ id: "r1", participants_count: 8 }], total: 1530 });
  });

  it("a busca e os filtros vão iguais para as duas RPCs", async () => {
    respondToRpc("cell_reports_list", { data: [] });
    respondToRpc("cell_reports_list_count", { data: 0 });

    const filters: CellReportFilters = { ...EMPTY_CELL_REPORT_FILTERS, cellId: C1, from: "2026-11-22", to: "2026-11-28", types: ["macrocell"], held: "no" };
    const { result } = renderList({ page: 1, pageSize: 50, search: "João (Graça)" }, filters);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const expected = {
      _search: ["%joao%", "%graca%"],
      _cell_id: C1,
      _date_from: "2026-11-22",
      _date_to: "2026-11-28",
      _types: ["Macrocélula"],
      _held: false,
    };
    const [page, count] = fakeRpcs();
    expect(page.args).toEqual({ ...expected, _limit: 50, _offset: 0 });
    expect(count.args).toEqual(expected);
  });

  it("um erro em qualquer uma das duas vira erro da lista", async () => {
    respondToRpc("cell_reports_list", { data: [] });
    respondToRpc("cell_reports_list_count", { error: { code: "57014", message: "canceling statement" } });

    const { result } = renderList({ page: 1, pageSize: 25, search: "" });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
