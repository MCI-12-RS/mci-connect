import { describe, it, expect } from "vitest";
import { formatWeekRange } from "./week";

describe("formatWeekRange (RN-08)", () => {
  it("Dada uma semana dentro do mês, então mostra dia/mês do domingo e do sábado", () => {
    expect(formatWeekRange("2026-11-22", "2026-11-28")).toBe("22/11 - 28/11");
  });

  it("Dado o dia 1º, então não volta para o dia anterior (sem conversão de fuso)", () => {
    expect(formatWeekRange("2026-11-01", "2026-11-07")).toBe("01/11 - 07/11");
  });

  it("Dada uma semana na virada do mês, então cada ponta mostra o seu mês", () => {
    expect(formatWeekRange("2026-11-29", "2026-12-05")).toBe("29/11 - 05/12");
  });

  it("Dada uma semana na virada do ano, então cada ponta mostra o seu mês", () => {
    expect(formatWeekRange("2026-12-27", "2027-01-02")).toBe("27/12 - 02/01");
  });

  it("Dado um valor fora do formato, então sai como veio", () => {
    expect(formatWeekRange("", "2026-11-28T00:00:00")).toBe(" - 2026-11-28T00:00:00");
  });
});
