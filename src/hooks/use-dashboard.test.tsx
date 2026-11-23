import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "@/test/query-wrapper";
import { NOT_SINGLE_ROW, fakeQueries, fakeRpcs, resetFakeSupabase, respondWith } from "@/test/fake-supabase";
import { PERMISSION_DENIED } from "@/lib/errors";
import { useDashboardCellsByType, useDashboardG12Ranking, useDashboardSummary } from "./use-dashboard";

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

const summaryRow = {
  week_start: "2026-11-22",
  week_end: "2026-11-28",
  reports_sent: 12,
  cells_pending: 3,
  visitors: 7,
  cells_not_held: 1,
  members_total: 1530,
  members_active: 1400,
  members_inactive: 130,
  members_baptized: 1000,
  members_not_baptized: 530,
  members_without_leader: 4,
  members_without_cell_link: 210,
};

const hooks = [
  { fn: "dashboard_summary", useHook: useDashboardSummary },
  { fn: "dashboard_cells_by_type", useHook: useDashboardCellsByType },
  { fn: "dashboard_g12_ranking", useHook: useDashboardG12Ranking },
];

const denied = { code: PERMISSION_DENIED, message: "Você não tem permissão para ver o dashboard." };

describe("useDashboardSummary (RN-02, RN-08)", () => {
  beforeEach(() => resetFakeSupabase());
  afterEach(() => vi.useRealTimers());

  it("Dado o dashboard aberto, quando carrega, então chama só a dashboard_summary, sem argumentos, e devolve a linha como objeto", async () => {
    respondWith({ data: [summaryRow] });

    const { result } = renderHook(() => useDashboardSummary(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fakeQueries()).toHaveLength(0);
    expect(fakeRpcs().map(({ fn, args, calls }) => ({ fn, args, calls }))).toEqual([
      { fn: "dashboard_summary", args: undefined, calls: [["single"]] },
    ]);
    expect(result.current.data).toEqual(summaryRow);
  });

  it("Dado um resultado vazio, quando carrega, então é erro (nada de números zerados)", async () => {
    vi.useFakeTimers();
    const empty = { data: [] };
    respondWith(empty, empty, empty, empty);

    const { result } = renderHook(() => useDashboardSummary(), { wrapper: createQueryWrapper() });
    await act(() => vi.advanceTimersByTimeAsync(60_000));

    expect(result.current.isError).toBe(true);
    expect(result.current.error).toEqual(NOT_SINGLE_ROW);
  });
});

describe("useDashboardCellsByType e useDashboardG12Ranking (RN-02, RN-08)", () => {
  beforeEach(() => resetFakeSupabase());

  it("Dado o dashboard aberto, quando carrega as células por tipo, então chama só a dashboard_cells_by_type, sem argumentos", async () => {
    const rows = [
      { cell_type: "Discipulado", total: 450 },
      { cell_type: "Evangelística", total: 750 },
    ];
    respondWith({ data: rows });

    const { result } = renderHook(() => useDashboardCellsByType(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fakeQueries()).toHaveLength(0);
    expect(fakeRpcs().map(({ fn, args, calls }) => ({ fn, args, calls }))).toEqual([
      { fn: "dashboard_cells_by_type", args: undefined, calls: [] },
    ]);
    expect(result.current.data).toEqual(rows);
  });

  it("Dado o dashboard aberto, quando carrega o ranking, então chama só a dashboard_g12_ranking, sem argumentos, e mantém a ordem e os totais do banco", async () => {
    const rows = [
      { couple_key: "a|b", name: "Bruno", spouse_name: "Ana", male_cells: 3, female_cells: 4, total_cells: 7 },
      { couple_key: "c", name: "Carla", spouse_name: null, male_cells: 0, female_cells: 0, total_cells: 0 },
    ];
    respondWith({ data: rows });

    const { result } = renderHook(() => useDashboardG12Ranking(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fakeQueries()).toHaveLength(0);
    expect(fakeRpcs().map(({ fn, args, calls }) => ({ fn, args, calls }))).toEqual([
      { fn: "dashboard_g12_ranking", args: undefined, calls: [] },
    ]);
    expect(result.current.data).toEqual(rows);
  });
});

describe("Acesso ao dashboard (RN-09)", () => {
  beforeEach(() => resetFakeSupabase());
  afterEach(() => vi.useRealTimers());

  it.each(hooks)(
    "Dado um usuário sem permissão, quando $fn responde 42501, então o erro chega na hora, sem nova tentativa",
    async ({ fn, useHook }) => {
      respondWith({ error: denied }, { error: denied }, { error: denied }, { error: denied });

      const { result } = renderHook(() => useHook(), { wrapper: createQueryWrapper() });
      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(fakeRpcs().map((call) => call.fn)).toEqual([fn]);
      expect(result.current.error).toEqual(denied);
    },
  );

  it.each(hooks)(
    "Dado outro erro, quando $fn falha, então tenta de novo como o padrão (3 novas tentativas)",
    async ({ fn, useHook }) => {
      vi.useFakeTimers();
      const failure = { error: { code: "08006", message: "connection failure" } };
      respondWith(failure, failure, failure, failure);

      const { result } = renderHook(() => useHook(), { wrapper: createQueryWrapper() });
      await act(() => vi.advanceTimersByTimeAsync(60_000));

      expect(result.current.isError).toBe(true);
      expect(fakeRpcs().map((call) => call.fn)).toEqual([fn, fn, fn, fn]);
    },
  );
});
