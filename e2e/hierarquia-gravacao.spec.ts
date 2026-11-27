import { test, expect, type Page } from "@playwright/test";
import { e2eEnv, lit, sql, type E2EEnv } from "./exclusao-support";
import * as H from "./hierarquia-support";
import { pickMember } from "./membro-validacoes-support";

// Gravação que muda valores de outras telas (E2.06, PR 2, T14): UX-13 e o critério "Células logo
// depois de salvar, sem recarregar" da RN-08, com a massa do spec. Rita define Tiago como líder de
// Fábio (inativo, discípulo de André) e salva; Membros, Células, Ministérios e o Dashboard têm de
// mostrar o carregando e depois o valor novo, nunca o antigo guardado.


/** As leituras de Membros: a `members_view` e a lista pela `members_list` (E2.07). */
const MEMBER_READS = /\/rest\/v1\/(members_view|rpc\/members_list)/;
let env: E2EEnv;

test.beforeAll(async () => {
  env = e2eEnv();
  await H.removeAccounts(env);
  H.cleanup(env);
  await H.seed(env);
});

test.afterAll(async () => {
  if (!env) return;
  await H.removeAccounts(env);
  H.cleanup(env);
});

test.beforeEach(() => H.resetThrottle(env));

const menu = (page: Page, label: string) => page.getByRole("button", { name: label, exact: true });
const rankingTotal = (page: Page, couple: string) => page.locator("tbody tr").filter({ has: page.getByRole("rowheader", { name: couple }) }).locator("td").last();
const leaderOfFabio = () => sql(env, `SELECT leader_id FROM public.members WHERE id = ${lit(H.memberId(H.FABIO))}`);

test("UX-13: Rita define Tiago como líder de Fábio e as outras telas mostram o valor novo, sem recarregar a página", async ({ page }) => {
  expect(leaderOfFabio(), "massa: Fábio começa sob André").toBe(H.memberId(H.ANDRE));
  await H.signIn(page, H.RITA);
  await page.setViewportSize({ width: 1280, height: 900 });

  // 1. Deixa as outras telas na memória (o cache de antes da gravação).
  await expect(rankingTotal(page, "Pedro Alves & Paula Alves")).toHaveText("4");
  await expect(rankingTotal(page, "Tiago Rocha & Tânia Rocha")).toHaveText("4");
  await menu(page, "Células").click();
  const cellRow = (name: string) => page.locator("tbody tr").filter({ has: page.locator("td:nth-child(1) span.break-words", { hasText: new RegExp(`^${name}`) }) });
  await expect(cellRow("Gabriel Nunes").locator("td:nth-child(2)")).toHaveText("Pedro Alves");
  await expect(cellRow("Fábio Lima").locator("td:nth-child(2)")).toHaveText("Pedro Alves");
  await menu(page, "Ministérios").click();
  await H.expandNode(page, "Samuel Colares e Magda Colares");
  await expect(H.treeNode(page, "Pedro Alves e Paula Alves")).toHaveAttribute("aria-label", "Pedro Alves e Paula Alves, G12, 4 discípulos, 4 células");
  await expect(H.treeNode(page, "Tiago Rocha e Tânia Rocha")).toHaveAttribute("aria-label", "Tiago Rocha e Tânia Rocha, G12, 10 discípulos, 4 células");

  // 2. Em Membros, abre Fábio e troca o líder. A lista demora a recarregar para dar tempo de ver o estado.
  await menu(page, "Membros").click();
  await page.getByLabel("Buscar", { exact: true }).fill("Fábio");
  await expect(H.memberRow(page, H.FABIO.name, true)).toBeVisible();
  await page.getByRole("button", { name: `Editar ${H.FABIO.name}`, exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Editar membro" });
  await expect(dialog).toBeVisible();
  await pickMember(page, dialog, "Líder *", H.TIAGO.name);

  // O que as telas mostram a cada mudança: instala os observadores antes de salvar.
  await page.evaluate(() => {
    const w = window as unknown as { __seen: Record<string, string[]>; __busy: string[] };
    w.__seen = { cells: [], tree: [], ranking: [] };
    w.__busy = [];
    new MutationObserver(() => {
      const busy = document.querySelector('tbody[aria-busy="true"]');
      if (busy) w.__busy.push(`${busy.querySelectorAll("tr.opacity-60").length} linhas em opacity-60`);
      document.querySelectorAll("tbody tr").forEach((tr) => {
        const leader = tr.querySelector("td:nth-child(1) span.break-words")?.textContent ?? "";
        if (/^(Gabriel|Fábio)/.test(leader)) w.__seen.cells.push(`${leader.trim()} | ${tr.querySelector("td:nth-child(2)")?.textContent ?? ""}`);
        const head = tr.querySelector("th")?.textContent ?? "";
        if (/Pedro Alves & Paula Alves|Tiago Rocha & Tânia Rocha/.test(head)) w.__seen.ranking.push(`${head} | ${tr.querySelector("td:last-child")?.textContent ?? ""}`);
      });
      document.querySelectorAll("button[aria-label]").forEach((b) => {
        const label = b.getAttribute("aria-label") ?? "";
        if (/^(Pedro Alves e Paula|Tiago Rocha e T)/.test(label)) w.__seen.tree.push(label);
      });
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  // A lista de Membros vem da `members_list` (POST) desde o E2.07.
  await page.route(MEMBER_READS, async (route) => {
    const read = route.request().method() === "GET" || route.request().url().includes("/rpc/members_list");
    if (read) await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.continue();
  });
  await dialog.getByRole("button", { name: "Salvar alterações", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(leaderOfFabio(), "gravou o líder novo").toBe(H.memberId(H.TIAGO));

  // 3. Membros: enquanto a lista recarrega, as linhas ficam esmaecidas e com aria-busy; depois, o valor novo.
  await expect(page.locator('tbody[aria-busy="true"]')).toBeVisible();
  await expect(page.locator("tbody tr.opacity-60").first()).toBeVisible();
  await expect(page.locator('tbody[aria-busy="true"]')).toHaveCount(0, { timeout: 10_000 });
  await page.unroute(MEMBER_READS);
  const fabio = H.memberRow(page, H.FABIO.name, true);
  await expect(fabio.locator("td:nth-child(4)")).toContainText("144");
  await expect(fabio.locator("td:nth-child(5)")).toContainText("Tiago Rocha");
  await page.getByLabel("Buscar", { exact: true }).fill("");
  await expect(H.memberRow(page, H.GABRIEL.name, true).locator("td:nth-child(5) [aria-hidden='true']")).toHaveText("Tiago Rocha / Fábio Lima");
  await expect(H.memberRow(page, H.ANDRE.name, true).locator("td:nth-child(6) [aria-hidden='true']").first()).toHaveText("1 discípulo");

  // 4. Células: C4 e C10 mostram "Tiago Rocha" já na primeira lista exibida, nunca "Pedro Alves" do cache.
  await menu(page, "Células").click();
  await expect(cellRow("Gabriel Nunes").locator("td:nth-child(2)")).toHaveText("Tiago Rocha");
  await expect(cellRow("Fábio Lima").locator("td:nth-child(2)")).toHaveText("Tiago Rocha");
  // 5. Ministérios: a árvore recarrega e mostra os totais novos.
  await menu(page, "Ministérios").click();
  await H.expandNode(page, "Samuel Colares e Magda Colares");
  await expect(H.treeNode(page, "Pedro Alves e Paula Alves")).toHaveAttribute("aria-label", "Pedro Alves e Paula Alves, G12, 3 discípulos, 2 células");
  await expect(H.treeNode(page, "Tiago Rocha e Tânia Rocha")).toHaveAttribute("aria-label", "Tiago Rocha e Tânia Rocha, G12, 11 discípulos, 6 células");
  // 6. Dashboard: o ranking mostra Pedro e Paula com 2 e Tiago e Tânia com 6.
  await menu(page, "Dashboard").click();
  await expect(rankingTotal(page, "Pedro Alves & Paula Alves")).toHaveText("2");
  await expect(rankingTotal(page, "Tiago Rocha & Tânia Rocha")).toHaveText("6");

  // O que apareceu na tela ao longo do caminho: nunca o valor antigo depois da gravação.
  const seen = await page.evaluate(() => (window as unknown as { __seen: Record<string, string[]>; __busy: string[] }).__seen);
  expect(seen.cells.filter((line) => line.includes("Pedro Alves")), "Células: G12 antigo nunca aparece depois de salvar").toEqual([]);
  expect(seen.cells.some((line) => line.includes("Tiago Rocha")), "Células mostrou o G12 novo").toBe(true);
  expect(seen.tree.filter((l) => /4 discípulos, 4 células$|10 discípulos, 4 células$/.test(l)), "Ministérios: totais antigos nunca aparecem").toEqual([]);
  expect(seen.ranking.filter((l) => /Pedro Alves & Paula Alves \| 4$|Tiago Rocha & Tânia Rocha \| 4$/.test(l)), "Dashboard: ranking antigo nunca aparece").toEqual([]);
});

test("UX-13: a lista aberta recarrega com as linhas esmaecidas e 'aria-busy', também nos cartões do celular", async ({ page }) => {
  sql(env, `UPDATE public.members SET leader_id = ${lit(H.memberId(H.ANDRE))} WHERE id = ${lit(H.memberId(H.FABIO))};`);
  test.info().annotations.push({ type: "massa", description: "a massa volta ao que era pelo cleanup do afterAll" });
  await H.signIn(page, H.RITA);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/members?size=50");
  await expect(H.memberCard(page, H.FABIO.name)).toBeVisible();
  await page.getByRole("button", { name: `Editar ${H.FABIO.name}`, exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Editar membro" });
  await expect(dialog).toBeVisible();
  await pickMember(page, dialog, "Líder *", H.TIAGO.name);
  // A lista de Membros vem da `members_list` (POST) desde o E2.07.
  await page.route(MEMBER_READS, async (route) => {
    const read = route.request().method() === "GET" || route.request().url().includes("/rpc/members_list");
    if (read) await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.continue();
  });
  await dialog.getByRole("button", { name: "Salvar alterações", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('div[aria-busy="true"].opacity-60')).toBeVisible();
  await expect(page.locator('div[aria-busy="true"]')).toHaveCount(0, { timeout: 10_000 });
  await page.unroute(MEMBER_READS);
  await expect(H.memberCard(page, H.FABIO.name).getByText("Tiago Rocha").first()).toBeVisible();
});
