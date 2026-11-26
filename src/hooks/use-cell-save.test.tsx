import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeQueries, resetFakeSupabase, respondWith } from "@/test/fake-supabase";
import { CELL_STORED_SELECT } from "@/lib/cells/fields";
import { useCellSave, type CreateCellRequest } from "./use-cell-save";

// O cadastro de célula repetido depois de uma queda (E2.08, DT-09).

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

vi.mock("@/lib/auth/session-check", () => ({ requestSessionCheck: vi.fn(), requestSessionCheckOnDenied: vi.fn() }));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useCellSave(), { wrapper });
  return (request: CreateCellRequest) => act(() => result.current.save(request));
}

const ID = "22222222-2222-4222-8222-222222222222";

const insert: CreateCellRequest["insert"] = {
  id: ID,
  leader_id: "l1",
  timothy_id: "t1",
  host_id: "h1",
  type: "Evangelística",
  meeting_day: "Quarta",
  meeting_time: "20:00",
  zip_code: "90010000",
  street: "Rua A",
  number: "10",
  complement: null,
  neighborhood: "Centro",
  city: "Porto Alegre",
  state: "RS",
};

/** A linha gravada como a `cells_view` devolve: horário com segundos. */
const stored = {
  id: ID,
  leader_id: "l1",
  timothy_id: "t1",
  host_id: "h1",
  type: "Evangelística",
  meeting_day: "Quarta",
  meeting_time: "20:00:00",
  zip_code: "90010000",
  street: "Rua A",
  number: "10",
  complement: null,
  neighborhood: "Centro",
  city: "Porto Alegre",
  state: "RS",
  is_active: true,
};

const network = { code: "", message: "TypeError: Failed to fetch" };
const pkey = { code: "23505", message: 'duplicate key value violates unique constraint "cells_pkey"' };

beforeEach(() => resetFakeSupabase());

describe("useCellSave: nova tentativa de cadastro (DT-09)", () => {
  it("a célula achada na conferência é a mesma do envio: criada, sem gravar de novo", async () => {
    const save = setup();
    respondWith({ error: network });
    expect(await save({ kind: "create", insert })).toEqual({ kind: "failed", failure: { kind: "connection" } });

    respondWith({ data: stored });
    expect(await save({ kind: "create", insert })).toEqual({ kind: "saved", outcome: "created" });

    const queries = fakeQueries();
    expect(queries).toHaveLength(2);
    expect(queries[1].table).toBe("cells_view");
    expect(queries[1].calls[0]).toEqual(["select", CELL_STORED_SELECT]);
  });

  it("a pessoa corrigiu o formulário depois da tentativa sem resposta: as correções vão num PATCH só do que mudou", async () => {
    const save = setup();
    respondWith({ error: network });
    await save({ kind: "create", insert });

    respondWith({ data: stored }, { data: [{ id: ID }] });
    const corrected = { ...insert, meeting_time: "19:30", street: "Rua B" };
    expect(await save({ kind: "create", insert: corrected })).toEqual({ kind: "saved", outcome: "created" });

    const patch = fakeQueries()[2];
    expect(patch.table).toBe("cells");
    expect(patch.calls.slice(0, 3)).toEqual([
      ["update", { meeting_time: "19:30", street: "Rua B" }],
      ["eq", "id", ID],
      ["select", "id"],
    ]);
  });

  it("o PATCH das correções volta sem linha: a célula saiu do alcance (gone)", async () => {
    const save = setup();
    respondWith({ error: network });
    await save({ kind: "create", insert });

    respondWith({ data: stored }, { data: [] });
    expect(await save({ kind: "create", insert: { ...insert, number: "12" } })).toEqual({ kind: "gone" });
  });

  it("23505 em cells_pkey: confere a célula; igual, criada", async () => {
    const save = setup();
    respondWith({ error: pkey }, { data: stored });
    expect(await save({ kind: "create", insert })).toEqual({ kind: "saved", outcome: "created" });
    expect(fakeQueries().map((q) => q.table)).toEqual(["cells", "cells_view"]);
  });

  it("23505 em cells_pkey com a célula diferente: PATCH das correções", async () => {
    const save = setup();
    respondWith({ error: pkey }, { data: stored }, { data: [{ id: ID }] });
    expect(await save({ kind: "create", insert: { ...insert, host_id: "h2" } })).toEqual({
      kind: "saved",
      outcome: "created",
    });
    const [, , patch] = fakeQueries();
    expect(patch.calls[0]).toEqual(["update", { host_id: "h2" }]);
  });

  it("23505 em cells_pkey sem a célula visível: criada, como manda a DT-09", async () => {
    const save = setup();
    respondWith({ error: pkey }, { data: null });
    expect(await save({ kind: "create", insert })).toEqual({ kind: "saved", outcome: "created" });
  });

  it("23505 em cells_pkey e a conferência cai: queda de conexão, e a tentativa segue incerta", async () => {
    const save = setup();
    respondWith({ error: pkey }, { error: network });
    expect(await save({ kind: "create", insert })).toEqual({ kind: "failed", failure: { kind: "connection" } });

    respondWith({ data: stored });
    expect(await save({ kind: "create", insert })).toEqual({ kind: "saved", outcome: "created" });
    expect(fakeQueries()[2].table).toBe("cells_view");
  });
});
