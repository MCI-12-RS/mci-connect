import { expect, test, type Browser, type Page } from "@playwright/test";
import { createAuthUser, deleteAuthUser, e2eEnv, lit, rpcAs, sql, type E2EEnv } from "./exclusao-support";

// Acesso e sessão do membro excluído (E2.01, PR 6, tarefa 23): RN-14, UX-35 e
// UX-36. Login de verdade pela função `sign-in`, na stack local (a função precisa
// estar servida e o `npm run dev` apontando para ela; variáveis de
// `e2e/exclusao-support.ts`). Sem elas, ou fora da stack local, os testes são
// pulados. Cria a própria massa fictícia (ids e2e2016f-…) e apaga tudo no fim.
// Rodar com `--workers=1`: a `sign_in_throttle` é por origem (127.0.0.1).

test.describe.configure({ mode: "serial" });

const PREFIX = "e2e2016f";
const PASSWORD = "QaExcluido#2026";
const id = (n: number) => `${PREFIX}-0001-0000-0000-${String(n).padStart(12, "0")}`;
const ROLE = `${PREFIX}-0002-0000-0000-000000000001`;

const INVALID_MESSAGE = "Usuário ou senha inválidos. Confira os dados e tente de novo.";
const SESSION_ENDED = "Sua sessão terminou. Entre de novo para continuar.";

interface Who {
  n: number;
  name: string;
  email: string;
  cpf?: string;
  mobile?: string;
}

const DORA: Who = { n: 1, name: "QA Acesso Dora Lima", email: "dora.e2e201f6@teste.invalid", cpf: "11144477735", mobile: "(51) 95555-6001" };
const EVA: Who = { n: 2, name: "QA Acesso Eva Reis", email: "eva.e2e201f6@teste.invalid" };
const FABIO: Who = { n: 3, name: "QA Acesso Fábio Dias", email: "fabio.e2e201f6@teste.invalid" };
const GIL: Who = { n: 4, name: "QA Acesso Gil Melo", email: "gil.e2e201f6@teste.invalid" };
const HANA: Who = { n: 5, name: "QA Acesso Hana Cruz", email: "hana.e2e201f6@teste.invalid" };
const IVO: Who = { n: 6, name: "QA Acesso Ivo Paz", email: "ivo.e2e201f6@teste.invalid" };
const JUCA: Who = { n: 7, name: "QA Acesso Juca Vaz", email: "juca.e2e201f6@teste.invalid" };
const ALL = [DORA, EVA, FABIO, GIL, HANA, IVO, JUCA];

let env: E2EEnv;
const authIds: Record<number, string> = {};

const identifier = (page: Page) => page.getByLabel("Identificação");
const password = (page: Page) => page.getByLabel("Senha", { exact: true });
const submit = (page: Page) => page.locator('button[type="submit"]');
const message = (page: Page) => page.locator("#login-message");
const sessionNotice = (page: Page) => page.getByText(SESSION_ENDED);

function cleanup() {
  sql(
    env,
    `BEGIN;
     SET LOCAL session_replication_role = replica;
     DELETE FROM public.events WHERE entity_id::text LIKE '${PREFIX}%' OR actor_label LIKE 'QA Acesso%';
     DELETE FROM private.member_access_suspensions WHERE member_id::text LIKE '${PREFIX}%';
     DELETE FROM public.members WHERE id::text LIKE '${PREFIX}%';
     DELETE FROM public.role_permissions WHERE role_id::text LIKE '${PREFIX}%';
     DELETE FROM public.roles WHERE id::text LIKE '${PREFIX}%';
     DELETE FROM private.sign_in_throttle;
     COMMIT;`,
  );
}

async function removeAccounts() {
  const ids = sql(env, `SELECT id FROM auth.users WHERE email IN (${ALL.map((w) => lit(w.email)).join(", ")})`);
  for (const userId of ids.split("\n").filter(Boolean)) await deleteAuthUser(env, userId);
}

const adminAuthId = () => sql(env, `SELECT id FROM auth.users WHERE email = ${lit(process.env.E2E_ADMIN_EMAIL ?? "")}`);
const deleteMember = (who: Who) => rpcAs(env, adminAuthId(), `public.delete_member(${lit(id(who.n))})`);
const restoreMember = (who: Who) => rpcAs(env, adminAuthId(), `public.restore_member(${lit(id(who.n))})`);

test.beforeAll(async () => {
  env = e2eEnv();
  cleanup();
  await removeAccounts();
  for (const who of ALL) authIds[who.n] = await createAuthUser(env, who.email, PASSWORD);
  const row = (who: Who) =>
    `(${lit(id(who.n))}, ${lit(who.name)}, 'F', false, true, ${lit(authIds[who.n])}, ${lit(ROLE)}, ${lit(who.email)},
      ${who.cpf ? lit(who.cpf) : "NULL"}, ${who.mobile ? lit(who.mobile) : "NULL"})`;
  sql(
    env,
    `BEGIN;
     INSERT INTO public.roles (id, name) VALUES (${lit(ROLE)}, 'QA Acesso Excluído');
     INSERT INTO public.role_permissions (role_id, permission)
     SELECT ${lit(ROLE)}::uuid, p::public.permission_action
     FROM unnest(ARRAY['view_dashboard', 'view_all_church', 'edit_own_data']) p;
     INSERT INTO public.members (id, name, gender, has_leadership, is_active, auth_user_id, role_id, email, cpf, mobile_whatsapp)
     VALUES ${ALL.map(row).join(",\n            ")};
     COMMIT;`,
  );
});

test.afterAll(async () => {
  if (!env) return;
  cleanup();
  await removeAccounts();
  const leftovers = sql(
    env,
    `SELECT (SELECT count(*) FROM public.members WHERE id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM public.roles WHERE id::text LIKE '${PREFIX}%')
          + (SELECT count(*) FROM auth.users WHERE email IN (${ALL.map((w) => lit(w.email)).join(", ")}))`,
  );
  expect(leftovers, "limpeza: nada da massa ficou no banco").toBe("0");
});

test.beforeEach(() => {
  sql(env, "DELETE FROM private.sign_in_throttle;");
});

async function typeAndSubmit(page: Page, who: string, pw: string) {
  await page.goto("/login");
  await identifier(page).fill(who);
  await password(page).fill(pw);
  await submit(page).click();
}

async function expectSignedIn(page: Page) {
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
}

async function signInApi(identifierText: string, passwordText: string) {
  const response = await fetch(`${env.apiUrl}/functions/v1/sign-in`, {
    method: "POST",
    headers: { apikey: env.publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: identifierText, password: passwordText }),
  });
  const text = await response.text();
  return { status: response.status, text };
}

/** A volta do foco, como o navegador a anuncia. */
async function returnFocus(page: Page) {
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
}

/** Abre uma segunda sessão do navegador (outro contexto) já com o membro logado. */
async function openSession(browser: Browser, who: Who) {
  const context = await browser.newContext({ baseURL: "http://localhost:8080" });
  const page = await context.newPage();
  await typeAndSubmit(page, who.email, PASSWORD);
  await expectSignedIn(page);
  return { context, page };
}

const lastFailureReason = (who: Who) =>
  sql(
    env,
    `SELECT coalesce(metadata->>'reason', '') FROM public.events
     WHERE action = 'login_failed' AND entity_id::text = ${lit(id(who.n))} ORDER BY occurred_at DESC LIMIT 1`,
  );

test.describe("RN-14 e UX-35: o login de um cadastro excluído", () => {
  test.beforeAll(() => {
    deleteMember(DORA);
  });

  test("Dado um cadastro excluído, quando entra por e-mail, CPF ou celular, então recebe a mesma recusa única (401)", async () => {
    const reference = await signInApi("ninguem.e2e201f6@teste.invalid", PASSWORD);
    expect(reference.status).toBe(401);
    for (const typed of [DORA.email, DORA.cpf ?? "", DORA.mobile ?? ""]) {
      const result = await signInApi(typed, PASSWORD);
      expect(result.status, typed).toBe(401);
      expect(result.text, `${typed}: corpo igual ao do cadastro inexistente`).toBe(reference.text);
    }
    const wrong = await signInApi(DORA.email, "senha-errada-qualquer");
    expect(wrong.status).toBe(401);
    expect(wrong.text).toBe(reference.text);
  });

  test("UX-35: a tela mostra a mesma mensagem de senha errada, mantém a identificação e foca a senha limpa", async ({ page }) => {
    for (const typed of [DORA.email, DORA.cpf ?? "", DORA.mobile ?? ""]) {
      await typeAndSubmit(page, typed, PASSWORD);
      await expect(message(page)).toHaveText(INVALID_MESSAGE);
      await expect(message(page)).toHaveAttribute("role", "alert");
      await expect(identifier(page)).not.toHaveValue("");
      await expect(password(page)).toHaveValue("");
      await expect(password(page)).toBeFocused();
      await expect(page).toHaveURL(/\/login$/);
      sql(env, "DELETE FROM private.sign_in_throttle;");
    }
    await typeAndSubmit(page, "ninguem.e2e201f6@teste.invalid", PASSWORD);
    await expect(message(page)).toHaveText(INVALID_MESSAGE);
    await expect(page.getByText(/excluíd|não encontrad/i)).toHaveCount(0);
  });

  test("RN-14: a Auditoria registra login_failed com o motivo member_deleted (rótulo 'Cadastro excluído')", async () => {
    await signInApi(DORA.email, PASSWORD);
    expect(lastFailureReason(DORA)).toBe("member_deleted");
  });

  test("RN-14: o login direto no Auth não revela nada (provedor desligado ou conta suspensa) e a senha não é conferida", async () => {
    const before = sql(env, "SELECT count(*) FROM private.sign_in_throttle");
    const response = await fetch(`${env.apiUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: env.publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: DORA.email, password: PASSWORD }),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = await response.text();
    expect(body).not.toMatch(/banned/i);
    expect(sql(env, "SELECT count(*) FROM private.sign_in_throttle")).toBe(before);
  });

  test("RN-14 (restauração): depois de restore_member, o mesmo membro entra de novo com a mesma senha", async ({ page }) => {
    restoreMember(DORA);
    for (const typed of [DORA.email, DORA.cpf ?? "", DORA.mobile ?? ""]) {
      await typeAndSubmit(page, typed, PASSWORD);
      await expectSignedIn(page);
      await page.evaluate(() => localStorage.clear());
      await page.context().clearCookies();
    }
    // Excluída de novo, volta a ser recusada.
    deleteMember(DORA);
    await typeAndSubmit(page, DORA.email, PASSWORD);
    await expect(message(page)).toHaveText(INVALID_MESSAGE);
    restoreMember(DORA);
  });
});

test.describe("UX-36: a sessão de um membro excluído termina", () => {
  test("(a) próxima leitura recusada: abrir o Dashboard leva ao /login com o aviso", async ({ browser }) => {
    const { context, page } = await openSession(browser, EVA);
    await page.getByRole("button", { name: "Membros" }).click();
    await expect(page).toHaveURL(/\/members/);
    deleteMember(EVA);
    await page.getByRole("button", { name: "Dashboard" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(sessionNotice(page)).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: SESSION_ENDED })).toBeVisible();
    // Sem sessão: voltar a uma rota protegida pede o login de novo.
    await page.goto("/members");
    await expect(page).toHaveURL(/\/login$/);
    await context.close();
  });

  test("(a) próxima gravação recusada: salvar os próprios dados leva ao /login com o aviso", async ({ browser }) => {
    const { context, page } = await openSession(browser, FABIO);
    await page.getByRole("button", { name: "Editar meus dados" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    deleteMember(FABIO);
    // Sem mudança, o formulário fecha sem gravar (E2.04, DA-9): a próxima gravação precisa de uma alteração.
    await page.getByLabel("Observações").fill("Mudou depois de excluído");
    await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(sessionNotice(page)).toBeVisible();
    await context.close();
  });

  test("(b) a volta do foco encerra a sessão com o aviso, sem nenhuma outra ação", async ({ browser }) => {
    const { context, page } = await openSession(browser, GIL);
    deleteMember(GIL);
    await returnFocus(page);
    await expect(page).toHaveURL(/\/login$/);
    await expect(sessionNotice(page)).toBeVisible();
    await context.close();
  });

  test("(c) sem rede, a volta do foco não encerra a sessão", async ({ browser }) => {
    const { context, page } = await openSession(browser, HANA);
    deleteMember(HANA);
    await context.setOffline(true);
    await returnFocus(page);
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(/\/$/);
    await expect(sessionNotice(page)).toHaveCount(0);
    await context.setOffline(false);
    await context.close();
  });

  test("(c) um erro 5xx na releitura do cadastro não encerra a sessão", async ({ browser }) => {
    const { context, page } = await openSession(browser, JUCA);
    deleteMember(JUCA);
    await page.route("**/rest/v1/members_view*", (route) => route.fulfill({ status: 503, body: "{}", contentType: "application/json" }));
    await returnFocus(page);
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(/\/$/);
    await expect(sessionNotice(page)).toHaveCount(0);
    // Voltando a rede, a próxima volta do foco (passados os 10 s) encerra.
    await page.unroute("**/rest/v1/members_view*");
    await page.waitForTimeout(10_500);
    await returnFocus(page);
    await expect(page).toHaveURL(/\/login$/);
    await expect(sessionNotice(page)).toBeVisible();
    await context.close();
  });

  test("(d) o botão Sair leva ao /login sem o aviso de sessão encerrada", async ({ browser }) => {
    const { context, page } = await openSession(browser, IVO);
    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(identifier(page)).toBeVisible();
    await expect(sessionNotice(page)).toHaveCount(0);
    await context.close();
  });
});
