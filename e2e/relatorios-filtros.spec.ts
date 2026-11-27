import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { e2eEnv, sql, type E2EEnv } from "./exclusao-support";
import * as F from "./celulas-filtros-support";

// A lista de Relatórios com filtros e atalhos de semana (E2.12, PR 2; T1 a T9, P90, P93; RN-01 a
// RN-15, RN-18; UX-01, 03, 05, 08, 09, 11, 13, 15, 16, 17, 18, 26, 27, 28), com a massa do E2.10:
// R9 e R10 nesta semana; R1 e R6 (C5 excluída) na passada; R2 (Não houve célula) e R8 na retrasada;
// R4 e R5 antes; R3 excluído.

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
const DESKTOP = { width: 1280, height: 800 };
const total = (page: Page) => page.getByRole("status").filter({ hasText: /^\d[\d.]* relatórios?$/ });
const shortcut = (page: Page, name: string) => page.getByRole("radio", { name: new RegExp(`^${name}, de `) });

/** As datas das três semanas, pelo banco (Brasília). */
function weeks() {
  const [thisStart, thisEnd, lastStart, lastEnd, beforeStart] = sql(
    env,
    `SELECT w, w + 6, w - 7, w - 1, w - 14 FROM (SELECT public.week_start(public.sp_today()) AS w) s`,
  ).split("|");
  return { thisStart, thisEnd, lastStart, lastEnd, beforeStart };
}
const br = (iso: string) => iso.split("-").reverse().join("/");

async function openReports(page: Page, query = "") {
  await page.goto(`/cell-reports${query}`);
  await expect(total(page)).toBeVisible();
}

test("UX-01, UX-05: no celular, Buscar, Filtros e os três atalhos à vista, sem campo de filtro; Filtros abre o Sheet na ordem da UXD-2", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await F.signIn(page, F.RITA);
  await openReports(page, `?cell=${F.cellId(1)}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Relatórios");
  await expect(page.getByLabel("Buscar")).toBeVisible();
  for (const name of ["Esta semana", "Semana passada", "Semana retrasada"]) {
    const item = shortcut(page, name);
    await expect(item).toBeEnabled();
    expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  // Os três na mesma linha em 360 px.
  const tops = await Promise.all(["Esta semana", "Semana passada", "Semana retrasada"].map(async (n) => (await shortcut(page, n).boundingBox())!.y));
  expect(new Set(tops).size).toBe(1);
  await expect(page.getByText("Escolha uma ou mais pessoas")).toHaveCount(0);
  await page.getByRole("button", { name: /^Filtros/ }).click();
  const sheet = page.getByRole("dialog", { name: "Filtros" });
  await expect(sheet.getByRole("heading", { name: "Filtros" })).toBeFocused();
  const order = await sheet.locator("label, legend, p.mb-1").allInnerTexts();
  const wanted = ["Célula", "Líder", "G12", "Período", "Tipo", "Reunião"];
  expect(order.filter((text) => wanted.includes(text))).toEqual(wanted);
  // A Reunião, uma opção por linha, cada uma com 44 px.
  const held = sheet.getByRole("radiogroup");
  const rows = await held.locator("label").evaluateAll((labels) => labels.map((l) => l.getBoundingClientRect().top));
  expect(new Set(rows).size).toBe(3);
  await expect(sheet.getByText("Close")).toHaveCount(0);
});

test("UX-03, UX-15: o atalho vale na hora, troca o Período, marca e não desmarca; com o Líder aplicado, mantém o Líder", async ({ page }) => {
  await page.setViewportSize(PHONE);
  const w = weeks();
  await F.signIn(page, F.RITA);
  await openReports(page, "?page=1&size=50");
  await expect(total(page)).toHaveText("8 relatórios");
  const listRequests: string[] = [];
  page.on("request", (request) => {
    if (/rpc\/cell_reports_list\?/.test(request.url())) listRequests.push(request.url());
  });
  await shortcut(page, "Esta semana").click();
  await expect(page).toHaveURL(new RegExp(`from=${w.thisStart}&to=${w.thisEnd}`));
  await expect(page).not.toHaveURL(/page=/);
  await expect(page).toHaveURL(/size=50/);
  await expect(total(page)).toHaveText("2 relatórios");
  await expect(shortcut(page, "Esta semana")).toHaveAttribute("aria-checked", "true");
  await expect(shortcut(page, "Semana passada")).toHaveAttribute("aria-checked", "false");
  await expect(shortcut(page, "Esta semana")).toBeFocused();
  await expect(page.getByRole("button", { name: `Remover filtro De: ${br(w.thisStart)}` })).toBeVisible();
  await expect(page.getByRole("button", { name: `Remover filtro Até: ${br(w.thisEnd)}` })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Filtros \(1/ })).toBeVisible();
  expect(listRequests).toHaveLength(1);
  // Tocar de novo não faz requisição e não desmarca.
  await shortcut(page, "Esta semana").click();
  await expect(shortcut(page, "Esta semana")).toHaveAttribute("aria-checked", "true");
  expect(listRequests).toHaveLength(1);
  await shortcut(page, "Semana passada").click();
  await expect(total(page)).toHaveText("2 relatórios");
  await expect(page.getByRole("button", { name: /^Ver o relatório de .*, André Souza$/ })).toHaveCount(1);
  await shortcut(page, "Semana retrasada").click();
  await expect(page.getByRole("button", { name: /, Débora Lins$/ })).toHaveCount(1);
  // Mudar filtro ou tocar num atalho não cria entrada no histórico: o voltar sai da tela.
  await page.goBack();
  await expect(page).not.toHaveURL(/cell-reports/);
});

test("UX-11: Pedro com o link Líder: Débora vê Pessoa indisponível, sem o nome nem o id de Débora no DOM ou nas respostas", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await F.signIn(page, F.PEDRO);
  const network = F.recordResponses(page);
  await openReports(page, `?leaders=${F.memberId(F.DEBORA)}`);
  await expect(page.getByRole("button", { name: "Remover filtro Líder: Pessoa indisponível" })).toBeVisible();
  await expect(page.getByText("Esta pessoa não está disponível para você.")).toBeVisible();
  await expect(total(page)).toHaveText("0 relatórios");
  await expect(page.getByText("Nenhum relatório encontrado com estes filtros.")).toBeVisible();
  await page.waitForLoadState("networkidle");
  const main = await page.getByRole("main").innerHTML();
  expect(main).not.toContain("Débora");
  expect(main).not.toContain(F.memberId(F.DEBORA));
  expect(network.bodies.join("\n")).not.toContain("Débora");
  expect(network.urls.join("\n")).not.toContain("member_names");
  // Com André também: os relatórios dele (R1, R2, R4 e R5).
  await openReports(page, `?leaders=${F.memberId(F.DEBORA)},${F.memberId(F.ANDRE)}`);
  await expect(total(page)).toHaveText("4 relatórios");
  await page.getByRole("button", { name: "Remover filtro Líder: Pessoa indisponível" }).click();
  await expect(page).not.toHaveURL(new RegExp(F.memberId(F.DEBORA)));
});

test("UX-13, UX-15: Reunião e Tipo pelo painel do computador; type=abc sai, held=no traz só R2", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await F.signIn(page, F.RITA);
  await openReports(page, "?type=abc&held=no");
  await expect(page).not.toHaveURL(/type=/);
  await expect(total(page)).toHaveText("1 relatório");
  await expect(page.getByRole("button", { name: /^Filtros \(1/ })).toBeVisible();
  await expect(page.getByText("Motivo:")).toBeVisible();
  await page.getByRole("button", { name: "Remover filtro Reunião: Não houve célula" }).click();
  await expect(total(page)).toHaveText("8 relatórios");
  // Painel: Tipo Discipulado traz R8 (C3) e R9 (C6).
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await page.getByRole("button", { name: /Tipo/ }).click();
  await page.getByRole("checkbox", { name: "Discipulado" }).click();
  await page.keyboard.press("Escape");
  await expect(total(page)).toHaveText("2 relatórios");
});

test("UX-17, UX-18: a linha em cartão (360) e na tabela (1280), com o dia abreviado, os números e Não houve célula", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await F.signIn(page, F.RITA);
  await openReports(page, `?cell=${F.cellId(1)}`);
  const card = page.getByRole("listitem").filter({ hasText: "A fé que vence" });
  await expect(card).toContainText("André Souza");
  await expect(card).toContainText("G12: Pedro Alves");
  // O dia abreviado à vista e o dia inteiro para o leitor de tela (UXD-15).
  await expect(card.getByText("Qua,", { exact: true })).toHaveAttribute("aria-hidden", "true");
  await expect(card.getByText("Quarta,", { exact: true })).toHaveClass(/sr-only/);
  await expect(card).toContainText("20:00");
  await expect(card).toContainText("Rua das Flores, 100 · Centro");
  await expect(card).toContainText("Célula realizada");
  await expect(card).toContainText("Participantes: 0");
  await expect(card).toContainText("Oferta: R$ 50,00");
  const notHeld = page.getByRole("listitem").filter({ hasText: "Chuva forte no bairro" });
  await expect(notHeld).toContainText("Não houve célula");
  await expect(notHeld).not.toContainText("Participantes:");
  await expect(page.getByRole("table")).toHaveCount(0);
  await page.setViewportSize(DESKTOP);
  await page.reload();
  await expect(page.getByRole("table")).toBeVisible();
  const headers = await page.getByRole("columnheader").allInnerTexts();
  expect(headers.map((h) => h.trim())).toEqual(["Célula", "Data e horário", "Reunião", "Participantes", "Visitantes", "Oferta", "Ações"]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const main = await page.getByRole("main").innerText();
  for (const forbidden of ["presenças", "Presenças", "Relatórios de Células", "Célula sem líder", "Não Realizada"]) expect(main).not.toContain(forbidden);
});

test("UX-09: Limpar filtros deixa só o size, sem atalho marcado, e o foco em Filtros", async ({ page }) => {
  await page.setViewportSize(PHONE);
  const w = weeks();
  await F.signIn(page, F.RITA);
  await openReports(page, `?cell=${F.cellId(1)}&from=${w.lastStart}&to=${w.lastEnd}&type=evangelistic&held=yes&q=fe&page=2&size=50`);
  await expect(page.getByRole("button", { name: /^Filtros \(4/ })).toBeVisible();
  await page.getByRole("button", { name: "Limpar filtros" }).first().click();
  await expect(page).toHaveURL(/\/cell-reports\?size=50$/);
  await expect(page.getByRole("button", { name: /^Filtros/ })).toBeFocused();
  await expect(shortcut(page, "Semana passada")).toHaveAttribute("aria-checked", "false");
});

test("UX-16: links prontos do Dashboard: esta semana, held=yes e held=no", async ({ page }) => {
  const w = weeks();
  await F.signIn(page, F.RITA);
  await openReports(page, `?from=${w.thisStart}&to=${w.thisEnd}`);
  await expect(total(page)).toHaveText("2 relatórios");
  await expect(shortcut(page, "Esta semana")).toHaveAttribute("aria-checked", "true");
  await openReports(page, `?from=${w.thisStart}&to=${w.thisEnd}&held=no`);
  await expect(total(page)).toHaveText("0 relatórios");
});

test("UX-28: em 320 px, a lista, os atalhos e o Sheet não rolam na horizontal; axe sem violações (fora o contraste dos tokens)", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await F.signIn(page, F.RITA);
  await openReports(page);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  await page.getByRole("button", { name: /^Filtros/ }).click();
  await expect(page.getByRole("dialog", { name: "Filtros" })).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
});
