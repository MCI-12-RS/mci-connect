import { afterEach, describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { renderHook } from "@testing-library/react";
import { TABLE_MIN_WIDTH, WIDE_TABLE_MIN_WIDTH, useMinWidth } from "./use-min-width";

// P45 do E2.06: o primeiro render já sai com o layout certo (critério de pronto 7).

const originalWidth = window.innerWidth;
const setWidth = (width: number) => Object.defineProperty(window, "innerWidth", { configurable: true, value: width });

const Probe = ({ minWidth }: { minWidth: number }) => <span>{useMinWidth(minWidth) ? "tabela" : "cartões"}</span>;

describe("useMinWidth", () => {
  afterEach(() => setWidth(originalWidth));

  it("em 1280 px, o primeiro render (sem efeitos) já é a tabela, com as colunas largas", () => {
    setWidth(1280);
    expect(renderToString(<Probe minWidth={TABLE_MIN_WIDTH} />)).toContain("tabela");
    expect(renderToString(<Probe minWidth={WIDE_TABLE_MIN_WIDTH} />)).toContain("tabela");
  });

  it("em 360 px e em 1023 px, o primeiro render já são os cartões", () => {
    setWidth(360);
    expect(renderToString(<Probe minWidth={TABLE_MIN_WIDTH} />)).toContain("cartões");
    setWidth(1023);
    expect(renderToString(<Probe minWidth={TABLE_MIN_WIDTH} />)).toContain("cartões");
  });

  it("em 1024 px, tabela sem as colunas largas", () => {
    setWidth(1024);
    expect(renderHook(() => useMinWidth(TABLE_MIN_WIDTH)).result.current).toBe(true);
    expect(renderHook(() => useMinWidth(WIDE_TABLE_MIN_WIDTH)).result.current).toBe(false);
  });
});
