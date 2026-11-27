import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { e2eEnv, type E2EEnv } from "./exclusao-support";
import * as F from "./celulas-filtros-support";

// Filtros da lista de Células (E2.10, PR 4): T1 a T7, P50 a P54 e P85, com a massa do spec (C1 a C8).
// Rita (Administrador) vê a igreja toda, inclusive cadastros de outros testes: as listas são
// conferidas só nos líderes da massa (`listedLeaders`). Pedro (Líder) vê o ramo dele.

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

const FILTER_ORDER = [
  "Líder",
  "G12",
  "Rua",
  "Bairro",
  "Cidade",
  "Tipo",
  "Dia da semana",
  "Situação",
  "Situação do relatório",
  "Cadastrada a partir de",
  "Cadastrada até",
];

const filtersButton = (page: Page) => page.getByRole("button", { name: /^Filtros/ });
const sheet = (page: Page) => page.getByRole("dialog", { name: "Filtros" });
const total = (page: Page) => page.getByRole("status").filter({ hasText: /^\d[\d.]* células?$/ }).first();

async function openCells(page: Page, query = "") {
  await page.goto(`/cells${query}`);
  await F.waitForCells(page);
}

const L = (person: F.Person) => person.name;

test.describe("celular e tablet (Sheet)", () => {
  test("UX-01, UX-02: em 360 e 768, 'Filtros' (44 px) abre o Sheet com os 10 filtros na ordem da UXD-1", async ({ page }) => {
    await F.signIn(page, F.RITA);
    for (const viewport of [PHONE, TABLET]) {
      await page.setViewportSize(viewport);
      await openCells(page);
      const button = filtersButton(page);
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expect(page.getByLabel("Rua", { exact: true })).toHaveCount(0);
      await button.click();
      const dialog = sheet(page);
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("heading", { name: "Filtros" })).toBeFocused();
      const text = (await dialog.textContent()) ?? "";
      let last = -1;
      for (const label of FILTER_ORDER) {
        const at = text.indexOf(label, last + 1);
        expect(at, label).toBeGreaterThan(last);
        last = at;
      }
      expect(text).not.toMatch(/Modalidade|Logradouro|Indiferente|Discipuladora|Status|Cadastrado a partir|Formato: dd\/mm\/aaaa|Atrasado|Em dia/);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    }
  });

  test("UX-03: marcar não consulta; 'Aplicar filtros' consulta uma vez, fecha, volta para a página 1 e devolve o foco", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.RITA);
    await openCells(page, "?page=2");
    let listCalls = 0;
    page.on("request", (request) => {
      if (request.url().includes("/rpc/cells_list?") || request.url().endsWith("/rpc/cells_list")) listCalls++;
    });
    await filtersButton(page).click();
    await sheet(page).getByText("Discipulado", { exact: true }).click();
    await sheet(page).getByText("Pendente", { exact: true }).click();
    expect(listCalls).toBe(0);
    await sheet(page).getByRole("button", { name: "Aplicar filtros" }).click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/cells\?type=discipleship&report_status=pending$/);
    await expect(filtersButton(page)).toBeFocused();
    await F.waitForCells(page);
    expect(listCalls).toBe(1);
  });

  test("UX-06: cada valor é um chip de 36 px; o toque tira só ele e volta para a página 1", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.RITA);
    await openCells(page, "?type=evangelistic,discipleship&status=active");
    const chips = page.getByTestId("filter-chips").getByRole("button");
    await expect(chips).toHaveCount(3);
    expect((await chips.first().boundingBox())!.height).toBeGreaterThanOrEqual(36);
    await page.getByRole("button", { name: "Remover filtro Tipo: Discipulado" }).click();
    await expect(page).toHaveURL(/\/cells\?type=evangelistic&status=active$/);
    await expect(filtersButton(page)).toHaveAccessibleName("Filtros (2 ativos)");
  });
});

test.describe("computador (painel)", () => {
  test("UX-01, UX-04: em 1024 e 1280, 'Filtros' abre o painel (aria-expanded), sem Sheet, e o painel lembra o estado", async ({ page }) => {
    await F.signIn(page, F.RITA);
    for (const viewport of [LAPTOP, DESKTOP]) {
      await page.setViewportSize(viewport);
      await openCells(page);
      const button = filtersButton(page);
      if ((await button.getAttribute("aria-expanded")) === "true") await button.click();
      await expect(button).toHaveAttribute("aria-expanded", "false");
      await button.click();
      await expect(button).toHaveAttribute("aria-expanded", "true");
      await expect(sheet(page)).toHaveCount(0);
      await expect(page.getByLabel("Rua", { exact: true })).toBeVisible();
      await page.reload();
      await F.waitForCells(page);
      await expect(filtersButton(page)).toHaveAttribute("aria-expanded", "true");
      await filtersButton(page).click();
    }
  });

  test("UX-04: no painel, a Rua vale 300 ms depois da última tecla, sem botão", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await F.signIn(page, F.RITA);
    await openCells(page);
    if ((await filtersButton(page).getAttribute("aria-expanded")) !== "true") await filtersButton(page).click();
    await page.getByLabel("Rua", { exact: true }).fill("sao joao");
    await expect(page).toHaveURL(/street=sao\+joao/);
    await F.waitForCells(page);
    // RN-07: sem acento e sem maiúsculas, "Av. São João" (C2) e "Rua Sao Joao" (C3).
    await expect(page.getByRole("row").filter({ hasText: "Diego Reis" })).toHaveCount(1);
    await expect(page.getByRole("row").filter({ hasText: "Débora Lins" })).toHaveCount(1);
    await expect(total(page)).toHaveText("2 células");
    await filtersButton(page).click();
  });
});

test.describe("seletores e pessoa indisponível", () => {
  test("UX-08: para Pedro, o Líder e o G12 oferecem exatamente as pessoas do spec; André vê também Tânia no G12", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.PEDRO);
    await openCells(page);
    await filtersButton(page).click();
    const leader = sheet(page).getByRole("combobox", { name: "Líder" });
    await leader.click();
    const options = page.getByRole("option");
    await expect(options).toHaveText(["André Souza (144), nível 144", "Diego Reis (144), nível 144", "Gabriel Costa (20.736), nível 20.736", "Paula Alves (G12), G12"]);
    await leader.fill("zzzz");
    await expect(page.getByText("Nenhum líder de célula encontrado.")).toBeVisible();
    await page.keyboard.press("Escape");
    const g12 = sheet(page).getByRole("combobox", { name: "G12" });
    await g12.click();
    await expect(page.getByRole("option")).toHaveText(["Paula Alves", "Pedro Alves", "Tiago Rocha"]);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    await F.resetThrottle(env);
    await page.context().clearCookies();
    await page.evaluate(() => window.localStorage.clear());
    await F.signIn(page, F.ANDRE);
    await openCells(page);
    await filtersButton(page).click();
    await sheet(page).getByRole("combobox", { name: "G12" }).click();
    await expect(page.getByRole("option", { name: "Tânia Rocha" })).toBeVisible();
  });

  test("UX-09: Pedro com G12 Tânia: 'Pessoa indisponível', '0 células' e nada de Tânia no DOM nem nas respostas", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.PEDRO);
    const network = F.recordResponses(page);
    const rpcs: string[] = [];
    page.on("request", (request) => rpcs.push(request.url()));
    await openCells(page, `?g12=${F.memberId(F.TANIA)}`);
    await expect(page.getByRole("button", { name: "Remover filtro G12: Pessoa indisponível" })).toBeVisible();
    await expect(page.getByText("Esta pessoa não está disponível para você.")).toBeVisible();
    await expect(total(page)).toHaveText("0 células");
    await expect(page.getByText("Nenhuma célula encontrada com estes filtros.")).toBeVisible();
    await page.waitForLoadState("networkidle");
    const html = await page.getByRole("main").innerHTML();
    for (const text of [html, network.bodies.join("\n")]) {
      expect(text).not.toContain("Tânia");
      expect(text).not.toContain(F.memberId(F.TANIA));
    }
    expect(rpcs.some((url) => url.includes("member_names"))).toBe(false);

    // Com Tânia e Pedro, C4 e C1 (da mais recente para a mais antiga); tirar o chip tira o id da URL.
    await openCells(page, `?g12=${F.memberId(F.TANIA)},${F.memberId(F.PEDRO)}`);
    await expect(total(page)).toHaveText("2 células");
    expect(await F.listedLeaders(page)).toEqual([L(F.GABRIEL), L(F.ANDRE)]);
    await page.getByRole("button", { name: "Remover filtro G12: Pessoa indisponível" }).click();
    await expect(page).not.toHaveURL(new RegExp(F.memberId(F.TANIA)));
    // Um id que não existe dá a mesma tela; "xyz" sai da URL e não conta.
    await openCells(page, `?g12=${F.NOBODY_ID}`);
    await expect(page.getByRole("button", { name: "Remover filtro G12: Pessoa indisponível" })).toBeVisible();
    await page.goto("/cells?g12=xyz");
    await expect(page).toHaveURL(/\/cells$/);
    await expect(filtersButton(page)).toHaveAccessibleName("Filtros");
  });
});

test.describe("URL, ordem, links prontos (RN-12, RN-13, RN-21)", () => {
  test("RN-13: Rita sem filtros vê a ordem do cadastro, com a 'data não registrada' no fim", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.RITA);
    await openCells(page, "?size=100");
    expect(await F.listedLeaders(page)).toEqual([L(F.DIEGO), L(F.PAULA), L(F.GABRIEL), L(F.ESTER), L(F.ANDRE), L(F.SAMUEL), L(F.DEBORA)]);
  });

  test("UX-12: 'type=abc&day=sat': type sai da URL, 'Filtros (1)', C4 e C8; recarregar mantém", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.RITA);
    await page.goto("/cells?type=abc&day=sat");
    await expect(page).toHaveURL(/\/cells\?day=sat$/);
    await F.waitForCells(page);
    await expect(filtersButton(page)).toHaveAccessibleName("Filtros (1 ativos)");
    expect(await F.listedLeaders(page)).toEqual([L(F.GABRIEL), L(F.ESTER)]);
    await page.reload();
    await F.waitForCells(page);
    expect(await F.listedLeaders(page)).toEqual([L(F.GABRIEL), L(F.ESTER)]);
  });

  test("UX-13: os links prontos e a situação do relatório", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.RITA);
    await openCells(page, "?type=evangelistic");
    expect(await F.listedLeaders(page)).toEqual([L(F.DIEGO), L(F.GABRIEL), L(F.ESTER), L(F.ANDRE)]);
    const week = F.thisWeek(env);
    await openCells(page, `?from=${week.start}&to=${week.end}`);
    expect(await F.listedLeaders(page)).toEqual([L(F.DIEGO)]);
    await expect(page.getByRole("button", { name: `Remover filtro Cadastrada a partir de ${week.start.split("-").reverse().join("/")}` })).toBeVisible();
    await openCells(page, `?g12=${F.memberId(F.PEDRO)},${F.memberId(F.PAULA)}&status=active`);
    expect(await F.listedLeaders(page)).toEqual([L(F.PAULA), L(F.ANDRE)]);
    // RN-10: "Enviado" (C6 e C7), "Sem relatório na semana passada" (C3) e "nas 4 ou mais" (C8).
    await openCells(page, "?report_status=sent");
    expect(await F.listedLeaders(page)).toEqual([L(F.PAULA), L(F.SAMUEL)]);
    await expect(page.getByRole("button", { name: "Remover filtro Situação do relatório: Enviado" })).toBeVisible();
    await openCells(page, "?report_status=missed_1");
    expect(await F.listedLeaders(page)).toEqual([L(F.DEBORA)]);
    await openCells(page, "?report_status=missed_1,missed_4plus");
    expect(await F.listedLeaders(page)).toEqual([L(F.ESTER), L(F.DEBORA)]);
    await expect(page.getByRole("button", { name: "Remover filtro Situação do relatório: Sem relatório nas 4 ou mais semanas anteriores" })).toBeVisible();
    // Inativa e Pendente: o vazio com filtros.
    await openCells(page, "?status=inactive&report_status=pending");
    await expect(page.getByText("Nenhuma célula encontrada com estes filtros.")).toBeVisible();
  });

  test("UX-07: 'Limpar filtros' (44 px) deixa só o tamanho, os campos e a busca vazios, e o foco em 'Filtros'", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await F.signIn(page, F.RITA);
    await openCells(page, "?type=evangelistic&status=active&day=wed&q=flores&page=2&size=50");
    const clear = page.getByRole("button", { name: "Limpar filtros" }).first();
    expect((await clear.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await clear.click();
    await expect(page).toHaveURL(/\/cells\?size=50$/);
    await expect(page.getByLabel("Buscar")).toHaveValue("");
    await expect(filtersButton(page)).toBeFocused();
  });
});

test("UX-27, UX-28: em 320 px o Sheet não rola na horizontal; axe na lista e no Sheet (fora o contraste dos tokens)", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await F.signIn(page, F.RITA);
  await openCells(page, "?type=evangelistic&report_status=missed_1");
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  // O contraste dos tokens globais é um problema conhecido (CLAUDE.md, "Problemas conhecidos").
  let results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  await filtersButton(page).click();
  await expect(sheet(page)).toBeVisible();
  const sheetOverflow = await sheet(page).evaluate((el) => {
    const body = el.querySelector("form > div");
    return body ? body.scrollWidth - body.clientWidth : 0;
  });
  expect(sheetOverflow).toBeLessThanOrEqual(0);
  results = await new AxeBuilder({ page }).include("[role='dialog']").disableRules(["color-contrast"]).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});
