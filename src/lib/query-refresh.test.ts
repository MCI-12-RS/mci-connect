import { afterEach, describe, expect, it } from "vitest";
import { QueryClient, QueryObserver, type QueryKey } from "@tanstack/react-query";
import { refreshAfterCellWrite, refreshAfterMemberWrite, refreshAfterReportWrite } from "./query-refresh";

// E2.06, AQ-6, DT-16 e UXD-10; E2.09, AQ-3 e RN-09: depois de gravar, a tela
// fechada carrega do zero (sem o valor de antes) e a aberta recarrega.

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
  ["refreshAfterReportWrite", refreshAfterReportWrite],
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
    expect(client.getQueryState(roles.queryKey)?.isInvalidated).toBe(false);
    // O acesso nunca é descartado; só a gravação de célula o relê (E2.08, AQ-8, DT-14).
    expect(client.getQueryState(access.queryKey)?.isInvalidated).toBe(refresh === refreshAfterCellWrite);
  });
});

describe("refreshAfterReportWrite (E2.09, UX-11)", () => {
  it("a lista de Células e o Dashboard fechados não guardam a situação de antes do relatório", async () => {
    const client = newClient();
    const cells = await seed(client, ["cells", "list", { page: 1, pageSize: 10, search: "" }]);
    const summary = await seed(client, ["dashboard", "summary"]);
    const members = await seed(client, ["members", "list", { page: 1 }]);

    await refreshAfterReportWrite(client);

    expect(client.getQueryData(cells.queryKey)).toBeUndefined();
    expect(client.getQueryData(summary.queryKey)).toBeUndefined();
    expect(client.getQueryData(members.queryKey)).toBeUndefined();
  });

  it("resolve só depois que a lista aberta terminou de recarregar", async () => {
    const client = newClient();
    const list = await seed(client, ["cells", "list", { page: 1 }]);
    observe(client, list.queryKey, list.queryFn);

    const done = refreshAfterReportWrite(client);
    expect(client.getQueryData(list.queryKey)).toBe("valor 1");
    await done;
    expect(client.getQueryData(list.queryKey)).toBe("valor 2");
  });
});
