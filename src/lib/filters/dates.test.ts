import { describe, expect, it } from "vitest";
import { formatFilterDate, isDateRangeInverted, isIsoDate } from "./dates";

describe("datas dos filtros (E2.07, P54)", () => {
  it("isIsoDate: data de calendário que existe", () => {
    expect(isIsoDate("2026-11-28")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2026-02-31")).toBe(false);
    expect(isIsoDate("28/11/2026")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });

  it("intervalo invertido só com as duas datas e o fim antes do início; o mesmo dia vale", () => {
    expect(isDateRangeInverted("2026-11-25", "2026-11-20")).toBe(true);
    expect(isDateRangeInverted("2026-11-25", "2026-11-25")).toBe(false);
    expect(isDateRangeInverted("2026-11-25", null)).toBe(false);
  });

  it("o chip em dd/mm/aaaa", () => {
    expect(formatFilterDate("2026-11-22")).toBe("22/11/2026");
  });
});
