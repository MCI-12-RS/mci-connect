import { describe, it, expect } from "vitest";
import { anyTrend, trendOf, TREND_SPOKEN } from "./report-comparison";

// Comparação com o relatório anterior de célula realizada (E2.10, RN-17, P82).

describe("trendOf", () => {
  it("traduz o sinal do servidor", () => {
    expect(trendOf(1)).toBe("up");
    expect(trendOf(-1)).toBe("down");
    expect(trendOf(0)).toBe("same");
  });
  it("sem comparação: nulo (só o número)", () => {
    expect(trendOf(null)).toBeNull();
    expect(trendOf(undefined)).toBeNull();
    expect(trendOf(Number.NaN)).toBeNull();
  });
});

describe("TREND_SPOKEN (leitor de tela)", () => {
  it("os textos do Negócio, depois do número", () => {
    expect(`8${TREND_SPOKEN.up}`).toBe("8, mais que no relatório anterior");
    expect(`0${TREND_SPOKEN.down}`).toBe("0, menos que no relatório anterior");
    expect(`3${TREND_SPOKEN.same}`).toBe("3, igual ao relatório anterior");
  });
});

describe("anyTrend (a frase das setas)", () => {
  it("só quando algum relatório mostra seta", () => {
    expect(anyTrend([{ participants_trend: null, visitors_trend: null }])).toBe(false);
    expect(anyTrend([{ participants_trend: null, visitors_trend: 0 }])).toBe(true);
    expect(anyTrend([])).toBe(false);
  });
});
