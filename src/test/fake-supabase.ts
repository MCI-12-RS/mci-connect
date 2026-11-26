// Cliente do Supabase falso para os testes de hooks e telas (sem rede). Cada
// `from(tabela)` ou `rpc(função, argumentos)` cria uma consulta que registra as
// chamadas encadeadas (select, insert, update, ilike, order, range, in, eq, neq, single…) e, quando
// aguardada, responde com a próxima resposta da fila (uma fila só, na ordem em
// que as consultas forem criadas). Uma RPC com fila própria (`respondToRpc`)
// usa essa fila antes da geral.
//
// Uso no teste:
//   vi.mock("@/integrations/supabase/client", async () => {
//     const { fakeSupabase } = await import("@/test/fake-supabase");
//     return { supabase: fakeSupabase };
//   });

export interface FakeError {
  code: string;
  message: string;
  /** O `app_error` do banco: `details` em JSON e `hint = 'app_error'`. */
  details?: string;
  hint?: string;
}

export interface FakeResponse {
  data?: unknown;
  count?: number | null;
  error?: FakeError | null;
  /** A resposta só chega quando esta promessa resolver (para ver o estado de carregamento). */
  until?: PromiseLike<unknown>;
}

export interface FakeResult {
  data: unknown;
  count: number | null;
  error: FakeError | null;
}

export type FakeCall = [method: string, ...args: unknown[]];

// O que o PostgREST responde quando `.single()` não encontra exatamente uma linha.
export const NOT_SINGLE_ROW: FakeError = {
  code: "PGRST116",
  message: "JSON object requested, multiple (or no) rows returned",
};

abstract class FakeBuilder implements PromiseLike<FakeResult> {
  readonly calls: FakeCall[] = [];

  protected constructor(private readonly response: FakeResponse) {}

  private record(method: string, args: unknown[]): this {
    this.calls.push([method, ...args]);
    return this;
  }

  select(...args: unknown[]): this {
    return this.record("select", args);
  }
  insert(...args: unknown[]): this {
    return this.record("insert", args);
  }
  update(...args: unknown[]): this {
    return this.record("update", args);
  }
  ilike(...args: unknown[]): this {
    return this.record("ilike", args);
  }
  eq(...args: unknown[]): this {
    return this.record("eq", args);
  }
  neq(...args: unknown[]): this {
    return this.record("neq", args);
  }
  in(...args: unknown[]): this {
    return this.record("in", args);
  }
  gte(...args: unknown[]): this {
    return this.record("gte", args);
  }
  lte(...args: unknown[]): this {
    return this.record("lte", args);
  }
  order(...args: unknown[]): this {
    return this.record("order", args);
  }
  range(...args: unknown[]): this {
    return this.record("range", args);
  }
  limit(...args: unknown[]): this {
    return this.record("limit", args);
  }
  maybeSingle(...args: unknown[]): this {
    return this.record("maybeSingle", args);
  }
  single(...args: unknown[]): this {
    return this.record("single", args);
  }
  /** O sinal de cancelamento (tempo-limite) não muda a resposta falsa. */
  abortSignal(...args: unknown[]): this {
    return this.record("abortSignal", args);
  }

  /** Os métodos chamados, na ordem, sem os argumentos. */
  methods(): string[] {
    return this.calls.map(([method]) => method);
  }

  /**
   * A resposta da fila. Com `.single()` e `data` em lista (as linhas que o
   * servidor encontrou), responde como o PostgREST: uma linha vira o objeto;
   * nenhuma ou mais de uma viram o erro PGRST116.
   */
  private result(): FakeResult {
    const result: FakeResult = {
      data: this.response.data ?? null,
      count: this.response.count ?? null,
      error: this.response.error ?? null,
    };
    if (!this.methods().includes("single") || result.error || !Array.isArray(result.data)) return result;
    return result.data.length === 1
      ? { ...result, data: result.data[0] }
      : { ...result, data: null, error: NOT_SINGLE_ROW };
  }

  then<TResult1 = FakeResult, TResult2 = never>(
    onfulfilled?: ((value: FakeResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const { until } = this.response;
    const result = until ? Promise.resolve(until).then(() => this.result()) : Promise.resolve(this.result());
    return result.then(onfulfilled, onrejected);
  }
}

/** Uma consulta `from(table)`. */
export class FakeQuery extends FakeBuilder {
  constructor(
    readonly table: string,
    response: FakeResponse,
  ) {
    super(response);
  }
}

/** Uma chamada `rpc(fn, args)`; `args` fica `undefined` quando não é passado. */
export class FakeRpc extends FakeBuilder {
  constructor(
    readonly fn: string,
    readonly args: unknown,
    response: FakeResponse,
  ) {
    super(response);
  }
}

const responses: FakeResponse[] = [];
const rpcResponses = new Map<string, FakeResponse[]>();
const queries: FakeQuery[] = [];
const rpcs: FakeRpc[] = [];

export const fakeSupabase = {
  from(table: string): FakeQuery {
    const query = new FakeQuery(table, responses.shift() ?? {});
    queries.push(query);
    return query;
  },
  rpc(fn: string, args?: unknown): FakeRpc {
    const call = new FakeRpc(fn, args, rpcResponses.get(fn)?.shift() ?? responses.shift() ?? {});
    rpcs.push(call);
    return call;
  },
};

/** Respostas das próximas consultas e RPCs, na ordem em que forem criadas. */
export function respondWith(...next: FakeResponse[]): void {
  responses.push(...next);
}

/**
 * Respostas das próximas chamadas de uma RPC, na ordem, independentemente das
 * outras consultas. Útil quando várias RPCs rodam ao mesmo tempo.
 */
export function respondToRpc(fn: string, ...next: FakeResponse[]): void {
  rpcResponses.set(fn, [...(rpcResponses.get(fn) ?? []), ...next]);
}

/** As consultas `from` criadas desde o último reset, na ordem. */
export function fakeQueries(): readonly FakeQuery[] {
  return queries;
}

/** As chamadas `rpc` feitas desde o último reset, na ordem. */
export function fakeRpcs(): readonly FakeRpc[] {
  return rpcs;
}

export function resetFakeSupabase(): void {
  responses.length = 0;
  rpcResponses.clear();
  queries.length = 0;
  rpcs.length = 0;
}
