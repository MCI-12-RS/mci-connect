import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FOCUS_CHECK_INTERVAL_MS,
  isFocusCheckDue,
  requestSessionCheck,
  requestSessionCheckOnDenied,
  setSessionCheckHandler,
  singleFlight,
} from "./session-check";

describe("sinal de verificação da sessão (E2.01, AQ-8)", () => {
  let unregister: (() => void) | null = null;
  afterEach(() => {
    unregister?.();
    unregister = null;
  });

  it("sem verificação registrada, o pedido não faz nada", () => {
    expect(() => requestSessionCheck()).not.toThrow();
  });

  it("o pedido chega à verificação registrada", () => {
    const check = vi.fn();
    unregister = setSessionCheckHandler(check);
    requestSessionCheck();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("só a recusa 42501 pede a verificação", () => {
    const check = vi.fn();
    unregister = setSessionCheckHandler(check);
    requestSessionCheckOnDenied({ code: "42501", message: "permission denied" });
    requestSessionCheckOnDenied({ code: "", message: "TypeError: Failed to fetch" });
    requestSessionCheckOnDenied({ code: "PGRST301", message: "JWT expired" });
    requestSessionCheckOnDenied(new Error("x"));
    requestSessionCheckOnDenied(null);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("desfazer o registro não apaga o de outro provider", () => {
    const first = vi.fn();
    const second = vi.fn();
    const undoFirst = setSessionCheckHandler(first);
    unregister = setSessionCheckHandler(second);
    undoFirst();
    requestSessionCheck();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("depois de desfeito, o pedido não chega mais", () => {
    const check = vi.fn();
    setSessionCheckHandler(check)();
    requestSessionCheck();
    expect(check).not.toHaveBeenCalled();
  });
});

describe("singleFlight", () => {
  it("chamadas ao mesmo tempo geram uma execução só", async () => {
    let release: () => void = () => {};
    const run = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const once = singleFlight(run);
    const calls = [once(), once(), once()];
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await Promise.all(calls);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("terminada a execução, a próxima chamada executa de novo", async () => {
    const run = vi.fn(() => Promise.resolve());
    const once = singleFlight(run);
    await once();
    await once();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("uma falha libera a próxima execução", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("falhou")).mockResolvedValueOnce(undefined);
    const once = singleFlight(run);
    await expect(once()).rejects.toThrow("falhou");
    await expect(once()).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("isFocusCheckDue", () => {
  it("a primeira volta do foco verifica", () => {
    expect(isFocusCheckDue(null, 1_000)).toBe(true);
  });

  it("não verifica de novo antes do intervalo", () => {
    expect(isFocusCheckDue(1_000, 1_000 + FOCUS_CHECK_INTERVAL_MS - 1)).toBe(false);
  });

  it("verifica de novo a partir do intervalo", () => {
    expect(isFocusCheckDue(1_000, 1_000 + FOCUS_CHECK_INTERVAL_MS)).toBe(true);
  });
});

describe("portão da senha (E2.03, AQ-3)", () => {
  it("o código do portão vai para o portão, antes (e no lugar) da releitura do cadastro", async () => {
    const { handleGateError, requestSessionCheckOnDenied, setGateHandler, setSessionCheckHandler } = await import("./session-check");
    const gate = vi.fn();
    const check = vi.fn();
    const undoGate = setGateHandler(gate);
    const undoCheck = setSessionCheckHandler(check);
    const error = { code: "42501", message: "x", details: JSON.stringify({ code: "password_change_required" }), hint: "app_error" };
    requestSessionCheckOnDenied(error);
    expect(gate).toHaveBeenCalledWith("password_change_required");
    expect(check).not.toHaveBeenCalled();
    requestSessionCheckOnDenied({ code: "42501", message: "permission denied" });
    expect(check).toHaveBeenCalledTimes(1);
    expect(handleGateError({ code: "22023" })).toBe(false);
    undoGate();
    undoCheck();
  });
});
