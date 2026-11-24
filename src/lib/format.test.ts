import { afterEach, describe, it, expect, vi } from "vitest";
import { formatCount, formatCurrency, formatDateTimeInBrasilia, formatList } from "./format";

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

describe("formatCurrency (E2.01, T7)", () => {
  // O Intl separa o "R$" do valor com um espaço inseparável.
  const brl = (text: string) => text.replace(" ", "\u00a0");

  it("em reais, com vírgula nos centavos e ponto nos milhares", () => {
    expect(formatCurrency(50)).toBe(brl("R$ 50,00"));
    expect(formatCurrency(0)).toBe(brl("R$ 0,00"));
    expect(formatCurrency(12.5)).toBe(brl("R$ 12,50"));
    expect(formatCurrency(1234.56)).toBe(brl("R$ 1.234,56"));
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
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
    vi.resetModules();
  });

  it("converte o instante do banco para o horário de Brasília (UX-15)", () => {
    expect(formatDateTimeInBrasilia("2026-11-10T17:32:00.123456+00:00")).toEqual({ date: "10/11/2026", time: "14:32" });
  });

  it("muda de dia quando, em Brasília, ainda é a véspera", () => {
    expect(formatDateTimeInBrasilia("2026-11-11T02:30:00+00:00")).toEqual({ date: "10/11/2026", time: "23:30" });
    expect(formatDateTimeInBrasilia("2026-11-11T03:00:00Z")).toEqual({ date: "11/11/2026", time: "00:00" });
  });

  // O formatador é criado na carga do módulo: o fuso muda antes de carregá-lo de novo.
  // 11/11/2026 02:30 UTC: 23:30 de 10/11 em Brasília, 11:30 de 11/11 em Tóquio e 18:30 de 10/11 em Los Angeles.
  it.each([
    ["Asia/Tokyo", [11, 11]],
    ["America/Los_Angeles", [10, 18]],
  ])("não depende do fuso do navegador (%s)", async (tz, [localDay, localHour]) => {
    process.env.TZ = tz;
    vi.resetModules();
    const { formatDateTimeInBrasilia: format } = await import("./format");
    // Sanidade: o relógio local está mesmo em outro fuso.
    const local = new Date("2026-11-11T02:30:00Z");
    expect([local.getDate(), local.getHours()]).toEqual([localDay, localHour]);
    expect(format("2026-11-11T02:30:00Z")).toEqual({ date: "10/11/2026", time: "23:30" });
  });

  it("valor vazio ou que não é data volta nulo", () => {
    expect(formatDateTimeInBrasilia(null)).toBeNull();
    expect(formatDateTimeInBrasilia("")).toBeNull();
    expect(formatDateTimeInBrasilia("ontem")).toBeNull();
  });
});
