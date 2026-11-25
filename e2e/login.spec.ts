import { test, expect } from "@playwright/test";

// Teste mínimo: a tela de login carrega e quem não está logado é levado a ela.
// Não faz login de verdade, para não depender de credenciais.

test("quem não está logado é levado para a tela de login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("a tela de login mostra os campos de identificação e senha", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel("Identificação")).toBeVisible();
  await expect(page.getByPlaceholder("CPF, celular ou e-mail")).toBeVisible();
  await expect(page.getByLabel("Senha", { exact: true })).toBeVisible();
  await expect(page.locator('button[type="submit"]')).toBeEnabled();
});
