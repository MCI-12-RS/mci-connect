import { afterEach, describe, expect, it } from "vitest";
import { QueryClient, QueryObserver, type QueryKey } from "@tanstack/react-query";
import { refreshAfterCellWrite, refreshAfterMemberWrite } from "./query-refresh";

// E2.06, AQ-6, DT-16 e UXD-10: depois de gravar, a tela fechada carrega do
// zero (sem o valor de antes) e a aberta recarrega.

const clients: QueryClient[] = [];
const unsubscribes: Array<() => void> = [];

function newClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  clients.push(client);
  return client;
}

/** Uma consulta com resposta já guardada, que conta as buscas. */
async function seed(client: QueryClient, queryKey: QueryKey) {
  const calls = { count: 0 };
  const queryFn = () => {
    calls.count += 1;
    return Promise.resolve(`valor ${calls.count}`);
  };
  await client.fetchQuery({ queryKey, queryFn });
  return { queryKey, queryFn, calls };
}

/** Deixa a consulta ativa, como a lista que está na tela. */
function observe(client: QueryClient, queryKey: QueryKey, queryFn: () => Promise<string>) {
  const observer = new QueryObserver(client, { queryKey, queryFn });
  unsubscribes.push(observer.subscribe(() => undefined));
}

afterEach(() => {
  unsubscribes.splice(0).forEach((unsubscribe) => unsubscribe());
  clients.splice(0).forEach((client) => client.clear());
});

describe.each([
  ["refreshAfterMemberWrite", refreshAfterMemberWrite],
  ["refreshAfterCellWrite", refreshAfterCellWrite],
])("%s", (_name, refresh) => {
  it("descarta as consultas inativas de Membros, Ministérios, Células, Relatórios e Dashboard", async () => {
    const client = newClient();
    const keys: QueryKey[] = [
      ["members", "list", { page: 1 }],
      ["members", "ministry-tree", "roots"],
      ["members", "options", { search: "" }],
      ["cells", "list", { page: 1 }],
      ["cell_reports", "list", { page: 1 }],
      ["dashboard", "g12-ranking"],
    ];
    for (const key of keys) await seed(client, key);

    await refresh(client);

    for (const key of keys) expect(client.getQueryData(key)).toBeUndefined();
  });

  it("recarrega a consulta ativa, sem descartar o que ela mostra", async () => {
    const client = newClient();
    const list = await seed(client, ["cells", "list", { page: 1 }]);
    observe(client, list.queryKey, list.queryFn);

    await refresh(client);

    expect(list.calls.count).toBe(2);
    expect(client.getQueryData(list.queryKey)).toBe("valor 2");
  });

  it("não mexe nas consultas de fora (acesso, funções, Auditoria)", async () => {
    const client = newClient();
    const access = await seed(client, ["access", "u1"]);
    const roles = await seed(client, ["role-options", "new"]);
    const events = await seed(client, ["events", "all"]);

    await refresh(client);

    expect(client.getQueryData(access.queryKey)).toBe("valor 1");
    expect(client.getQueryData(roles.queryKey)).toBe("valor 1");
    expect(client.getQueryData(events.queryKey)).toBe("valor 1");
    expect(client.getQueryState(access.queryKey)?.isInvalidated).toBe(false);
  });
});
