import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createAuthUser, deleteAuthUser, e2eEnv, lit, openList, sql, toast, type E2EEnv } from "./exclusao-support";

// Redefinição de senha e cadastro (E2.03, PR 3, tarefa 11): T5 (linha "Senha"
// e senha inicial), T6 (confirmação, senha temporária e recusas), a ação na
// lista (UX-39) e a Auditoria (T8), com login de verdade pela `sign-in` e a
// `reset_member_password` (stack local; variáveis de `e2e/exclusao-support.ts`).
// Cobre RN-01 a RN-04, RN-07, RN-17 pela tela e UX-21 a UX-26, UX-29 (sr-only),
// UX-30, UX-31, UX-36 e UX-39. Cria a própria massa (ids e2e203c3-…) e apaga
// tudo no fim. Rodar com `--workers=1`.

test.describe.configure({ mode: "serial" });

const PREFIX = "e2e203c3";
const PASSWORD = "Caminho#2026x";
const id = (kind: number, n: number) => `${PREFIX}-000${kind}-0000-0000-${String(n).padStart(12, "0")}`;
const ROLE_ANDRE = id(2, 1);
const ROLE_APOIO = id(2, 2);

interface Who {
  n: number;
  name: string;
  email: string | null;
  leader: number | null;
  role: string;
}

// André (pastor) → Apoio → Caio; André → Lauro (sem conta) e Olga (Administrador, função acima da de André).
type WithAccount = Who & { email: string };

const ANDRE: WithAccount = { n: 1, name: "QA Redef André Souza", email: "andre.e203c3@teste.invalid", leader: null, role: lit(ROLE_ANDRE) };
const APOIO: WithAccount = { n: 2, name: "QA Redef Paulo Apoio", email: "apoio.e203c3@teste.invalid", leader: 1, role: lit(ROLE_APOIO) };
const CAIO: Who = { n: 3, name: "QA Redef Caio Lima", email: "caio.e203c3@teste.invalid", leader: 2, role: "(SELECT id FROM public.roles WHERE is_default)" };
const LAURO: Who = { n: 4, name: "QA Redef Lauro Prado", email: null, leader: 1, role: "(SELECT id FROM public.roles WHERE is_default)" };
const OLGA: Who = { n: 5, name: "QA Redef Olga Teles", email: "olga.e203c3@teste.invalid", leader: 1, role: "(SELECT id FROM public.roles WHERE is_system)" };
const PEOPLE = [ANDRE, APOIO, CAIO, LAURO, OLGA];
const WITH_ACCOUNT = PEOPLE.filter((w): w is WithAccount => w.email !== null);

const MEMBER_PERMISSIONS = ["view_own_ministry", "edit_own_data", "submit_own_cell_report"];
const APOIO_PERMISSIONS = [...MEMBER_PERMISSIONS, "view_dashboard", "change_member_password"];
const ANDRE_PERMISSIONS = [...APOIO_PERMISSIONS, "create_member", "edit_member"];

const NEW_MEMBER = { name: "QA Redef Mateus Novo", mobile: "51988887771", password: "Oliveira#7" };

let env: E2EEnv;
const authIds: Record<string, string> = {};

function cleanup() {
  sql(
    env,
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     DELETE FROM public.events WHERE entity_id::text LIKE '${PREFIX}%' OR actor_label LIKE 'QA Redef%' OR entity_label LIKE 'QA Redef%';
     DELETE FROM public.members WHERE id::text LIKE '${PREFIX}%' OR name LIKE 'QA Redef%';
     DELETE FROM private.member_hierarchy h WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id);  -- em replica a FK em cascata não roda
     DELETE FROM public.role_permissions WHERE role_id::text LIKE '${PREFIX}%';
     DELETE FROM public.roles WHERE id::text LIKE '${PREFIX}%';
     DELETE FROM private.sign_in_throttle;
     COMMIT;`,
  );
}

async function removeAccounts() {
  const ids = sql(
    env,
    `SELECT id FROM auth.users WHERE email IN (${WITH_ACCOUNT.map((w) => lit(w.email)).join(", ")})
        OR id IN (SELECT auth_user_id FROM public.members WHERE name = ${lit(NEW_MEMBER.name)} AND auth_user_id IS NOT NULL)`,
  );
  for (const userId of ids.split("\n").filter(Boolean)) await deleteAuthUser(env, userId);
}

async function signIn(page: Page, identifier: string, password: string) {
  sql(env, "DELETE FROM private.sign_in_throttle;");
  await page.goto("/login");
  await page.getByLabel("Identificação").fill(identifier);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.locator('button[type="submit"]').click();
}

async function signInAs(page: Page, who: WithAccount) {
  await signIn(page, who.email, PASSWORD);
  await expect(page).toHaveURL(/\/$/);
}

/** Abre o cadastro de alguém pela lista de Membros (desktop). */
async function openRecord(page: Page, who: Who) {
  await openList(page, "/members", who.name);
  await page.getByRole("button", { name: `Editar ${who.name}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Editar membro" });
  await expect(dialog).toBeVisible();
  return dialog;
}

const permissionRows = (role: string, permissions: string[]) =>
  `INSERT INTO public.role_permissions (role_id, permission)
   SELECT ${lit(role)}::uuid, p::public.permission_action FROM unnest(ARRAY[${permissions.map(lit).join(", ")}]::text[]) p;`;

test.beforeAll(async () => {
  env = e2eEnv();
  cleanup();
  await removeAccounts();
  for (const who of WITH_ACCOUNT) authIds[who.email] = await createAuthUser(env, who.email, PASSWORD);
  const row = (who: Who) =>
    `(${lit(id(1, who.n))}, ${lit(who.name)}, 'M', ${who.leader === null}, ${who.leader !== null}, ${
      who.leader === null ? "NULL" : lit(id(1, who.leader))
    }, true, ${who.email ? lit(authIds[who.email]) : "NULL"}, ${who.role}, ${who.email ? lit(who.email) : lit(`lauro.${PREFIX}@teste.invalid`)})`;
  sql(
    env,
    `BEGIN;
     INSERT INTO public.roles (id, name) VALUES (${lit(ROLE_ANDRE)}, 'QA Redef Líder'), (${lit(ROLE_APOIO)}, 'QA Redef Apoio');
     ${permissionRows(ROLE_ANDRE, ANDRE_PERMISSIONS)}
     ${permissionRows(ROLE_APOIO, APOIO_PERMISSIONS)}
     COMMIT;`,
  );
  // O líder antes do discípulo (os triggers da hierarquia), uma linha por vez.
  for (const who of PEOPLE) {
    sql(
      env,
      `INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, leader_id, is_active, auth_user_id, role_id, email)
       VALUES ${row(who)};`,
    );
  }
});

test.afterAll(async () => {
  if (!env) return;
  cleanup();
  await removeAccounts();
  const leftovers = sql(
    env,
    `SELECT (SELECT count(*) FROM public.members WHERE id::text LIKE '${PREFIX}%' OR name LIKE 'QA Redef%')
          + (SELECT count(*) FROM public.roles WHERE id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM auth.users WHERE email LIKE '%.e203c3@teste.invalid')`,
  );
  expect(leftovers, "limpeza: nada da massa ficou no banco").toBe("0");
});

test.describe("E2.03 PR 3: linha Senha no cadastro (T5)", () => {
  test("UX-21: Caio tem 'Redefinir senha'; Lauro e Olga, o texto da recusa; o próprio cadastro, 'Alterar minha senha'", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signInAs(page, ANDRE);

    let dialog = await openRecord(page, CAIO);
    await expect(dialog.getByRole("button", { name: "Redefinir senha" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Alterar Senha" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Cancelar" }).click();

    dialog = await openRecord(page, LAURO);
    await expect(dialog.getByText("Este membro não tem acesso ao sistema.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Redefinir senha" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Cancelar" }).click();

    dialog = await openRecord(page, OLGA);
    await expect(dialog.getByText("Você não tem permissão para redefinir a senha deste membro.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Redefinir senha" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Cancelar" }).click();

    dialog = await openRecord(page, ANDRE);
    await expect(dialog.getByRole("button", { name: "Alterar minha senha" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Redefinir senha" })).toHaveCount(0);
  });

  test("RN-01 a RN-04, UX-22 a UX-26, UX-29: a redefinição mostra a senha uma vez, copia só ela e some ao concluir", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.setViewportSize({ width: 1280, height: 900 });
    await signInAs(page, ANDRE);
    const record = await openRecord(page, CAIO);
    const resetButton = record.getByRole("button", { name: "Redefinir senha" });
    await resetButton.click();

    const confirm = page.getByRole("alertdialog", { name: `Redefinir a senha de ${CAIO.name}?` });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole("listitem")).toHaveCount(4);
    await expect(confirm.getByRole("button", { name: "Cancelar" })).toBeFocused();
    await confirm.getByRole("button", { name: "Redefinir senha" }).click();

    const result = page.getByRole("alertdialog", { name: `Senha temporária de ${CAIO.name}` });
    await expect(result).toBeVisible();
    await expect(result.getByRole("heading", { name: `Senha temporária de ${CAIO.name}` })).toBeFocused();
    const visual = result.getByTestId("temporary-password");
    await expect(visual).toHaveAttribute("translate", "no");
    await expect(visual).toHaveAttribute("aria-hidden", "true");
    const password = (await visual.textContent()) ?? "";
    expect(password).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{8}$/);
    await expect(result.locator(".sr-only", { hasText: `Senha: ${Array.from(password).join(", ")}.` })).toHaveCount(1);
    await expect(result.locator("input")).toHaveCount(0);
    await expect(result.getByText("Ela não será mostrada de novo.")).toHaveCSS("font-weight", "600");

    // UX-24: só os 8 caracteres na área de transferência, com o anúncio.
    const copy = result.getByRole("button", { name: "Copiar senha" });
    const before = await copy.boundingBox();
    await copy.click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(password);
    await expect(result.getByRole("status")).toHaveText("Senha copiada.");
    const after = await result.getByRole("button", { name: "Senha copiada" }).boundingBox();
    expect(after?.width).toBeCloseTo(before?.width ?? 0, 0);

    // UX-26: Esc não fecha; "Concluir" fecha, e a senha some de tudo.
    await page.keyboard.press("Escape");
    await expect(result).toBeVisible();
    await result.getByRole("button", { name: "Concluir" }).click();
    await expect(result).toHaveCount(0);
    await expect(resetButton).toBeFocused();
    await expect(record.getByText(/^Senha redefinida às \d{2}:\d{2}\. Não é preciso salvar o cadastro\.$/)).toBeVisible();
    expect(await page.content()).not.toContain(password);
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + location.href);
    expect(stored).not.toContain(password);

    // RN-04 e RN-08 a: Caio entra com a temporária e vai para a troca obrigatória.
    await page.context().clearCookies();
    await page.evaluate(() => window.localStorage.clear());
    await signIn(page, CAIO.email ?? "", password);
    await expect(page).toHaveURL(/\/change-password$/);
    // A senha anterior deixou de valer.
    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await signIn(page, CAIO.email ?? "", PASSWORD);
    await expect(page.locator("#login-message")).toContainText("Usuário ou senha inválidos");
  });

  test("UX-30, UX-31, RN-07: a senha inicial fica em Acesso, recusa abc12 e o CPF do formulário, e a conta nasce com a marca", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signInAs(page, ANDRE);
    await openList(page, "/members", NEW_MEMBER.name);
    await page.getByRole("button", { name: "Novo membro", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Novo membro" });
    await expect(dialog).toBeVisible();
    const field = dialog.getByLabel("Senha inicial (opcional)", { exact: true });
    await expect(field).toHaveAttribute("autocomplete", "off");
    await expect(field).not.toHaveAttribute("placeholder", /.+/);
    await expect(dialog.getByLabel(/Confirmar/)).toHaveCount(0);
    await expect(field).toHaveAccessibleDescription(/Se ficar em branco, a senha inicial é 123456\..*data de nascimento do membro\./);

    await dialog.getByLabel("Nome *").fill(NEW_MEMBER.name);
    await dialog.getByRole("radio", { name: "Masculino" }).click();
    await dialog.getByLabel("Celular / WhatsApp").fill(NEW_MEMBER.mobile);
    await dialog.getByLabel("CPF").fill("52998224725");
    await field.fill("abc12");
    await field.blur();
    await expect(dialog.getByText("A senha precisa ter pelo menos 8 caracteres.")).toBeVisible();
    await field.fill("mat52998224725");
    await dialog.getByRole("button", { name: "Criar membro", exact: true }).click();
    await expect(
      dialog.getByText("A senha não pode conter o CPF, o celular ou a data de nascimento do membro, nem ser o e-mail do cadastro."),
    ).toBeVisible();
    await expect(field).toBeFocused();

    await field.fill(NEW_MEMBER.password);
    await dialog.getByRole("button", { name: "Criar membro", exact: true }).click();
    await expect(toast(page, "Membro criado com sucesso")).toBeVisible();

    await page.context().clearCookies();
    await page.evaluate(() => window.localStorage.clear());
    await signIn(page, NEW_MEMBER.mobile, NEW_MEMBER.password);
    await expect(page).toHaveURL(/\/change-password$/);
  });
});

test.describe("E2.03 PR 3: lista de Membros (UX-39) e Auditoria (T8)", () => {
  test("UX-39: Apoio, sem 'Editar Membro', redefine pela linha (desktop) e pelo ⋯ (celular); a própria linha não tem a ação", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signInAs(page, APOIO);
    await openList(page, "/members", "QA Redef");
    const resetCaio = page.getByRole("button", { name: `Redefinir a senha de ${CAIO.name}`, exact: true });
    await expect(resetCaio).toBeVisible();
    await expect(page.getByRole("button", { name: `Redefinir a senha de ${APOIO.name}`, exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: `Editar ${CAIO.name}`, exact: true })).toHaveCount(0);
    await resetCaio.click();
    const confirm = page.getByRole("alertdialog", { name: `Redefinir a senha de ${CAIO.name}?` });
    await confirm.getByRole("button", { name: "Cancelar" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(resetCaio).toBeFocused();

    await page.setViewportSize({ width: 360, height: 800 });
    await openList(page, "/members", "QA Redef");
    const actions = page.getByRole("button", { name: `Ações de ${CAIO.name}`, exact: true });
    await actions.click();
    await page.getByRole("menuitem", { name: "Redefinir senha" }).click();
    await expect(confirm).toBeVisible();
    const axe = await new AxeBuilder({ page }).include("[role='alertdialog']").analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(360);
    await confirm.getByRole("button", { name: "Cancelar" }).click();
    await expect(actions).toBeFocused();
    await expect(page.getByRole("button", { name: `Ações de ${APOIO.name}`, exact: true })).toHaveCount(0);
  });

  test("RN-17, UX-33: a Auditoria mostra a redefinição com o cadastro e a validade, sem a senha", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, env.admin.email, env.admin.password);
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/events");
    const row = page.getByRole("row").filter({ hasText: "Senha redefinida" }).filter({ hasText: CAIO.name }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText(ANDRE.name);
    await expect(row).toContainText(/válida até \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}/);
    await row.click();
    const panel = page.getByRole("dialog", { name: "Detalhes do evento" });
    await expect(panel.getByText("Validade")).toBeVisible();
    await expect(panel.getByText("Metadados")).toHaveCount(0);
  });
});
