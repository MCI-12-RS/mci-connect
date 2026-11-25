import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { SLOW_PENDING_MS, useSlowPending } from "./use-slow-pending";

// E2.06, P44 e UXD-11: "Ainda salvando…" aos 3 s com a gravação pendente, e não antes.

describe("useSlowPending", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("verdadeiro só aos 3 s com a gravação pendente", () => {
    const { result } = renderHook(({ pending }) => useSlowPending(pending), { initialProps: { pending: true } });
    expect(SLOW_PENDING_MS).toBe(3_000);

    act(() => vi.advanceTimersByTime(2_999));
    expect(result.current).toBe(false);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });

  it("volta a falso assim que a resposta chega", () => {
    const { result, rerender } = renderHook(({ pending }) => useSlowPending(pending), { initialProps: { pending: true } });
    act(() => vi.advanceTimersByTime(3_000));
    expect(result.current).toBe(true);

    rerender({ pending: false });
    expect(result.current).toBe(false);
  });

  it("sem gravação pendente, nunca avisa; a resposta antes dos 3 s cancela o aviso", () => {
    const { result, rerender } = renderHook(({ pending }) => useSlowPending(pending), { initialProps: { pending: false } });
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current).toBe(false);

    rerender({ pending: true });
    act(() => vi.advanceTimersByTime(2_000));
    rerender({ pending: false });
    act(() => vi.advanceTimersByTime(5_000));
    expect(result.current).toBe(false);

    // Uma nova gravação conta os 3 s do zero.
    rerender({ pending: true });
    act(() => vi.advanceTimersByTime(2_999));
    expect(result.current).toBe(false);
  });
});
