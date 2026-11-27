// E2.04 (RN-15, DA-13, UX-20): o "hoje" de Brasília e a conta dos anos com o
// calendário do Postgres, qualquer que seja o fuso do navegador.
import { describe, expect, it, vi } from "vitest";
import { addOneDay, formatIsoDateBr, isCompleteIsoDate, parseIsoDate, spToday, subtractYears } from "./sao-paulo";

describe("spToday", () => {
  it("23/11/2026 às 23:30 de Brasília ainda é 23/11, embora já seja 24/11 em UTC", () => {
    expect(spToday(new Date("2026-11-24T02:30:00Z"))).toBe("2026-11-23");
  });

  it("00:30 de Brasília já é o dia seguinte", () => {
    expect(spToday(new Date("2026-11-24T03:30:00Z"))).toBe("2026-11-24");
  });

  it("sem argumento, usa o relógio", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T02:59:00Z"));
    expect(spToday()).toBe("2025-12-31");
    vi.useRealTimers();
  });
});

describe("subtractYears (DA-13)", () => {
  it.each([
    ["2026-11-23", 100, "1926-11-23"],
    ["2024-02-29", 100, "1924-02-29"],
    ["2024-02-29", 1, "2023-02-28"],
    ["2100-02-28", 100, "2000-02-28"],
    ["2100-03-01", 100, "2000-03-01"],
  ])("%s menos %i anos = %s", (date, years, expected) => {
    expect(subtractYears(date, years)).toBe(expected);
  });

  it("recusa o que não é data", () => {
    expect(() => subtractYears("2026-02-30", 1)).toThrow(RangeError);
  });
});

describe("addOneDay, parseIsoDate e formatIsoDateBr", () => {
  it.each([
    ["1926-11-23", "1926-11-24"],
    ["2024-02-28", "2024-02-29"],
    ["2023-02-28", "2023-03-01"],
    ["2026-12-31", "2027-01-01"],
  ])("%s → %s", (date, expected) => {
    expect(addOneDay(date)).toBe(expected);
  });

  it("parseIsoDate só aceita datas que existem", () => {
    expect(parseIsoDate("2024-02-29")).toEqual({ year: 2024, month: 2, day: 29 });
    expect(parseIsoDate("2023-02-29")).toBeNull();
    expect(parseIsoDate("2026-13-01")).toBeNull();
    expect(parseIsoDate("10/05/2020")).toBeNull();
    expect(parseIsoDate(null)).toBeNull();
  });

  it("formatIsoDateBr escreve dd/mm/aaaa", () => {
    expect(formatIsoDateBr("2020-05-10")).toBe("10/05/2020");
    expect(formatIsoDateBr("x")).toBe("x");
  });
});

describe("isCompleteIsoDate", () => {
  it("só aceita data que existe com o ano de 4 dígitos", () => {
    expect(isCompleteIsoDate("2026-11-22")).toBe(true);
    expect(isCompleteIsoDate("1000-01-01")).toBe(true);
    expect(isCompleteIsoDate("0202-11-22")).toBe(false);
    expect(isCompleteIsoDate("0002-11-22")).toBe(false);
    expect(isCompleteIsoDate("20261-11-22")).toBe(false);
    expect(isCompleteIsoDate("2026-02-30")).toBe(false);
    expect(isCompleteIsoDate("")).toBe(false);
    expect(isCompleteIsoDate(null)).toBe(false);
  });
});
