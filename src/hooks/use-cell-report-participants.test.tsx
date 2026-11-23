import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "@/test/query-wrapper";
import { fakeQueries, resetFakeSupabase, respondWith } from "@/test/fake-supabase";
import { REPORT_PARTICIPANT_SELECT } from "@/lib/cell-reports/fields";
import { MEMBER_ADDRESS_SELECT } from "@/lib/members/fields";
import { useCellReportParticipants } from "./use-cell-report-participants";
import { useMemberAddress } from "./use-member-address";

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

describe("useCellReportParticipants (RN-06)", () => {
  beforeEach(() => resetFakeSupabase());

  it("Dado um relatório em edição, quando carrega, então lê os participantes com o nome na cell_report_participants_view, em ordem alfabética", async () => {
    const saved = [
      { member_id: "m1", member_name: "Ana" },
      { member_id: "m9", member_name: "Bia (inativa)" },
    ];
    respondWith({ data: saved });

    const { result } = renderHook(() => useCellReportParticipants("r1"), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [query] = fakeQueries();
    expect(query.table).toBe("cell_report_participants_view");
    expect(query.calls).toEqual([
      ["select", REPORT_PARTICIPANT_SELECT],
      ["eq", "report_id", "r1"],
      ["order", "member_name"],
    ]);
    expect(result.current.data).toEqual(saved);
  });

  it("Dado um relatório novo (sem id), quando abre o formulário, então não consulta nada", () => {
    const { result } = renderHook(() => useCellReportParticipants(null), { wrapper: createQueryWrapper() });

    expect(result.current.fetchStatus).toBe("idle");
    expect(fakeQueries()).toHaveLength(0);
  });
});

describe("useMemberAddress (RN-11)", () => {
  beforeEach(() => resetFakeSupabase());

  it("Dado um anfitrião escolhido, quando carrega, então lê o endereço na members_view (mascarada), e não na tabela members", async () => {
    const address = {
      street: null,
      number: null,
      complement: null,
      neighborhood: "Centro",
      city: "Porto Alegre",
      state: "RS",
      zip_code: null,
      sensitive_visible: false,
    };
    respondWith({ data: address });

    const { result } = renderHook(() => useMemberAddress("m7"), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [query] = fakeQueries();
    expect(query.table).toBe("members_view");
    expect(query.calls).toEqual([
      ["select", MEMBER_ADDRESS_SELECT],
      ["eq", "id", "m7"],
      ["maybeSingle"],
    ]);
    expect(result.current.data).toEqual(address);
  });

  it("Dado um membro fora do escopo, quando carrega, então devolve null", async () => {
    respondWith({ data: null });

    const { result } = renderHook(() => useMemberAddress("fora"), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBeNull();
  });

  it("Sem anfitrião, não consulta nada", () => {
    const { result } = renderHook(() => useMemberAddress(null), { wrapper: createQueryWrapper() });

    expect(result.current.fetchStatus).toBe("idle");
    expect(fakeQueries()).toHaveLength(0);
  });
});
