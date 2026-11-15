import { describe, it, expect } from "vitest";
import { DEFAULT_PAGE_SIZE, lastPage, parsePage, parsePageSize, toRange } from "./pagination";

describe("pagination (RN-01)", () => {
  it("aceita só os tamanhos 10, 25, 50 e 100; o resto vira 25", () => {
    expect(parsePageSize("10")).toBe(10);
    expect(parsePageSize("100")).toBe(100);
    expect(parsePageSize("30")).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageSize("1000")).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageSize(null)).toBe(25);
    expect(parsePageSize("abc")).toBe(25);
  });

  it("página inválida vira 1", () => {
    expect(parsePage("3")).toBe(3);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-2")).toBe(1);
    expect(parsePage("1.5")).toBe(1);
    expect(parsePage(null)).toBe(1);
  });

  it("converte página em intervalo inclusivo", () => {
    expect(toRange(1, 25)).toEqual([0, 24]);
    expect(toRange(62, 25)).toEqual([1525, 1549]);
    expect(toRange(0, 10)).toEqual([0, 9]);
  });

  it("calcula a última página (1.530 itens: 62 páginas de 25, 16 de 100)", () => {
    expect(lastPage(1530, 25)).toBe(62);
    expect(lastPage(1530, 100)).toBe(16);
    expect(lastPage(0, 25)).toBe(1);
    expect(lastPage(25, 25)).toBe(1);
    expect(lastPage(26, 25)).toBe(2);
  });
});
