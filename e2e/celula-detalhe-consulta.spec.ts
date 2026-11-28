import { test, expect, type Page } from "@playwright/test";
import { e2eEnv, lit, sql, type E2EEnv } from "./exclusao-support";
import * as F from "./celulas-filtros-support";

// A consulta "Ver relatório" a partir dos "Últimos relatórios" do detalhe da célula (E2.12, PR 4; T14,
// DA-14, P91, P92; RN-16; UX-19, UX-21, UX-22 no detalhe) e a edição por cima da consulta com a entrada
// própria no histórico (DA-11). A massa é a do E2.10 (C1 de André com R1, R2, R4 e R5); os nomes dos
// participantes e dos visitantes de R1 só aparecem na consulta, nunca no detalhe (RN-18 do E2.10).

let env: E2EEnv;

const PHONE = { width: 360, height: 800 };
const DESKTOP = { width: 1280, height: 800 };
const C1 = F.cellId(1);
const R1 = F.reportId(1);
const R4 = F.reportId(4);

function addNumbers() {
  const people = F.PEOPLE.map((person) => F.memberId(person));
  const statements = [
    `UPDATE public.cell_reports SET visitors = ARRAY['Visitante Um', 'Visitante Dois']::text[] WHERE id = ${lit(R1)};`,
    ...people.slice(0, 8).map((member) => `INSERT INTO public.cell_report_participants (report_id, member_id) VALUES (${lit(R1)}, ${lit(member)});`),
  ];
  sql(env, `BEGIN; SET LOCAL session_replication_role = replica; ${statements.join("\n")} COMMIT;`);
}

/** "dd/mm/aaaa" do dia `offset` a partir do domingo desta semana (as datas da massa são relativas a ele). */
const dayOf = (offset: number) => sql(env, `SELECT to_char(public.week_start(public.sp_today()) + ${offset}, 'DD/MM/YYYY')`);

test.beforeAll(async () => {
  env = e2eEnv();
  await F.removeAccounts(env);
  F.cleanup(env);
  await F.seed(env);
  addNumbers();
});

test.afterAll(async () => {
  if (!env) return;
  await F.removeAccounts(env);
  F.cleanup(env);
});

test.beforeEach(() => F.resetThrottle(env));

const region = (page: Page, name: string) => page.getByRole("region", { name });
const openButton = (page: Page, offset: number) =>
  region(page, "Últimos relatórios").getByRole("button", { name: `Ver o relatório de Quarta, ${dayOf(offset)} às 20:00` });
const consult = (page: Page) => page.getByRole("dialog", { name: /^Relatório de / });
const reportParam = (id: string) => new RegExp(`/cells/${C1}\\?report=${id}$`);
const noReport = new RegExp(`/cells/${C1}$`);

test("UX-19, UX-21: Pedro (360 px) toca no cartão de R1: a consulta com os nomes, sem Ver célula; o voltar fecha e o foco volta ao cartão", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await F.signIn(page, F.PEDRO);
  await page.goto(`/cells/${C1}`);
  await expect(page.getByRole("main")).not.toContainText("Visitante Um");
  const open = openButton(page, -4);
  await expect(open).toHaveAttribute("aria-haspopup", "dialog");
  await open.click();
  await expect(page).toHaveURL(reportParam(R1));
  const dialog = consult(page);
  await expect(dialog).toHaveAccessibleName(`Relatório de ${dayOf(-4)}`);
  await expect(dialog.getByRole("heading", { name: "Participantes (8)" })).toBeVisible();
  await expect(dialog.getByText("Visitante Um")).toBeVisible();
  await expect(dialog.getByRole("link", { name: /^Ver a célula/ })).toHaveCount(0);
  await expect(dialog.getByText("Ver célula", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "Ver todos os relatórios da célula de André Souza" })).toHaveAttribute(
    "href",
    `/cell-reports?cell=${C1}`,
  );
  await expect(dialog.getByRole("button", { name: "Editar relatório" })).toBeVisible();
  // P92: tela cheia no celular.
  expect((await dialog.boundingBox())!.width).toBeGreaterThanOrEqual(PHONE.width - 1);

  await page.goBack();
  await expect(page).toHaveURL(noReport);
  await expect(consult(page)).toHaveCount(0);
  await expect(openButton(page, -4)).toBeFocused();
  await expect(page.getByRole("main")).not.toContainText("Visitante Um");
});

test("UX-19: em 1280 px, o clique na linha da tabela abre; Esc fecha e o foco volta à data; recarregar reabre a consulta", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await F.signIn(page, F.PEDRO);
  await page.goto(`/cells/${C1}`);
  const table = region(page, "Últimos relatórios").getByRole("table");
  await table.getByRole("row").filter({ hasText: "Perdão" }).getByText("Perdão").click();
  await expect(page).toHaveURL(reportParam(R4));
  await expect(consult(page)).toHaveAccessibleName(`Relatório de ${dayOf(-25)}`);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(noReport);
  await expect(openButton(page, -25)).toBeFocused();

  // Por link (ou recarregando), a consulta abre sobre o detalhe; "Fechar" tira o report com replace.
  await page.goto(`/cells/${C1}?report=${R1}`);
  await expect(consult(page)).toHaveAccessibleName(`Relatório de ${dayOf(-4)}`);
  await page.reload();
  await expect(consult(page)).toHaveAccessibleName(`Relatório de ${dayOf(-4)}`);
  await consult(page).getByRole("button", { name: "Fechar" }).first().click();
  await expect(page).toHaveURL(noReport);
  await expect(page.getByRole("heading", { level: 2, name: "Últimos relatórios" })).toBeFocused();
  // `report` sem formato sai do endereço sem abrir nada.
  await page.goto(`/cells/${C1}?report=xyz`);
  await expect(page).toHaveURL(noReport);
  await expect(consult(page)).toHaveCount(0);
});

test("RN-16: Lia (só relatórios) com o link do detalhe e do relatório vê Célula não encontrada, sem nada do relatório na rede", async ({ page }) => {
  await F.signIn(page, F.LIA);
  const urls: string[] = [];
  page.on("request", (request) => {
    if (/\/rest\/v1\/(cell_reports_view|cell_report_participants_view)/.test(request.url())) urls.push(request.url());
  });
  await page.goto(`/cells/${C1}?report=${R1}`);
  await expect(page.getByRole("heading", { level: 1, name: "Célula não encontrada" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Visitante Um");
  expect(urls).toEqual([]);
});

test("DA-11: Pedro edita R1 pela consulta no detalhe: o voltar com alteração pergunta, Continuar editando mantém; salvar mostra o tema novo na consulta", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await F.signIn(page, F.PEDRO);
  await page.goto(`/cells/${C1}`);
  const original = sql(env, `SELECT theme FROM public.cell_reports WHERE id = ${lit(R1)}`);
  try {
    await openButton(page, -4).click();
    const dialog = consult(page);
    await dialog.getByRole("button", { name: "Editar relatório" }).click();
    const form = page.getByRole("dialog", { name: "Editar relatório" });
    await expect(form).toBeVisible();
    await form.getByLabel("Tema").fill("Tema pela consulta do detalhe");

    // O voltar pergunta, e a consulta continua no endereço.
    await page.goBack();
    const discard = page.getByRole("alertdialog", { name: "Descartar as alterações?" });
    await expect(discard).toBeVisible();
    await expect(page).toHaveURL(reportParam(R1));
    await discard.getByRole("button", { name: "Continuar editando" }).click();
    await expect(form.getByLabel("Tema")).toHaveValue("Tema pela consulta do detalhe");

    await form.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(form).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Tema pela consulta do detalhe");
    await expect(dialog.getByRole("button", { name: "Editar relatório" })).toBeFocused();
    await expect(page).toHaveURL(reportParam(R1));

    // A entrada da edição saiu ao salvar: o próximo voltar fecha a consulta.
    await page.goBack();
    await expect(page).toHaveURL(noReport);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // O detalhe atrás também mostra o tema novo.
    await expect(region(page, "Últimos relatórios")).toContainText("Tema pela consulta do detalhe");
    expect(await page.evaluate(() => getComputedStyle(document.body).pointerEvents)).not.toBe("none");
  } finally {
    sql(env, `BEGIN; SET LOCAL mci.cell_report_write = 'on'; UPDATE public.cell_reports SET theme = ${lit(original)} WHERE id = ${lit(R1)}; COMMIT;`);
  }
});

test("DA-11: sem alteração, o voltar fecha só o formulário; Descartar pela pergunta também deixa a consulta aberta", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await F.signIn(page, F.PEDRO);
  await page.goto(`/cells/${C1}`);
  await openButton(page, -4).click();
  const dialog = consult(page);
  await dialog.getByRole("button", { name: "Editar relatório" }).click();
  const form = page.getByRole("dialog", { name: "Editar relatório" });
  await expect(form.getByLabel("Tema")).toBeVisible();
  await page.goBack();
  await expect(form).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(reportParam(R1));
  await expect(dialog.getByRole("button", { name: "Editar relatório" })).toBeFocused();

  // Com alteração, "Cancelar" e "Descartar": fecha o formulário e tira a entrada.
  await dialog.getByRole("button", { name: "Editar relatório" }).click();
  await form.getByLabel("Tema").fill("Não vai ficar");
  await form.getByRole("button", { name: "Cancelar" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Descartar" }).click();
  await expect(form).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(noReport);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Pedro exclui R4 pela consulta no detalhe: a consulta fecha, R4 sai dos últimos e o foco vai para Últimos relatórios", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await F.signIn(page, F.PEDRO);
  await page.goto(`/cells/${C1}`);
  try {
    await openButton(page, -25).click();
    const dialog = consult(page);
    await expect(dialog).toHaveAccessibleName(`Relatório de ${dayOf(-25)}`);
    await dialog.getByRole("button", { name: /^Ações do relatório/ }).click();
    await page.getByRole("menuitem", { name: "Excluir relatório" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Excluir relatório" }).click();
    await expect(consult(page)).toHaveCount(0);
    await expect(page).toHaveURL(noReport);
    await expect(region(page, "Últimos relatórios").getByRole("heading", { level: 3 })).toHaveText([
      `Quarta, ${dayOf(-4)} às 20:00`,
      `Quarta, ${dayOf(-11)} às 20:00`,
      `Quarta, ${dayOf(-32)} às 20:00`,
    ]);
    await expect(page.getByRole("heading", { level: 2, name: "Últimos relatórios" })).toBeFocused();
  } finally {
    sql(
      env,
      `BEGIN; SET LOCAL session_replication_role = replica;
       UPDATE public.cell_reports SET deleted_at = NULL, deleted_by = NULL, deleted_by_kind = NULL, deleted_by_legacy = NULL WHERE id = ${lit(R4)}; COMMIT;`,
    );
  }
});
