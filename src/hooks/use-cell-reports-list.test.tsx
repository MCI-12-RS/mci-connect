import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "@/test/query-wrapper";
import { fakeQueries, resetFakeSupabase, respondWith } from "@/test/fake-supabase";
import { CELL_REPORT_ROW_SELECT, PARTICIPANT_COUNT_SELECT } from "@/lib/cell-reports/fields";
import { RANGE_NOT_SATISFIABLE } from "@/lib/list-query";
import { useCellReportsList } from "./use-cell-reports-list";

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

const pageRow = (id: string, visitors_count: number) => ({
  id,
  cell_id: `cell-${id}`,
  date: "2026-11-18",
  time: "20:00:00",
  theme: "Graça",
  observations: null,
  visitors: [],
  offering: 0,
  was_held: true,
  reason_not_held: null,
  visitors_count,
  cell_leader_name: "João da Silva",
  cell_street: "Rua A",
  cell_number: "1",
  cell_complement: null,
  cell_neighborhood: "Centro",
});

function renderList(params: { page: number; pageSize: number; search: string }) {
  return renderHook(() => useCellReportsList(params), { wrapper: createQueryWrapper() });
}

describe("useCellReportsList (RN-01, RN-03, RN-04)", () => {
  beforeEach(() => resetFakeSupabase());

  it("Dada a página 2 de 25, quando carrega, então pede a faixa 25–49 da cell_reports_view com total exato, da data mais recente para a mais antiga e desempate por id", async () => {
    respondWith({ data: [pageRow("r1", 0)], count: 1530 }, { data: [{ id: "r1", participants_count: 4 }] });

    const { result } = renderList({ page: 2, pageSize: 25, search: "" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [page] = fakeQueries();
    expect(page.table).toBe("cell_reports_view");
    expect(page.calls).toEqual([
      ["select", CELL_REPORT_ROW_SELECT, { count: "exact" }],
      ["order", "date", { ascending: false }],
      ["order", "time", { ascending: false }],
      ["order", "id"],
      ["range", 25, 49],
    ]);
    expect(result.current.data?.total).toBe(1530);
  });

  it("Dada uma busca com acento e parênteses, quando carrega, então aplica um ilike em search_text por palavra, já normalizada", async () => {
    respondWith({ data: [], count: 0 });

    const { result } = renderList({ page: 1, pageSize: 25, search: "João (Graça)" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const ilikes = fakeQueries()[0].calls.filter(([method]) => method === "ilike");
    expect(ilikes).toEqual([
      ["ilike", "search_text", "%joao%"],
      ["ilike", "search_text", "%graca%"],
    ]);
  });

  it("Dada uma página com linhas, quando carrega, então faz a segunda consulta de participantes só com os ids da página e soma as presenças", async () => {
    respondWith(
      { data: [pageRow("r1", 2), pageRow("r2", 0), pageRow("r3", 1)], count: 3 },
      { data: [{ id: "r2", participants_count: 7 }, { id: "r1", participants_count: 3 }] },
    );

    const { result } = renderList({ page: 1, pageSize: 25, search: "joao" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const queries = fakeQueries();
    expect(queries).toHaveLength(2);
    expect(queries[1].table).toBe("cell_reports_view");
    // Só o filtro por id: nada de busca nem de ordem (a contagem é por linha da página).
    expect(queries[1].calls).toEqual([
      ["select", PARTICIPANT_COUNT_SELECT],
      ["in", "id", ["r1", "r2", "r3"]],
    ]);
    expect(result.current.data?.rows.map((r) => [r.id, r.participants_count, r.visitors_count])).toEqual([
      ["r1", 3, 2],
      ["r2", 7, 0],
      ["r3", 0, 1],
    ]);
  });

  it("Dada uma página vazia, quando carrega, então não faz a segunda consulta", async () => {
    respondWith({ data: [], count: 0 });

    const { result } = renderList({ page: 1, pageSize: 25, search: "inexistente" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fakeQueries()).toHaveLength(1);
    expect(result.current.data).toEqual({ rows: [], total: 0 });
  });

  it("Dada uma página além do fim (416), quando carrega, então conta com os mesmos filtros e devolve a página vazia com o total atual", async () => {
    respondWith(
      { error: { code: RANGE_NOT_SATISFIABLE, message: "Requested range not satisfiable" } },
      { count: 12 },
    );

    const { result } = renderList({ page: 9, pageSize: 25, search: "ana" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const queries = fakeQueries();
    expect(queries).toHaveLength(2);
    expect(queries[1].calls).toEqual([
      ["select", "id", { count: "exact", head: true }],
      ["ilike", "search_text", "%ana%"],
    ]);
    expect(result.current.data).toEqual({ rows: [], total: 12 });
  });

  it("Dado um erro na contagem de participantes, quando carrega, então a lista fica em erro (não mostra presenças erradas)", async () => {
    respondWith({ data: [pageRow("r1", 0)], count: 1 }, { error: { code: "57014", message: "canceling statement" } });

    const { result } = renderList({ page: 1, pageSize: 25, search: "" });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useCellReportsList com o filtro Célula (E2.10, RN-19)", () => {
  beforeEach(() => resetFakeSupabase());

  it("filtra por cell_id na página e no total, e a chave muda com a célula", async () => {
    respondWith({ data: [], count: 0 });
    const { result } = renderHook(() => useCellReportsList({ page: 1, pageSize: 25, search: "" }, "c-1"), {
      wrapper: createQueryWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fakeQueries()[0].calls).toContainEqual(["eq", "cell_id", "c-1"]);
  });

  it("página além do fim: o total também é da célula", async () => {
    respondWith({ error: { code: RANGE_NOT_SATISFIABLE, message: "" } }, { count: 3 });
    const { result } = renderHook(() => useCellReportsList({ page: 4, pageSize: 25, search: "" }, "c-1"), {
      wrapper: createQueryWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fakeQueries()[1].calls).toEqual([
      ["select", "id", { count: "exact", head: true }],
      ["eq", "cell_id", "c-1"],
    ]);
    expect(result.current.data).toEqual({ rows: [], total: 3 });
  });

  it("sem célula, nenhum filtro por cell_id", async () => {
    respondWith({ data: [], count: 0 });
    const { result } = renderList({ page: 1, pageSize: 25, search: "" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fakeQueries()[0].calls.some(([method]) => method === "eq")).toBe(false);
  });
});
