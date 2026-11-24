import { afterEach, describe, it, expect } from "vitest";
import { formatCount, formatDateTimeInBrasilia, formatList } from "./format";

describe("formatCount", () => {
  it("abaixo de mil, sai sem separador", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(7)).toBe("7");
    expect(formatCount(999)).toBe("999");
  });

  it("a partir de mil, separa os milhares com ponto (inclusive com 4 dígitos)", () => {
    expect(formatCount(1000)).toBe("1.000");
    expect(formatCount(1530)).toBe("1.530");
    expect(formatCount(1234567)).toBe("1.234.567");
  });
});

describe("formatList", () => {
  it("um item sai como veio; nenhum, vazio", () => {
    expect(formatList(["Ana"])).toBe("Ana");
    expect(formatList([])).toBe("");
  });

  it("dois itens com 'e'; três ou mais com vírgulas e 'e' no último", () => {
    expect(formatList(["Ana", "Bruno"])).toBe("Ana e Bruno");
    expect(formatList(["Ana", "Bruno", "Sara"])).toBe("Ana, Bruno e Sara");
  });
});

describe("formatDateTimeInBrasilia", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("converte o instante do banco para o horário de Brasília (UX-15)", () => {
    expect(formatDateTimeInBrasilia("2026-11-10T17:32:00.123456+00:00")).toEqual({ date: "10/11/2026", time: "14:32" });
  });

  it("muda de dia quando, em Brasília, ainda é a véspera", () => {
    expect(formatDateTimeInBrasilia("2026-11-11T02:30:00+00:00")).toEqual({ date: "10/11/2026", time: "23:30" });
    expect(formatDateTimeInBrasilia("2026-11-11T03:00:00Z")).toEqual({ date: "11/11/2026", time: "00:00" });
  });

  it("não depende do fuso do navegador", () => {
    process.env.TZ = "Asia/Tokyo";
    expect(formatDateTimeInBrasilia("2026-11-10T17:32:00Z")).toEqual({ date: "10/11/2026", time: "14:32" });
    process.env.TZ = "America/Los_Angeles";
    expect(formatDateTimeInBrasilia("2026-11-10T17:32:00Z")).toEqual({ date: "10/11/2026", time: "14:32" });
  });

  it("valor vazio ou que não é data volta nulo", () => {
    expect(formatDateTimeInBrasilia(null)).toBeNull();
    expect(formatDateTimeInBrasilia("")).toBeNull();
    expect(formatDateTimeInBrasilia("ontem")).toBeNull();
  });
});
