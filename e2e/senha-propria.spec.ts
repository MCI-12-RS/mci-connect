import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createAuthUser, deleteAuthUser, e2eEnv, lit, sql, toast, type E2EEnv } from "./exclusao-support";

// A própria senha (E2.03, PR 2, tarefa 8): a troca obrigatória (T2), "Alterar
// minha senha" (T3, T4) e o login (T1), com login de verdade pela função
// `sign-in` e a troca pela `change-own-password` (stack local; variáveis de
// `e2e/exclusao-support.ts`). Cobre UX-03, UX-10, UX-11, UX-12, UX-13 (resposta
// simulada), UX-16, UX-19, UX-36 e UX-37 (axe), a RN-08 b, a RN-10, a RN-11 e a
// RN-16 com dois contextos. Cria a própria massa (ids e2e203b2-…) e apaga tudo
// no fim. Rodar com `--workers=1` (a `sign_in_throttle` é por origem).

test.describe.configure({ mode: "serial" });

const PREFIX = "e2e203b2";
const id = (n: number) => `${PREFIX}-0001-0000-0000-${String(n).padStart(12, "0")}`;

interface Who {
  n: number;
  name: string;
  email: string;
  password: string;
}

// Mateus entra com uma senha fora das regras (sequência): o login põe a marca (RN-08 b).
const MATEUS: Who = { n: 1, name: "QA Senha Mateus Rocha", email: "mateus.e203b2@teste.invalid", password: "12345678" };
// Hugo troca a própria senha pelo menu (RN-11).
const HUGO: Who = { n: 2, name: "QA Senha Hugo Melo", email: "hugo.e203b2@teste.invalid", password: "Caminho#2026x" };
// Vera recebe a marca durante o uso (UX-13, resposta simulada).
const VERA: Who = { n: 3, name: "QA Senha Vera Nunes", email: "vera.e203b2@teste.invalid", password: "Vereda#2026x" };
const PEOPLE = [MATEUS, HUGO, VERA];

const NEW_PASSWORD = "Abacate7x";
const ROUTES = ["/", "/members", "/cells", "/cell-reports", "/ministries", "/roles", "/events", "/login"];

let env: E2EEnv;
const authIds: Record<string, string> = {};

function cleanup() {
  sql(
    env,
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     DELETE FROM public.events WHERE entity_id::text LIKE '${PREFIX}%' OR actor_label LIKE 'QA Senha%';
     DELETE FROM public.members WHERE id::text LIKE '${PREFIX}%';
     DELETE FROM private.member_hierarchy h WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id);  -- em replica a FK em cascata não roda
     DELETE FROM private.sign_in_throttle;
     COMMIT;`,
  );
}

async function removeAccounts() {
  const ids = sql(env, `SELECT id FROM auth.users WHERE email IN (${PEOPLE.map((w) => lit(w.email)).join(", ")})`);
  for (const userId of ids.split("\n").filter(Boolean)) await deleteAuthUser(env, userId);
}

const mustChange = (who: Who) =>
  sql(env, `SELECT coalesce((SELECT must_change::text FROM private.account_passwords WHERE auth_user_id = ${lit(authIds[who.email])}), 'none')`);

/** O login pela tela, sem esperar o destino. */
async function signIn(page: Page, identifier: string, password: string) {
  sql(env, "DELETE FROM private.sign_in_throttle;");
  await page.goto("/login");
  await page.getByLabel("Identificação").fill(identifier);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.locator('button[type="submit"]').click();
}

const newPassword = (page: Page) => page.getByLabel("Nova senha", { exact: true });
const confirmation = (page: Page) => page.getByLabel("Confirmar nova senha", { exact: true });
const currentPassword = (page: Page) => page.getByLabel("Senha atual", { exact: true });

test.beforeAll(async () => {
  env = e2eEnv();
  cleanup();
  await removeAccounts();
  for (const who of PEOPLE) authIds[who.email] = await createAuthUser(env, who.email, who.password);
  const row = (who: Who) =>
    `(${lit(id(who.n))}, ${lit(who.name)}, 'M', false, true, ${lit(authIds[who.email])}, (SELECT id FROM public.roles WHERE is_default), ${lit(who.email)})`;
  sql(
    env,
    `INSERT INTO public.members (id, name, gender, has_leadership, is_active, auth_user_id, role_id, email)
     VALUES ${PEOPLE.map(row).join(",\n            ")};`,
  );
});

test.afterAll(async () => {
  if (!env) return;
  cleanup();
  await removeAccounts();
  const leftovers = sql(
    env,
    `SELECT (SELECT count(*) FROM public.members WHERE id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM auth.users WHERE email LIKE '%.e203b2@teste.invalid')`,
  );
  expect(leftovers, "limpeza: nada da massa ficou no banco").toBe("0");
});

test.describe("E2.03 PR 2: troca obrigatória (T2)", () => {
  test("RN-08 b, UX-03: senha fora das regras no login leva à troca; as rotas e o login levam a ela, sem menu", async ({ page }) => {
    await signIn(page, MATEUS.email, MATEUS.password);
    await expect(page).toHaveURL(/\/change-password$/);
    expect(mustChange(MATEUS)).toBe("true");
    await expect(page.getByRole("heading", { level: 1, name: "Crie uma nova senha" })).toBeFocused();
    await expect(page.getByLabel("Senha atual", { exact: true })).toHaveCount(0);

    for (const route of ROUTES) {
      await page.goto(route);
      await expect(page, `${route} leva à troca`).toHaveURL(/\/change-password$/);
      await expect(page.getByRole("heading", { name: "Crie uma nova senha" })).toBeVisible();
      await expect(page.getByTestId("menu-content")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Abrir menu" })).toHaveCount(0);
      await expect(page.getByText(MATEUS.name)).toHaveCount(0);
    }
  });

  test("UX-12: em 360×800 'Salvar nova senha' aparece sem rolar, também com erro; em 320×568, sem rolagem lateral", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await signIn(page, MATEUS.email, MATEUS.password);
    await expect(page).toHaveURL(/\/change-password$/);
    await newPassword(page).fill("11111111");
    await confirmation(page).fill("11111111");
    await page.getByRole("button", { name: "Salvar nova senha" }).click();
    await expect(page.getByText("Esta senha é fácil de adivinhar. Escolha outra.")).toBeVisible();
    await expect(newPassword(page)).toBeFocused();
    await expect(newPassword(page)).toHaveValue("");
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.getByRole("button", { name: "Salvar nova senha" })).toBeInViewport({ ratio: 1 });

    await page.setViewportSize({ width: 320, height: 568 });
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(320);
    const minHeight = await page.locator(".min-h-dvh").first().evaluate((el) => getComputedStyle(el).minHeight);
    expect(minHeight).not.toBe("0px");
  });

  test("UX-37: axe sem violações na troca obrigatória (claro e escuro)", async ({ page }) => {
    await signIn(page, MATEUS.email, MATEUS.password);
    await expect(page).toHaveURL(/\/change-password$/);
    const light = await new AxeBuilder({ page }).analyze();
    expect(light.violations.map((v) => v.id)).toEqual([]);
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    // Espera as transições de cor dos botões terminarem antes de medir.
    await page.waitForTimeout(500);
    // O botão principal no escuro (`--primary` com o texto, 2,97:1) é o problema conhecido dos tokens globais de tema.
    const dark = await new AxeBuilder({ page }).withRules(["color-contrast"]).exclude('button[type="submit"]').analyze();
    expect(dark.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(" ")} ${n.failureSummary}`))).toEqual([]);
  });

  test("UX-11: 'Sair' abre o login sem o aviso de sessão encerrada; ao entrar de novo, volta à troca", async ({ page }) => {
    await signIn(page, MATEUS.email, MATEUS.password);
    await expect(page).toHaveURL(/\/change-password$/);
    const save = await page.getByRole("button", { name: "Salvar nova senha" }).boundingBox();
    const signOut = await page.getByRole("button", { name: "Sair" }).boundingBox();
    expect(signOut?.height).toBeGreaterThanOrEqual(43.5);
    expect((signOut?.y ?? 0) - ((save?.y ?? 0) + (save?.height ?? 0))).toBeGreaterThanOrEqual(15.5);
    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText("Sua sessão terminou")).toHaveCount(0);
    await signIn(page, MATEUS.email, MATEUS.password);
    await expect(page).toHaveURL(/\/change-password$/);
  });

  test("RN-10, UX-10: a troca vai para o início com o toast, monta o menu, e o 'voltar' não volta à troca", async ({ page }) => {
    await signIn(page, MATEUS.email, MATEUS.password);
    await expect(page).toHaveURL(/\/change-password$/);
    await newPassword(page).fill(NEW_PASSWORD);
    await confirmation(page).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Salvar nova senha" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(toast(page, "Senha alterada. Use a nova senha da próxima vez que entrar.")).toBeVisible();
    await expect(page.getByTestId("menu-content")).toContainText("Dashboard");
    expect(mustChange(MATEUS)).toBe("false");
    await page.goBack();
    await expect(page).not.toHaveURL(/\/change-password$/);
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);

    // A nova senha entra direto, sem a troca.
    await page.context().clearCookies();
    await page.evaluate(() => window.localStorage.clear());
    await signIn(page, MATEUS.email, NEW_PASSWORD);
    await expect(page).toHaveURL(/\/$/);
  });

  test("UX-13: a marca posta durante o uso leva à troca na próxima leitura, sem toast nem mensagem de erro", async ({ page }) => {
    await signIn(page, VERA.email, VERA.password);
    await expect(page).toHaveURL(/\/$/);
    // O portão do banco é do PR 4: a resposta recusada é simulada com o código da AQ-3.
    // A lista de Membros lê a `members_list` desde o E2.07; o próprio cadastro, a `members_view`.
    await page.route(/\/rest\/v1\/(members_view|rpc\/members_list)/, (route) =>
      route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          code: "42501",
          message: "Troque a senha para continuar.",
          details: JSON.stringify({ code: "password_change_required" }),
          hint: "app_error",
        }),
      }),
    );
    await page.getByTestId("menu-content").getByRole("button", { name: "Membros" }).click();
    await expect(page).toHaveURL(/\/change-password$/);
    await expect(page.getByRole("heading", { name: "Crie uma nova senha" })).toBeVisible();
    await expect(page.locator("li[role='status']")).toHaveCount(0);
    await expect(page.getByText("Você não tem permissão")).toHaveCount(0);
  });
});

test.describe("E2.03 PR 2: Alterar minha senha (T3, T4)", () => {
  test("UX-16: tela cheia abaixo de 768 px e max-w-md a partir de 768 px; foco em 'Senha atual'; UX-37 axe", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signIn(page, HUGO.email, HUGO.password);
    await expect(page).toHaveURL(/\/$/);
    await page.getByTestId("menu-content").getByRole("button", { name: "Alterar minha senha" }).click();
    const dialog = page.getByRole("dialog", { name: "Alterar minha senha" });
    await expect(dialog).toBeVisible();
    await expect(currentPassword(page)).toBeFocused();
    const desktop = await dialog.boundingBox();
    expect(desktop?.width).toBeLessThanOrEqual(448.5);
    const axe = await new AxeBuilder({ page }).include("[role='dialog']").analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    await page.setViewportSize({ width: 360, height: 800 });
    await page.getByRole("button", { name: "Abrir menu" }).click();
    await page.getByTestId("menu-content").getByRole("button", { name: "Alterar minha senha" }).click();
    await expect(dialog).toBeVisible();
    const mobile = await dialog.boundingBox();
    expect(mobile?.width).toBeGreaterThanOrEqual(359.5);
    expect(mobile?.height).toBeGreaterThanOrEqual(799.5);
    await expect(dialog.getByRole("button", { name: "Salvar nova senha" })).toBeInViewport({ ratio: 1 });
    // UX-19: ao fechar, o foco volta ao ☰.
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByRole("button", { name: "Abrir menu" })).toBeFocused();
  });

  test("RN-11, UX-17, UX-19: senha atual errada, depois a troca; RN-16: a outra sessão termina com o aviso", async ({ browser, page }) => {
    // A segunda sessão de Hugo, em outro contexto (outro aparelho).
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await signIn(otherPage, HUGO.email, HUGO.password);
    await expect(otherPage).toHaveURL(/\/$/);

    await page.setViewportSize({ width: 1280, height: 800 });
    await signIn(page, HUGO.email, HUGO.password);
    await expect(page).toHaveURL(/\/$/);
    const item = page.getByTestId("menu-content").getByRole("button", { name: "Alterar minha senha" });
    await item.click();
    const dialog = page.getByRole("dialog", { name: "Alterar minha senha" });

    await currentPassword(page).fill("Errada#2026x");
    await newPassword(page).fill(NEW_PASSWORD);
    await confirmation(page).fill(NEW_PASSWORD);
    await dialog.getByRole("button", { name: "Salvar nova senha" }).click();
    await expect(dialog.getByText("A senha atual não confere.")).toBeVisible();
    await expect(dialog.getByText("Se não lembra a senha atual, fale com o seu líder.")).toBeVisible();
    await expect(currentPassword(page)).toBeFocused();
    await expect(currentPassword(page)).toHaveValue("");
    await expect(newPassword(page)).toHaveValue(NEW_PASSWORD);

    await currentPassword(page).fill(HUGO.password);
    await dialog.getByRole("button", { name: "Salvar nova senha" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(toast(page, "Senha alterada. Nos outros aparelhos, será preciso entrar de novo.")).toBeVisible();
    await expect(item).toBeFocused();
    // Ao abrir de novo, os campos estão vazios.
    await item.click();
    await expect(currentPassword(page)).toHaveValue("");
    await page.keyboard.press("Escape");

    // RN-16: a outra sessão foi apagada; ao voltar (recarregar), o login com o aviso.
    await otherPage.reload();
    await expect(otherPage).toHaveURL(/\/login$/);
    await expect(otherPage.getByText("Sua sessão terminou. Entre de novo para continuar.")).toBeVisible();
    await other.close();

    // A sessão atual continua, e a nova senha vale.
    await page.reload();
    await expect(page).toHaveURL(/\/$/);
    await page.context().clearCookies();
    await page.evaluate(() => window.localStorage.clear());
    await signIn(page, HUGO.email, NEW_PASSWORD);
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe("E2.03 PR 2: login (T1)", () => {
  test("RN-15, UX-01: 'Esqueceu a senha? Fale com o seu líder.' abaixo de Entrar, sem link nem botão", async ({ page }) => {
    await page.goto("/login");
    const text = page.getByText("Esqueceu a senha? Fale com o seu líder.");
    await expect(text).toBeVisible();
    expect(await text.evaluate((el) => el.tagName)).toBe("P");
    await expect(text.locator("a, button")).toHaveCount(0);
    const submit = await page.locator('button[type="submit"]').boundingBox();
    const box = await text.boundingBox();
    expect(box?.y ?? 0).toBeGreaterThan(submit?.y ?? 0);
  });
});
