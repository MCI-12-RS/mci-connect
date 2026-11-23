import { describe, it, expect } from "vitest";
import { OPTIONS_PAGE_SIZE, flattenOptionPages, optionsPageRange, toOptionsPage } from "./selectors";

const rows = (count: number, start = 0) => Array.from({ length: count }, (_, i) => ({ id: `m${start + i}` }));
const toOption = (row: { id: string }) => ({ value: row.id, label: row.id.toUpperCase() });

describe("optionsPageRange (RN-07)", () => {
  it("pede 21 linhas a partir do offset: 20 exibidas e uma que indica se há mais", () => {
    expect(OPTIONS_PAGE_SIZE).toBe(20);
    expect(optionsPageRange(0)).toEqual([0, 20]);
    expect(optionsPageRange(20)).toEqual([20, 40]);
    expect(optionsPageRange(40)).toEqual([40, 60]);
  });
});

describe("toOptionsPage (RN-07)", () => {
  it("com 21 linhas, exibe 20 e aponta a próxima página", () => {
    const page = toOptionsPage(rows(21), 0);
    expect(page.items).toEqual(rows(20));
    expect(page.nextOffset).toBe(20);
  });

  it("a próxima página começa onde a anterior parou", () => {
    expect(toOptionsPage(rows(21, 20), 20)).toEqual({ items: rows(20, 20), nextOffset: 40 });
  });

  it("com exatamente 20 linhas, não há próxima página", () => {
    expect(toOptionsPage(rows(20), 0)).toEqual({ items: rows(20), nextOffset: null });
  });

  it("com menos de 20 linhas, exibe todas e acabou", () => {
    expect(toOptionsPage(rows(5, 40), 40)).toEqual({ items: rows(5, 40), nextOffset: null });
  });

  it("sem linhas, página vazia e acabou", () => {
    expect(toOptionsPage([], 0)).toEqual({ items: [], nextOffset: null });
  });
});

describe("flattenOptionPages (RN-07)", () => {
  it("junta as páginas na ordem, sem repetir nenhuma opção (45 resultados: 20 + 20 + 5)", () => {
    const pages = [toOptionsPage(rows(21), 0), toOptionsPage(rows(21, 20), 20), toOptionsPage(rows(5, 40), 40)];

    const options = flattenOptionPages(pages, toOption);

    expect(options).toHaveLength(45);
    expect(new Set(options.map((o) => o.value)).size).toBe(45);
    expect(options[0]).toEqual({ value: "m0", label: "M0" });
    expect(options[44]).toEqual({ value: "m44", label: "M44" });
  });

  it("uma linha repetida entre páginas (cadastro no meio da navegação) aparece uma vez só", () => {
    const pages = [
      { items: [{ id: "a" }, { id: "b" }], nextOffset: 2 },
      { items: [{ id: "b" }, { id: "c" }], nextOffset: null },
    ];
    expect(flattenOptionPages(pages, toOption).map((o) => o.value)).toEqual(["a", "b", "c"]);
  });

  it("nada carregado ainda", () => {
    expect(flattenOptionPages(undefined, toOption)).toEqual([]);
  });
});
