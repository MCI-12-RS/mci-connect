import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { e2eEnv, sql, type E2EEnv } from "./exclusao-support";
import * as F from "./celulas-filtros-support";

// A consulta "Ver relatório" (E2.12, PR 3 junto do PR 2; T10 a T13, P91, P92, P94; RN-16, RN-17;
// UX-19 a UX-24), com a massa do E2.10: R1 de C1 (André), R2 "Não houve célula", R6 de C5
// (excluída), R8 de C3 (fora do escopo de Pedro) e R3 excluído.

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
const dateOf = (n: number) => sql(env, `SELECT to_char(date, 'DD/MM/YYYY') FROM public.cell_reports WHERE id = '${F.reportId(n)}'`);
const sheet = (page: Page) => page.getByRole("dialog");

async function openList(page: Page, query = "") {
  await page.goto(`/cell-reports${query}`);
  await expect(total(page)).toBeVisible();
}

test("UX-19, UX-20, UX-22: Rita abre R1 pelo cartão (360 px): o conteúdo, a entrada no histórico, o voltar fecha e o foco volta ao cartão", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await F.signIn(page, F.RITA);
  await openList(page, `?cell=${F.cellId(1)}`);
  const date = dateOf(1);
  const open = page.getByRole("button", { name: `Ver o relatório de ${date}, André Souza` });
  await expect(open).toHaveAttribute("aria-haspopup", "dialog");
  // Toque fora do nome, no cartão (o botão é esticado).
  const card = page.getByRole("listitem").filter({ has: open });
  const box = (await card.boundingBox())!;
  await card.click({ position: { x: box.width / 2, y: box.height - 12 } });
  await expect(page).toHaveURL(new RegExp(`report=${F.reportId(1)}`));
  const dialog = sheet(page);
  await expect(dialog.getByRole("heading", { level: 2, name: `Relatório de ${date}` })).toBeFocused();
  await expect(dialog).toContainText("Célula de André Souza");
  await expect(dialog).toContainText("Célula realizada");
  await expect(dialog.getByRole("heading", { level: 3, name: "Reunião" })).toBeVisible();
  await expect(dialog).toContainText("A fé que vence");
  await expect(dialog.getByRole("heading", { name: "Participantes (0)" })).toBeVisible();
  await expect(dialog).toContainText("Nenhum membro.");
  await expect(dialog.getByRole("heading", { name: "Visitantes (0)" })).toBeVisible();
  await expect(dialog).toContainText("R$ 50,00");
  await expect(dialog).toContainText("Líder, timóteo, anfitrião e tipo como estavam no envio. O G12 é o de hoje.");
  await expect(dialog).toContainText("Caio Lima");
  await expect(dialog).toContainText("Carla Dias");
  await expect(dialog).toContainText("CEP 90010-000");
  await expect(dialog.getByRole("link", { name: "Ver a célula de André Souza" })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Ver todos os relatórios da célula de André Souza" })).toBeVisible();
  // Rita edita e exclui: o rodapé com "Editar relatório" (44 px) e o "⋯".
  const edit = dialog.getByRole("button", { name: "Editar relatório" });
  await expect(edit).toBeVisible();
  expect((await edit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(dialog.getByRole("button", { name: `Ações do relatório de ${date}` })).toBeVisible();
  await expect(dialog.getByText("Close")).toHaveCount(0);
  const results = await new AxeBuilder({ page }).include("[role=dialog]").disableRules(["color-contrast"]).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  await page.goBack();
  await expect(dialog).toHaveCount(0);
  await expect(page).not.toHaveURL(/report=/);
  await expect(page).toHaveURL(new RegExp(`cell=${F.cellId(1)}`));
  await expect(open).toBeFocused();
});

test("UX-19, UX-21: na tabela (1280 px), o nome é o botão, o clique na linha abre, e sem o ícone Eye; Excluir e Editar com texto no rodapé", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await F.signIn(page, F.RITA);
  await openList(page, `?cell=${F.cellId(1)}`);
  const date = dateOf(2);
  const row = page.getByRole("row").filter({ hasText: "Chuva forte no bairro" });
  await row.getByRole("cell").nth(2).click();
  const dialog = sheet(page);
  await expect(dialog.getByRole("heading", { level: 2, name: `Relatório de ${date}` })).toBeVisible();
  await expect(dialog).toContainText("Reunião prevista");
  await expect(dialog).toContainText("Chuva forte no bairro");
  await expect(dialog).not.toContainText("Tema");
  await expect(dialog).not.toContainText("Oferta");
  await expect(dialog.getByRole("button", { name: "Excluir relatório" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Editar relatório" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(row.getByRole("button", { name: `Ver o relatório de ${date}, André Souza` })).toBeFocused();
});

test("UX-21: Lia (só relatórios) não tem Ver célula nem rodapé; Ver todos os relatórios desta célula leva ao filtro e o voltar reabre a consulta", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await F.signIn(page, F.LIA);
  await page.goto(`/cell-reports?report=${F.reportId(1)}`);
  const dialog = sheet(page);
  await expect(dialog.getByRole("heading", { level: 2, name: `Relatório de ${dateOf(1)}` })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Ver todos os relatórios da célula de André Souza" })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Ver a célula de André Souza" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Editar relatório" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Excluir relatório" })).toHaveCount(0);
  await dialog.getByRole("link", { name: "Ver todos os relatórios da célula de André Souza" }).click();
  await expect(page).toHaveURL(new RegExp(`/cell-reports\\?cell=${F.cellId(1)}$`));
  await expect(total(page)).toHaveText("4 relatórios");
  await page.goBack();
  await expect(sheet(page).getByRole("heading", { level: 2 })).toBeVisible();
});

test("UX-21: Rita em R6 (célula excluída): o badge, o aviso com Ver células excluídas, só Excluir relatório com texto em 360 px, sem Ver célula", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await F.signIn(page, F.RITA);
  await page.goto(`/cell-reports?report=${F.reportId(6)}`);
  const dialog = sheet(page);
  await expect(dialog.getByText("Célula excluída").first()).toBeVisible();
  await expect(dialog).toContainText("A célula deste relatório foi excluída. Restaure a célula para editar o relatório.");
  await expect(dialog.getByRole("link", { name: "Ver células excluídas" })).toBeVisible();
  await expect(dialog.getByRole("link", { name: /^Ver a célula/ })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Editar relatório" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Excluir relatório" })).toBeVisible();
});

test("UX-23: Pedro abre R8, R3 (excluído) e um id que não existe: o mesmo Relatório não encontrado, sem dado do relatório; Fechar tira o report", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await F.signIn(page, F.PEDRO);
  const network = F.recordResponses(page);
  for (const id of [F.reportId(8), F.reportId(3), F.NOBODY_ID]) {
    await page.goto(`/cell-reports?report=${id}`);
    const dialog = sheet(page);
    await expect(dialog.getByRole("heading", { level: 2, name: "Relatório não encontrado" })).toBeFocused();
    await expect(dialog).toContainText("Ele não existe, foi excluído ou não está disponível para você.");
    await expect(dialog).not.toContainText("Tema C3");
    await expect(dialog).not.toContainText("Esperança");
  }
  await page.waitForLoadState("networkidle");
  expect(network.bodies.join("\n")).not.toContain("Tema C3");
  await sheet(page).getByRole("button", { name: "Fechar", exact: true }).last().click();
  await expect(page).not.toHaveURL(/report=/);
  // report=xyz sai da URL, sem consulta.
  await page.goto("/cell-reports?report=xyz");
  await expect(page).not.toHaveURL(/report=/);
  await expect(sheet(page)).toHaveCount(0);
});

test("UX-24: Rita edita R1 pela consulta, o formulário abre por cima, a consulta mostra o tema novo; depois exclui R4 pela consulta", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await F.signIn(page, F.RITA);
  await openList(page, `?cell=${F.cellId(1)}`);
  await page.getByRole("button", { name: `Ver o relatório de ${dateOf(1)}, André Souza` }).click();
  const consult = page.getByRole("dialog", { name: `Relatório de ${dateOf(1)}` });
  await consult.getByRole("button", { name: "Editar relatório" }).click();
  const form = page.getByRole("dialog", { name: "Editar relatório" });
  await expect(form).toBeVisible();
  const theme = form.getByLabel("Tema");
  await theme.fill("A fé que vence tudo");
  await form.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(form).toHaveCount(0);
  await expect(consult).toContainText("A fé que vence tudo");
  await expect(consult.getByRole("button", { name: "Editar relatório" })).toBeFocused();
  // O primeiro Esc fecha o aviso (toast, que é a camada de cima do Radix); o "✕" fecha a consulta.
  await consult.getByRole("button", { name: "Fechar" }).click();
  await expect(page.getByRole("row").filter({ hasText: "A fé que vence tudo" })).toBeVisible();

  // Exclusão de R4 pela consulta: fecha, R4 sai da lista e do total, e o foco vai para o h1.
  await expect(total(page)).toHaveText("4 relatórios");
  const date4 = dateOf(4);
  await page.getByRole("button", { name: `Ver o relatório de ${date4}, André Souza` }).click();
  await page.getByRole("dialog", { name: `Relatório de ${date4}` }).getByRole("button", { name: "Excluir relatório" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Excluir relatório" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).not.toHaveURL(/report=/);
  await expect(total(page)).toHaveText("3 relatórios");
  await expect(page.getByRole("button", { name: `Ver o relatório de ${date4}, André Souza` })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
});
