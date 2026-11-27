import { test, expect } from "@playwright/test";
import { e2eEnv, lit, sql, type E2EEnv } from "./exclusao-support";
import * as F from "./membros-filtros-support";

// "Novo membro" com o líder já preenchido (E2.07, PR 4; RN-16, P55, T7; UX-22 e UX-23), com a massa
// do spec. Rita (Administrador) vê a igreja toda e recebe o aviso; Pedro (Líder) não.

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

const NEW_NAME = "Novo Membro E2E207";

test("UX-22, RN-16: Rita cadastra com o líder já preenchido, o aviso e 'Ir para o líder'", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await F.signIn(page, F.RITA);
  await page.goto("/members");
  await page.getByRole("button", { name: "Novo membro" }).click();
  const dialog = page.getByRole("dialog");
  const notice = dialog.getByTestId("prefilled-leader-notice");
  await expect(notice).toHaveText(/O líder já vem preenchido com você\./);
  const leaderBlock = dialog.locator("[data-leader-field]");
  await expect(leaderBlock).toContainText(F.RITA.name);
  await expect(dialog.getByRole("switch", { name: "Tem Liderança?" })).toBeChecked();

  const go = notice.getByRole("button", { name: "Ir para o líder" });
  expect((await go.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await go.click();
  await expect(dialog.getByLabel("Líder *")).toBeFocused();
  await expect(leaderBlock.locator("[data-highlighted]")).toHaveClass(/ring-2/);
  await expect(leaderBlock).toBeInViewport({ ratio: 1 });
  await expect(leaderBlock.locator("[data-highlighted]")).toHaveCount(0, { timeout: 4000 });

  // Desligar "Tem Liderança?" tira o aviso, sem o aviso do P20; religar devolve.
  await dialog.getByRole("switch", { name: "Tem Liderança?" }).click();
  await expect(notice).toHaveCount(0);
  await expect(dialog.getByText(/deixa de ser o líder/)).toHaveCount(0);
  await dialog.getByRole("switch", { name: "Tem Liderança?" }).click();
  await expect(dialog.getByTestId("prefilled-leader-notice")).toBeVisible();

  // Cria o cadastro sem tocar no Líder (F11): grava Rita como líder.
  await dialog.getByLabel("Nome *").fill(NEW_NAME);
  await dialog.getByRole("radio", { name: "Feminino" }).click();
  await dialog.getByLabel("Celular / WhatsApp").fill("51932079999");
  await dialog.getByRole("button", { name: "Criar membro" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 20_000 });
  const leader = sql(env, `SELECT leader_id FROM public.members WHERE name = ${lit(NEW_NAME)} AND deleted_at IS NULL`);
  expect(leader).toBe(F.memberId(F.RITA));
});

test("UX-23: Pedro abre o cadastro com o líder Pedro, sem o aviso; a edição não muda o líder", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await F.signIn(page, F.PEDRO);
  await page.goto("/members");
  await page.getByRole("button", { name: "Novo membro" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("[data-leader-field]")).toContainText(F.PEDRO.name);
  await expect(dialog.getByTestId("prefilled-leader-notice")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cancelar" }).click();

  await page.getByRole("button", { name: `Editar ${F.CAIO.name}` }).click();
  const edit = page.getByRole("dialog");
  await expect(edit.locator("[data-leader-field]")).toContainText(F.ANDRE.name);
  await expect(edit.getByTestId("prefilled-leader-notice")).toHaveCount(0);
});
