import { describe, it, expect, vi } from "vitest";
import { MAX_ROWS_PER_REQUEST, RANGE_NOT_SATISFIABLE, fetchAllRows, fetchListPage, withSearch } from "./list-query";

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

  it("página além do fim (416) e contagem sem total: total 0", async () => {
    const result = await fetchListPage(
      Promise.resolve({ data: null, count: null, error: { code: RANGE_NOT_SATISFIABLE, message: "" } }),
      () => Promise.resolve({ count: null, error: null }),
    );
    expect(result).toEqual({ rows: [], total: 0 });
  });
});

describe("fetchAllRows (sem o corte de 1000 linhas do PostgREST)", () => {
  const rowsUpTo = (total: number) => Array.from({ length: total }, (_, i) => ({ id: i }));
  /** Um servidor com `total` linhas, que devolve no máximo 1000 por consulta. */
  const server = (total: number) => {
    const all = rowsUpTo(total);
    return vi.fn((from: number, to: number) => Promise.resolve({ data: all.slice(from, Math.min(to + 1, total)), error: null }));
  };

  it("com menos de 1000 linhas, faz uma consulta só", async () => {
    const fetchBlock = server(3);
    expect(await fetchAllRows(fetchBlock)).toEqual(rowsUpTo(3));
    expect(fetchBlock.mock.calls).toEqual([[0, MAX_ROWS_PER_REQUEST - 1]]);
  });

  it("acima de 1000, pede os blocos seguintes até vir um incompleto", async () => {
    const fetchBlock = server(2500);
    const rows = await fetchAllRows(fetchBlock);
    expect(rows).toHaveLength(2500);
    expect(rows[2499]).toEqual({ id: 2499 });
    expect(fetchBlock.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("com exatamente 1000, confere o bloco seguinte, que vem vazio", async () => {
    const fetchBlock = server(1000);
    expect(await fetchAllRows(fetchBlock)).toHaveLength(1000);
    expect(fetchBlock).toHaveBeenCalledTimes(2);
  });

  it("um erro em qualquer bloco é repassado", async () => {
    const failure = { code: "XX000", message: "falhou" };
    const fetchBlock = vi
      .fn()
      .mockResolvedValueOnce({ data: rowsUpTo(1000), error: null })
      .mockResolvedValueOnce({ data: null, error: failure });
    await expect(fetchAllRows(fetchBlock)).rejects.toBe(failure);
  });
});
