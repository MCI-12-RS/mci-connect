import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "@/test/query-wrapper";
import { fakeQueries, resetFakeSupabase, respondWith } from "@/test/fake-supabase";
import { CELL_REPORT_DETAIL_SELECT, FORM_PARTICIPANT_SELECT } from "@/lib/cell-reports/fields";
import { useCellReport } from "./use-cell-report";
import { useCellReportParticipants } from "./use-cell-report-participants";

// A consulta "Ver relatório" (E2.12, T10, T12, DT-09): a linha por id e os participantes à parte.

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

const report = { id: "r1", date: "2026-11-19", cell_deleted: false };
const participants = [
  { member_id: "m1", member_name: "Ana Souza", member_deleted: false },
  { member_id: "m9", member_name: "Sara Reis", member_deleted: true },
];

describe("useCellReport", () => {
  beforeEach(() => resetFakeSupabase());

  it("lê só a linha da cell_reports_view por id, sem tocar na tabela", async () => {
    respondWith({ data: report });

    const { result } = renderHook(() => useCellReport("r1"), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(report);
    const [query] = fakeQueries();
    expect(query.table).toBe("cell_reports_view");
    expect(query.calls).toEqual([
      ["select", CELL_REPORT_DETAIL_SELECT],
      ["eq", "id", "r1"],
      ["maybeSingle"],
    ]);
    expect(fakeQueries()).toHaveLength(1);
  });

  it("relatório que não veio (excluído, fora do escopo ou inexistente): null", async () => {
    respondWith({ data: null });

    const { result } = renderHook(() => useCellReport("sumiu"), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBeNull();
  });

  describe("novas tentativas", () => {
    afterEach(() => vi.useRealTimers());
    const offline = { code: "", message: "TypeError: Failed to fetch", details: "", hint: "" };

    it("um erro do servidor aparece na hora, sem nova tentativa", async () => {
      vi.useFakeTimers();
      respondWith({ error: { code: "XX000", message: "falhou" } }, { data: report });

      const { result } = renderHook(() => useCellReport("r1"), { wrapper: createQueryWrapper() });
      await act(() => vi.advanceTimersByTimeAsync(60_000));

      expect(result.current.isError).toBe(true);
      expect(fakeQueries()).toHaveLength(1);
    });

    it("na queda de conexão, tenta de novo uma vez só", async () => {
      vi.useFakeTimers();
      respondWith({ error: offline }, { data: report });

      const { result } = renderHook(() => useCellReport("r1"), { wrapper: createQueryWrapper() });
      await act(() => vi.advanceTimersByTimeAsync(1_100));

      expect(result.current.data).toEqual(report);
    });
  });

  it("desligado (painel fechando), não consulta, mas devolve o que já leu", async () => {
    respondWith({ data: report });
    const { result, rerender } = renderHook(({ enabled }) => useCellReport("r1", { enabled }), {
      wrapper: createQueryWrapper(),
      initialProps: { enabled: true },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ enabled: false });
    expect(result.current.data).toEqual(report);
    expect(fakeQueries()).toHaveLength(1);
  });

  it("sem relatório escolhido, não consulta nada", () => {
    const { result } = renderHook(() => useCellReport(null), { wrapper: createQueryWrapper() });

    expect(result.current.fetchStatus).toBe("idle");
    expect(fakeQueries()).toHaveLength(0);
  });
});

describe("useCellReportParticipants (RN-17)", () => {
  beforeEach(() => resetFakeSupabase());

  it("lê todos os participantes na cell_report_participants_view, na ordem do nome e do id, em blocos de 1000", async () => {
    const block = Array.from({ length: 1000 }, (_, i) => ({ member_id: `m${i}`, member_name: `Membro ${i}`, member_deleted: false }));
    respondWith({ data: block }, { data: [participants[1]] });

    const { result } = renderHook(() => useCellReportParticipants("r1"), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1001);
    const [first, second] = fakeQueries();
    expect(first.table).toBe("cell_report_participants_view");
    expect(first.calls).toEqual([
      ["select", FORM_PARTICIPANT_SELECT],
      ["eq", "report_id", "r1"],
      ["order", "member_name"],
      ["order", "member_id"],
      ["range", 0, 999],
    ]);
    expect(second.calls).toContainEqual(["range", 1000, 1999]);
    expect(fakeQueries().map((q) => q.table)).not.toContain("members");
  });

  it("um erro só nos participantes fica nos participantes", async () => {
    respondWith({ error: { code: "XX000", message: "falhou" } });

    const { result } = renderHook(() => useCellReportParticipants("r1"), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
