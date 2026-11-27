import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { e2eEnv, type E2EEnv } from "./exclusao-support";
import * as F from "./celulas-filtros-support";

// O filtro Célula em Relatórios (E2.10, PR 3; T15, P84, RN-19; UX-25, UX-26, UX-27), com a massa do
// spec: C1 com R1, R2, R4 e R5 (R3 excluído), C5 excluída com R6 e C8 sem relatório.

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
const C1_CHIP = "Célula de André Souza · Quarta · 20:00";
const total = (page: Page) => page.getByText(/^\d[\d.]* relatórios?$/).first();

async function openReports(page: Page, query: string) {
  await page.goto(`/cell-reports${query}`);
}

test("Pedro: o chip de C1, R1, R2, R4 e R5 ('4 relatórios'); tirar o chip mostra todos (UX-25)", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await F.signIn(page, F.PEDRO);
  await openReports(page, `?cell=${F.cellId(1)}`);
  const chip = page.getByRole("button", { name: `Remover filtro ${C1_CHIP}` });
  await expect(chip).toBeVisible();
  await expect(total(page)).toHaveText("4 relatórios");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Relatórios de Células");
  // UX-26: o chip tem 36 px e "Limpar filtros", 44 px.
  expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(36);
  expect((await page.getByRole("button", { name: "Limpar filtros" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await chip.click();
  await expect(chip).toHaveCount(0);
  await expect(page).not.toHaveURL(/cell=/);
  await expect(page.getByLabel("Buscar relatórios")).toBeFocused();
  // Sem o filtro, Pedro vê também os de C6 (R9) e de C5 (R6, pelos discípulos).
  await expect(total(page)).not.toHaveText("4 relatórios");
});

test("Lia (só relatórios da igreja): o mesmo chip e os 4", async ({ page }) => {
  await F.signIn(page, F.LIA);
  await openReports(page, `?cell=${F.cellId(1)}`);
  await expect(page.getByRole("button", { name: `Remover filtro ${C1_CHIP}` })).toBeVisible();
  await expect(total(page)).toHaveText("4 relatórios");
});

test("Diego: 'Célula indisponível', a dica e a lista vazia; nada de C1 no DOM nem nas respostas (RN-19)", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await F.signIn(page, F.DIEGO);
  const network = F.recordResponses(page);
  await openReports(page, `?cell=${F.cellId(1)}`);
  await expect(page.getByRole("button", { name: "Remover filtro Célula indisponível" })).toBeVisible();
  await expect(page.getByText("Esta célula não está disponível para você.")).toBeVisible();
  await expect(page.getByText("Nenhum relatório encontrado com estes filtros.")).toBeVisible();
  const main = await page.getByRole("main").innerHTML();
  expect(main).not.toContain("André Souza");
  expect(main).not.toContain(F.memberId(F.ANDRE));
  await page.waitForLoadState("networkidle");
  const bodies = network.bodies.join("\n");
  expect(bodies).not.toContain("André Souza");
  expect(bodies).not.toContain(F.memberId(F.ANDRE));
  // Uma célula que não existe dá a mesma tela.
  await openReports(page, `?cell=${F.NOBODY_ID}`);
  await expect(page.getByRole("button", { name: "Remover filtro Célula indisponível" })).toBeVisible();
});

test("Rita, C5 excluída: o chip normal e R6 com 'Célula excluída'", async ({ page }) => {
  await F.signIn(page, F.RITA);
  await openReports(page, `?cell=${F.cellId(5)}`);
  await expect(page.getByRole("button", { name: "Remover filtro Célula de Jonas Prado · Sexta · 20:00" })).toBeVisible();
  await expect(total(page)).toHaveText("1 relatório");
  await expect(page.getByText("Célula excluída").first()).toBeVisible();
});

test("Ester, C8 sem relatório: o vazio com filtros e 'Limpar filtros' (outline)", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await F.signIn(page, F.ESTER);
  await openReports(page, `?cell=${F.cellId(8)}`);
  await expect(page.getByRole("button", { name: "Remover filtro Célula de Ester Ramos · Sábado · 16:00" })).toBeVisible();
  await expect(page.getByText("Nenhum relatório encontrado com estes filtros.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Limpar filtros" })).toHaveCount(2);
});

test("'xyz' sai da URL, e a lista vem sem o filtro", async ({ page }) => {
  await F.signIn(page, F.RITA);
  await openReports(page, "?cell=xyz&size=50");
  await expect(page).toHaveURL(/\/cell-reports\?size=50$/);
  await expect(page.getByRole("button", { name: /^Remover filtro Célula/ })).toHaveCount(0);
});

test("UX-27: em 320 px, o chip quebra a linha sem rolar na horizontal; axe sem violações (fora o contraste dos tokens)", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await F.signIn(page, F.PEDRO);
  await openReports(page, `?cell=${F.cellId(1)}`);
  await expect(page.getByRole("button", { name: `Remover filtro ${C1_CHIP}` })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // O contraste dos tokens globais é um problema conhecido (CLAUDE.md, "Problemas conhecidos").
  const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});
