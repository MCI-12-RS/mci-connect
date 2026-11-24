import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "@/test/query-wrapper";
import { fakeQueries, resetFakeSupabase, respondWith } from "@/test/fake-supabase";
import { CELL_REPORT_DETAIL_SELECT, REPORT_PARTICIPANT_SELECT } from "@/lib/cell-reports/fields";
import { useCellReport } from "./use-cell-report";

// Consulta do relatório de célula excluída (E2.01, T7; RN-09 b, RN-11, RN-13).

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

const report = { id: "r1", date: "2026-11-19", cell_deleted: true };
const participants = [
  { member_id: "m1", member_name: "Ana Souza", member_deleted: false },
  { member_id: "m9", member_name: "Sara Reis", member_deleted: true },
];

describe("useCellReport", () => {
  beforeEach(() => resetFakeSupabase());

  it("lê o relatório na cell_reports_view e todos os participantes na cell_report_participants_view, juntos e em ordem alfabética", async () => {
    respondWith({ data: report }, { data: participants });

    const { result } = renderHook(() => useCellReport("r1"), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({ report, participants });
    const [reportQuery, participantsQuery] = fakeQueries();
    expect(reportQuery.table).toBe("cell_reports_view");
    expect(reportQuery.calls).toEqual([
      ["select", CELL_REPORT_DETAIL_SELECT],
      ["eq", "id", "r1"],
      ["maybeSingle"],
    ]);
    // Nenhuma leitura da tabela members: o nome vem da view (inclusive o do excluído).
    expect(participantsQuery.table).toBe("cell_report_participants_view");
    expect(participantsQuery.calls).toEqual([
      ["select", REPORT_PARTICIPANT_SELECT],
      ["eq", "report_id", "r1"],
      ["order", "member_name"],
      ["order", "member_id"],
      ["range", 0, 999],
    ]);
    expect(fakeQueries().map((q) => q.table)).not.toContain("members");
  });

  it("com mais de 1000 participantes, pede o bloco seguinte (sem o corte do PostgREST)", async () => {
    const block = Array.from({ length: 1000 }, (_, i) => ({ member_id: `m${i}`, member_name: `Membro ${i}`, member_deleted: false }));
    respondWith({ data: report }, { data: block }, { data: [participants[1]] });

    const { result } = renderHook(() => useCellReport("r1"), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.participants).toHaveLength(1001);
    expect(fakeQueries()[2].calls).toContainEqual(["range", 1000, 1999]);
  });

  it("relatório que não veio (excluído no meio tempo ou fora do escopo): null", async () => {
    respondWith({ data: null }, { data: [] });

    const { result } = renderHook(() => useCellReport("sumiu"), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBeNull();
  });

  it("um erro no relatório ou nos participantes vira erro da consulta", async () => {
    respondWith({ data: report }, { error: { code: "XX000", message: "falhou" } });

    const { result } = renderHook(() => useCellReport("r1"), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("desligado (painel fechando), não consulta, mas devolve o que já leu desse relatório", async () => {
    respondWith({ data: report }, { data: participants });
    const { result, rerender } = renderHook(({ enabled }) => useCellReport("r1", { enabled }), {
      wrapper: createQueryWrapper(),
      initialProps: { enabled: true },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ enabled: false });
    expect(result.current.data).toEqual({ report, participants });
    expect(fakeQueries()).toHaveLength(2);
  });

  it("sem relatório escolhido, não consulta nada", () => {
    const { result } = renderHook(() => useCellReport(null), { wrapper: createQueryWrapper() });

    expect(result.current.fetchStatus).toBe("idle");
    expect(fakeQueries()).toHaveLength(0);
  });
});
