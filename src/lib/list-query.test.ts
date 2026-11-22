import { describe, it, expect, vi } from "vitest";
import { RANGE_NOT_SATISFIABLE, fetchListPage, withSearch } from "./list-query";

class FakeQuery {
  readonly filters: Array<[string, string]> = [];
  ilike(column: string, pattern: string): FakeQuery {
    this.filters.push([column, pattern]);
    return this;
  }
}

describe("withSearch (RN-04)", () => {
  it("aplica um ilike em search_text por padrão, sem juntar os padrões", () => {
    const query = withSearch(new FakeQuery(), ["%joao%", "%a,b%"]);
    expect(query.filters).toEqual([
      ["search_text", "%joao%"],
      ["search_text", "%a,b%"],
    ]);
  });

  it("sem busca, não aplica filtro", () => {
    expect(withSearch(new FakeQuery(), []).filters).toEqual([]);
  });
});

describe("fetchListPage (RN-01)", () => {
  it("devolve as linhas e o total exato", async () => {
    const countAll = vi.fn();
    const result = await fetchListPage(Promise.resolve({ data: [{ id: "a" }, { id: "b" }], count: 30, error: null }), countAll);
    expect(result).toEqual({ rows: [{ id: "a" }, { id: "b" }], total: 30 });
    expect(countAll).not.toHaveBeenCalled();
  });

  it("resposta sem linhas e sem total vira lista vazia", async () => {
    const result = await fetchListPage(Promise.resolve({ data: null, count: null, error: null }), vi.fn());
    expect(result).toEqual({ rows: [], total: 0 });
  });

  it("página além do fim (416): devolve a página vazia com o total atual", async () => {
    const countAll = vi.fn(() => Promise.resolve({ count: 12, error: null }));
    const result = await fetchListPage(
      Promise.resolve({ data: null, count: null, error: { code: RANGE_NOT_SATISFIABLE, message: "Requested range not satisfiable" } }),
      countAll,
    );
    expect(result).toEqual({ rows: [], total: 12 });
    expect(countAll).toHaveBeenCalledTimes(1);
  });

  it("propaga os demais erros e o erro da contagem", async () => {
    const error = { code: "42501", message: "permission denied" };
    await expect(fetchListPage(Promise.resolve({ data: null, count: null, error }), vi.fn())).rejects.toBe(error);

    const countError = { code: "57014", message: "canceling statement" };
    await expect(
      fetchListPage(
        Promise.resolve({ data: null, count: null, error: { code: RANGE_NOT_SATISFIABLE, message: "" } }),
        () => Promise.resolve({ count: null, error: countError }),
      ),
    ).rejects.toBe(countError);
  });
});
