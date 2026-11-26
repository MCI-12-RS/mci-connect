import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { resetFakeSupabase, respondWith } from "@/test/fake-supabase";
import { useDeleteMember, useMarkMemberInactive } from "./use-member-deletion";
import { useDeleteCell, useMarkCellInactive } from "./use-cell-deletion";
import { useDeleteCellReport } from "./use-cell-report-deletion";
import { useRestoreCell, useRestoreCellReport, useRestoreMember } from "./use-restore";
import { useDialogWrite, type WriteResultHandlers } from "./use-dialog-write";
import type { WriteResult } from "@/lib/deletion/outcome";

// O portão da senha (E2.03, RN-09, RN-16 e AQ-3) nas gravações que devolvem o
// erro classificado em vez de lançar (exclusão, inativação e restauração): o
// 42501 com o código do portão não é "sem permissão".

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const sessionCheck = vi.hoisted(() => vi.fn());
const gate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session-check", () => ({ requestSessionCheck: sessionCheck, requestGate: gate }));

const gateError = (code: string) => ({ code: "42501", message: "x", details: JSON.stringify({ code }), hint: "app_error" });

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  resetFakeSupabase();
  toast.mockReset();
  sessionCheck.mockReset();
  gate.mockReset();
});

describe("hooks de exclusão, inativação e restauração: o portão vem classificado", () => {
  const cases = [
    ["useDeleteMember", useDeleteMember],
    ["useMarkMemberInactive", useMarkMemberInactive],
    ["useDeleteCell", useDeleteCell],
    ["useMarkCellInactive", useMarkCellInactive],
    ["useDeleteCellReport", useDeleteCellReport],
    ["useRestoreMember", useRestoreMember],
    ["useRestoreCell", useRestoreCell],
    ["useRestoreCellReport", useRestoreCellReport],
  ] as const;

  it.each(cases)("%s: password_change_required e session_ended viram { kind: 'gate' }", async (_name, useHook) => {
    const { result } = renderHook(() => useHook(), { wrapper });
    for (const code of ["password_change_required", "session_ended"]) {
      respondWith({ error: gateError(code) });
      let outcome: unknown;
      await act(async () => {
        outcome = await result.current.mutateAsync("id-1");
      });
      expect(outcome).toEqual({ kind: "gate", code });
    }
  });
});

describe("useDialogWrite: o portão fecha o diálogo sem toast", () => {
  const handlers: WriteResultHandlers = {
    doneText: "Excluído.",
    networkText: "Sem conexão.",
    unexpectedText: "Tente de novo.",
    onRefused: vi.fn(),
  };

  const send = async (result: WriteResult) => {
    const onClose = vi.fn();
    const { result: hook } = renderHook(() => useDialogWrite(onClose));
    await act(async () => {
      hook.current.send(() => Promise.resolve(result), handlers);
    });
    return { onClose, error: hook.current.error };
  };

  it("avisa o portão com o código e fecha, sem toast e sem releitura", async () => {
    const { onClose, error } = await send({ kind: "gate", code: "password_change_required" });
    expect(gate).toHaveBeenCalledWith("password_change_required");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
    expect(sessionCheck).not.toHaveBeenCalled();
    expect(error).toBeNull();
  });

  it("a falta de permissão comum continua com o toast e a releitura", async () => {
    const { onClose } = await send({ kind: "forbidden" });
    expect(gate).not.toHaveBeenCalled();
    expect(sessionCheck).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
