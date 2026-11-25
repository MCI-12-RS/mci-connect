import { test, expect, type Page, type Request, type Response } from "@playwright/test";

// Árvore de ministérios e seletores paginados (E1.08, PR 4: RN-05, RN-07 e RN-10).
//
// Faz login de verdade, então precisa de um banco com usuários de teste e do
// front apontando para ele (VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY
// no ambiente do `npm run dev`). As credenciais vêm só do ambiente; sem elas,
// os testes são pulados:
//   E2E_MINISTRIES_EMAIL / E2E_MINISTRIES_PASSWORD: usuário que vê ao menos um
//   pastor com discípulos (view_members ou view_all_church);
//   E2E_SELECTORS_EMAIL / E2E_SELECTORS_PASSWORD: usuário que edita o bloco
//   ministerial do próprio cadastro (edit_member ou função de sistema) e vê
//   mais de 40 membros.
// Nada é salvo: os seletores são só abertos, paginados e pesquisados.

const TREE_RPC = "/rest/v1/rpc/ministry_tree_nodes";
const MEMBERS_TABLE = "/rest/v1/members";
const MEMBERS_VIEW = "/rest/v1/members_view";

interface TreeNode {
  member_id: string;
  member_name: string;
  spouse_id: string | null;
  spouse_name: string | null;
  direct_disciples: number;
}

interface MemberOption {
  id: string;
  name: string;
}

/** Credenciais do ambiente; sem elas, o teste é pulado. */
function credentials(emailVar: string, passwordVar: string) {
  const email = process.env[emailVar];
  const password = process.env[passwordVar];
  test.skip(!email || !password, `Defina ${emailVar} e ${passwordVar} para rodar este teste.`);
  return { email: email ?? "", password: password ?? "" };
}

async function login(page: Page, { email, password }: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Identificação").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/$/);
}

/** Todas as requisições ao /rest/v1/ feitas pela página, na ordem. */
function recordRestRequests(page: Page): Request[] {
  const requests: Request[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/rest/v1/")) requests.push(request);
  });
  return requests;
}

const pathOf = (request: Request) => new URL(request.url()).pathname;
const isTreeRpc = (response: Response) => new URL(response.url()).pathname === TREE_RPC;

/** Uma consulta de opções de membro do seletor (members_view, só id e nome), na página `offset`. */
function isMemberOptions(offset: number) {
  return (response: Response) => {
    const url = new URL(response.url());
    return (
      url.pathname === MEMBERS_VIEW &&
      url.searchParams.get("select") === "id,name" &&
      url.searchParams.get("offset") === String(offset)
    );
  };
}

/** O nó (botão de expandir) cujo nome acessível começa pelo nome do principal. */
const nodeButton = (page: Page, node: TreeNode) =>
  page.getByRole("button", { name: new RegExp(`^${node.member_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) });

test.describe("Ministérios (RN-10, RN-05)", () => {
  test.setTimeout(60_000);

  test("Dado um usuário que vê os pastores, quando abre a árvore e um nó, então cada nível é uma chamada só à RPC e nada lê a tabela members", async ({
    page,
  }) => {
    const user = credentials("E2E_MINISTRIES_EMAIL", "E2E_MINISTRIES_PASSWORD");
    const requests = recordRestRequests(page);

    await login(page, user);
    const rootsResponse = page.waitForResponse(isTreeRpc);
    await page.goto("/ministries");
    const roots: TreeNode[] = await (await rootsResponse).json();
    await page.waitForLoadState("networkidle");

    // Abrir a tela: uma chamada, sem argumentos (as raízes).
    const treeCalls = () => requests.filter((request) => pathOf(request) === TREE_RPC);
    expect(treeCalls()).toHaveLength(1);
    expect(treeCalls()[0].postDataJSON() ?? {}).toEqual({});
    expect(roots.length).toBeGreaterThan(0);
    for (const root of roots) {
      await expect(page.getByText(root.member_name, { exact: true }).first()).toBeVisible();
    }

    // Abrir um nó: exatamente uma chamada, com os ids do casal (sem nulos).
    const parent = roots.find((root) => root.direct_disciples > 0);
    test.skip(!parent, "Nenhuma raiz com discípulos diretos neste banco.");
    if (!parent) return;
    const childrenResponse = page.waitForResponse(isTreeRpc);
    await nodeButton(page, parent).click();
    const children: TreeNode[] = await (await childrenResponse).json();
    await page.waitForLoadState("networkidle");

    expect(treeCalls()).toHaveLength(2);
    const parentIds = parent.spouse_id ? [parent.member_id, parent.spouse_id] : [parent.member_id];
    expect(treeCalls()[1].postDataJSON()).toEqual({ _parent_ids: parentIds });
    await expect(nodeButton(page, parent)).toHaveAttribute("aria-expanded", "true");
    // A contagem do nó bate com o que a expansão trouxe: ao menos um filho.
    expect(children.length).toBeGreaterThan(0);
    for (const child of children) {
      await expect(page.getByText(child.member_name, { exact: true }).first()).toBeVisible();
    }

    // Recolher e reabrir usa o cache: nenhuma chamada nova.
    await nodeButton(page, parent).click();
    await expect(nodeButton(page, parent)).toHaveAttribute("aria-expanded", "false");
    await nodeButton(page, parent).click();
    await expect(page.getByText(children[0].member_name, { exact: true }).first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(treeCalls()).toHaveLength(2);

    // RN-05: nenhuma leitura direta da tabela members na sessão inteira.
    expect(requests.filter((request) => pathOf(request) === MEMBERS_TABLE).map((request) => request.url())).toEqual([]);
  });
});

test.describe("Seletores paginados (RN-07)", () => {
  test.setTimeout(60_000);

  test("Dado o seletor de cônjuge, quando abre, carrega mais e pesquisa, então vêm 20 opções por vez, sem repetir, e a busca recomeça do início", async ({
    page,
  }) => {
    const user = credentials("E2E_SELECTORS_EMAIL", "E2E_SELECTORS_PASSWORD");
    const requests = recordRestRequests(page);

    await login(page, user);
    await page.getByRole("button", { name: "Editar meus dados" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const spouse = dialog.getByLabel("Cônjuge");
    const listbox = page.getByRole("listbox");
    const loadMore = listbox.getByRole("option", { name: "Carregar mais" });
    const memberOptions = listbox.getByRole("option").filter({ hasNotText: /^(Carregar mais|Carregando…)$/ });

    // Primeira página: 21 linhas pedidas, 20 exibidas e o "Carregar mais".
    const firstResponse = page.waitForResponse(isMemberOptions(0));
    await spouse.click();
    await spouse.press("ArrowDown");
    const firstPage: MemberOption[] = await (await firstResponse).json();
    expect(new URL((await firstResponse).url()).searchParams.get("limit")).toBe("21");
    expect(firstPage).toHaveLength(21);
    await expect(memberOptions).toHaveCount(20);
    await expect(loadMore).toBeVisible();
    await expect(memberOptions.first()).toHaveText(firstPage[0].name);
    await expect(memberOptions.nth(19)).toHaveText(firstPage[19].name);

    // "Carregar mais": a página seguinte (offset 20), sem repetir ninguém.
    const secondResponse = page.waitForResponse(isMemberOptions(20));
    await loadMore.click();
    const secondPage: MemberOption[] = await (await secondResponse).json();
    expect(secondPage).toHaveLength(21);
    await expect(memberOptions).toHaveCount(40);
    const shownIds = [...firstPage.slice(0, 20), ...secondPage.slice(0, 20)].map((row) => row.id);
    expect(new Set(shownIds).size).toBe(40);
    await expect(memberOptions.nth(20)).toHaveText(secondPage[0].name);

    // Trocar a busca recomeça do offset 0, só com o novo resultado.
    const term = secondPage[0].name.split(" ")[0];
    const searchResponse = page.waitForResponse(
      (response) => isMemberOptions(0)(response) && new URL(response.url()).searchParams.has("search_text"),
    );
    await spouse.pressSequentially(term);
    const searchPage: MemberOption[] = await (await searchResponse).json();
    expect(searchPage.length).toBeGreaterThan(0);
    await expect(memberOptions).toHaveCount(Math.min(searchPage.length, 20));
    await expect(memberOptions.first()).toHaveText(searchPage[0].name);

    // Esc fecha só o menu; o formulário continua aberto. Nada foi salvo.
    await spouse.press("Escape");
    await expect(listbox).toHaveCount(0);
    await expect(dialog).toBeVisible();
    // As RPCs de leitura também são POST: escrita é só POST, PATCH ou DELETE numa tabela.
    const writes = requests.filter((request) => request.method() !== "GET" && !pathOf(request).startsWith("/rest/v1/rpc/"));
    expect(writes.map((request) => `${request.method()} ${pathOf(request)}`)).toEqual([]);
    expect(requests.filter((request) => pathOf(request) === MEMBERS_TABLE)).toHaveLength(0);
  });

  test("Dado o seletor de cônjuge aberto, com texto digitado e a lista rolando, quando aperta Tab, então o foco vai ao campo seguinte sem escolher nada", async ({
    page,
  }) => {
    const user = credentials("E2E_SELECTORS_EMAIL", "E2E_SELECTORS_PASSWORD");

    await login(page, user);
    await page.getByRole("button", { name: "Editar meus dados" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const spouse = dialog.getByLabel("Cônjuge");
    const listbox = page.getByRole("listbox");

    // Sem cônjuge escolhido (com um escolhido, o Tab pararia antes no botão de
    // limpar, que some e volta enquanto a busca carrega). Nada é salvo.
    await spouse.focus();
    await page.keyboard.press("Tab");
    if ((await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Limpar seleção") {
      await page.keyboard.press("Enter");
      await expect(spouse).toBeFocused();
      await page.keyboard.press("Tab");
    }

    // O campo seguinte na ordem do Tab, com o menu fechado; o cônjuge mostra o placeholder.
    await expect(spouse).not.toBeFocused();
    await page.evaluate(() => document.activeElement?.setAttribute("data-e2e-next-field", ""));
    const nextField = dialog.locator("[data-e2e-next-field]");
    await expect(nextField).toBeFocused();
    const emptySpouse = dialog.getByText("Buscar cônjuge…", { exact: true });
    await expect(emptySpouse).toBeVisible();

    // Menu aberto com texto digitado e mais opções do que cabem: a lista rola.
    // O texto é a primeira vogal cuja busca enche o menu neste banco.
    await spouse.focus();
    await spouse.press("ArrowDown");
    await expect(listbox.getByRole("option").first()).toBeVisible();
    let listScrolls = false;
    for (const term of ["a", "e", "o", "i", "u"]) {
      const searchResponse = page.waitForResponse(
        (response) => isMemberOptions(0)(response) && new URL(response.url()).searchParams.has("search_text"),
      );
      await spouse.fill(term);
      await searchResponse;
      await expect(listbox.getByRole("option").first()).toBeVisible();
      listScrolls = await listbox.evaluate((list) => list.scrollHeight > list.clientHeight);
      if (listScrolls) break;
    }
    expect(listScrolls).toBe(true);

    await page.keyboard.press("Tab");

    // O Tab sai do seletor (sem parar na lista), fecha o menu e não escolhe ninguém.
    await expect(nextField).toBeFocused();
    await expect(listbox).toHaveCount(0);
    await expect(emptySpouse).toBeVisible();
  });
});
