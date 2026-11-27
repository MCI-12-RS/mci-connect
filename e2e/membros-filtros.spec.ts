import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { e2eEnv, type E2EEnv } from "./exclusao-support";
import * as F from "./membros-filtros-support";

// Filtros da lista de Membros (E2.07, PR 3): T1 a T6, P50 a P54, com a massa do spec (19 pessoas e as
// células C1 a C5). Rita (Administrador) vê a igreja toda, inclusive cadastros de outros testes: as
// listas são conferidas só nos nomes da massa (`listedNames`). Pedro (Líder) vê o ramo dele.

let env: E2EEnv;

test.beforeAll(async () => {
  env = e2eEnv();
  await F.removeAccounts(env);
  F.cleanup(env);
  await F.seed(env);
});

test.afterAll(async () => {
  if (!env) return;
  await F.removeAccounts(env);
  F.cleanup(env);
});

test.beforeEach(() => F.resetThrottle(env));

const PHONE = { width: 360, height: 800 };
const TABLET = { width: 768, height: 1024 };
const LAPTOP = { width: 1024, height: 768 };
const DESKTOP = { width: 1280, height: 800 };

/** As 9 legendas e rótulos do painel, na ordem do legado (UXD-3). */
const FILTER_ORDER = [
  "Liderança",
  "Bairro",
  "Cidade",
  "Situação",
  "Situação de liderança",
  "Batizado",
  "Nível",
  "Vínculo celular",
  "Cadastrado a partir de",
];

async function openMembers(page: Page, query = "") {
  await page.goto(`/members${query}`);
  await F.waitForList(page);
}

const filtersButton = (page: Page) => page.getByRole("button", { name: /^Filtros/ });
const sheet = (page: Page) => page.getByRole("dialog", { name: "Filtros" });
const total = (page: Page) => page.getByRole("status").filter({ hasText: /^\d[\d.]* membros?$/ }).first();

async function chooseLeader(page: Page, scope: Page | ReturnType<Page["locator"]>, search: string, name: string) {
  const input = scope.getByLabel("Liderança", { exact: true });
  await input.fill(search);
  await page.getByRole("option", { name, exact: true }).click();
}

test.describe("celular e tablet (Sheet)", () => {
  test("UX-01, UX-17: Buscar e Filtros de 44 px, sem campo de filtro na página; o Sheet com os 9 filtros na ordem", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.RITA);
    await openMembers(page);
    await expect(page.getByLabel("Buscar")).toBeVisible();
    expect((await filtersButton(page).boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByLabel("Bairro")).toHaveCount(0);

    await filtersButton(page).click();
    const panel = sheet(page);
    await expect(panel).toBeVisible();
    // Ao abrir, o foco vai para o título, sem abrir o teclado (UXD-15).
    await expect(panel.getByRole("heading", { name: "Filtros" })).toBeFocused();
    const box = await panel.boundingBox();
    expect(box!.y + box!.height).toBeGreaterThan(799); // de baixo
    expect(box!.height).toBeLessThanOrEqual(800 * 0.9 + 1);
    const text = (await panel.textContent()) ?? "";
    let last = -1;
    for (const label of FILTER_ORDER) {
      const at = text.indexOf(label, last + 1);
      expect(at, label).toBeGreaterThan(last);
      last = at;
    }
    for (const name of ["Limpar", "Aplicar filtros"]) {
      const button = panel.getByRole("button", { name, exact: true });
      await expect(button).toBeInViewport();
      expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    const option = panel.locator("label").filter({ hasText: /^Ativo$/ });
    expect((await option.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByText("Indiferente")).toHaveCount(0);
    await expect(page.getByText("Possui Liderança")).toHaveCount(0);
    await expect(page.getByText("Formato: dd/mm/aaaa")).toHaveCount(0);

    await page.setViewportSize(TABLET);
    await page.keyboard.press("Escape");
    await filtersButton(page).click();
    const right = await sheet(page).boundingBox();
    expect(right!.x).toBeGreaterThan(0); // da direita
  });

  test("F2, RN-04, UX-03: Pedro filtra pela rede de André e aplica uma vez só", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.PEDRO);
    await openMembers(page);
    let listCalls = 0;
    page.on("request", (request) => {
      if (request.url().includes("/rpc/members_list?") || request.url().endsWith("/rpc/members_list")) listCalls += 1;
    });
    await filtersButton(page).click();
    const panel = sheet(page);
    await chooseLeader(page, panel, "and", F.ANDRE.name);
    await panel.locator("label").filter({ hasText: /^Ativo$/ }).click();
    expect(listCalls).toBe(0);
    await panel.getByRole("button", { name: "Aplicar filtros" }).click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(filtersButton(page)).toBeFocused();
    await F.waitForList(page);
    // Fábio está inativo: com Situação Ativo, fica de fora; a rede passa por ele (Gabriel e Jonas).
    expect(await F.listedNames(page)).toEqual([F.CAIO.name, F.GABRIEL.name, F.JONAS.name]);
    await expect(total(page)).toHaveText("3 membros");
    await expect(filtersButton(page)).toHaveAccessibleName("Filtros (2 ativos)");
    await expect(page.getByRole("button", { name: `Remover filtro Liderança: ${F.ANDRE.name}` })).toBeVisible();
    expect(listCalls).toBe(1);

    // O "✕" do chip vale na hora, sem "Aplicar filtros" (UX-06).
    await page.getByRole("button", { name: "Remover filtro Situação: Ativo" }).click();
    await F.waitForList(page);
    expect(await F.listedNames(page)).toEqual([F.CAIO.name, F.FABIO.name, F.GABRIEL.name, F.JONAS.name]);
    await expect(page).not.toHaveURL(/status=/);
  });

  test("UX-03: fechar sem aplicar não muda a lista nem a URL; Limpar esvazia os campos sem aplicar", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.PEDRO);
    await openMembers(page, "?q=lima");
    await filtersButton(page).click();
    await sheet(page).locator("label").filter({ hasText: /^Inativo$/ }).click();
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/status=/);

    await page.goto("/members?status=active&q=lima");
    await F.waitForList(page);
    await filtersButton(page).click();
    await sheet(page).getByRole("button", { name: "Limpar", exact: true }).click();
    await expect(sheet(page).getByRole("radio", { name: "Todos" }).first()).toBeChecked();
    await expect(page).toHaveURL(/status=active/);
    await expect(page).toHaveURL(/q=lima/);
  });

  test("UX-19: 320 px e zoom de 200%, sem rolagem horizontal na página nem no Sheet", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await F.signIn(page, F.RITA);
    await openMembers(page, `?status=active&leadership=with_leader,pastor&level=2,3&cell_link=none&leaders=${F.memberId(F.PEDRO)}`);
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await filtersButton(page).click();
    const scroll = await sheet(page).evaluate((el) => {
      const body = el.querySelector("form > div") as HTMLElement;
      return body.scrollWidth - body.clientWidth;
    });
    expect(scroll).toBeLessThanOrEqual(0);
  });
});

test.describe("computador (painel)", () => {
  test("UX-01, UX-04, UX-18: o painel abre e fecha, aplica na hora e lembra o estado", async ({ page }) => {
    await page.setViewportSize(LAPTOP);
    await F.signIn(page, F.RITA);
    await page.evaluate(() => localStorage.removeItem("filters-panel-open:members"));
    await openMembers(page, `?leaders=${F.memberId(F.PEDRO)}`);
    const button = filtersButton(page);
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(sheet(page)).toHaveCount(0);
    // Com o painel aberto, sem chips: os campos já mostram os valores.
    await expect(page.getByTestId("filter-chips")).toHaveCount(0);

    // Bairro vale 300 ms depois da última tecla (RN-06: sem acento, contém).
    await page.getByLabel("Bairro").fill("sao joao");
    await expect(page).toHaveURL(/neighborhood=sao(\+|%20)joao/);
    await F.waitForList(page);
    expect(await F.listedNames(page)).toEqual([F.CAIO.name]);

    // Nível no Popover: "Todos" sem escolha; a escolha vale na hora.
    const level = page.getByRole("button", { name: /^Nível/ });
    await expect(level).toHaveText("Todos");
    await page.getByLabel("Bairro").fill("");
    await level.click();
    await page.getByRole("dialog").getByLabel("144").check();
    await page.getByRole("dialog").getByLabel("1.728").check();
    await page.keyboard.press("Escape");
    await expect(level).toBeFocused();
    await expect(level).toHaveText("144, 1.728");
    await F.waitForList(page);
    expect(await F.listedNames(page)).toEqual([F.ANDRE.name, F.CAIO.name, F.FABIO.name]);

    const hScroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(hScroll).toBeLessThanOrEqual(0);

    await page.reload();
    await F.waitForList(page);
    await expect(filtersButton(page)).toHaveAttribute("aria-expanded", "true");
    await filtersButton(page).click();
    await page.reload();
    await F.waitForList(page);
    await expect(filtersButton(page)).toHaveAttribute("aria-expanded", "false");
    // Fechado, os chips voltam.
    await expect(page.getByRole("button", { name: "Remover filtro Nível: 144" })).toBeVisible();
  });

  test("UX-13, RN-15: sem filtros, por nível e nome; na tabela, aria-sort só no Nível", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await F.signIn(page, F.RITA);
    await openMembers(page, "?size=100");
    expect(await F.listedNames(page)).toEqual([
      F.MAGDA.name, F.SAMUEL.name, // Pastores
      F.LUCIA.name, F.PAULA.name, F.PEDRO.name, F.TANIA.name, F.TIAGO.name, // G12
      F.ANDRE.name, F.BEATRIZ.name, F.CARLA.name, F.DIEGO.name, F.HUGO.name, F.RITA.name, // 144
      F.CAIO.name, F.DEBORA.name, F.FABIO.name, // 1.728
      F.GABRIEL.name, // 20.736
      F.JONAS.name, // Nível 5
      F.ESTER.name, // sem liderança
    ]);
    const sorted = page.locator("th[aria-sort]");
    await expect(sorted).toHaveCount(1);
    await expect(sorted).toHaveText("Nível");
    await expect(sorted).toHaveAttribute("aria-sort", "ascending");
  });

  test("UX-10, RN-12: datas invertidas e o chip das datas", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await F.signIn(page, F.PEDRO);
    await page.evaluate(() => localStorage.setItem("filters-panel-open:members", "1"));
    await openMembers(page);
    const from = page.getByLabel("Cadastrado a partir de");
    const to = page.getByLabel("Cadastrado até");
    await expect(from).not.toHaveAttribute("max");
    await from.fill("2026-11-25");
    await to.fill("2026-11-20");
    await expect(page.getByText("A data inicial precisa ser igual ou anterior à data final.")).toBeVisible();
    await expect(to).toHaveAttribute("aria-invalid", "true");
    await expect(filtersButton(page)).toHaveText(/^Filtros/);
    await expect(filtersButton(page)).toHaveAccessibleName("Filtros");

    // Só "até" há 5 dias: Jonas (cadastrado há 10 dias) entre os da massa.
    await from.fill("");
    const fiveDaysAgo = await page.evaluate(() => {
      const d = new Date(Date.now() - 5 * 86_400_000);
      return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
    });
    await to.fill(fiveDaysAgo);
    await F.waitForList(page);
    expect(await F.listedNames(page)).toEqual([F.JONAS.name]);
    await filtersButton(page).click();
    const [y, m, d] = fiveDaysAgo.split("-");
    await expect(page.getByRole("button", { name: `Remover filtro Cadastrado até ${d}/${m}/${y}` })).toBeVisible();
  });
});

test.describe("URL e links", () => {
  test("UX-12, RN-17: o equivalente de Sem Vínculo Celular", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.RITA);
    await openMembers(page, "?status=active&cell_link=none&size=100");
    await expect(filtersButton(page)).toHaveAccessibleName("Filtros (2 ativos)");
    await expect(page.getByRole("button", { name: "Remover filtro Situação: Ativo" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remover filtro Vínculo celular: Sem vínculo" })).toBeVisible();
    expect(await F.listedNames(page)).toEqual([F.LUCIA.name, F.PAULA.name, F.GABRIEL.name, F.JONAS.name, F.ESTER.name]);
  });

  test("UX-11, RN-14: valor inválido sai da URL; recarregar mantém; sem entrada nova no histórico", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.PEDRO);
    await openMembers(page, "?level=abc&baptized=yes&leaders=nao-e-id");
    await expect(page).toHaveURL(/\/members\?baptized=yes$/);
    await expect(filtersButton(page)).toHaveAccessibleName("Filtros (1 ativos)");
    await expect(page.getByRole("button", { name: "Remover filtro Batizado: Sim" })).toBeVisible();
    await page.reload();
    await F.waitForList(page);
    await expect(page.getByRole("button", { name: "Remover filtro Batizado: Sim" })).toBeVisible();
    const before = await page.evaluate(() => history.length);
    await page.getByRole("button", { name: "Remover filtro Batizado: Sim" }).click();
    await F.waitForList(page);
    expect(await page.evaluate(() => history.length)).toBe(before);
  });

  test("UX-07, RN-14: Limpar filtros tira os filtros, a busca e a página, e mantém o tamanho", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.RITA);
    await openMembers(page, "?status=active&baptized=no&cell_link=none&q=ana&page=2&size=50");
    const clear = page.getByRole("button", { name: "Limpar filtros" }).first();
    expect((await clear.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await clear.click();
    await expect(page).toHaveURL(/\/members\?size=50$/);
    await expect(page.getByLabel("Buscar")).toHaveValue("");
    await expect(filtersButton(page)).toBeFocused();
    await expect(page.getByRole("button", { name: "Limpar filtros" })).toHaveCount(0);
  });

  test("UX-09, RN-05: pessoa indisponível, sem nome nem id na tela e sem member_names", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.PEDRO);
    const namesCalls: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/rpc/member_names")) namesCalls.push(request.postData() ?? "");
    });
    const tiago = F.memberId(F.TIAGO);
    await openMembers(page, `?leaders=${tiago}`);
    await expect(page.getByRole("button", { name: "Remover filtro Liderança: Pessoa indisponível" })).toBeVisible();
    await expect(page.getByText("Esta pessoa não está disponível para você.")).toBeVisible();
    await expect(total(page)).toHaveText("0 membros");
    await expect(page.getByText("Nenhum membro encontrado com estes filtros.")).toBeVisible();
    const html = await page.content();
    expect(html).not.toContain(F.TIAGO.name);
    expect(html).not.toContain(tiago);
    expect(namesCalls.filter((body) => body.includes(tiago))).toEqual([]);

    // Com André: só a rede dele.
    await openMembers(page, `?leaders=${tiago},${F.memberId(F.ANDRE)}`);
    expect(await F.listedNames(page)).toEqual([F.CAIO.name, F.FABIO.name, F.GABRIEL.name, F.JONAS.name]);

    // Um id que não existe dá a mesma tela.
    await openMembers(page, `?leaders=${F.NOBODY_ID}`);
    await expect(page.getByRole("button", { name: "Remover filtro Liderança: Pessoa indisponível" })).toBeVisible();
    await expect(total(page)).toHaveText("0 membros");
  });

  test("UX-08: o seletor de Liderança de Pedro só oferece o ministério dele", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.PEDRO);
    await openMembers(page);
    await filtersButton(page).click();
    const input = sheet(page).getByLabel("Liderança", { exact: true });
    await input.fill("tiago");
    await expect(page.getByText("Nenhum membro do seu ministério encontrado.")).toBeVisible();
    await input.fill("");
    await input.fill("alves");
    await expect(page.getByRole("option")).toHaveText([F.PAULA.name, F.PEDRO.name]);
    await expect(input).toHaveAttribute("aria-describedby", /.+/);
  });
});

test.describe("vínculo e relatórios", () => {
  test("RN-10, AQ-7: participante pelo relatório; excluir o relatório tira Paula de Participante sem recarregar", async ({ page }) => {
    F.addReport(env, 1, 3, [F.PAULA, F.ANDRE]);
    await page.setViewportSize(DESKTOP);
    await F.signIn(page, F.RITA);
    await openMembers(page, "?cell_link=attendee&size=100");
    expect(await F.listedNames(page)).toEqual([F.PAULA.name, F.ANDRE.name]);

    // Exclui o relatório pela tela de Relatórios e volta para a lista filtrada pelo menu.
    await page.goto("/cell-reports");
    await page.getByRole("button", { name: new RegExp(`^Excluir o relatório de .* da célula de ${F.ANDRE.name}$`) }).first().click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Excluir relatório" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await page.goBack();
    await F.waitForList(page);
    expect(await F.listedNames(page)).toEqual([]);
  });
});

test.describe("acessibilidade", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`UX-20, UX-21: axe no Sheet e no painel (${theme})`, async ({ page }) => {
      await page.setViewportSize(PHONE);
      await F.signIn(page, F.RITA);
      await openMembers(page, "?status=active");
      await page.evaluate((t) => document.documentElement.classList.toggle("dark", t === "dark"), theme);
      await filtersButton(page).click();
      await expect(sheet(page)).toBeVisible();
      const mobile = await new AxeBuilder({ page }).include("[role='dialog']").withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(mobile.violations.filter((v) => v.id !== "color-contrast").map((v) => v.id)).toEqual([]);

      await page.keyboard.press("Escape");
      await page.setViewportSize(DESKTOP);
      await page.evaluate(() => localStorage.setItem("filters-panel-open:members", "1"));
      await page.reload();
      await F.waitForList(page);
      await page.evaluate((t) => document.documentElement.classList.toggle("dark", t === "dark"), theme);
      const desktop = await new AxeBuilder({ page }).include("#members-filters-panel").withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(desktop.violations.filter((v) => v.id !== "color-contrast").map((v) => v.id)).toEqual([]);
    });
  }
});
