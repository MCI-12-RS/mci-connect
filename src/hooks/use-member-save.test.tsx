import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeQueries, resetFakeSupabase, respondWith } from "@/test/fake-supabase";
import { CREATE_MEMBER_TIMEOUT_MS, useMemberSave, type MemberSaveRequest } from "./use-member-save";

// A gravação do formulário de membro (E2.04, T5 e T7; DT-11, DT-19, DT-25).

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: { ...fakeSupabase, functions: { invoke } } };
});

const sessionCheck = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session-check", () => ({ requestSessionCheck: sessionCheck }));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useMemberSave(), { wrapper });
  const save = (request: MemberSaveRequest) => act(() => result.current.save(request));
  return { save, invalidate };
}

const update = (patch: Record<string, string | null>): MemberSaveRequest => ({ kind: "update", memberId: "m1", patch });
const create = (): MemberSaveRequest => ({
  kind: "create",
  attemptId: "11111111-1111-4111-8111-111111111111",
  password: "123456",
  memberData: { name: "Ana Souza", gender: "F", email: null },
  confirmDeletedMatches: false,
});

/** A `create-user-admin` respondeu com erro: o supabase-js entrega um `FunctionsHttpError` com a `Response`. */
function functionError(status: number, body: unknown) {
  const error = new Error("Edge Function returned a non-2xx status code");
  Object.assign(error, { name: "FunctionsHttpError", context: new Response(JSON.stringify(body), { status }) });
  invoke.mockResolvedValueOnce({ data: null, error });
}

const appError = (message: string, detail: Record<string, unknown>) => ({
  code: "22023",
  message,
  hint: "app_error",
  details: JSON.stringify(detail),
});

beforeEach(() => {
  resetFakeSupabase();
  invoke.mockReset();
  sessionCheck.mockReset();
});

describe("useMemberSave: edição (DT-19)", () => {
  it("sem mudança, nada é enviado (DA-9)", async () => {
    const { save } = setup();
    expect(await save(update({}))).toEqual({ kind: "unchanged" });
    expect(fakeQueries()).toHaveLength(0);
  });

  it("PATCH só com o que mudou, pedindo só o id de volta; sucesso recarrega Membros e as funções", async () => {
    const { save, invalidate } = setup();
    respondWith({ data: [{ id: "m1" }] });

    expect(await save(update({ notes: "Nova" }))).toEqual({ kind: "saved" });

    const [query] = fakeQueries();
    expect(query.table).toBe("members");
    expect(query.calls).toEqual([
      ["update", { notes: "Nova" }],
      ["eq", "id", "m1"],
      ["select", "id"],
    ]);
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([["members"], ["role-options"]]);
  });

  it("0 linhas: o cadastro sumiu; a lista recarrega e a sessão é conferida (E2.01)", async () => {
    const { save, invalidate } = setup();
    respondWith({ data: [] });

    expect(await save(update({ notes: "x" }))).toEqual({ kind: "gone" });
    expect(sessionCheck).toHaveBeenCalled();
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([["members", "list"]]);
  });

  it("recusa de regra com campos: value_in_use com cada campo e a sua mensagem (RN-10)", async () => {
    const { save } = setup();
    respondWith({ error: appError("Este e-mail já está sendo usado por outro cadastro.", { code: "value_in_use", fields: ["email", "cpf"] }) });

    const result = await save(update({ email: "caio@exemplo.com", cpf: "52998224725" }));
    expect(result).toEqual({
      kind: "refused",
      refusal: {
        message: "Este e-mail já está sendo usado por outro cadastro.",
        fields: {
          email: "Este e-mail já está sendo usado por outro cadastro.",
          cpf: "Este CPF já está sendo usado por outro cadastro.",
        },
        rereadAccess: false,
      },
    });
  });

  it("40P01 (DT-25): falha técnica, com nova tentativa, sem texto técnico", async () => {
    const { save } = setup();
    respondWith({ error: { code: "40P01", message: "deadlock detected" } });
    expect(await save(update({ leader_id: "pedro" }))).toEqual({ kind: "failed", network: false });
  });

  it("queda de conexão: falha de rede", async () => {
    const { save } = setup();
    respondWith({ error: { code: "", message: "TypeError: Failed to fetch" } });
    expect(await save(update({ notes: "x" }))).toEqual({ kind: "failed", network: true });
  });

  it("42501: a recusa de permissão, no topo, que relê o acesso", async () => {
    const { save, invalidate } = setup();
    respondWith({ error: { code: "42501", message: "permission denied for table members" } });

    const result = await save(update({ notes: "x" }));
    expect(result).toEqual({
      kind: "refused",
      refusal: { message: "Você não tem permissão para esta ação.", fields: {}, rereadAccess: true },
    });
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toContainEqual(["access"]);
  });
});

describe("useMemberSave: cadastro novo pela create-user-admin (DT-11)", () => {
  it("envia o attemptId, a senha, os dados e a confirmação; a repetição (replayed) também é sucesso", async () => {
    const { save } = setup();
    invoke.mockResolvedValueOnce({ data: { member: { id: "novo" }, replayed: true }, error: null });

    expect(await save(create())).toEqual({ kind: "saved" });
    expect(invoke).toHaveBeenCalledWith("create-user-admin", {
      body: {
        attemptId: "11111111-1111-4111-8111-111111111111",
        password: "123456",
        memberData: { name: "Ana Souza", gender: "F", email: null },
        confirmDeletedMatches: false,
      },
    });
  });

  it("deleted_matches: as correspondências, para o aviso do E2.01", async () => {
    const { save } = setup();
    functionError(409, { error: "Há cadastros excluídos.", code: "deleted_matches", matches: [] });
    expect(await save(create())).toEqual({ kind: "deletedMatches", matches: [], accountEmail: false });
  });

  it("value_in_use da função: cada campo com a sua mensagem, mobile no Celular", async () => {
    const { save } = setup();
    functionError(409, { error: "Este celular já está sendo usado por outro cadastro.", code: "value_in_use", fields: ["mobile"] });
    const result = await save(create());
    expect(result).toMatchObject({
      kind: "refused",
      refusal: { fields: { mobile_whatsapp: "Este celular já está sendo usado por outro cadastro." } },
    });
  });

  it("forbidden: a recusa de permissão, que relê o acesso", async () => {
    const { save } = setup();
    functionError(403, { error: "Você não tem permissão para cadastrar membros.", code: "forbidden" });
    expect(await save(create())).toMatchObject({ kind: "refused", refusal: { rereadAccess: true, fields: {} } });
  });

  it("server_error e queda de conexão: falha, com o aviso de conexão só na queda", async () => {
    const { save } = setup();
    functionError(500, { error: "Erro interno.", code: "server_error" });
    expect(await save(create())).toEqual({ kind: "failed", network: false });

    const offline = new Error("Failed to send a request to the Edge Function");
    offline.name = "FunctionsFetchError";
    invoke.mockResolvedValueOnce({ data: null, error: offline });
    expect(await save(create())).toEqual({ kind: "failed", network: true });
  });
});

describe("useMemberSave: tempo-limite do cadastro (T7)", () => {
  afterEach(() => vi.useRealTimers());

  it("sem resposta em 20 s: queda de conexão, e a gravação é liberada para a nova tentativa", async () => {
    vi.useFakeTimers();
    const { save } = setup();
    invoke.mockReturnValueOnce(new Promise(() => {}));

    let outcome: unknown;
    await act(async () => {
      const pending = save(create());
      await vi.advanceTimersByTimeAsync(CREATE_MEMBER_TIMEOUT_MS - 1);
      expect(outcome).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      outcome = await pending;
    });
    expect(CREATE_MEMBER_TIMEOUT_MS).toBe(20_000);
    expect(outcome).toEqual({ kind: "failed", network: true });

    invoke.mockResolvedValueOnce({ data: { member: { id: "novo" }, replayed: true }, error: null });
    await act(async () => {
      outcome = await save(create());
    });
    expect(outcome).toEqual({ kind: "saved" });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("a resposta antes do limite vale", async () => {
    vi.useFakeTimers();
    const { save } = setup();
    invoke.mockResolvedValueOnce({ data: { member: { id: "novo" } }, error: null });
    let outcome: unknown;
    await act(async () => {
      outcome = await save(create());
    });
    expect(outcome).toEqual({ kind: "saved" });
  });
});

describe("useMemberSave: uma gravação por vez (UX-25)", () => {
  it("um segundo envio durante o primeiro não chama o servidor de novo", async () => {
    const { save } = setup();
    let finish: (value: unknown) => void = () => {};
    invoke.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));

    let first: Promise<unknown> = Promise.resolve();
    let second: unknown;
    await act(async () => {
      first = save(create());
      second = await save(create());
      finish({ data: { member: { id: "novo" } }, error: null });
      await first;
    });

    expect(second).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
