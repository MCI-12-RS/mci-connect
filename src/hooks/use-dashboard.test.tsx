import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "@/test/query-wrapper";
import { NOT_SINGLE_ROW, fakeQueries, fakeRpcs, resetFakeSupabase, respondWith } from "@/test/fake-supabase";
import { PERMISSION_DENIED } from "@/lib/errors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { DASHBOARD_SUMMARY_KEY, useDashboardG12Ranking, useDashboardSummary, useInvalidatedByWrite } from "./use-dashboard";

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
  reports_held: 11,
  members_new: 2,
  cells_new: 1,
  cells_evangelistic: 5,
  cells_discipleship: 3,
  cells_macrocell: 0,
};

const hooks = [
  { fn: "dashboard_summary", useHook: useDashboardSummary },
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

describe("useDashboardG12Ranking (RN-11)", () => {
  beforeEach(() => resetFakeSupabase());

  it("Dado o dashboard aberto, quando carrega o ranking, então chama só a dashboard_g12_ranking, sem argumentos, e mantém a ordem e os totais do banco", async () => {
    const rows = [
      { couple_key: "a|b", name: "Bruno", spouse_name: "Ana", male_cells: 3, female_cells: 4, total_cells: 7, g12_ids: ["b", "a"] },
      { couple_key: "c", name: "Carla", spouse_name: null, male_cells: 0, female_cells: 0, total_cells: 0, g12_ids: ["c"] },
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

describe("useInvalidatedByWrite (E2.14, DT-07, DA-3)", () => {
  beforeEach(() => resetFakeSupabase());

  function wrapperWith(client: QueryClient) {
    return function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    };
  }

  it("Dado o resumo carregado, quando uma gravação o invalida e a busca seguinte falha, então a marca continua", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    respondWith({ data: [summaryRow] }, { error: { code: "08006", message: "connection failure" } });

    const { result } = renderHook(
      () => ({ query: useDashboardSummary(), invalidated: useInvalidatedByWrite(DASHBOARD_SUMMARY_KEY) }),
      { wrapper: wrapperWith(client) },
    );
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(result.current.invalidated).toBe(false);

    await act(() => client.invalidateQueries({ queryKey: ["dashboard"], refetchType: "active" }));
    await waitFor(() => expect(result.current.query.isError).toBe(true));
    expect(result.current.invalidated).toBe(true);
  });

  it("Dado o resumo carregado, quando uma busca sem gravação falha (voltar para a aba), então não há marca", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    respondWith({ data: [summaryRow] }, { error: { code: "08006", message: "connection failure" } });

    const { result } = renderHook(
      () => ({ query: useDashboardSummary(), invalidated: useInvalidatedByWrite(DASHBOARD_SUMMARY_KEY) }),
      { wrapper: wrapperWith(client) },
    );
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));

    await act(async () => {
      await result.current.query.refetch();
    });
    await waitFor(() => expect(result.current.query.isError).toBe(true));
    expect(result.current.invalidated).toBe(false);
  });
});
