// Cliente do Supabase falso para os testes de hooks (sem rede). Cada
// `from(tabela)` cria uma consulta que registra as chamadas encadeadas
// (select, ilike, order, range, in, eq…) e, quando aguardada, responde com a
// próxima resposta da fila.
//
// Uso no teste:
//   vi.mock("@/integrations/supabase/client", async () => {
//     const { fakeSupabase } = await import("@/test/fake-supabase");
//     return { supabase: fakeSupabase };
//   });

export interface FakeError {
  code: string;
  message: string;
}

export interface FakeResponse {
  data?: unknown;
  count?: number | null;
  error?: FakeError | null;
}

export interface FakeResult {
  data: unknown;
  count: number | null;
  error: FakeError | null;
}

export type FakeCall = [method: string, ...args: unknown[]];

export class FakeQuery implements PromiseLike<FakeResult> {
  readonly calls: FakeCall[] = [];

  constructor(
    readonly table: string,
    private readonly response: FakeResponse,
  ) {}

  private record(method: string, args: unknown[]): this {
    this.calls.push([method, ...args]);
    return this;
  }

  select(...args: unknown[]): this {
    return this.record("select", args);
  }
  ilike(...args: unknown[]): this {
    return this.record("ilike", args);
  }
  eq(...args: unknown[]): this {
    return this.record("eq", args);
  }
  in(...args: unknown[]): this {
    return this.record("in", args);
  }
  order(...args: unknown[]): this {
    return this.record("order", args);
  }
  range(...args: unknown[]): this {
    return this.record("range", args);
  }
  maybeSingle(...args: unknown[]): this {
    return this.record("maybeSingle", args);
  }

  /** Os métodos chamados, na ordem, sem os argumentos. */
  methods(): string[] {
    return this.calls.map(([method]) => method);
  }

  then<TResult1 = FakeResult, TResult2 = never>(
    onfulfilled?: ((value: FakeResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const result: FakeResult = {
      data: this.response.data ?? null,
      count: this.response.count ?? null,
      error: this.response.error ?? null,
    };
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

const responses: FakeResponse[] = [];
const queries: FakeQuery[] = [];

export const fakeSupabase = {
  from(table: string): FakeQuery {
    const query = new FakeQuery(table, responses.shift() ?? {});
    queries.push(query);
    return query;
  },
};

/** Respostas das próximas consultas, na ordem em que forem criadas. */
export function respondWith(...next: FakeResponse[]): void {
  responses.push(...next);
}

/** As consultas criadas desde o último reset, na ordem. */
export function fakeQueries(): readonly FakeQuery[] {
  return queries;
}

export function resetFakeSupabase(): void {
  responses.length = 0;
  queries.length = 0;
}
